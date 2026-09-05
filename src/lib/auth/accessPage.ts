export function accessPageSecurityHeaders(nonce: string): Record<string, string> {
  return {
    "Cache-Control": "no-store, max-age=0",
    "Content-Security-Policy": `default-src 'none'; img-src data:; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "X-Robots-Tag": "noindex, nofollow, noarchive",
  };
}

export function accessPage(nonce: string): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
  <meta name="robots" content="noindex, nofollow, noarchive" />
  <link rel="icon" href="data:," />
  <title>Unlock Poke Deal</title>
  <style nonce="${nonce}">
    :root { color-scheme: dark; --bg: #080b13; --ink: #f8fbff; --muted: #aeb9cf; --yellow: #ffcb05; --red: #ef3340; --blue: #2a75bb; }
    * { box-sizing: border-box; }
    body { min-height: 100vh; min-height: 100svh; margin: 0; display: grid; place-items: center; background: radial-gradient(circle at 72% 18%, rgba(255,203,5,.2), transparent 24%), linear-gradient(140deg, rgba(239,51,64,.22), rgba(42,117,187,.18) 48%, var(--bg)); color: var(--ink); font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    main { display: grid; justify-items: center; gap: 16px; width: min(420px, calc(100vw - 32px)); padding: max(28px, env(safe-area-inset-top)) 22px max(28px, env(safe-area-inset-bottom)); text-align: center; }
    .ball { position: relative; width: 96px; height: 96px; border: 5px solid #101827; border-radius: 999px; background: linear-gradient(#f8fbff 0 48%, #101827 48% 52%, var(--red) 52% 100%); box-shadow: inset 0 0 0 5px rgba(255,255,255,.78), 0 18px 48px rgba(0,0,0,.4); }
    .ball::before { position: absolute; inset: 50% auto auto 50%; width: 28px; height: 28px; content: ""; border: 5px solid #101827; border-radius: inherit; background: #f8fbff; transform: translate(-50%, -50%); }
    h1 { margin: 0; font-size: clamp(30px, 9vw, 36px); line-height: 1.1; }
    p { max-width: 32ch; margin: 0; color: var(--muted); font-size: 15px; line-height: 1.5; }
    form { display: grid; gap: 12px; width: 100%; min-width: 0; text-align: left; }
    label { color: #fff4b0; font-size: 15px; font-weight: 700; }
    input, button { box-sizing: border-box; width: 100%; min-height: 48px; border-radius: 12px; font: inherit; font-size: 16px; }
    input { min-width: 0; padding: 12px; border: 1px solid #8090ad; background: #101827; color: #f8fbff; }
    button { padding: 12px 16px; border: 2px solid var(--yellow); background: var(--yellow); color: #101827; font-weight: 800; cursor: pointer; }
    input:focus-visible, button:focus-visible { outline: 3px solid #f8fbff; outline-offset: 4px; }
    input[aria-invalid="true"] { border-color: #ff8e98; }
    button:disabled { cursor: wait; opacity: .7; }
    #status { min-height: 3em; overflow-wrap: anywhere; }
  </style>
</head>
<body>
  <main id="main-content">
    <span class="ball" aria-hidden="true"></span>
    <h1>Unlock Poke Deal</h1>
    <p id="access-help">Paste your private unlock link or token to trust this browser. Your saved offline work stays here.</p>
    <form id="access-form" method="post" action="/access">
      <label for="access-token">Private unlock link or token</label>
      <input id="access-token" type="password" autocomplete="off" autocapitalize="none" spellcheck="false" maxlength="1024" required aria-describedby="access-help status" />
      <button id="unlock-button" type="submit">Unlock this browser</button>
    </form>
    <p id="status" role="status" aria-live="polite"></p>
    <noscript><p>Enable JavaScript to unlock this browser.</p></noscript>
  </main>
  <script nonce="${nonce}">
    (() => {
      const status = document.getElementById("status");
      const form = document.getElementById("access-form");
      const input = document.getElementById("access-token");
      const button = document.getElementById("unlock-button");
      const fragment = location.hash.slice(1);
      history.replaceState(null, "", "/access");

      function readToken(value) {
        if (value.length > 1024) return null;
        const text = value.trim();
        if (/^[A-Za-z0-9_-]{43,256}$/.test(text)) return text;
        try {
          const url = new URL(text);
          if (url.origin !== location.origin || url.pathname !== "/access" || url.search || url.username || url.password) return null;
          const token = url.hash.slice(1);
          return /^[A-Za-z0-9_-]{43,256}$/.test(token) ? token : null;
        } catch { return null; }
      }

      let submitting = false;
      async function unlock() {
        if (submitting) return;
        const token = readToken(input.value);
        if (!token) {
          input.setAttribute("aria-invalid", "true");
          status.textContent = "Paste a complete unlock link for this Poke Deal address, or its private token.";
          input.focus();
          return;
        }
        submitting = true;
        input.removeAttribute("aria-invalid");
        input.disabled = true;
        button.disabled = true;
        form.setAttribute("aria-busy", "true");
        status.textContent = "Trusting this browser…";
        try {
          const response = await fetch("/access", {
            method: "POST",
            credentials: "same-origin",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ token })
          });
          if (!response.ok) {
            status.textContent = response.status === 401
              ? "This unlock link is invalid or no longer active. Check your saved link and try again."
              : "Poke Deal could not unlock this browser right now. Try again.";
            return;
          }
          const result = await response.json();
          if (!result || result.ok !== true) {
            status.textContent = "Access was not confirmed. Try again.";
            return;
          }
          input.value = "";
          status.textContent = "Trusted. Opening Poke Deal…";
          location.replace("/");
        } catch {
          status.textContent = "Could not connect to Poke Deal. Check your connection and try again.";
        } finally {
          submitting = false;
          input.disabled = false;
          button.disabled = false;
          form.removeAttribute("aria-busy");
        }
      }
      form.addEventListener("submit", (event) => {
        event.preventDefault();
        void unlock();
      });
      if (fragment) {
        input.value = fragment;
        void unlock();
      }
    })();
  </script>
</body>
</html>`;
}
