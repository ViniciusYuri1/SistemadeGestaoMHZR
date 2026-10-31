/* ==========================================================================
   views/settings.js — Configurações: perfil, tema, notificações, logo,
   empresa e import/export do banco de dados em Excel.
   ========================================================================== */

(function () {
  "use strict";
  window.Views = window.Views || {};

  function profileSectionHtml(ctx) {
    const user = DB.Users.get(ctx.user.id);
    return `
      <div class="card" style="margin-bottom:18px;">
        <div class="card-header"><h3 class="card-title">Meu Perfil</h3></div>
        <div class="card-pad">
          <div class="flex items-center gap-3" style="margin-bottom:18px;">
            <div id="profile-avatar-wrap">${UI.avatarHtml(user, "avatar-lg")}</div>
            <div>
              <div style="font-weight:700;">${UI.escapeHtml(user.name)}</div>
              <div class="text-sm text-muted">${user.role === "admin" ? "Administrador" : "Funcionário"} · ${UI.escapeHtml(user.position || "")}</div>
              <div class="flex gap-2" style="margin-top:8px;">
                <label class="btn btn-secondary" style="cursor:pointer; padding:6px 12px; font-size:12px;">
                  Trocar foto
                  <input type="file" accept="image/*" id="profile-photo-input" style="display:none;" />
                </label>
                ${user.photo ? `<button class="btn btn-ghost" id="remove-profile-photo" style="padding:6px 12px; font-size:12px;">Remover foto</button>` : ""}
              </div>
            </div>
          </div>
          <div class="form-row">
            <div class="form-group">
              <label class="form-label">Nome completo</label>
              <input type="text" class="form-control" id="profile-name" value="${UI.escapeHtml(user.name)}" />
            </div>
            <div class="form-group">
              <label class="form-label">E-mail</label>
              <input type="email" class="form-control" id="profile-email" value="${UI.escapeHtml(user.email)}" />
            </div>
          </div>
          <div class="form-group">
            <label class="form-label">Nova senha (deixe em branco para manter a atual)</label>
            <input type="password" class="form-control" id="profile-password" placeholder="••••••••" />
          </div>
          <button class="btn btn-primary" id="save-profile">Salvar Perfil</button>
        </div>
      </div>`;
  }

  function appearanceSectionHtml() {
    const settings = DB.Settings.get();
    return `
      <div class="card" style="margin-bottom:18px;">
        <div class="card-header"><h3 class="card-title">Aparência</h3></div>
        <div class="card-pad">
          <div class="form-group">
            <label class="form-label">Tema</label>
            <div class="flex gap-2">
              <button class="btn ${settings.theme === "light" ? "btn-primary" : "btn-secondary"}" id="theme-light">☀️ Claro</button>
              <button class="btn ${settings.theme === "dark" ? "btn-primary" : "btn-secondary"}" id="theme-dark">🌙 Escuro</button>
            </div>
          </div>
        </div>
      </div>`;
  }

  function notificationsSectionHtml() {
    const n = DB.Settings.get().notifications;
    return `
      <div class="card" style="margin-bottom:18px;">
        <div class="card-header"><h3 class="card-title">Notificações</h3></div>
        <div class="card-pad flex-col gap-3">
          <label class="checkbox-row"><input type="checkbox" id="notif-email" ${n.email ? "checked" : ""}/> Receber notificações por e-mail</label>
          <label class="checkbox-row"><input type="checkbox" id="notif-push" ${n.push ? "checked" : ""}/> Notificações push no navegador</label>
          <label class="checkbox-row"><input type="checkbox" id="notif-deadline" ${n.deadlineReminder ? "checked" : ""}/> Lembrete de prazos próximos</label>
          <label class="checkbox-row"><input type="checkbox" id="notif-summary" ${n.dailySummary ? "checked" : ""}/> Resumo diário de atividades</label>
          <button class="btn btn-primary" id="save-notifications" style="margin-top:6px; align-self:flex-start;">Salvar Notificações</button>
        </div>
      </div>`;
  }

  function companySectionHtml() {
    const settings = DB.Settings.get();
    return `
      <div class="card" style="margin-bottom:18px;">
        <div class="card-header"><h3 class="card-title">Empresa</h3></div>
        <div class="card-pad">
          <div class="form-group">
            <label class="form-label">Nome da empresa</label>
            <input type="text" class="form-control" id="company-name" value="${UI.escapeHtml(settings.companyName || "")}" />
          </div>
          <div class="form-group">
            <label class="form-label">Logo</label>
            <div class="flex items-center gap-3">
              <div style="width:56px; height:56px; border-radius:12px; background:var(--bg-hover); display:flex; align-items:center; justify-content:center; overflow:hidden;">
                ${settings.logo ? `<img src="${settings.logo}" style="width:100%; height:100%; object-fit:cover;" />` : "🏢"}
              </div>
              <input type="file" accept="image/*" id="company-logo-input" />
            </div>
          </div>
          <button class="btn btn-primary" id="save-company">Salvar Empresa</button>
        </div>
      </div>`;
  }

  function databaseSectionHtml() {
    const hasLegacy = DB.hasLegacyLocalData();
    return `
      <div class="card">
        <div class="card-header"><h3 class="card-title">Banco de Dados</h3></div>
        <div class="card-pad flex-col gap-3">
          <p class="text-sm text-muted">
            Os dados do sistema ficam no Supabase (banco central na nuvem) e são compartilhados
            por toda a equipe. Você pode exportar um backup em Excel (.xlsx) ou importar uma
            planilha para atualizar tarefas em lote.
          </p>
          <div class="flex gap-2" style="flex-wrap:wrap;">
            <button class="btn btn-secondary" id="export-excel-btn">⬇️ Exportar para Excel</button>
            <label class="btn btn-secondary" style="cursor:pointer;">
              ⬆️ Importar do Excel
              <input type="file" id="import-excel-input" accept=".xlsx,.xls" style="display:none;" />
            </label>
            ${hasLegacy ? `<button class="btn btn-ghost" id="migrate-local-btn">☁️ Enviar dados antigos deste navegador</button>` : ""}
          </div>
          ${hasLegacy ? `<p class="text-sm text-muted">Este navegador ainda guarda dados da versão antiga (localStorage). O botão acima envia empresas, boletos, equipes e tarefas para o Supabase — faça isso apenas uma vez, no navegador que tinha os dados reais.</p>` : ""}
        </div>
      </div>`;
  }

  /* ------------------------------------------------------------------ */
  /* Telegram                                                            */
  /* ------------------------------------------------------------------ */

  const OUTBOX_KIND = {
    approval_requested: "Material para aprovação",
    approval_decided: "Decisão do cliente",
    task_done: "Tarefa concluída",
    reminder_client: "Lembrete ao cliente",
    digest_team: "Resumo do dia (equipe)"
  };
  const OUTBOX_STATUS = {
    pending: ["Na fila", "badge-em_andamento"],
    sending: ["Enviando", "badge-em_andamento"],
    sent: ["Enviada", "badge-concluida"],
    failed: ["Falhou", "badge-urgente"]
  };

  function telegramSectionHtml() {
    return `
      <div class="card">
        <div class="card-header"><h3 class="card-title">📣 Telegram</h3></div>
        <div class="card-pad" id="tg-body"><div class="text-sm text-muted">Carregando...</div></div>
      </div>`;
  }

  async function loadTelegramSection(container, ctx) {
    const body = container.querySelector("#tg-body");
    if (!body) return;
    const cfgRes = await DB.Telegram.config();
    if (!body.isConnected) return;
    if (!cfgRes.ok) {
      body.innerHTML = `<div class="text-sm text-muted">${cfgRes.unavailable ? "Integração ainda não configurada no banco (migration do Telegram pendente)." : UI.escapeHtml(cfgRes.message)}</div>`;
      return;
    }
    const cfg = cfgRes.config;
    const [st, team, outbox] = await Promise.all([DB.Telegram.call("status"), DB.Telegram.chats(null), DB.Telegram.outbox(15)]);
    if (!body.isConnected) return;

    const botLine = st.ok
      ? `<div style="padding:10px 14px;background:var(--color-success-light);border-radius:var(--radius-md);color:var(--color-success);font-weight:600;font-size:14px;">
           🤖 Bot <strong>@${UI.escapeHtml(st.username)}</strong> conectado${st.webhookUrl ? " · recebendo comandos" : " · webhook ainda não registrado (clique em Salvar e ativar)"}
           ${st.lastError ? `<div class="text-sm" style="color:var(--color-danger);font-weight:400;margin-top:4px;">Último erro do Telegram: ${UI.escapeHtml(st.lastError)}</div>` : ""}
         </div>`
      : `<div style="padding:10px 14px;background:var(--color-warning-light);border-radius:var(--radius-md);color:var(--color-warning);font-size:14px;">⚠️ ${UI.escapeHtml(st.message || "Bot indisponível.")}</div>`;

    body.innerHTML = `
      <div class="flex-col gap-3">
        ${botLine}
        <div class="form-group" style="margin:0;">
          <label class="form-label">Endereço do sistema (usado nos botões das mensagens)</label>
          <input type="url" class="form-control" id="tg-app-url" placeholder="https://seu-sistema.vercel.app" value="${UI.escapeHtml(cfg.app_url || "")}" />
          <div class="text-sm text-muted" style="margin-top:4px;">Os botões "Ver e aprovar" só aparecem com um endereço https.</div>
        </div>
        <div><button class="btn btn-primary" id="tg-setup">Salvar e ativar bot</button></div>

        <div style="border-top:1px solid var(--border-color);padding-top:14px;">
          <div class="flex items-center justify-between" style="gap:8px;flex-wrap:wrap;">
            <div>
              <div style="font-weight:700;">Grupo da equipe</div>
              <div class="text-sm text-muted">Recebe as decisões dos clientes e o resumo diário de prazos (09:00).</div>
            </div>
            <button class="btn btn-secondary btn-sm" id="tg-team">${team.chats.length ? "Gerenciar" : "Vincular grupo da equipe"}</button>
          </div>
          ${team.chats.map((c) => `<div class="text-sm" style="margin-top:6px;">💬 ${UI.escapeHtml(c.title || String(c.chat_id))}</div>`).join("")}
        </div>

        <div style="border-top:1px solid var(--border-color);padding-top:14px;">
          <div style="font-weight:700;margin-bottom:6px;">Últimas mensagens</div>
          ${outbox.length ? `
          <div style="overflow-x:auto;">
            <table class="data-table">
              <thead><tr><th>Quando</th><th>Tipo</th><th>Situação</th><th>Detalhe</th></tr></thead>
              <tbody>${outbox.map((o) => {
                const s = OUTBOX_STATUS[o.status] || [o.status, ""];
                return `<tr>
                  <td class="text-sm">${UI.formatDateTime(o.created_at)}</td>
                  <td class="text-sm">${UI.escapeHtml(OUTBOX_KIND[o.kind] || o.kind)}</td>
                  <td><span class="badge ${s[1]}">${s[0]}</span></td>
                  <td class="text-sm text-muted">${UI.escapeHtml(o.last_error || (o.status === "sent" ? "" : `${o.attempts} tentativa(s)`))}</td>
                </tr>`;
              }).join("")}</tbody>
            </table>
          </div>` : `<div class="text-sm text-muted">Nenhuma mensagem enviada ainda.</div>`}
        </div>
      </div>`;

    body.querySelector("#tg-setup").addEventListener("click", async (e) => {
      const btn = e.currentTarget;
      const appUrl = body.querySelector("#tg-app-url").value.trim().replace(/\/+$/, "");
      if (appUrl && !/^https?:\/\//.test(appUrl)) { UI.toast("Informe o endereço completo, começando com https://", "error"); return; }
      btn.disabled = true;
      btn.textContent = "Ativando...";
      const setup = await DB.Telegram.call("setup", { webhookUrl: `${DB.Telegram.functionsUrl()}/telegram`, appUrl });
      const saved = await DB.Telegram.saveConfig(appUrl, setup.ok ? setup.username : null);
      btn.disabled = false;
      btn.textContent = "Salvar e ativar bot";
      if (!saved.ok) { UI.toast(saved.message, "error"); return; }
      if (!setup.ok) { UI.toast("Endereço salvo, mas o bot não respondeu: " + (setup.message || "erro"), "error"); }
      else UI.toast(setup.webhookSet ? `Bot @${setup.username} ativado.` : `Bot @${setup.username} conectado (webhook só é registrado em endereço https).`, "success");
      loadTelegramSection(container, ctx);
    });
    body.querySelector("#tg-team").addEventListener("click", () => {
      window.Views.openTelegramLinkModal(null, () => loadTelegramSection(container, ctx));
    });
  }

  /* ------------------------------------------------------------------ */
  /* Meta Ads                                                            */
  /* ------------------------------------------------------------------ */

  function metaSectionHtml() {
    return `
      <div class="card">
        <div class="card-header"><h3 class="card-title">📈 Meta Ads</h3></div>
        <div class="card-pad" id="meta-body"><div class="text-sm text-muted">Carregando...</div></div>
      </div>`;
  }

  function companyOptions(selected) {
    return DB.Companies.list().map((c) => `<option value="${c.id}" ${c.id === selected ? "selected" : ""}>${UI.escapeHtml(c.name)}</option>`).join("");
  }

  async function loadMetaSection(container) {
    const body = container.querySelector("#meta-body");
    if (!body) return;
    const { accounts, unavailable } = await DB.Meta.accounts();
    if (!body.isConnected) return;
    if (unavailable) {
      body.innerHTML = `<div class="text-sm text-muted">Integração ainda não configurada no banco (migration do Meta Ads pendente).</div>`;
      return;
    }
    const coName = (id) => (DB.Companies.get(id) || {}).name || id;
    body.innerHTML = `
      <div class="flex-col gap-3">
        <p class="text-sm text-muted" style="margin:0;">As métricas são lidas do Meta a cada hora. Os alertas vão para o grupo da equipe no Telegram e aparecem em <strong>Campanhas</strong>.</p>

        <div>
          <div style="font-weight:700;margin-bottom:6px;">Contas vinculadas</div>
          ${accounts.length ? `
          <div style="overflow-x:auto;">
            <table class="data-table">
              <thead><tr><th>Conta</th><th>Cliente / unidade</th><th>Última leitura</th><th title="Alerta quando o custo por lead de ontem passar deste valor">Custo/lead máx. (R$)</th><th title="Alerta quando o gasto do dia passar deste % do orçamento diário">Gasto do dia (%)</th><th>Ativa</th><th></th></tr></thead>
              <tbody>${accounts.map((a) => `
                <tr data-meta-acc="${a.id}">
                  <td><div style="font-weight:600;">${UI.escapeHtml(a.name || a.account_id)}</div><div class="text-sm text-muted">${UI.escapeHtml(a.account_id)}</div></td>
                  <td class="text-sm">${UI.escapeHtml(coName(a.company_id))}</td>
                  <td class="text-sm">${a.last_sync_at ? UI.formatDateTime(a.last_sync_at) : "—"}${a.last_error ? `<div style="color:var(--color-danger);">${UI.escapeHtml(a.last_error)}</div>` : ""}</td>
                  <td><input type="number" min="0" step="0.01" class="form-control" data-f="cpl" value="${a.cpl_max == null ? "" : a.cpl_max}" placeholder="—" style="width:110px;" /></td>
                  <td><input type="number" min="0" step="5" class="form-control" data-f="pct" value="${a.spend_pct_alert == null ? "" : a.spend_pct_alert}" placeholder="—" style="width:90px;" /></td>
                  <td><input type="checkbox" data-f="active" ${a.active ? "checked" : ""} /></td>
                  <td><button class="btn btn-secondary btn-sm" data-meta-save>Salvar</button></td>
                </tr>`).join("")}</tbody>
            </table>
          </div>` : `<div class="text-sm text-muted">Nenhuma conta vinculada ainda.</div>`}
        </div>

        <div style="border-top:1px solid var(--border-color);padding-top:14px;">
          <div class="flex items-center justify-between" style="gap:8px;flex-wrap:wrap;">
            <div style="font-weight:700;">Vincular conta de anúncios</div>
            <button class="btn btn-secondary btn-sm" id="meta-fetch">Buscar contas no Meta</button>
          </div>
          <div id="meta-available" style="margin-top:8px;"></div>
          <div class="flex gap-2" style="margin-top:10px;flex-wrap:wrap;align-items:flex-end;">
            <div class="form-group" style="margin:0;"><label class="form-label">ID da conta</label><input class="form-control" id="meta-new-id" placeholder="act_1234567890" style="width:190px;" /></div>
            <div class="form-group" style="margin:0;"><label class="form-label">Cliente / unidade</label><select class="form-control" id="meta-new-co" style="min-width:220px;">${companyOptions()}</select></div>
            <button class="btn btn-primary btn-sm" id="meta-new-link">Vincular</button>
          </div>
        </div>
      </div>`;

    body.querySelectorAll("[data-meta-acc]").forEach((row) => {
      row.querySelector("[data-meta-save]").addEventListener("click", async () => {
        const cpl = row.querySelector('[data-f="cpl"]').value;
        const pctV = row.querySelector('[data-f="pct"]').value;
        const r = await DB.Meta.update(row.dataset.metaAcc, cpl === "" ? null : Number(cpl), pctV === "" ? null : Math.round(Number(pctV)), row.querySelector('[data-f="active"]').checked);
        UI.toast(r.ok ? "Conta atualizada." : r.message, r.ok ? "success" : "error");
        if (r.ok) loadMetaSection(container);
      });
    });

    const link = async (accountId, companyId, name, currency) => {
      const r = await DB.Meta.link(companyId, accountId, name, currency);
      UI.toast(r.ok ? "Conta vinculada. Os dados aparecem na próxima leitura (ou em Campanhas → Sincronizar agora)." : r.message, r.ok ? "success" : "error");
      if (r.ok) loadMetaSection(container);
    };
    body.querySelector("#meta-new-link").addEventListener("click", () => {
      const id = body.querySelector("#meta-new-id").value.trim();
      if (!id) { UI.toast("Informe o ID da conta de anúncios.", "error"); return; }
      link(id, body.querySelector("#meta-new-co").value);
    });
    body.querySelector("#meta-fetch").addEventListener("click", async (e) => {
      const btn = e.currentTarget;
      const box = body.querySelector("#meta-available");
      btn.disabled = true;
      box.innerHTML = `<div class="text-sm text-muted">Consultando o Meta...</div>`;
      const r = await DB.Meta.call("accounts");
      btn.disabled = false;
      if (!r.ok) { box.innerHTML = `<div class="text-sm" style="color:var(--color-danger);">${UI.escapeHtml(r.message || "Falha ao consultar o Meta.")}</div>`; return; }
      const linked = accounts.reduce((m, a) => { m[a.account_id] = a; return m; }, {});
      box.innerHTML = r.accounts.length ? r.accounts.map((a) => `
        <div class="flex items-center gap-2" style="padding:6px 0;border-bottom:1px solid var(--border-color);flex-wrap:wrap;" data-avail="${UI.escapeHtml(a.id)}">
          <div style="flex:1;min-width:200px;"><strong>${UI.escapeHtml(a.name || a.id)}</strong> <span class="text-sm text-muted">${UI.escapeHtml(a.id)}</span></div>
          ${linked[a.id] && linked[a.id].active ? `<span class="text-sm text-muted">vinculada a ${UI.escapeHtml(coName(linked[a.id].company_id))}</span>` : `
          <select class="form-control" style="width:auto;min-width:200px;">${companyOptions(linked[a.id] && linked[a.id].company_id)}</select>
          <button class="btn btn-primary btn-sm">Vincular</button>`}
        </div>`).join("") : `<div class="text-sm text-muted">O token não tem acesso a nenhuma conta de anúncios.</div>`;
      box.querySelectorAll("[data-avail]").forEach((row) => {
        const b = row.querySelector("button");
        if (!b) return;
        const a = r.accounts.find((x) => x.id === row.dataset.avail);
        b.addEventListener("click", () => link(a.id, row.querySelector("select").value, a.name, a.currency));
      });
    });
  }

  /* Vincular grupos a uma empresa (companyId) ou à equipe (null) */
  window.Views.openTelegramLinkModal = function (companyId, onChange) {
    const company = companyId ? DB.Companies.get(companyId) : null;
    const title = company ? company.name : "Grupo da equipe";
    let bot = null;
    let code = null;

    const overlay = UI.showModal(`
      <div class="modal-header">
        <h3>📣 Telegram — ${UI.escapeHtml(title)}</h3>
        <button class="modal-close" id="tl-close">✕</button>
      </div>
      <div class="modal-body" id="tl-body"><div class="text-sm text-muted">Carregando...</div></div>
      <div class="modal-footer">
        <button class="btn btn-secondary" id="tl-refresh">Atualizar</button>
        <button class="btn btn-primary" id="tl-done">Concluir</button>
      </div>`, { static: true });
    const close = () => { UI.hideModal(); if (onChange) onChange(); };
    overlay.querySelector("#tl-close").addEventListener("click", close);
    overlay.querySelector("#tl-done").addEventListener("click", close);
    overlay.querySelector("#tl-refresh").addEventListener("click", () => load());

    async function load() {
      const body = overlay.querySelector("#tl-body");
      const [cfg, res] = await Promise.all([DB.Telegram.config(), DB.Telegram.chats(companyId)]);
      if (!body.isConnected) return;
      if (!cfg.ok || res.unavailable) {
        body.innerHTML = `<div class="text-sm text-muted">Integração com o Telegram ainda não configurada no banco (migration pendente).</div>`;
        return;
      }
      bot = cfg.config.bot_username || null;
      const command = code ? `/vincular${bot ? "@" + bot : ""} ${code}` : "";
      body.innerHTML = `
        <div class="form-group">
          <label class="form-label">Grupos vinculados</label>
          ${res.chats.length ? res.chats.map((c) => `
            <div class="flex items-center justify-between" style="padding:8px 0;border-bottom:1px solid var(--border-color);gap:8px;">
              <div>
                <div style="font-weight:600;">💬 ${UI.escapeHtml(c.title || String(c.chat_id))}</div>
                <div class="text-sm text-muted">Vinculado em ${UI.formatDateTime(c.linked_at)}${c.linked_by ? ` por ${UI.escapeHtml(c.linked_by)}` : ""}</div>
              </div>
              <button class="btn btn-ghost btn-sm" data-tl-unlink="${c.id}">Desvincular</button>
            </div>`).join("") : `<div class="text-sm text-muted">Nenhum grupo vinculado ainda.</div>`}
        </div>
        <div style="padding:12px 14px;background:var(--bg-surface-alt);border:1px solid var(--border-color);border-radius:var(--radius-md);">
          <div style="font-weight:700;margin-bottom:6px;">Vincular um grupo</div>
          <ol class="text-sm" style="margin:0 0 10px 18px;line-height:1.7;">
            <li>No Telegram, crie o grupo${company ? " do cliente" : " da equipe"} (ou use um existente) e adicione o bot ${bot ? `<strong>@${UI.escapeHtml(bot)}</strong>` : "(ative o bot em Configurações → Telegram)"}.</li>
            <li>Gere o código abaixo (vale 24 horas, uma única vez).</li>
            <li>Envie no grupo a mensagem com o código e clique em <strong>Atualizar</strong>.</li>
          </ol>
          ${code ? `
          <div class="flex items-center gap-2" style="flex-wrap:wrap;">
            <code id="tl-command" style="font-size:15px;padding:8px 12px;background:var(--bg-surface);border:1px solid var(--border-color);border-radius:8px;user-select:all;">${UI.escapeHtml(command)}</code>
            <button class="btn btn-secondary btn-sm" id="tl-copy">Copiar</button>
          </div>` : `<button class="btn btn-primary btn-sm" id="tl-code">Gerar código</button>`}
        </div>`;

      const codeBtn = body.querySelector("#tl-code");
      if (codeBtn) codeBtn.addEventListener("click", async () => {
        codeBtn.disabled = true;
        const r = await DB.Telegram.createCode(companyId);
        if (!r.ok) { UI.toast(r.message, "error"); codeBtn.disabled = false; return; }
        code = r.code;
        load();
      });
      const copyBtn = body.querySelector("#tl-copy");
      if (copyBtn) copyBtn.addEventListener("click", () => {
        (navigator.clipboard ? navigator.clipboard.writeText(command) : Promise.reject())
          .then(() => UI.toast("Comando copiado. Cole no grupo do Telegram.", "success"))
          .catch(() => UI.toast("Selecione o texto e copie manualmente.", "error"));
      });
      body.querySelectorAll("[data-tl-unlink]").forEach((btn) => {
        btn.addEventListener("click", async () => {
          const chat = res.chats.find((c) => c.id === btn.dataset.tlUnlink);
          if (!chat || !UI.confirmDialog(`Desvincular "${chat.title || chat.chat_id}"? O grupo deixa de receber avisos.`)) return;
          const r = await DB.Telegram.unlink(chat);
          if (!r.ok) { UI.toast(r.message, "error"); return; }
          UI.toast("Grupo desvinculado.", "success");
          load();
        });
      });
    }
    load();
  };

  function syncTopbarAvatar(user) {
    const el = document.getElementById("user-avatar");
    if (!el) return;
    if (user.photo) {
      el.innerHTML = `<img src="${user.photo}" alt="${UI.escapeHtml(user.name)}" />`;
    } else {
      el.textContent = user.avatar || user.name.slice(0, 2).toUpperCase();
    }
  }

  function render(container, ctx) {
    const isAdmin = ctx.user.role === "admin";
    container.innerHTML = `
      <div class="page-header">
        <div>
          <h1>Configurações</h1>
          <p class="page-subtitle">Gerencie seu perfil, preferências do sistema${isAdmin ? " e dados da empresa" : ""}.</p>
        </div>
      </div>

      ${profileSectionHtml(ctx)}
      ${appearanceSectionHtml()}
      ${notificationsSectionHtml()}
      ${isAdmin ? companySectionHtml() : ""}
      ${isAdmin ? telegramSectionHtml() : ""}
      ${isAdmin ? metaSectionHtml() : ""}
      ${isAdmin ? databaseSectionHtml() : ""}
    `;

    bindEvents(container, ctx);
    if (isAdmin) loadTelegramSection(container, ctx);
    if (isAdmin) loadMetaSection(container);
  }

  function bindEvents(container, ctx) {
    container.querySelector("#save-profile").addEventListener("click", async () => {
      const name = container.querySelector("#profile-name").value.trim();
      const email = container.querySelector("#profile-email").value.trim();
      const password = container.querySelector("#profile-password").value.trim();
      if (!name || !email) {
        UI.toast("Preencha nome e e-mail.", "error");
        return;
      }
      const patch = { name, email };
      if (password) patch.password = password;
      const result = await DB.Users.update(ctx.user.id, patch);
      if (!result.ok) {
        UI.toast(result.message || "Não foi possível atualizar o perfil.", "error");
        return;
      }
      UI.toast("Perfil atualizado com sucesso.", "success");
      document.getElementById("user-name").textContent = name;
    });

    container.querySelector("#profile-photo-input").addEventListener("change", async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      if (!file.type.startsWith("image/")) {
        UI.toast("Selecione um arquivo de imagem.", "error");
        return;
      }
      if (file.size > 3 * 1024 * 1024) {
        UI.toast("Imagem muito grande (máx. 3MB).", "error");
        return;
      }
      const reader = new FileReader();
      reader.onload = async (ev) => {
        const result = await DB.Users.update(ctx.user.id, { photo: ev.target.result });
        if (!result.ok) {
          UI.toast(result.message || "Não foi possível salvar a foto.", "error");
          return;
        }
        UI.toast("Foto de perfil atualizada.", "success");
        syncTopbarAvatar(result.user);
        render(container, ctx);
      };
      reader.readAsDataURL(file);
    });

    const removePhotoBtn = container.querySelector("#remove-profile-photo");
    if (removePhotoBtn) {
      removePhotoBtn.addEventListener("click", async () => {
        const result = await DB.Users.update(ctx.user.id, { photo: null });
        if (!result.ok) {
          UI.toast(result.message || "Não foi possível remover a foto.", "error");
          return;
        }
        UI.toast("Foto de perfil removida.", "success");
        syncTopbarAvatar(result.user);
        render(container, ctx);
      });
    }

    container.querySelector("#theme-light").addEventListener("click", () => {
      DB.Settings.update({ theme: "light" });
      UI.applyTheme("light");
      render(container, ctx);
    });
    container.querySelector("#theme-dark").addEventListener("click", () => {
      DB.Settings.update({ theme: "dark" });
      UI.applyTheme("dark");
      render(container, ctx);
    });

    container.querySelector("#save-notifications").addEventListener("click", () => {
      DB.Settings.update({
        notifications: {
          email: container.querySelector("#notif-email").checked,
          push: container.querySelector("#notif-push").checked,
          deadlineReminder: container.querySelector("#notif-deadline").checked,
          dailySummary: container.querySelector("#notif-summary").checked
        }
      });
      UI.toast("Preferências de notificação salvas.", "success");
    });

    if (ctx.user.role === "admin") {
      container.querySelector("#save-company").addEventListener("click", () => {
        DB.Settings.update({ companyName: container.querySelector("#company-name").value.trim() });
        UI.toast("Dados da empresa atualizados.", "success");
      });

      container.querySelector("#company-logo-input").addEventListener("change", (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => {
          DB.Settings.update({ logo: ev.target.result });
          UI.toast("Logo atualizada.", "success");
          render(container, ctx);
        };
        reader.readAsDataURL(file);
      });

      container.querySelector("#export-excel-btn").addEventListener("click", () => {
        DB.exportToExcel("banco_de_dados_gestao_tarefas.xlsx");
        UI.toast("Exportação concluída. Verifique seus downloads.", "success");
      });

      container.querySelector("#import-excel-input").addEventListener("change", (e) => {
        const file = e.target.files[0];
        if (!file) return;
        DB.importFromExcel(file, (result) => {
          UI.toast(result.message, result.ok ? "success" : "error");
          if (result.ok) render(container, ctx);
        });
      });

      const migrateBtn = container.querySelector("#migrate-local-btn");
      if (migrateBtn) {
        migrateBtn.addEventListener("click", async () => {
          if (!UI.confirmDialog("Enviar os dados antigos deste navegador (empresas, boletos, equipes e tarefas) para o Supabase? Registros com o mesmo ID serão sobrescritos.")) return;
          migrateBtn.disabled = true;
          migrateBtn.textContent = "Enviando...";
          const result = await DB.importLegacyLocal();
          UI.toast(result.message, result.ok ? "success" : "error");
          migrateBtn.disabled = false;
          render(container, ctx);
        });
      }
    }
  }

  window.Views.settings = function (container, ctx) {
    render(container, ctx);
  };
})();
