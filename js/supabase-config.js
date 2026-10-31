/* ==========================================================================
   supabase-config.js — Credenciais públicas do projeto Supabase.
   Copie a URL e a chave "anon public" em:
   Dashboard do Supabase → Settings → API
   (a anon key é pública por design; a segurança vem das policies RLS)

   Aberto em localhost/127.0.0.1 (node scripts/dev-server.js), o sistema usa o
   Supabase LOCAL do Docker (npx supabase start) — nunca o de produção.
   ========================================================================== */

(function () {
  const host = window.location.hostname;
  const isLocal = host === "localhost" || host === "127.0.0.1";

  window.SUPABASE_ENV = isLocal ? "local" : "production";
  window.SUPABASE_CONFIG = isLocal
    ? {
        url: "http://127.0.0.1:54321",
        anonKey: "sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH"
      }
    : {
        url: "https://vxfgvmusrynamhjlyhod.supabase.co",
        anonKey: "sb_publishable_2JXzq7RTpmUt-ATlXozR5A_uSbejhJP"
      };

  if (isLocal) {
    document.addEventListener("DOMContentLoaded", () => {
      const tag = document.createElement("div");
      tag.textContent = "AMBIENTE DE TESTE · banco local";
      tag.style.cssText = "position:fixed;left:50%;bottom:10px;transform:translateX(-50%);z-index:9999;" +
        "background:#ca8a04;color:#fff;font:700 11px/1 system-ui,sans-serif;letter-spacing:.06em;" +
        "padding:6px 12px;border-radius:999px;box-shadow:0 2px 8px rgba(0,0,0,.25);pointer-events:none;";
      document.body.appendChild(tag);
    });
  }
})();
