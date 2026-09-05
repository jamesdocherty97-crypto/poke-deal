import {
  canonicalCompCacheKey,
  compCacheFreshness,
  isDueOfflineMutation,
  offlineBootstrapFreshness,
  offlineRetryDelayMs,
  shouldRetryOfflineResponse,
  type CompCacheIdentity,
} from "./policy.js";
import { availableOfflineSaleQuantity, offlineSaleItemId, offlineSaleQuantity, readOfflineSaleStock, type OfflineSaleStock } from "./pendingSales.js";

const DB_NAME = "poke-deal-offline";
// v3 retains all stores while preventing older clients from deleting sale receipts.
const DB_VERSION = 3;
const QUEUE_STORE = "mutation-queue";
const COMP_STORE = "comp-cache";
const BOOTSTRAP_STORE = "bootstrap-cache";
const STATE_EVENT = "poke-deal:offline-state";
export const OFFLINE_SYNC_TAG = "poke-deal-mutations";

export type OfflineMutationKind = "acquire" | "mark-sold" | "review-resolution" | "scan-correction" | "comp-intent" | "scan-intent" | "quick-fill";

export type OfflineMutationSummary = {
  label: string;
  detail?: string;
  cardName?: string;
  grade?: string;
  quantity?: number;
  amountPence?: number;
  photo?: { width: number; height: number; mimeType: string };
};

export type OfflineMutation = {
  id: string;
  kind: OfflineMutationKind;
  endpoint: string;
  method: "GET" | "POST" | "PATCH";
  headers: Record<string, string>;
  body?: unknown;
  summary: OfflineMutationSummary;
  createdAt: string;
  updatedAt: string;
  attempts: number;
  nextAttemptAt: string | null;
  lastError: string | null;
  requiresClient: boolean;
  /** Original stock snapshot used to reserve a queued sale atomically. */
  saleStock?: OfflineSaleStock;
  /** Retained sale receipt protects tabs with stale inventory after sync. */
  syncedAt?: string | null;
  stockAfterSync?: OfflineSaleStock;
  syncStartedAt?: string | null;
  mayHaveReachedServer?: boolean;
};

export type OfflineCompCacheEntry<T = unknown> = {
  key: string;
  identity: CompCacheIdentity;
  payload: T;
  cachedAt: string;
  lastAccessedAt: string;
};

export type OfflineBootstrapEntry<T = unknown> = {
  key: "latest";
  payload: T;
  cachedAt: string;
};

export type OfflineSyncState = {
  supported: boolean;
  online: boolean;
  syncing: boolean;
  pendingCount: number;
  failedCount: number;
  lastError: string | null;
};

export type OfflineFlushResult = {
  synced: OfflineMutation[];
  blocked: OfflineMutation[];
  remaining: OfflineMutation[];
};

let currentSyncing = false;
let currentLastError: string | null = null;
let flushInFlight: Promise<OfflineFlushResult> | null = null;
let stateChannel: BroadcastChannel | null = null;

export function offlineStorageSupported(): boolean {
  return typeof window !== "undefined" && "indexedDB" in window;
}

export async function enqueueOfflineMutation(input: {
  id?: string;
  kind: OfflineMutationKind;
  endpoint: string;
  method?: OfflineMutation["method"];
  body?: unknown;
  headers?: Record<string, string>;
  summary: OfflineMutationSummary;
  requiresClient?: boolean;
  saleStock?: OfflineSaleStock;
  mayHaveReachedServer?: boolean;
}): Promise<OfflineMutation> {
  const now = new Date().toISOString();
  const mutation: OfflineMutation = {
    id: input.id ?? crypto.randomUUID(),
    kind: input.kind,
    endpoint: input.endpoint,
    method: input.method ?? "POST",
    headers: {
      ...(input.body == null ? {} : { "Content-Type": "application/json" }),
      ...input.headers,
    },
    ...(input.body == null ? {} : { body: input.body }),
    summary: input.summary,
    createdAt: now,
    updatedAt: now,
    attempts: 0,
    nextAttemptAt: null,
    lastError: null,
    requiresClient: Boolean(input.requiresClient),
    ...(input.saleStock ? { saleStock: readOfflineSaleStock({ item: input.saleStock }) } : {}),
    mayHaveReachedServer: Boolean(input.mayHaveReachedServer),
  };
  const saved = await withQueueRows((rows, store) => {
    const existing = rows.find((row) => row.id === mutation.id);
    if (existing) return existing;
    if (mutation.kind === "mark-sold") {
      const stock = mutation.saleStock;
      if (!stock || stock.id !== offlineSaleItemId(mutation)) throw new Error("Reload this stock row before saving an offline sale.");
      const available = availableOfflineSaleQuantity(stock, rows);
      if (offlineSaleQuantity(mutation) > available) {
        throw new Error(`Only ${available} available on this device; other copies are reserved by queued sales.`);
      }
    }
    store.put(mutation);
    return mutation;
  });
  // Safari/unsupported workers may never resolve serviceWorker.ready. Local
  // persistence must complete without depending on worker installation.
  void requestBackgroundSync();
  emitOfflineState();
  return saved;
}

export async function listOfflineMutations(): Promise<OfflineMutation[]> {
  const rows = await getAllRecords<OfflineMutation>(QUEUE_STORE);
  return rows.filter((row) => !row.syncedAt).sort((left, right) => left.createdAt.localeCompare(right.createdAt));
}

export async function listOfflineSaleReservations(): Promise<OfflineMutation[]> {
  return (await getAllRecords<OfflineMutation>(QUEUE_STORE)).filter((row) => row.kind === "mark-sold");
}

/** Keep successful online sales safe if the subsequent inventory refresh fails. */
export async function recordOfflineSaleReceipt(mutationId: string, item: OfflineSaleStock): Promise<OfflineMutation> {
  const stock = readOfflineSaleStock({ item });
  if (!stock || !Number.isFinite(Date.parse(stock.updatedAt ?? ""))) throw new Error("Sale response did not confirm current stock.");
  const now = new Date().toISOString();
  const receipt = await withQueueRows((rows, store) => {
    const existing = rows.find((row) => row.id === mutationId);
    if (existing && offlineSaleItemId(existing) !== stock.id) throw new Error("Sale receipt belongs to a different queued action.");
    if (existing?.stockAfterSync && Date.parse(existing.stockAfterSync.updatedAt ?? "") > Date.parse(stock.updatedAt!)) return existing;
    const value: OfflineMutation = {
      id: mutationId,
      kind: "mark-sold",
      endpoint: `/api/inventory/${encodeURIComponent(stock.id)}/sell`,
      method: "POST",
      headers: {},
      summary: { label: "Confirmed sale" },
      createdAt: now,
      attempts: 0,
      ...existing,
      updatedAt: now,
      nextAttemptAt: null,
      lastError: null,
      requiresClient: false,
      syncedAt: now,
      stockAfterSync: stock,
      syncStartedAt: null,
      mayHaveReachedServer: true,
    };
    store.put(value);
    return value;
  });
  emitOfflineState();
  return receipt;
}

export async function removeOfflineMutation(id: string): Promise<void> {
  await withQueueRows((rows, store) => {
    const mutation = rows.find((row) => row.id === id);
    if (mutation?.kind === "mark-sold" && (mutation.syncedAt || mutation.syncStartedAt || mutation.mayHaveReachedServer)) {
      throw new Error("This sale may already be recorded on the server. Reconnect and reconcile it before undoing the sale.");
    }
    store.delete(id);
  });
  emitOfflineState();
}

export async function retryOfflineMutation(id: string): Promise<void> {
  await withQueueRows((rows, store) => {
    const mutation = rows.find((row) => row.id === id);
    if (!mutation || mutation.syncedAt || (mutation.syncStartedAt && Date.now() - Date.parse(mutation.syncStartedAt) < 120_000)) return;
    mutation.requiresClient = false;
    mutation.nextAttemptAt = null;
    mutation.lastError = null;
    mutation.syncStartedAt = null;
    mutation.updatedAt = new Date().toISOString();
    store.put(mutation);
  });
  emitOfflineState();
  void requestBackgroundSync();
}

export async function putOfflineComp<T>(identity: CompCacheIdentity, payload: T, cachedAt = new Date().toISOString()): Promise<void> {
  const key = canonicalCompCacheKey(identity);
  const entry: OfflineCompCacheEntry<T> = { key, identity, payload, cachedAt, lastAccessedAt: new Date().toISOString() };
  await putRecord(COMP_STORE, entry);
}

export async function getOfflineComp<T>(identity: CompCacheIdentity): Promise<{
  payload: T;
  cachedAt: string;
  ageHours: number;
  stale: boolean;
} | null> {
  const key = canonicalCompCacheKey(identity);
  const entry = await getRecord<OfflineCompCacheEntry<T>>(COMP_STORE, key);
  if (!entry) return null;
  const freshness = compCacheFreshness(entry.cachedAt);
  if (freshness.state === "expired") {
    await deleteRecord(COMP_STORE, key);
    return null;
  }
  entry.lastAccessedAt = new Date().toISOString();
  await putRecord(COMP_STORE, entry);
  return { payload: entry.payload, cachedAt: entry.cachedAt, ageHours: freshness.ageHours, stale: freshness.state === "stale" };
}

export async function putOfflineBootstrap<T>(payload: T, cachedAt = new Date().toISOString()): Promise<void> {
  await putRecord(BOOTSTRAP_STORE, { key: "latest", payload, cachedAt } satisfies OfflineBootstrapEntry<T>);
}

export async function getOfflineBootstrap<T>(): Promise<{ payload: T; cachedAt: string; ageHours: number } | null> {
  const entry = await getRecord<OfflineBootstrapEntry<T>>(BOOTSTRAP_STORE, "latest");
  if (!entry) return null;
  const freshness = offlineBootstrapFreshness(entry.cachedAt);
  if (freshness.expired) {
    await deleteRecord(BOOTSTRAP_STORE, "latest");
    return null;
  }
  return { payload: entry.payload, cachedAt: entry.cachedAt, ageHours: freshness.ageHours };
}

export async function getOfflineSyncState(): Promise<OfflineSyncState> {
  if (!offlineStorageSupported()) {
    return { supported: false, online: typeof navigator === "undefined" ? true : navigator.onLine, syncing: false, pendingCount: 0, failedCount: 0, lastError: "Offline storage unavailable" };
  }
  const queue = await listOfflineMutations().catch(() => []);
  return {
    supported: true,
    online: navigator.onLine,
    syncing: currentSyncing,
    pendingCount: queue.length,
    failedCount: queue.filter((row) => Boolean(row.lastError)).length,
    lastError: currentLastError ?? queue.find((row) => row.lastError)?.lastError ?? null,
  };
}

export function subscribeOfflineState(listener: (state: OfflineSyncState) => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  const update = () => void getOfflineSyncState().then(listener);
  window.addEventListener(STATE_EVENT, update);
  window.addEventListener("online", update);
  window.addEventListener("offline", update);
  navigator.serviceWorker?.addEventListener("message", update);
  const channel = offlineStateChannel();
  channel?.addEventListener("message", update);
  update();
  return () => {
    window.removeEventListener(STATE_EVENT, update);
    window.removeEventListener("online", update);
    window.removeEventListener("offline", update);
    navigator.serviceWorker?.removeEventListener("message", update);
    channel?.removeEventListener("message", update);
  };
}

export async function registerOfflineWorker(): Promise<ServiceWorkerRegistration | null> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return null;
  const registration = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
  if (navigator.onLine) void flushOfflineQueue();
  return registration;
}

export async function flushOfflineQueue(fetcher: typeof fetch = fetch): Promise<OfflineFlushResult> {
  if (flushInFlight) return flushInFlight;
  flushInFlight = runFlush(fetcher).finally(() => {
    flushInFlight = null;
  });
  return flushInFlight;
}

async function runFlush(fetcher: typeof fetch): Promise<OfflineFlushResult> {
  const synced: OfflineMutation[] = [];
  const blocked: OfflineMutation[] = [];
  currentSyncing = true;
  currentLastError = null;
  emitOfflineState();
  try {
    const queue = await listOfflineMutations();
    if (typeof navigator !== "undefined" && !navigator.onLine) return { synced, blocked, remaining: queue };
    for (const queued of queue) {
      if (queued.requiresClient || !isDueOfflineMutation(queued)) continue;
      const mutation = queued.kind === "mark-sold" ? await claimOfflineSale(queued.id) : queued;
      if (!mutation) continue;
      try {
        const response = await fetcher(mutation.endpoint, {
          method: mutation.method,
          headers: { ...mutation.headers, "X-Poke-Deal-Mutation-Id": mutation.id },
          credentials: "same-origin",
          ...(mutation.body == null ? {} : { body: JSON.stringify(mutation.body) }),
        });
        if (response.ok) {
          if (mutation.kind === "mark-sold") {
            const payload: unknown = await response.clone().json().catch(() => null);
            const confirmedStock = readOfflineSaleStock(payload);
            if (!confirmedStock || confirmedStock.id !== offlineSaleItemId(mutation) || !Number.isFinite(Date.parse(confirmedStock.updatedAt ?? ""))) {
              throw new Error("Sale response did not confirm current stock. Retry sync to reconcile this sale safely.");
            }
            mutation.syncedAt = new Date().toISOString();
            mutation.stockAfterSync = confirmedStock;
            mutation.syncStartedAt = null;
            mutation.lastError = null;
            await saveOfflineSaleResult(mutation);
          } else {
            await deleteRecord(QUEUE_STORE, mutation.id);
          }
          synced.push(mutation);
          continue;
        }
        const message = await responseError(response);
        mutation.attempts += 1;
        mutation.updatedAt = new Date().toISOString();
        mutation.lastError = message;
        mutation.syncStartedAt = null;
        if (shouldRetryOfflineResponse(response.status)) {
          mutation.nextAttemptAt = new Date(Date.now() + offlineRetryDelayMs(mutation.attempts)).toISOString();
        } else {
          mutation.nextAttemptAt = null;
          mutation.requiresClient = true;
          mutation.mayHaveReachedServer = false;
          blocked.push(mutation);
        }
        await saveOfflineSaleResult(mutation);
        currentLastError = message;
      } catch (error) {
        mutation.attempts += 1;
        mutation.updatedAt = new Date().toISOString();
        mutation.lastError = error instanceof Error ? error.message : "Network request failed";
        mutation.syncStartedAt = null;
        mutation.nextAttemptAt = new Date(Date.now() + offlineRetryDelayMs(mutation.attempts)).toISOString();
        await saveOfflineSaleResult(mutation);
        currentLastError = mutation.lastError;
        break;
      }
    }
    return { synced, blocked, remaining: await listOfflineMutations() };
  } finally {
    currentSyncing = false;
    emitOfflineState();
  }
}

async function requestBackgroundSync(): Promise<void> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
  try {
    const registration = await navigator.serviceWorker.ready;
    const syncRegistration = registration as ServiceWorkerRegistration & { sync?: { register(tag: string): Promise<void> } };
    await syncRegistration.sync?.register(OFFLINE_SYNC_TAG);
  } catch {
    // Foreground online listeners are the supported fallback.
  }
}

function emitOfflineState() {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(STATE_EVENT));
  offlineStateChannel()?.postMessage("changed");
}

function offlineStateChannel(): BroadcastChannel | null {
  if (typeof window === "undefined" || typeof BroadcastChannel === "undefined") return null;
  try { return stateChannel ??= new BroadcastChannel(STATE_EVENT); }
  catch { return null; }
}

async function claimOfflineSale(id: string): Promise<OfflineMutation | null> {
  return withQueueRows((rows, store) => {
    const mutation = rows.find((row) => row.id === id);
    if (!mutation || mutation.syncedAt || mutation.requiresClient || !isDueOfflineMutation(mutation)) return null;
    if (mutation.syncStartedAt && Date.now() - Date.parse(mutation.syncStartedAt) < 120_000) return null;
    mutation.syncStartedAt = new Date().toISOString();
    mutation.mayHaveReachedServer = true;
    store.put(mutation);
    return mutation;
  });
}

async function saveOfflineSaleResult(mutation: OfflineMutation): Promise<void> {
  await withQueueRows((rows, store) => {
    const existing = rows.find((row) => row.id === mutation.id);
    // A late retry error must not erase another tab/worker's successful receipt.
    if (!existing || existing.syncedAt) return;
    store.put(mutation);
  });
}

async function responseError(response: Response): Promise<string> {
  try {
    const payload = await response.clone().json() as { error?: string };
    return payload.error ?? `Sync failed (${response.status})`;
  } catch {
    return `Sync failed (${response.status})`;
  }
}

function openOfflineDb(): Promise<IDBDatabase> {
  if (!offlineStorageSupported()) return Promise.reject(new Error("Offline storage unavailable"));
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    let blocked = false;
    request.onblocked = () => {
      blocked = true;
      reject(new Error("Close or reload older Poke Deal tabs to update offline storage. Queued actions are retained."));
    };
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(QUEUE_STORE)) db.createObjectStore(QUEUE_STORE, { keyPath: "id" });
      if (!db.objectStoreNames.contains(COMP_STORE)) db.createObjectStore(COMP_STORE, { keyPath: "key" });
      if (!db.objectStoreNames.contains(BOOTSTRAP_STORE)) db.createObjectStore(BOOTSTRAP_STORE, { keyPath: "key" });
    };
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => db.close();
      if (blocked) db.close();
      else resolve(db);
    };
    request.onerror = () => reject(request.error ?? new Error("Offline storage failed to open"));
  });
}

/** IndexedDB serializes readwrite transactions across tabs and the worker. */
async function withQueueRows<T>(action: (rows: OfflineMutation[], store: IDBObjectStore) => T): Promise<T> {
  const db = await openOfflineDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(QUEUE_STORE, "readwrite");
    const store = transaction.objectStore(QUEUE_STORE);
    const request = store.getAll();
    let result: T;
    let failure: unknown;
    request.onsuccess = () => {
      try { result = action(request.result as OfflineMutation[], store); }
      catch (error) { failure = error; transaction.abort(); }
    };
    transaction.oncomplete = () => { db.close(); resolve(result!); };
    transaction.onabort = transaction.onerror = () => {
      db.close();
      reject(failure ?? transaction.error ?? new Error("Offline storage transaction failed"));
    };
  });
}

async function withStore<T>(storeName: string, mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openOfflineDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, mode);
    const request = action(transaction.objectStore(storeName));
    let requestResult: T;
    let requestCompleted = false;
    let settled = false;
    request.onsuccess = () => {
      requestResult = request.result;
      requestCompleted = true;
    };
    request.onerror = () => {
      if (settled) return;
      settled = true;
      db.close();
      reject(request.error ?? new Error("Offline storage request failed"));
    };
    transaction.oncomplete = () => {
      if (settled) return;
      settled = true;
      db.close();
      if (!requestCompleted) {
        reject(new Error("Offline storage transaction completed without a result"));
        return;
      }
      resolve(requestResult!);
    };
    const rejectTransaction = () => {
      if (settled) return;
      settled = true;
      db.close();
      reject(transaction.error ?? new Error("Offline storage transaction failed"));
    };
    transaction.onerror = rejectTransaction;
    transaction.onabort = rejectTransaction;
  });
}

function putRecord<T>(store: string, value: T): Promise<IDBValidKey> {
  return withStore(store, "readwrite", (objectStore) => objectStore.put(value));
}

function deleteRecord(store: string, key: IDBValidKey): Promise<undefined> {
  return withStore(store, "readwrite", (objectStore) => objectStore.delete(key)) as Promise<undefined>;
}

function getRecord<T>(store: string, key: IDBValidKey): Promise<T | undefined> {
  return withStore(store, "readonly", (objectStore) => objectStore.get(key)) as Promise<T | undefined>;
}

function getAllRecords<T>(store: string): Promise<T[]> {
  return withStore(store, "readonly", (objectStore) => objectStore.getAll()) as Promise<T[]>;
}
