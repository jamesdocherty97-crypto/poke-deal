/** Normalize dealer-entered catalog text for search and matching. */
export function normalizeSearchText(input: string): string {
  return input
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[♀]/g, " f ")
    .replace(/[♂]/g, " m ")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function tokenizeSearchText(input: string): string[] {
  const normalized = normalizeSearchText(input);
  return normalized ? normalized.split(" ") : [];
}

export function tokenMatches(queryToken: string, candidateToken: string): boolean {
  if (queryToken === candidateToken) return true;
  if (queryToken.length >= 3 && candidateToken.startsWith(queryToken)) return true;
  if (queryToken.length >= 4 && candidateToken.length >= 4) {
    return damerauLevenshtein(queryToken, candidateToken) <= 1;
  }
  return false;
}

/**
 * Damerau-Levenshtein distance with adjacent transpositions. Good enough for
 * catalogue typo tolerance without adding a dependency.
 */
export function damerauLevenshtein(a: string, b: string): number {
  const left = normalizeSearchText(a);
  const right = normalizeSearchText(b);
  if (left === right) return 0;
  if (!left) return right.length;
  if (!right) return left.length;

  const rows = left.length + 1;
  const cols = right.length + 1;
  const dp = Array.from({ length: rows }, () => Array<number>(cols).fill(0));
  for (let i = 0; i < rows; i++) dp[i]![0] = i;
  for (let j = 0; j < cols; j++) dp[0]![j] = j;

  for (let i = 1; i <= left.length; i++) {
    for (let j = 1; j <= right.length; j++) {
      const cost = left[i - 1] === right[j - 1] ? 0 : 1;
      dp[i]![j] = Math.min(
        dp[i - 1]![j]! + 1,
        dp[i]![j - 1]! + 1,
        dp[i - 1]![j - 1]! + cost,
      );
      if (
        i > 1 &&
        j > 1 &&
        left[i - 1] === right[j - 2] &&
        left[i - 2] === right[j - 1]
      ) {
        dp[i]![j] = Math.min(dp[i]![j]!, dp[i - 2]![j - 2]! + 1);
      }
    }
  }

  return dp[left.length]![right.length]!;
}

export function scoreSearchText(query: string, candidate: string): number {
  const normalizedQuery = normalizeSearchText(query);
  const normalizedCandidate = normalizeSearchText(candidate);
  if (!normalizedQuery || !normalizedCandidate) return 0;
  if (normalizedCandidate === normalizedQuery) return 1000;
  if (normalizedCandidate.startsWith(normalizedQuery)) {
    return Math.max(850 - (normalizedCandidate.length - normalizedQuery.length) * 4, 650);
  }

  const queryTokens = tokenizeSearchText(query);
  const candidateTokens = tokenizeSearchText(candidate);
  if (queryTokens.length > 0 && candidateTokens.length > 0) {
    let editPenalty = 0;
    const allMatched = queryTokens.every((qt) => {
      const distances = candidateTokens
        .filter((ct) => tokenMatches(qt, ct))
        .map((ct) => (qt === ct || ct.startsWith(qt) ? 0 : damerauLevenshtein(qt, ct)));
      if (distances.length === 0) return false;
      editPenalty += Math.min(...distances);
      return true;
    });
    if (allMatched) {
      const extra = Math.max(candidateTokens.length - queryTokens.length, 0);
      return Math.max(700 - extra * 30 - editPenalty * 45, 120);
    }
  }

  const wholeDistance = damerauLevenshtein(normalizedQuery, normalizedCandidate);
  const maxLen = Math.max(normalizedQuery.length, normalizedCandidate.length);
  if (wholeDistance <= 2 || wholeDistance / maxLen <= 0.18) {
    return Math.max(460 - wholeDistance * 55, 80);
  }

  return 0;
}
