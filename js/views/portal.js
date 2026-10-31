/* ==========================================================================
   views/portal.js — Portal da Empresa: visão exclusiva para usuários com
   role "company". Exige assinatura digital do contrato antes de exibir boletos.
   ========================================================================== */

(function () {
  "use strict";
  window.Views = window.Views || {};

  const STATUS_CFG = {
    pago:      { label: "Pago",      badge: "badge-concluida",    icon: "✅" },
    pendente:  { label: "Pendente",  badge: "badge-em_andamento", icon: "⏳" },
    vencido:   { label: "Vencido",   badge: "badge-urgente",      icon: "⚠️" },
    cancelado: { label: "Cancelado", badge: "badge-backlog",       icon: "🚫" }
  };

  const MONTH_NAMES = ["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"];

  function brl(v) {
    return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v || 0);
  }

  function monthLabel(ym) {
    if (!ym) return "";
    const [y, m] = ym.split("-");
    return `${MONTH_NAMES[parseInt(m, 10) - 1]}/${y}`;
  }

  function currentYM() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  }

  function monthOptions(selected, boletos) {
    const months = [...new Set(boletos.map((b) => b.month))].sort();
    if (!months.length) return "";
    return months.map((ym) =>
      `<option value="${ym}" ${ym === selected ? "selected" : ""}>${monthLabel(ym)}</option>`
    ).join("");
  }

  function fmtDateTime(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    return d.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
  }

  const STATUS_TASK = {
    backlog:      { label: "Backlog",      badge: "badge-backlog",      step: 0 },
    nao_iniciada: { label: "A Fazer",      badge: "badge-nao_iniciada", step: 1 },
    em_andamento: { label: "Em Progresso", badge: "badge-em_andamento", step: 2 },
    em_revisao:   { label: "Revisão",      badge: "badge-em_revisao",   step: 3 },
    aguardando_aprovacao: { label: "Aguardando sua aprovação", badge: "badge-aguardando_aprovacao", step: 3 },
    ajustes:      { label: "Em ajustes",   badge: "badge-ajustes",      step: 2 },
    concluida:    { label: "Concluído",    badge: "badge-concluida",    step: 4 }
  };
  const PRIORITY_TASK = { baixa: "Baixa", media: "Média", alta: "Alta", urgente: "Urgente" };
  const STEPS_TASK = ["Backlog", "A Fazer", "Em Progresso", "Revisão", "Concluído"];

  /* ---- estado interno de filtro ---- */
  let filterMonth = currentYM();
  let portalTab   = "boletos";
  let selectedCompanyId = null;
  let tasksView   = "lista";
  const calRef    = new Date(); calRef.setDate(1);
  let tgState     = null; // { bot, account } — carregado uma vez por página

  /* Colunas do quadro na linguagem do cliente */
  const BOARD = [
    { label: "Na fila",          statuses: ["backlog", "nao_iniciada"] },
    { label: "Em produção",      statuses: ["em_andamento", "em_revisao", "ajustes"] },
    { label: "Aguardando você",  statuses: ["aguardando_aprovacao"] },
    { label: "Concluído",        statuses: ["concluida"] }
  ];
  const WEEKDAYS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
  const MONTHS_FULL = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];

  function boardHtml(tasks) {
    const today = DB.todayISO();
    return `
      <div class="kanban-board">
        ${BOARD.map((col) => {
          const list = tasks.filter((t) => col.statuses.includes(t.status));
          return `
          <div class="kanban-column">
            <div class="kanban-column-header"><span>${col.label}</span><span class="text-muted">${list.length}</span></div>
            <div class="kanban-cards">
              ${list.map((t) => {
                const st = STATUS_TASK[t.status] || STATUS_TASK.nao_iniciada;
                const overdue = t.status !== "concluida" && t.dueDate < today;
                return `
                <div class="kanban-card" data-portal-task="${t.id}" style="cursor:pointer;">
                  <div class="kc-title-row"><span class="kc-title">${UI.escapeHtml(t.title)}</span></div>
                  <div style="margin:6px 0;"><span class="badge ${st.badge}">${st.label}</span></div>
                  <div class="text-sm" style="${overdue ? "color:var(--color-danger);font-weight:700;" : ""}">📅 ${UI.formatDate(t.dueDate)}${overdue ? " ⚠️" : ""}</div>
                </div>`;
              }).join("") || `<div class="text-sm text-muted" style="padding:8px;">—</div>`}
            </div>
          </div>`;
        }).join("")}
      </div>`;
  }

  function calendarHtml(tasks) {
    const year = calRef.getFullYear();
    const month = calRef.getMonth();
    const firstDay = new Date(year, month, 1).getDay();
    const days = new Date(year, month + 1, 0).getDate();
    const today = DB.todayISO();
    const cells = [];
    for (let i = 0; i < firstDay; i++) cells.push(null);
    for (let d = 1; d <= days; d++) cells.push(`${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`);
    while (cells.length % 7) cells.push(null);
    return `
      <div class="flex items-center justify-between" style="margin-bottom:12px;gap:8px;">
        <button class="btn btn-secondary btn-sm" data-cal-shift="-1">‹</button>
        <strong>${MONTHS_FULL[month]} de ${year}</strong>
        <button class="btn btn-secondary btn-sm" data-cal-shift="1">›</button>
      </div>
      <div style="overflow-x:auto;">
        <div class="calendar-month-grid" style="min-width:640px;">
          ${WEEKDAYS.map((w) => `<div class="cal-weekday">${w}</div>`).join("")}
          ${cells.map((iso) => {
            if (!iso) return `<div class="calendar-day-cell outside"></div>`;
            const list = tasks.filter((t) => t.dueDate === iso);
            return `
            <div class="calendar-day-cell ${iso === today ? "today" : ""}">
              <div class="day-number">${Number(iso.slice(8))}</div>
              ${list.map((t) => {
                const cls = t.status === "concluida" ? "done" : t.dueDate < today ? "overdue" : "";
                return `<div class="cal-event-pill ${cls}" data-portal-task="${t.id}" title="${UI.escapeHtml(t.title)}" style="cursor:pointer;">${t.status === "aguardando_aprovacao" ? "⏳ " : ""}${UI.escapeHtml(t.title)}</div>`;
              }).join("")}
            </div>`;
          }).join("")}
        </div>
      </div>
      <p class="text-sm text-muted" style="margin-top:8px;">As tarefas aparecem na data de entrega prevista.</p>`;
  }

  /* ---- Conectar Telegram (login sem senha pelo bot) ---- */
  function loadTelegramState() {
    if (tgState) return Promise.resolve(tgState);
    return Promise.all([DB.Telegram.publicInfo(), DB.Telegram.myAccount()]).then(([info, account]) => {
      tgState = { bot: info.bot_username || null, account };
      return tgState;
    });
  }

  function renderTelegramButton(container, ctx) {
    const slot = container.querySelector("#portal-tg");
    if (!slot) return;
    loadTelegramState().then((st) => {
      if (!slot.isConnected || !st.bot) return;
      slot.innerHTML = st.account
        ? `<button class="btn btn-ghost btn-sm" id="portal-tg-btn" title="Telegram conectado">📱 Telegram conectado</button>`
        : `<button class="btn btn-secondary btn-sm" id="portal-tg-btn">📱 Conectar Telegram</button>`;
      slot.querySelector("#portal-tg-btn").addEventListener("click", () => openTelegramConnectModal(container, ctx));
    });
  }

  async function openTelegramConnectModal(container, ctx) {
    const st = tgState;
    const refresh = () => { tgState = null; UI.hideModal(); window.Views.portal(container, ctx); };
    if (st.account) {
      const overlay = UI.showModal(`
        <div class="modal-header"><h3>📱 Telegram conectado</h3><button class="modal-close" id="tc-close">✕</button></div>
        <div class="modal-body">
          <p>Sua conta está ligada ao Telegram <strong>${UI.escapeHtml(st.account.tg_username ? "@" + st.account.tg_username : st.account.tg_name || "")}</strong>.</p>
          <p class="text-sm text-muted">Para abrir o portal sem senha, abra a conversa com <strong>@${UI.escapeHtml(st.bot)}</strong> e toque em <strong>Portal</strong>. Os avisos de aprovação dos grupos também levam direto para lá.</p>
        </div>
        <div class="modal-footer">
          <button class="btn btn-ghost" id="tc-off" style="color:var(--color-danger);">Desconectar</button>
          <a class="btn btn-secondary" href="https://t.me/${encodeURIComponent(st.bot)}" target="_blank" rel="noopener">Abrir o bot</a>
          <button class="btn btn-primary" id="tc-ok">Fechar</button>
        </div>`);
      overlay.querySelector("#tc-close").addEventListener("click", UI.hideModal);
      overlay.querySelector("#tc-ok").addEventListener("click", UI.hideModal);
      overlay.querySelector("#tc-off").addEventListener("click", async () => {
        if (!UI.confirmDialog("Desconectar o Telegram? Você continuará entrando com e-mail e senha.")) return;
        const r = await DB.Telegram.disconnectMe();
        if (!r.ok) { UI.toast(r.message, "error"); return; }
        UI.toast("Telegram desconectado.", "success");
        refresh();
      });
      return;
    }
    const r = await DB.Telegram.connectToken();
    if (!r.ok) { UI.toast(r.message, "error"); return; }
    const link = `https://t.me/${encodeURIComponent(st.bot)}?start=c_${encodeURIComponent(r.token)}`;
    const overlay = UI.showModal(`
      <div class="modal-header"><h3>📱 Conectar Telegram</h3><button class="modal-close" id="tc-close">✕</button></div>
      <div class="modal-body">
        <p>Conecte uma vez e passe a abrir o portal pelo Telegram, <strong>sem senha</strong>.</p>
        <ol class="text-sm" style="margin:0 0 14px 18px;line-height:1.8;">
          <li>Toque em <strong>Abrir o Telegram</strong> (no celular ou no computador com Telegram).</li>
          <li>Na conversa com <strong>@${UI.escapeHtml(st.bot)}</strong>, toque em <strong>Iniciar</strong>.</li>
          <li>Volte aqui e toque em <strong>Já conectei</strong>.</li>
        </ol>
        <a class="btn btn-primary" id="tc-link" href="${UI.escapeHtml(link)}" target="_blank" rel="noopener" style="width:100%;justify-content:center;">Abrir o Telegram</a>
        <p class="text-sm text-muted" style="margin-top:10px;">O link vale 15 minutos e só funciona uma vez. Só a sua conta do Telegram passa a entrar no portal.</p>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" id="tc-cancel">Cancelar</button>
        <button class="btn btn-primary" id="tc-done">Já conectei</button>
      </div>`, { static: true });
    overlay.querySelector("#tc-close").addEventListener("click", UI.hideModal);
    overlay.querySelector("#tc-cancel").addEventListener("click", UI.hideModal);
    overlay.querySelector("#tc-done").addEventListener("click", async () => {
      const acc = await DB.Telegram.myAccount();
      if (!acc) { UI.toast("Ainda não recebemos a conexão. Abra o bot e toque em Iniciar.", "error"); return; }
      UI.toast("Telegram conectado!", "success");
      refresh();
    });
  }

  /* ================================================================= */
  /* TELA DE ASSINATURA DO CONTRATO                                     */
  /* ================================================================= */

  function renderContractScreen(container, ctx, company) {
    const initials  = company.name.split(" ").slice(0, 2).map((p) => p[0]).join("").toUpperCase();
    const hasFile   = !!(company.contractFile && company.contractFile.data);
    const hasText   = !!(company.contractText && company.contractText.trim());

    const fileBlock = hasFile ? `
      <div style="display:flex;align-items:center;gap:10px;padding:12px 16px;background:var(--bg-soft,#f9f7f3);border:1px solid var(--border-color);border-radius:10px;margin-bottom:20px;">
        <span style="font-size:22px;">📎</span>
        <div style="flex:1;">
          <div style="font-weight:600;font-size:14px;">${UI.escapeHtml(company.contractFile.name)}</div>
          <div class="text-sm text-muted">Arquivo do contrato em anexo</div>
        </div>
        <button class="btn btn-primary btn-sm" id="btn-open-file">Abrir contrato</button>
      </div>` : "";

    const textBlock = hasText ? `
      <div style="background:var(--bg-soft,#f9f7f3);border:1px solid var(--border-color);border-radius:8px;padding:24px;max-height:340px;overflow-y:auto;font-size:14px;line-height:1.9;white-space:pre-wrap;font-family:inherit;margin-bottom:24px;">${UI.escapeHtml(company.contractText)}</div>` : "";

    container.innerHTML = `
      <div style="max-width:820px;margin:0 auto;">

        <!-- cabeçalho -->
        <div style="display:flex;align-items:center;gap:16px;margin-bottom:28px;">
          <div style="width:52px;height:52px;background:var(--color-primary);border-radius:14px;display:flex;align-items:center;justify-content:center;font-size:20px;font-weight:800;color:#fff;flex-shrink:0;">
            ${initials}
          </div>
          <div>
            <h1 style="margin:0;line-height:1.1;">${UI.escapeHtml(company.name)}</h1>
            <p class="page-subtitle" style="margin:4px 0 0;">Para acessar seus boletos, leia e assine o contrato abaixo.</p>
          </div>
        </div>

        <!-- aviso -->
        <div style="display:flex;align-items:center;gap:10px;padding:12px 16px;background:var(--color-warning-light,#fff8e1);border:1px solid var(--color-warning,#f59e0b);border-radius:10px;margin-bottom:20px;font-size:13px;font-weight:600;color:var(--color-warning,#b45309);">
          ⚠️ Leia o contrato na íntegra antes de assinar. Após a assinatura, você terá acesso aos boletos da sua empresa.
        </div>

        <!-- card do contrato -->
        <div class="card" style="margin-bottom:24px;">
          <div class="card-header">
            <h3 class="card-title">📄 Contrato de Prestação de Serviços</h3>
          </div>
          <div class="card-pad">
            ${fileBlock}
            ${textBlock}

            <div class="form-group">
              <label class="form-label" for="sign-name">✍️ Assinatura digital — Digite seu nome completo *</label>
              <input type="text" class="form-control" id="sign-name" placeholder="Ex: João Silva" style="font-size:15px;letter-spacing:.3px;" autocomplete="off" />
              <div class="text-sm text-muted" style="margin-top:4px;">Seu nome será registrado como assinatura digital com data e hora.</div>
            </div>

            <label class="checkbox-row" style="margin:18px 0 24px;font-size:14px;align-items:flex-start;gap:10px;">
              <input type="checkbox" id="sign-agree" style="margin-top:3px;flex-shrink:0;" />
              <span>Li e estou de acordo com todos os termos e condições do Contrato de Prestação de Serviços${hasFile ? " (incluindo o arquivo anexado)" : ""}, reconhecendo este ato como uma assinatura eletrônica válida.</span>
            </label>

            <button class="btn btn-primary" id="btn-sign" style="width:100%;padding:14px 0;font-size:16px;font-weight:700;" disabled>
              ✍️ Assinar Contrato e Acessar Boletos
            </button>
          </div>
        </div>

        <p class="text-sm text-muted" style="text-align:center;">
          Dúvidas sobre o contrato? Entre em contato com a equipe responsável pela sua conta.
        </p>
      </div>`;

    const openFileBtn = container.querySelector("#btn-open-file");
    if (openFileBtn) {
      openFileBtn.addEventListener("click", () => UI.openAttachment(company.contractFile));
    }

    const nameInput  = container.querySelector("#sign-name");
    const agreeCheck = container.querySelector("#sign-agree");
    const signBtn    = container.querySelector("#btn-sign");

    function checkReady() {
      signBtn.disabled = !nameInput.value.trim() || !agreeCheck.checked;
    }
    nameInput.addEventListener("input", checkReady);
    agreeCheck.addEventListener("change", checkReady);

    signBtn.addEventListener("click", () => {
      const name = nameInput.value.trim();
      if (!name || !agreeCheck.checked) return;
      signBtn.disabled = true;
      signBtn.textContent = "Registrando assinatura...";
      DB.Companies.signContract(company.id, name);
      UI.toast("Contrato assinado com sucesso! Bem-vindo ao portal.", "success");
      window.Views.portal(container, ctx);
    });
  }

  /* ================================================================= */
  /* MODAL: VER CONTRATO ASSINADO                                       */
  /* ================================================================= */

  function openContractViewModal(company) {
    const hasFile = !!(company.contractFile && company.contractFile.data);
    const hasText = !!(company.contractText && company.contractText.trim());

    const html = `
      <div class="modal-header">
        <h3>📄 Contrato — ${UI.escapeHtml(company.name)}</h3>
        <button class="modal-close" id="cv-close">✕</button>
      </div>
      <div class="modal-body">
        ${hasFile ? `
        <div style="display:flex;align-items:center;gap:10px;padding:10px 14px;background:var(--bg-soft,#f9f7f3);border:1px solid var(--border-color);border-radius:8px;margin-bottom:14px;">
          <span style="font-size:20px;">📎</span>
          <span class="text-sm" style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${UI.escapeHtml(company.contractFile.name)}</span>
          <button class="btn btn-primary btn-sm" id="cv-open-file">Abrir arquivo</button>
        </div>` : ""}
        ${hasText ? `<div style="background:var(--bg-soft,#f9f7f3);border:1px solid var(--border-color);border-radius:8px;padding:20px;max-height:320px;overflow-y:auto;font-size:13px;line-height:1.8;white-space:pre-wrap;margin-bottom:14px;">${UI.escapeHtml(company.contractText)}</div>` : ""}
        <div style="display:flex;align-items:center;gap:10px;padding:12px 16px;background:var(--color-success-light,#dcfce7);border-radius:8px;font-size:13px;font-weight:600;color:var(--color-success,#16a34a);">
          ✅ Assinado por <strong>${UI.escapeHtml(company.contractSignedBy || "")}</strong> em ${fmtDateTime(company.contractSignedAt)}
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-primary" id="cv-ok">Fechar</button>
      </div>`;

    const overlay = UI.showModal(html);
    overlay.querySelector("#cv-close").addEventListener("click", UI.hideModal);
    overlay.querySelector("#cv-ok").addEventListener("click", UI.hideModal);

    const openFileBtn = overlay.querySelector("#cv-open-file");
    if (openFileBtn) {
      openFileBtn.addEventListener("click", () => UI.openAttachment(company.contractFile));
    }
  }

  /* ================================================================= */
  /* MODAL: MATERIAL, APROVAÇÃO E HISTÓRICO DE UMA TAREFA               */
  /* ================================================================= */

  function portalEventText(ev, ctx) {
    const d = ev.data || {};
    const who = ev.actor === ctx.user.id ? "Você"
      : (DB.Users.get(ev.actor) || {}).role === "company" ? DB.Users.get(ev.actor).name
      : "Equipe";
    const st = (k) => (STATUS_TASK[k] || {}).label || k || "—";
    switch (ev.type) {
      case "created":            return "Tarefa criada";
      case "status_changed":     return `Status: <strong>${st(d.from)}</strong> → <strong>${st(d.to)}</strong>`;
      case "approval_requested": return `${who === "Equipe" ? "A equipe" : UI.escapeHtml(who)} enviou material para aprovação: <strong>${UI.escapeHtml((d.files || []).join(", "))}</strong>${d.message ? ` — “${UI.escapeHtml(d.message)}”` : ""}`;
      case "approval_decided":   return d.decision === "approved"
        ? `<strong style="color:var(--color-success);">${UI.escapeHtml(who)} aprovou o material</strong>${d.onBehalf ? " (registrado pela equipe)" : ""}`
        : `<strong style="color:var(--color-danger);">${UI.escapeHtml(who)} pediu ajustes</strong>${d.onBehalf ? " (registrado pela equipe)" : ""}: “${UI.escapeHtml(d.reason || "")}”`;
      case "approval_cancelled": return "A equipe retirou o material da aprovação";
      default:                   return null;
    }
  }

  function portalFileHtml(f, url) {
    const mime = f.mime || "";
    let preview = "";
    if (url && mime.indexOf("image/") === 0) {
      preview = `<a href="${UI.escapeHtml(url)}" target="_blank" rel="noopener"><img src="${UI.escapeHtml(url)}" alt="${UI.escapeHtml(f.name)}" style="display:block;max-width:100%;max-height:420px;margin:0 auto;border-radius:8px;" /></a>`;
    } else if (url && mime.indexOf("video/") === 0) {
      preview = `<video src="${UI.escapeHtml(url)}" controls preload="metadata" style="display:block;max-width:100%;max-height:420px;margin:0 auto;border-radius:8px;"></video>`;
    }
    return `
      <div style="padding:12px;border:1px solid var(--border-color);border-radius:10px;margin-bottom:10px;">
        ${preview}
        <div class="flex items-center justify-between" style="gap:8px;flex-wrap:wrap;${preview ? "margin-top:8px;" : ""}">
          <div class="text-sm" style="font-weight:600;word-break:break-word;">${UI.escapeHtml(f.name)} <span class="text-muted">(versão ${f.version})</span></div>
          ${url ? `<a class="btn btn-secondary btn-sm" href="${UI.escapeHtml(url)}" target="_blank" rel="noopener">Abrir / baixar</a>` : `<span class="text-sm text-muted">indisponível</span>`}
        </div>
      </div>`;
  }

  function openPortalTaskModal(ctx, task, canApprove, onDone) {
    const overlay = UI.showModal(`
      <div class="modal-header">
        <h3>${UI.escapeHtml(task.title)}</h3>
        <button class="modal-close" id="pt-close">✕</button>
      </div>
      <div class="modal-body" id="pt-body"><div class="text-sm text-muted">Carregando...</div></div>
      <div class="modal-footer" id="pt-footer"><button class="btn btn-secondary" id="pt-ok">Fechar</button></div>`, { large: true });
    overlay.querySelector("#pt-close").addEventListener("click", UI.hideModal);
    overlay.querySelector("#pt-ok").addEventListener("click", UI.hideModal);

    Promise.all([DB.TaskApprovals.list(task.id), DB.TaskFiles.list(task.id), DB.TaskEvents.list(task.id)]).then(async ([rounds, filesRes, events]) => {
      const body = overlay.querySelector("#pt-body");
      if (!body || !body.isConnected) return;
      const files = filesRes.files.filter((f) => !f.removed_at);
      const byId = files.reduce((m, f) => { m[f.id] = f; return m; }, {});
      const pending = rounds.find((r) => r.status === "pending");
      const decided = rounds.filter((r) => r.status === "approved" || r.status === "rejected");
      const lastDecided = decided[decided.length - 1];
      const shown = pending ? (pending.file_ids || []).map((id) => byId[id]).filter(Boolean)
        : lastDecided ? (lastDecided.file_ids || []).map((id) => byId[id]).filter(Boolean)
        : [];
      const urls = await DB.TaskFiles.signedUrls(shown.map((f) => f.path));
      if (!body.isConnected) return;

      const history = events.map((ev) => ({ ev, text: portalEventText(ev, ctx) })).filter((x) => x.text).reverse();

      body.innerHTML = `
        ${task.description ? `<div class="text-sm" style="margin-bottom:14px;white-space:pre-wrap;line-height:1.6;">${UI.escapeHtml(task.description)}</div>` : ""}

        ${pending ? `
        <div style="padding:12px 14px;background:var(--color-primary-light);border:1px solid var(--color-primary);border-radius:10px;margin-bottom:14px;">
          <div style="font-weight:700;color:var(--color-primary);">⏳ Material aguardando ${canApprove ? "a sua aprovação" : "aprovação"}</div>
          <div class="text-sm text-muted" style="margin-top:2px;">Enviado em ${fmtDateTime(pending.requested_at)}</div>
          ${pending.message ? `<div class="text-sm" style="margin-top:6px;white-space:pre-wrap;">💬 ${UI.escapeHtml(pending.message)}</div>` : ""}
        </div>` : lastDecided ? `
        <div style="padding:12px 14px;background:${lastDecided.status === "approved" ? "var(--color-success-light)" : "var(--color-danger-light)"};border-radius:10px;margin-bottom:14px;">
          <div style="font-weight:700;color:${lastDecided.status === "approved" ? "var(--color-success)" : "var(--color-danger)"};">${lastDecided.status === "approved" ? "✅ Material aprovado" : "✏️ Ajustes solicitados"} em ${fmtDateTime(lastDecided.decided_at)}</div>
          ${lastDecided.reason ? `<div class="text-sm" style="margin-top:6px;white-space:pre-wrap;">${UI.escapeHtml(lastDecided.reason)}</div>` : ""}
          ${lastDecided.status === "rejected" ? `<div class="text-sm text-muted" style="margin-top:6px;">A equipe está trabalhando nos ajustes e enviará uma nova versão.</div>` : ""}
        </div>` : ""}

        ${shown.length ? shown.map((f) => portalFileHtml(f, urls[f.path])).join("") : `<div class="text-sm text-muted" style="margin-bottom:14px;">Nenhum material enviado para avaliação ainda.</div>`}

        ${pending && canApprove ? `
        <div id="pt-reject-box" style="display:none;margin-top:6px;">
          <label class="form-label" for="pt-reason">O que precisa ser ajustado?</label>
          <textarea class="form-control" id="pt-reason" rows="3" placeholder="Descreva os ajustes (texto, cores, imagem, prazo...)"></textarea>
        </div>` : ""}

        <div style="margin-top:18px;">
          <div class="form-label">📜 Histórico</div>
          ${history.length ? history.map(({ ev, text }) => `
            <div style="padding:7px 0;border-bottom:1px solid var(--border-color);">
              <div class="text-sm">${text}</div>
              <div class="text-sm text-muted">${fmtDateTime(ev.created_at)}</div>
            </div>`).join("") : `<div class="text-sm text-muted">Sem registros.</div>`}
        </div>`;

      if (!(pending && canApprove)) return;
      const footer = overlay.querySelector("#pt-footer");
      footer.innerHTML = `
        <button class="btn btn-secondary" id="pt-ok">Fechar</button>
        <button class="btn btn-ghost" id="pt-reject" style="color:var(--color-danger);">✏️ Pedir ajustes</button>
        <button class="btn btn-primary" id="pt-approve">✅ Aprovar material</button>`;
      footer.querySelector("#pt-ok").addEventListener("click", UI.hideModal);

      const decide = async (decision, btn) => {
        let reason = null;
        if (decision === "rejected") {
          const box = body.querySelector("#pt-reject-box");
          if (box.style.display === "none") {
            box.style.display = "";
            btn.textContent = "Enviar pedido de ajustes";
            body.querySelector("#pt-reason").focus();
            return;
          }
          reason = body.querySelector("#pt-reason").value.trim();
          if (reason.length < 3) { UI.toast("Descreva o que precisa ser ajustado.", "error"); return; }
        } else if (!UI.confirmDialog("Confirmar a aprovação deste material?")) {
          return;
        }
        footer.querySelectorAll("button").forEach((b) => { b.disabled = true; });
        const res = await DB.TaskApprovals.decide(pending.id, task.id, decision, reason);
        if (!res.ok) {
          UI.toast(res.message, "error");
          footer.querySelectorAll("button").forEach((b) => { b.disabled = false; });
          return;
        }
        UI.toast(decision === "approved" ? "Material aprovado. Obrigado!" : "Pedido de ajustes enviado para a equipe.", "success");
        UI.hideModal();
        if (onDone) onDone();
      };
      footer.querySelector("#pt-approve").addEventListener("click", (e) => decide("approved", e.currentTarget));
      footer.querySelector("#pt-reject").addEventListener("click", (e) => decide("rejected", e.currentTarget));
    });
  }

  /* ================================================================= */
  /* PORTAL PRINCIPAL (BOLETOS)                                         */
  /* ================================================================= */

  /* Evita loop de recarga: depois de um reload bem-sucedido, considera os
     dados frescos por alguns segundos antes de buscar de novo no servidor */
  let freshUntil = 0;

  window.Views.portal = function (container, ctx) {
    /* Garante que os dados reflitam qualquer alteração feita pelo admin
       (ex.: contrato anexado, boleto criado) enquanto esta aba estava aberta */
    if (Date.now() > freshUntil) {
      DB.reload().then(() => {
        freshUntil = Date.now() + 5000;
        if (container.isConnected) window.Views.portal(container, ctx);
      });
    }
    /* Unidades que este usuário acessa e o que pode ver em cada uma */
    const access = DB.CompanyMembers.accessOf();
    if (!access.length) {
      container.innerHTML = `<div class="empty-state"><div class="empty-icon">🔒</div>Seu acesso ainda não foi liberado para nenhuma unidade. Fale com a equipe responsável.</div>`;
      return;
    }
    if (!access.some((a) => a.companyId === selectedCompanyId)) {
      selectedCompanyId = (access.find((a) => a.primary) || access[0]).companyId;
    }
    const current = access.find((a) => a.companyId === selectedCompanyId);
    const perms = current.perms;
    const company = DB.Companies.get(selectedCompanyId);

    /* Portão de contrato (unidade principal, para quem vê o financeiro):
       se existe texto OU arquivo e ainda não foi assinado → tela de assinatura */
    const hasContract = company && (
      (company.contractText && company.contractText.trim()) ||
      company.contractFile
    );
    if (hasContract && !company.contractSignedAt && current.primary && perms.can_view_financial) {
      renderContractScreen(container, ctx, company);
      return;
    }

    const tabs = [["boletos", "🧾 Boletos", perms.can_view_financial], ["tarefas", "✅ Tarefas", perms.can_view_tasks], ["campanhas", "📈 Campanhas", perms.can_view_campaigns && !!window.CampaignsPanel]]
      .filter((t) => t[2]);
    if (!tabs.some((t) => t[0] === portalTab) && tabs.length) portalTab = tabs[0][0];

    const initials          = company ? company.name.split(" ").slice(0, 2).map((p) => p[0]).join("").toUpperCase() : "EM";
    const hasSignedContract = company && hasContract && company.contractSignedAt;
    const companyName       = UI.escapeHtml(company ? company.name : ctx.user.name);

    /* ---- tabs ---- */
    const tabBar = `
      <div style="display:flex;gap:2px;margin-bottom:22px;border-bottom:2px solid var(--border-color);">
        ${tabs.map(([id, label]) => {
          const active = portalTab === id;
          return `<button data-portal-tab="${id}" style="padding:10px 20px;border:none;background:none;cursor:pointer;font-size:14px;font-weight:600;color:${active ? "var(--color-primary)" : "var(--text-muted)"};border-bottom:2px solid ${active ? "var(--color-primary)" : "transparent"};margin-bottom:-2px;transition:color .2s,border-color .2s;">${label}</button>`;
        }).join("")}
      </div>`;

    /* ===== ABA BOLETOS ===== */
    function renderBoletosContent() {
      const allBoletos = DB.Boletos.list({ companyId: selectedCompanyId || "_none" });
      const today      = DB.todayISO();
      if (!allBoletos.some((b) => b.month === filterMonth)) {
        filterMonth = allBoletos.length ? allBoletos[allBoletos.length - 1].month : currentYM();
      }
      const filtered       = allBoletos.filter((b) => !filterMonth || b.month === filterMonth);
      const hasMonthFilter = allBoletos.length > 0;

      const rows = filtered.length === 0
        ? `<tr><td colspan="6" style="text-align:center;padding:36px;color:var(--text-muted);">Nenhum boleto neste período.</td></tr>`
        : filtered.map((b) => {
            const cfg    = STATUS_CFG[b.status] || STATUS_CFG.pendente;
            const overdue = b.status === "pendente" && b.dueDate < today;
            return `<tr>
              <td><div style="font-weight:600;">${UI.escapeHtml(b.description)}</div><div class="text-sm text-muted">${monthLabel(b.month)}</div></td>
              <td style="font-weight:700;color:var(--color-primary);font-size:1.05rem;">${brl(b.amount)}</td>
              <td class="text-sm" style="${overdue ? "color:var(--color-danger);font-weight:600;" : ""}">${UI.formatDate(b.dueDate)}${overdue ? " ⚠️" : ""}</td>
              <td class="text-sm">${b.paidDate ? UI.formatDate(b.paidDate) : "—"}</td>
              <td><span class="badge ${cfg.badge}">${cfg.icon} ${cfg.label}</span></td>
              <td>${b.attachment ? `<button class="btn btn-secondary btn-sm" data-open-att="${b.id}">📎 Ver boleto</button>` : `<span class="text-sm text-muted">—</span>`}</td>
            </tr>`;
          }).join("");

      return `
        <div class="card">
          <div class="card-header" style="flex-wrap:wrap;gap:10px;">
            <h3 class="card-title">Boletos</h3>
            ${hasMonthFilter ? `
            <div class="flex items-center gap-2">
              <label class="text-sm text-muted">Período:</label>
              <select class="form-control" id="portal-month" style="width:auto;min-width:160px;">
                <option value="">Todos os períodos</option>
                ${monthOptions(filterMonth, allBoletos)}
              </select>
            </div>` : ""}
          </div>
          <div style="overflow-x:auto;">
            <table class="data-table">
              <thead><tr><th>Descrição</th><th>Valor</th><th>Vencimento</th><th>Pagamento</th><th>Status</th><th>Arquivo</th></tr></thead>
              <tbody>${rows}</tbody>
            </table>
          </div>
        </div>
        <p class="text-sm text-muted" style="margin-top:18px;text-align:center;">Dúvidas sobre cobranças? Entre em contato com a equipe responsável.</p>`;
    }

    /* ===== ABA TAREFAS ===== */
    function renderTarefasContent() {
      /* Usa "_none" como fallback para nunca vazar tarefas de outros quando companyId for nulo */
      const tasks = DB.Tasks.list({ companyId: selectedCompanyId || "_none" })
        .sort((x, y) => (y.status === "aguardando_aprovacao") - (x.status === "aguardando_aprovacao"));
      const today = DB.todayISO();
      const awaiting = tasks.filter((t) => t.status === "aguardando_aprovacao").length;

      if (!tasks.length) {
        return `<div class="empty-state"><div class="empty-icon">📋</div>Nenhuma tarefa vinculada à sua empresa ainda.</div>`;
      }

      const cards = tasks.map((t) => {
        const st      = STATUS_TASK[t.status] || STATUS_TASK.nao_iniciada;
        const step    = st.step;
        const overdue = t.status !== "concluida" && t.dueDate < today;
        const done    = (t.checklist || []).filter((c) => c.done).length;
        const total   = (t.checklist || []).length;
        const pct     = total ? Math.round((done / total) * 100) : 0;
        const prLabel = PRIORITY_TASK[t.priority] || t.priority;

        const prColor = t.priority === "urgente" ? "var(--color-danger)"
                      : t.priority === "alta"    ? "#a85a3f"
                      : t.priority === "media"   ? "var(--color-warning)"
                      : "var(--color-info)";

        /* barra de progresso de etapas */
        const stepsBar = STEPS_TASK.map((s, i) => {
          const done_s   = i < step;
          const current  = i === step;
          const bg       = done_s ? "var(--color-primary)" : current ? "var(--color-primary)" : "var(--border-color)";
          const opacity  = done_s || current ? "1" : "0.35";
          return `<div title="${s}" style="flex:1;height:6px;border-radius:3px;background:${bg};opacity:${opacity};transition:background .3s;"></div>`;
        }).join("");

        return `
        <div class="card" style="margin-bottom:14px;${t.status === "aguardando_aprovacao" ? "border:1px solid var(--color-primary);" : ""}">
          <div class="card-pad">
            <div class="flex items-center justify-between" style="margin-bottom:8px;flex-wrap:wrap;gap:6px;">
              <div style="font-weight:700;font-size:15px;flex:1;min-width:0;">${UI.escapeHtml(t.title)}</div>
              <span class="badge ${st.badge}" style="flex-shrink:0;">${st.label}</span>
            </div>
            ${t.description ? `<div class="text-sm text-muted" style="margin-bottom:10px;line-height:1.5;">${UI.escapeHtml(t.description.slice(0, 160))}${t.description.length > 160 ? "…" : ""}</div>` : ""}

            <!-- barra de etapas -->
            <div style="display:flex;gap:3px;margin-bottom:10px;">${stepsBar}</div>
            <div class="text-sm text-muted" style="margin-bottom:12px;">${st.label}</div>

            <div class="flex gap-4" style="font-size:13px;flex-wrap:wrap;">
              <div>📅 <span class="text-muted">Prazo:</span> <strong style="${overdue ? "color:var(--color-danger);" : ""}">${UI.formatDate(t.dueDate)}${overdue ? " ⚠️" : ""}</strong></div>
              <div>🎯 <span class="text-muted">Prioridade:</span> <strong style="color:${prColor};">${prLabel}</strong></div>
              ${total ? `<div>☑️ <span class="text-muted">Checklist:</span> <strong>${done}/${total}</strong>
                <div class="progress-bar" style="width:80px;display:inline-flex;margin-left:4px;vertical-align:middle;">
                  <div class="progress-bar-fill" style="width:${pct}%;"></div>
                </div></div>` : ""}
            </div>

            ${(t.tags || []).length ? `<div style="margin-top:10px;">${t.tags.map((tag) => `<span class="tag-pill">${UI.escapeHtml(tag)}</span>`).join(" ")}</div>` : ""}

            <div class="flex gap-2" style="margin-top:12px;justify-content:flex-end;flex-wrap:wrap;">
              ${t.status === "aguardando_aprovacao"
                ? `<button class="btn btn-primary btn-sm" data-portal-task="${t.id}">👀 Ver material${perms.can_approve ? " e responder" : ""}</button>`
                : `<button class="btn btn-ghost btn-sm" data-portal-task="${t.id}">Detalhes e histórico</button>`}
            </div>
          </div>
        </div>`;
      }).join("");

      return `
        <div class="page-header" style="margin-bottom:14px;">
          <div>
            <h3 style="margin:0;font-size:15px;">Suas Tarefas</h3>
            <p class="page-subtitle">${tasks.length} tarefa(s) vinculada(s) à sua empresa.</p>
          </div>
        </div>
        ${awaiting ? `
        <div style="padding:12px 16px;background:var(--color-primary-light);border:1px solid var(--color-primary);border-radius:10px;margin-bottom:14px;font-size:14px;font-weight:600;color:var(--color-primary);">
          ⏳ ${awaiting === 1 ? "1 material aguardando" : `${awaiting} materiais aguardando`} ${perms.can_approve ? "a sua aprovação" : "aprovação"}.
        </div>` : ""}
        <div class="flex gap-2" style="margin-bottom:14px;flex-wrap:wrap;">
          ${[["lista", "☰ Lista"], ["quadro", "▦ Quadro"], ["calendario", "📅 Calendário"], ["historico", "📜 Histórico"]].map(([id, label]) =>
            `<button class="btn btn-sm ${tasksView === id ? "btn-primary" : "btn-secondary"}" data-tasks-view="${id}">${label}</button>`).join("")}
        </div>
        ${tasksView === "quadro" ? boardHtml(tasks)
          : tasksView === "calendario" ? calendarHtml(tasks)
          : tasksView === "historico" ? `<div class="card"><div class="card-pad" id="portal-history"><div class="text-sm text-muted">Carregando histórico...</div></div></div>`
          : cards}`;
    }

    container.innerHTML = `
      <!-- cabeçalho -->
      <div style="display:flex;align-items:center;gap:16px;margin-bottom:22px;flex-wrap:wrap;">
        <div style="width:52px;height:52px;background:var(--color-primary);border-radius:14px;display:flex;align-items:center;justify-content:center;font-size:20px;font-weight:800;color:#fff;flex-shrink:0;">${initials}</div>
        <div style="flex:1;min-width:180px;">
          <h1 style="margin:0;line-height:1.1;">${companyName}</h1>
          <p class="page-subtitle" style="margin:4px 0 0;">Portal do Cliente${company && company.brand ? ` · ${UI.escapeHtml(company.brand)}` : ""}</p>
        </div>
        ${access.length > 1 ? `
        <select class="form-control" id="portal-unit" style="width:auto;min-width:200px;flex-shrink:0;" title="Unidade">
          ${access.map((a) => {
            const c = DB.Companies.get(a.companyId);
            return `<option value="${a.companyId}" ${a.companyId === selectedCompanyId ? "selected" : ""}>${UI.escapeHtml(c ? c.name : a.companyId)}</option>`;
          }).join("")}
        </select>` : ""}
        ${hasSignedContract && perms.can_view_financial ? `<button class="btn btn-secondary" id="btn-view-contract" style="flex-shrink:0;">📄 Contrato</button>` : ""}
        <div id="portal-tg" style="flex-shrink:0;"></div>
      </div>
      ${tabBar}
      <div id="portal-tab-content">${!tabs.length
        ? `<div class="empty-state"><div class="empty-icon">🔒</div>Nenhuma área liberada para você nesta unidade.</div>`
        : portalTab === "boletos" ? renderBoletosContent()
        : portalTab === "campanhas" ? `<div id="portal-campaigns"></div>`
        : renderTarefasContent()}</div>`;

    const campEl = container.querySelector("#portal-campaigns");
    if (campEl) window.CampaignsPanel.render(campEl, { companyIds: [selectedCompanyId], staff: false });

    const unitSel = container.querySelector("#portal-unit");
    if (unitSel) unitSel.addEventListener("change", (e) => { selectedCompanyId = e.target.value; window.Views.portal(container, ctx); });

    /* ---- eventos ---- */
    container.querySelectorAll("[data-portal-tab]").forEach((btn) => {
      btn.addEventListener("click", () => {
        portalTab = btn.dataset.portalTab;
        window.Views.portal(container, ctx);
      });
    });

    const monthSel = container.querySelector("#portal-month");
    if (monthSel) {
      monthSel.addEventListener("change", (e) => { filterMonth = e.target.value; window.Views.portal(container, ctx); });
    }

    renderTelegramButton(container, ctx);

    container.querySelectorAll("[data-tasks-view]").forEach((btn) => {
      btn.addEventListener("click", () => { tasksView = btn.dataset.tasksView; window.Views.portal(container, ctx); });
    });
    container.querySelectorAll("[data-cal-shift]").forEach((btn) => {
      btn.addEventListener("click", () => {
        calRef.setMonth(calRef.getMonth() + Number(btn.dataset.calShift));
        window.Views.portal(container, ctx);
      });
    });

    /* Histórico da unidade: eventos visíveis ao cliente de todas as tarefas */
    const historyBox = container.querySelector("#portal-history");
    if (historyBox) {
      const unitTasks = DB.Tasks.list({ companyId: selectedCompanyId || "_none", includeArchived: true });
      const titles = unitTasks.reduce((m, t) => { m[t.id] = t.title; return m; }, {});
      DB.TaskEvents.listForTasks(unitTasks.map((t) => t.id), 100).then((events) => {
        if (!historyBox.isConnected) return;
        const rows = events.map((ev) => ({ ev, text: portalEventText(ev, ctx) })).filter((x) => x.text);
        historyBox.innerHTML = rows.length ? rows.map(({ ev, text }) => `
          <div style="padding:9px 0;border-bottom:1px solid var(--border-color);">
            <div class="text-sm" style="font-weight:700;">${UI.escapeHtml(titles[ev.task_id] || "Tarefa")}</div>
            <div class="text-sm">${text}</div>
            <div class="text-sm text-muted">${fmtDateTime(ev.created_at)}</div>
          </div>`).join("") : `<div class="text-sm text-muted">Nenhum registro ainda.</div>`;      });
    }

    container.querySelectorAll("[data-portal-task]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const fresh = await DB.Tasks.refresh(btn.dataset.portalTask);
        if (!fresh) { UI.toast("Tarefa não encontrada.", "error"); window.Views.portal(container, ctx); return; }
        openPortalTaskModal(ctx, fresh, perms.can_approve, () => window.Views.portal(container, ctx));
      });
    });

    const contractBtn = container.querySelector("#btn-view-contract");
    if (contractBtn) contractBtn.addEventListener("click", () => openContractViewModal(company));

    container.querySelectorAll("[data-open-att]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const b = DB.Boletos.get(btn.dataset.openAtt);
        if (b && b.attachment) UI.openAttachment(b.attachment);
        else UI.toast("Arquivo não disponível.", "error");
      });
    });
  };
})();
