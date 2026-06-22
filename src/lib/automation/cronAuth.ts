export function isAuthorizedCronRequest(authorizationHeader: string | null, secret = process.env.CRON_SECRET): boolean {
  const expected = secret?.trim();
  return Boolean(expected && authorizationHeader === `Bearer ${expected}`);
}
