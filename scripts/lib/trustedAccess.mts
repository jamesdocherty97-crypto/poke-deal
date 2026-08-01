const ACCESS_TOKEN_ENV_KEYS = [
  "POKE_DEAL_ACCESS_TOKEN",
  "VERIFY_PROD_ACCESS_TOKEN",
  "APP_ACCESS_TOKEN",
] as const;
const DEFAULT_PRODUCTION_ORIGIN = "https://poke-deal.vercel.app";

export type TrustedDeviceCookie = {
  name: string;
  value: string;
};

export async function trustedDeviceCookie(
  baseUrl: string,
): Promise<TrustedDeviceCookie | undefined> {
  const token = ACCESS_TOKEN_ENV_KEYS
    .map((key) => process.env[key]?.trim())
    .find(Boolean);
  if (!token) return undefined;

  const origin = new URL(baseUrl).origin;
  assertSafeEnrollmentOrigin(origin);
  const response = await fetch(new URL("/access", origin), {
    method: "POST",
    redirect: "error",
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "application/json",
      Origin: origin,
    },
    body: JSON.stringify({ token }),
  });
  if (!response.ok) {
    throw new Error(`Trusted-device enrollment failed with HTTP ${response.status}.`);
  }

  const cookiePair = response.headers.get("set-cookie")?.split(";", 1)[0];
  const separator = cookiePair?.indexOf("=") ?? -1;
  if (!cookiePair || separator <= 0 || separator === cookiePair.length - 1) {
    throw new Error("Trusted-device enrollment did not return a session cookie.");
  }

  return {
    name: cookiePair.slice(0, separator),
    value: cookiePair.slice(separator + 1),
  };
}

function assertSafeEnrollmentOrigin(origin: string): void {
  const url = new URL(origin);
  if (url.protocol === "http:" && isLoopbackHostname(url.hostname)) return;
  if (url.protocol !== "https:") {
    throw new Error("Trusted-device enrollment requires HTTPS or a loopback development URL.");
  }

  const configuredOrigin = (
    process.env.POKE_DEAL_ACCESS_ORIGIN
    ?? process.env.NEXT_PUBLIC_APP_URL
    ?? DEFAULT_PRODUCTION_ORIGIN
  ).trim();
  let expectedOrigin: string;
  try {
    expectedOrigin = new URL(configuredOrigin).origin;
  } catch {
    throw new Error("POKE_DEAL_ACCESS_ORIGIN must be an absolute trusted URL.");
  }
  if (origin !== expectedOrigin) {
    throw new Error("Refusing to send the enrollment token to an unapproved origin.");
  }
}

function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return normalized === "localhost" || normalized === "127.0.0.1" || normalized === "[::1]" || normalized === "::1";
}

export async function trustedDeviceHeaders(
  baseUrl: string,
  headers: Record<string, string> = {},
): Promise<Record<string, string>> {
  const cookie = await trustedDeviceCookie(baseUrl);
  if (!cookie) return { ...headers };
  return { ...headers, Cookie: `${cookie.name}=${cookie.value}` };
}
