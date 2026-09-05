const DB_NAME = "poke-deal-offline";
const DB_VERSION = 3;
const QUEUE_STORE = "mutation-queue";
const COMP_STORE = "comp-cache";
const BOOTSTRAP_STORE = "bootstrap-cache";
const SYNC_TAG = "poke-deal-mutations";
const SHELL_CACHE = "poke-deal-shell-v3";

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(SHELL_CACHE).then((cache) => cache.addAll(["/", "/manifest.webmanifest"])).catch(() => undefined));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(Promise.all([
    caches.keys().then((keys) => Promise.all(keys.filter((key) => key.startsWith("poke-deal-shell-") && key !== SHELL_CACHE).map((key) => caches.delete(key)))),
    self.clients.claim(),
  ]));
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;
  if (request.mode === "navigate") {
    event.respondWith(fetch(request).then((response) => {
      if (url.pathname === "/" && response.ok && (response.headers.get("content-type") || "").includes("text/html")) {
        const copy = response.clone();
        caches.open(SHELL_CACHE).then((cache) => cache.put("/", copy));
      }
      return response;
    }).catch(() => caches.match(request).then((match) => match || caches.match("/"))));
    return;
  }
  if (url.pathname.startsWith("/_next/static/") || /\.(?:png|jpg|jpeg|webp|svg|woff2?)$/i.test(url.pathname)) {
    event.respondWith(caches.match(request).then((cached) => cached || fetch(request).then((response) => {
      if (response.ok) {
        const copy = response.clone();
        caches.open(SHELL_CACHE).then((cache) => cache.put(request, copy));
      }
      return response;
    })));
  }
});

self.addEventListener("sync", (event) => {
  if (event.tag === SYNC_TAG) event.waitUntil(flushQueue());
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "POKE_DEAL_FLUSH") event.waitUntil(flushQueue());
});

async function flushQueue() {
  const db = await openDb();
  const rows = await readAll(db);
  let synced = 0;
  let failed = 0;
  for (const queued of rows.sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
    if (queued.requiresClient || queued.syncedAt) continue;
    if (queued.nextAttemptAt && Date.parse(queued.nextAttemptAt) > Date.now()) continue;
    const mutation = queued.kind === "mark-sold" ? await claimSale(db, queued.id) : queued;
    if (!mutation) continue;
    try {
      const response = await fetch(mutation.endpoint, {
        method: mutation.method,
        headers: { ...mutation.headers, "X-Poke-Deal-Mutation-Id": mutation.id },
        credentials: "same-origin",
        ...(mutation.body == null ? {} : { body: JSON.stringify(mutation.body) }),
      });
      if (response.ok) {
        if (mutation.kind === "mark-sold") {
          const payload = await response.clone().json().catch(() => null);
          const item = payload?.item;
          const match = /^\/api\/inventory\/([^/?]+)\/sell$/.exec(mutation.endpoint);
          const itemId = match ? decodeURIComponent(match[1]) : null;
          if (!item || item.id !== itemId || !Number.isSafeInteger(item.quantity) || item.quantity < 0 || !["IN_STOCK", "LISTED", "RESERVED", "SOLD"].includes(item.status) || !Number.isFinite(Date.parse(item.updatedAt || ""))) {
            throw new Error("Sale response did not confirm current stock. Retry sync to reconcile this sale safely.");
          }
          mutation.syncedAt = new Date().toISOString();
          mutation.syncStartedAt = null;
          mutation.lastError = null;
          mutation.stockAfterSync = { id: item.id, quantity: item.quantity, status: item.status, updatedAt: item.updatedAt };
          await put(db, mutation);
        } else {
          await remove(db, mutation.id);
        }
        synced += 1;
        continue;
      }
      mutation.attempts += 1;
      mutation.updatedAt = new Date().toISOString();
      mutation.lastError = await errorMessage(response);
      mutation.syncStartedAt = null;
      if ([401, 403, 408, 425, 429].includes(response.status) || response.status >= 500) {
        mutation.nextAttemptAt = new Date(Date.now() + Math.min(1000 * 2 ** mutation.attempts, 900000)).toISOString();
      } else {
        mutation.nextAttemptAt = null;
        mutation.requiresClient = true;
        mutation.mayHaveReachedServer = false;
      }
      await put(db, mutation);
      failed += 1;
    } catch (error) {
      mutation.attempts += 1;
      mutation.updatedAt = new Date().toISOString();
      mutation.lastError = error instanceof Error ? error.message : "Network request failed";
      mutation.syncStartedAt = null;
      mutation.nextAttemptAt = new Date(Date.now() + Math.min(1000 * 2 ** mutation.attempts, 900000)).toISOString();
      await put(db, mutation);
      failed += 1;
      break;
    }
  }
  const clients = await self.clients.matchAll({ includeUncontrolled: true, type: "window" });
  clients.forEach((client) => client.postMessage({ type: "POKE_DEAL_SYNC_STATE", synced, failed }));
  db.close();
}

function openDb() {
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
    request.onerror = () => reject(request.error);
  });
}

function readAll(db) {
  return requestResult(db.transaction(QUEUE_STORE, "readonly").objectStore(QUEUE_STORE).getAll());
}

function remove(db, id) {
  return requestResult(db.transaction(QUEUE_STORE, "readwrite").objectStore(QUEUE_STORE).delete(id));
}

function put(db, value) {
  return queueTransaction(db, (rows, store) => {
    const current = rows.find((row) => row.id === value.id);
    if (current && !current.syncedAt) store.put(value);
  });
}

function claimSale(db, id) {
  return queueTransaction(db, (rows, store) => {
    const mutation = rows.find((row) => row.id === id);
    if (!mutation || mutation.syncedAt || mutation.requiresClient) return null;
    if (mutation.nextAttemptAt && Date.parse(mutation.nextAttemptAt) > Date.now()) return null;
    if (mutation.syncStartedAt && Date.now() - Date.parse(mutation.syncStartedAt) < 120000) return null;
    mutation.syncStartedAt = new Date().toISOString();
    mutation.mayHaveReachedServer = true;
    store.put(mutation);
    return mutation;
  });
}

function queueTransaction(db, action) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(QUEUE_STORE, "readwrite");
    const store = transaction.objectStore(QUEUE_STORE);
    const request = store.getAll();
    let result;
    let failure;
    request.onsuccess = () => {
      try { result = action(request.result, store); }
      catch (error) { failure = error; transaction.abort(); }
    };
    transaction.oncomplete = () => resolve(result);
    transaction.onerror = transaction.onabort = () => reject(failure || transaction.error || new Error("Offline queue transaction failed"));
  });
}

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function errorMessage(response) {
  try {
    const payload = await response.clone().json();
    return payload.error || `Sync failed (${response.status})`;
  } catch {
    return `Sync failed (${response.status})`;
  }
}
