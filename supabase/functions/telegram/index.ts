// =============================================================================
// Edge Function "telegram" — bot do Sistema de Gestão.
//
//   POST (Telegram, com o header secreto)  → comandos nos grupos:
//        /vincular CODIGO, /pendentes, /desvincular, /ajuda
//   POST ?action=dispatch                  → envia a fila notification_outbox
//        (chamado pelo banco via pg_net e pelo pg_cron; só envia o que já está
//        na fila, por isso não precisa de senha)
//   POST ?action=miniapp-login {initData}  → sessão do portal para a conta do
//        Telegram conectada (assinatura conferida com o token do bot)
//   POST ?action=setup   (admin logado)    → registra o webhook e os comandos
//   POST ?action=status  (admin logado)    → dados do bot e do webhook
//
// Segredo necessário (Edge Functions → Secrets): TELEGRAM_BOT_TOKEN.
// "Verify JWT" deve ficar DESLIGADO: o Telegram não envia token do Supabase;
// a função confere o header secreto do Telegram e o login do admin.
// =============================================================================

import { createClient } from "jsr:@supabase/supabase-js@2";

const BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "";
const TG_BASE = (Deno.env.get("TELEGRAM_API_BASE") ?? "https://api.telegram.org").replace(/\/$/, "");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

// deno-lint-ignore no-explicit-any
type Any = any;

async function tg(method: string, params: Record<string, unknown> = {}): Promise<Any> {
  try {
    const res = await fetch(`${TG_BASE}/bot${BOT_TOKEN}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
    });
    return await res.json();
  } catch (e) {
    return { ok: false, error_code: 0, description: String(e) };
  }
}

/* O header secreto do webhook é derivado do token: nenhum segredo extra. */
async function webhookSecret(): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("sgt-webhook:" + BOT_TOKEN));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 48);
}

let botUsername: string | null = null;
async function getBotUsername(): Promise<string | null> {
  if (botUsername) return botUsername;
  const me = await tg("getMe");
  if (me.ok) botUsername = me.result.username;
  return botUsername;
}

function esc(s: string) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function reply(chatId: number, text: string) {
  return tg("sendMessage", { chat_id: chatId, text, parse_mode: "HTML", link_preview_options: { is_disabled: true } });
}

const HELP =
  "<b>Assistente do Sistema de Gestão</b>\n\n" +
  "/vincular CÓDIGO — vincula este grupo a um cliente (código gerado no CRM)\n" +
  "/pendentes — lista os materiais aguardando aprovação\n" +
  "/desvincular — encerra o envio de avisos neste grupo (somente administradores)\n\n" +
  "Os avisos de aprovação, ajustes e entregas são enviados automaticamente neste grupo.";

/* ------------------------------------------------------------------------- */
/* Webhook                                                                    */
/* ------------------------------------------------------------------------- */

async function handleUpdate(update: Any) {
  const member = update.my_chat_member;
  if (member) {
    const status = member.new_chat_member?.status;
    if (status === "left" || status === "kicked") {
      await db.rpc("telegram_chat_left", { p_chat_id: member.chat.id });
    } else if ((status === "member" || status === "administrator") &&
               (member.old_chat_member?.status === "left" || member.old_chat_member?.status === "kicked")) {
      await reply(member.chat.id, "Olá. Para receber os avisos neste grupo, solicite o código de vinculação à nossa equipe e envie:\n<code>/vincular CÓDIGO</code>");
    }
    return;
  }

  const msg = update.message;
  if (!msg) return;
  if (msg.migrate_to_chat_id) {
    await db.rpc("telegram_chat_migrated", { p_old: msg.chat.id, p_new: msg.migrate_to_chat_id });
    return;
  }
  const text: string = msg.text ?? "";
  const m = text.match(/^\/([a-z_]+)(?:@([A-Za-z0-9_]+))?(?:\s+([\s\S]*))?$/i);
  if (!m) return;
  const [, cmdRaw, target, argRaw] = m;
  if (target) {
    const me = await getBotUsername();
    if (me && target.toLowerCase() !== me.toLowerCase()) return; // comando para outro bot
  }
  const cmd = cmdRaw.toLowerCase();
  const arg = (argRaw ?? "").trim();
  const chat = msg.chat;
  const isGroup = chat.type === "group" || chat.type === "supergroup";

  if (cmd === "start" && !isGroup) {
    await handlePrivateStart(msg, arg);
    return;
  }
  if (cmd === "start" || cmd === "ajuda" || cmd === "help") {
    await reply(chat.id, isGroup ? HELP : HELP + "\n\n<i>Para utilizar, adicione o assistente ao grupo do cliente.</i>");
    return;
  }
  if (!isGroup) {
    await reply(chat.id, "Este assistente funciona nos grupos de clientes. Adicione-o a um grupo e utilize /vincular.");
    return;
  }

  if (cmd === "vincular") {
    if (!arg) {
      await reply(chat.id, "Informe o código gerado no CRM: <code>/vincular CÓDIGO</code>");
      return;
    }
    const who = [msg.from?.first_name, msg.from?.last_name].filter(Boolean).join(" ") || msg.from?.username || "";
    const { data, error } = await db.rpc("telegram_link_chat", {
      p_code: arg.replace(/\s+/g, ""), p_chat_id: chat.id, p_title: chat.title ?? "", p_user: who,
    });
    if (error || !data?.ok) {
      await reply(chat.id, "Código inválido ou expirado. Gere um novo código no CRM (válido por 24 horas e para um único uso).");
      return;
    }
    await reply(chat.id, data.kind === "team"
      ? "Grupo da <b>equipe</b> vinculado. Aqui serão enviadas as decisões dos clientes e o resumo diário de prazos."
      : `Grupo vinculado a <b>${esc(data.company)}</b>.\nOs materiais para aprovação e as entregas serão comunicados por aqui.`);
    return;
  }

  if (cmd === "pendentes") {
    const { data } = await db.rpc("telegram_pending_text", { p_chat_id: chat.id });
    await reply(chat.id, data ?? "Este grupo ainda não está vinculado. Utilize <code>/vincular CÓDIGO</code>.");
    return;
  }

  if (cmd === "desvincular") {
    const cm = await tg("getChatMember", { chat_id: chat.id, user_id: msg.from?.id });
    const st = cm.ok ? cm.result.status : "";
    if (st !== "creator" && st !== "administrator") {
      await reply(chat.id, "Somente administradores do grupo podem desvinculá-lo.");
      return;
    }
    await db.rpc("telegram_chat_left", { p_chat_id: chat.id });
    await reply(chat.id, "Grupo desvinculado. Nenhum aviso será enviado neste grupo.");
  }
}

/* ------------------------------------------------------------------------- */
/* Conversa privada: conectar a conta e abrir o portal (Mini App)            */
/* ------------------------------------------------------------------------- */

async function appUrl(): Promise<string | null> {
  const { data } = await db.rpc("telegram_setting", { p_key: "app_url" });
  return data ?? null;
}

function portalKeyboard(app: string | null, label = "Acessar o portal") {
  if (!app || !/^https:\/\//.test(app)) return undefined;
  return { inline_keyboard: [[{ text: label, web_app: { url: `${app}/telegram.html` } }]] };
}

async function handlePrivateStart(msg: Any, payload: string) {
  const app = await appUrl();
  const from = msg.from ?? {};
  const name = [from.first_name, from.last_name].filter(Boolean).join(" ");

  if (payload.startsWith("c_")) {
    const { data } = await db.rpc("telegram_connect_user", {
      p_token: payload.slice(2), p_tg_user_id: from.id, p_username: from.username ?? null, p_name: name || null,
    });
    if (!data?.ok) {
      await reply(msg.chat.id, "Este link de conexão expirou ou já foi utilizado. No portal, clique novamente em <b>Conectar Telegram</b>.");
      return;
    }
    await tg("sendMessage", {
      chat_id: msg.chat.id, parse_mode: "HTML",
      text: `Telegram conectado à conta de <b>${esc(data.name ?? "")}</b>.\nA partir de agora, o portal pode ser acessado por aqui, sem senha.`,
      reply_markup: portalKeyboard(app),
    });
    return;
  }

  const { data: acc } = await db.rpc("telegram_login_lookup", { p_tg_user_id: from.id });
  if (acc?.user_id) {
    await tg("sendMessage", {
      chat_id: msg.chat.id, parse_mode: "HTML",
      text: `Olá, <b>${esc(acc.name ?? name)}</b>. Utilize o botão abaixo para acessar suas tarefas, materiais e aprovações.`,
      reply_markup: portalKeyboard(app),
    });
    return;
  }
  const login = app ? `\n\n${esc(app)}/index.html` : "";
  await reply(msg.chat.id,
    "Para acessar o portal por aqui, entre uma vez pelo navegador com seu e-mail e senha e clique em <b>Conectar Telegram</b>." + login);
}

/* initData do Mini App: assinatura HMAC com o token do bot */
async function hmac(key: ArrayBuffer | Uint8Array, data: string): Promise<ArrayBuffer> {
  const k = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return crypto.subtle.sign("HMAC", k, new TextEncoder().encode(data));
}

async function verifyInitData(initData: string): Promise<Any | null> {
  const params = new URLSearchParams(initData);
  const hash = params.get("hash") ?? "";
  params.delete("hash");
  const check = [...params.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([k, v]) => `${k}=${v}`).join("\n");
  const secret = await hmac(new TextEncoder().encode("WebAppData"), BOT_TOKEN);
  const calc = Array.from(new Uint8Array(await hmac(secret, check))).map((b) => b.toString(16).padStart(2, "0")).join("");
  if (calc.length !== hash.length) return null;
  let diff = 0;
  for (let i = 0; i < calc.length; i++) diff |= calc.charCodeAt(i) ^ hash.charCodeAt(i);
  if (diff !== 0) return null;
  const authDate = Number(params.get("auth_date") ?? 0);
  if (!authDate || Date.now() / 1000 - authDate > 86400) return null; // assinatura de mais de 24 h
  try {
    return JSON.parse(params.get("user") ?? "null");
  } catch {
    return null;
  }
}

async function miniappLogin(body: Any) {
  if (!BOT_TOKEN) return { ok: false, reason: "not_configured" };
  const user = await verifyInitData(String(body?.initData ?? ""));
  if (!user?.id) return { ok: false, reason: "invalid" };
  const { data: acc } = await db.rpc("telegram_login_lookup", { p_tg_user_id: user.id });
  if (!acc?.email) return { ok: false, reason: "not_linked" };
  const { data, error } = await db.auth.admin.generateLink({ type: "magiclink", email: acc.email });
  if (error || !data?.properties?.hashed_token) return { ok: false, reason: "error" };
  return { ok: true, token_hash: data.properties.hashed_token, name: acc.name };
}

/* ------------------------------------------------------------------------- */
/* Envio da fila                                                              */
/* ------------------------------------------------------------------------- */

async function dispatch() {
  let sent = 0, failed = 0, retried = 0;
  for (let round = 0; round < 4; round++) {
    const { data: rows, error } = await db.rpc("telegram_claim_outbox", { p_limit: 25 });
    if (error) return { error: error.message, sent, failed, retried };
    if (!rows || !rows.length) break;
    for (const row of rows as Any[]) {
      const params: Record<string, unknown> = {
        chat_id: row.chat_id, text: row.text, parse_mode: "HTML", link_preview_options: { is_disabled: true },
      };
      if (row.button_url && /^https:\/\//.test(row.button_url)) {
        params.reply_markup = { inline_keyboard: [[{ text: row.button_text || "Abrir", url: row.button_url }]] };
      }
      const res = await tg("sendMessage", params);
      if (res.ok) {
        sent++;
        await db.rpc("telegram_outbox_result", { p_id: row.id, p_ok: true });
        continue;
      }
      const migrateTo = res.parameters?.migrate_to_chat_id;
      if (migrateTo) await db.rpc("telegram_chat_migrated", { p_old: row.chat_id, p_new: migrateTo });
      const gone = !migrateTo && (res.error_code === 403 || /chat not found/i.test(res.description ?? ""));
      const retryAfter = migrateTo ? 1 : res.parameters?.retry_after ?? null;
      await db.rpc("telegram_outbox_result", {
        p_id: row.id, p_ok: false, p_error: `${res.error_code ?? ""} ${res.description ?? ""}`.trim(),
        p_retry_after: retryAfter, p_chat_gone: gone,
      });
      if (gone) failed++; else retried++;
    }
  }
  return { sent, failed, retried };
}

/* ------------------------------------------------------------------------- */
/* Ações do admin (setup / status)                                            */
/* ------------------------------------------------------------------------- */

async function requireAdmin(req: Request): Promise<boolean> {
  const jwt = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!jwt) return false;
  const { data } = await db.auth.getUser(jwt);
  if (!data?.user) return false;
  const { data: prof } = await db.from("profiles").select("role").eq("id", data.user.id).maybeSingle();
  return prof?.role === "admin";
}

async function setup(body: Any) {
  if (!BOT_TOKEN) return { ok: false, message: "Segredo TELEGRAM_BOT_TOKEN não configurado na função." };
  const me = await tg("getMe");
  if (!me.ok) return { ok: false, message: "Token do bot inválido: " + (me.description ?? "") };
  botUsername = me.result.username;

  let webhook: Any = null;
  const url: string = body?.webhookUrl ?? "";
  if (/^https:\/\//.test(url)) {
    webhook = await tg("setWebhook", {
      url, secret_token: await webhookSecret(), allowed_updates: ["message", "my_chat_member"], max_connections: 10,
    });
    if (!webhook.ok) return { ok: false, message: "Falha ao registrar o webhook: " + (webhook.description ?? "") };
  }
  const commands = [
    { command: "vincular", description: "Vincular este grupo a um cliente (código do CRM)" },
    { command: "pendentes", description: "Materiais aguardando aprovação" },
    { command: "desvincular", description: "Parar de receber avisos neste grupo" },
    { command: "ajuda", description: "Como usar o bot" },
  ];
  await tg("setMyCommands", { commands, scope: { type: "all_group_chats" } });
  await tg("setMyCommands", { commands: [{ command: "start", description: "Abrir o portal do cliente" }], scope: { type: "all_private_chats" } });
  // Botão de menu da conversa privada abre o portal (Mini App) — exige https
  const app: string = String(body?.appUrl ?? "").replace(/\/+$/, "");
  if (/^https:\/\//.test(app)) {
    await tg("setChatMenuButton", { menu_button: { type: "web_app", text: "Portal", web_app: { url: `${app}/telegram.html` } } });
  }
  return { ok: true, username: botUsername, name: me.result.first_name, webhookSet: !!webhook, privacy: !me.result.can_read_all_group_messages };
}

async function status() {
  if (!BOT_TOKEN) return { ok: false, message: "Segredo TELEGRAM_BOT_TOKEN não configurado na função." };
  const me = await tg("getMe");
  if (!me.ok) return { ok: false, message: "Token do bot inválido: " + (me.description ?? "") };
  const info = await tg("getWebhookInfo");
  return {
    ok: true, username: me.result.username, name: me.result.first_name,
    webhookUrl: info.result?.url ?? "", pending: info.result?.pending_update_count ?? 0,
    lastError: info.result?.last_error_message ?? null,
  };
}

/* ------------------------------------------------------------------------- */

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ ok: false }, 405);
  const action = new URL(req.url).searchParams.get("action");

  if (action === "dispatch") return json(await dispatch());
  if (action === "miniapp-login") return json(await miniappLogin(await req.json().catch(() => ({}))));

  if (action === "setup" || action === "status") {
    if (!(await requireAdmin(req))) return json({ ok: false, message: "Apenas administradores." }, 403);
    const body = await req.json().catch(() => ({}));
    return json(action === "setup" ? await setup(body) : await status());
  }

  // Webhook do Telegram
  if (!BOT_TOKEN || req.headers.get("x-telegram-bot-api-secret-token") !== (await webhookSecret())) {
    return json({ ok: false }, 401);
  }
  const update = await req.json().catch(() => null);
  if (update) {
    try {
      await handleUpdate(update);
    } catch (e) {
      console.error("[telegram] update", e);
    }
  }
  return json({ ok: true }); // sempre 200 para o Telegram não reenviar
});
