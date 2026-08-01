export function accessPageSecurityHeaders(nonce: string): Record<string, string> {
  return {
    "Cache-Control": "no-store, max-age=0",
    "Content-Security-Policy": `default-src 'none'; img-src data:; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
  };
}

export function accessPage(nonce: string): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
  <link rel="icon" href="data:," />
  <title>Unlock Poke Deal</title>
  <style nonce="${nonce}">
    :root { color-scheme: dark; --bg: #080b13; --ink: #f8fbff; --muted: #aeb9cf; --yellow: #ffcb05; --red: #ef3340; --blue: #2a75bb; }
    * { box-sizing: border-box; }
    body { min-height: 100vh; min-height: 100svh; margin: 0; display: grid; place-items: center; background: radial-gradient(circle at 72% 18%, rgba(255,203,5,.2), transparent 24%), linear-gradient(140deg, rgba(239,51,64,.22), rgba(42,117,187,.18) 48%, var(--bg)); color: var(--ink); font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    main { display: grid; justify-items: center; gap: 16px; width: min(420px, calc(100vw - 32px)); padding: max(28px, env(safe-area-inset-top)) 22px max(28px, env(safe-area-inset-bottom)); text-align: center; }
    .ball { position: relative; width: 96px; height: 96px; border: 5px solid #101827; border-radius: 999px; background: linear-gradient(#f8fbff 0 48%, #101827 48% 52%, var(--red) 52% 100%); box-shadow: inset 0 0 0 5px rgba(255,255,255,.78), 0 18px 48px rgba(0,0,0,.4); }
    .ball::before { position: absolute; inset: 50% auto auto 50%; width: 28px; height: 28px; content: ""; border: 5px solid #101827; border-radius: inherit; background: #f8fbff; transform: translate(-50%, -50%); }
    h1 { margin: 0; font-size: 36px; line-height: 1; }
    p { max-width: 32ch; margin: 0; color: var(--muted); font-size: 15px; line-height: 1.5; }
  </style>
</head>
<body>
  <main>
    <span class="ball" aria-hidden="true"></span>
    <h1>Trusting this browser</h1>
    <p id="status" role="status" aria-live="polite">Creating private Poke Deal access…</p>
  </main>
  <script nonce="${nonce}">
    (() => {
      const status = document.getElementById("status");
      const token = location.hash.slice(1);
      history.replaceState(null, "", "/access");
      if (!token) {
        status.textContent = "This access link is incomplete.";
        return;
      }
      fetch("/access", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token })
      }).then((response) => {
        if (!response.ok) throw new Error("Access denied");
        status.textContent = "Trusted. Opening Poke Deal…";
        location.replace("/");
      }).catch(() => {
        status.textContent = "This unlock link is invalid or no longer active.";
      });
    })();
  </script>
</body>
</html>`;
}
