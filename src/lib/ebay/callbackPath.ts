export function isEbayAccountDeletionCallbackPath(pathname: string): boolean {
  return pathname === "/api/ebay/account-deletion";
}

export function isEbayOauthCallbackPath(pathname: string): boolean {
  return pathname === "/api/ebay/oauth" || pathname === "/api/ebay/oauth/callback";
}
