export function allowsPublicAppAccess(env: Record<string, string | undefined> = process.env): boolean {
  return env.APP_PUBLIC_ACCESS?.trim().toLowerCase() === "true";
}

export function requiresAppPassword(env: Record<string, string | undefined> = process.env): boolean {
  if (allowsPublicAppAccess(env)) return false;
  const vercelEnv = env.VERCEL_ENV?.trim().toLowerCase();
  if (vercelEnv) return vercelEnv === "production";
  return env.NODE_ENV?.trim().toLowerCase() === "production";
}
