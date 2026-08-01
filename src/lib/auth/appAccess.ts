export function allowsPublicAppAccess(
  env: Record<string, string | undefined> = process.env,
  hostname?: string,
): boolean {
  if (env.VERCEL_ENV?.trim()) return false;
  if (env.APP_PUBLIC_ACCESS?.trim().toLowerCase() !== "true") return false;
  return isLoopbackHostname(hostname);
}

export function requiresTrustedDeviceAccess(
  env: Record<string, string | undefined> = process.env,
  hostname?: string,
): boolean {
  if (allowsPublicAppAccess(env, hostname)) return false;
  const vercelEnv = env.VERCEL_ENV?.trim().toLowerCase();
  if (vercelEnv) return vercelEnv !== "development";
  return env.NODE_ENV?.trim().toLowerCase() === "production";
}

function isLoopbackHostname(hostname: string | undefined): boolean {
  const normalized = hostname?.trim().toLowerCase();
  return normalized === "localhost" || normalized === "127.0.0.1" || normalized === "[::1]" || normalized === "::1";
}
