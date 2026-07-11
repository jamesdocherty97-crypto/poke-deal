const CLIENT_MUTATION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;

export type ClientMutationIdResult =
  | { ok: true; value: string | null }
  | { ok: false; error: string };

export function readClientMutationId(request: Request): ClientMutationIdResult {
  const raw = request.headers.get("x-poke-deal-mutation-id")?.trim();
  if (!raw) return { ok: true, value: null };
  if (!CLIENT_MUTATION_PATTERN.test(raw)) {
    return { ok: false, error: "X-Poke-Deal-Mutation-Id must be 8-128 safe identifier characters." };
  }
  return { ok: true, value: raw };
}

export function saleMutationFields(clientMutationId: string | null, mutationIndex: number) {
  return clientMutationId ? { clientMutationId, mutationIndex } : {};
}
