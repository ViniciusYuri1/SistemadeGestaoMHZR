/* ==========================================================================
   views/tasks.js — Gestão de Tarefas: listagem, filtros, busca, ordenação,
   criação/edição, duplicar, arquivar, excluir e modal de detalhes
   (checklist, comentários, anexos, horas registradas).
   ========================================================================== */

(function () {
  "use strict";
  window.Views = window.Views || {};

  const STATUS_LABELS = DB.TASK_STATUS_LABELS;
  const PRIORITY_LABELS = { baixa: "Baixa", media: "Média", alta: "Alta", urgente: "Urgente" };

  let state = {
    search: "",
    status: "",
    priority: "",
    assignee: null, // null = ainda não definido (recebe o padrão por perfil no 1º render)
    company: "",
    sort: "dueDate",
    showArchived: false
  };

  function lastHandoff(task) {
    const list = task.handoffs || [];
    const last = list[list.length - 1];
    return last && last.to === task.assignee ? last : null;
  }

  const TRACKED_FIELD_LABELS = {
    title: "título", description: "descrição", priority: "prioridade",
    startDate: "data de início", dueDate: "prazo", tags: "tags", companyIds: "empresas"
  };

  function taskEventText(ev) {
    const d = ev.data || {};
    const st = (k) => STATUS_LABELS[k] || k || "—";
    switch (ev.type) {
      case "created":          return d.duplicatedFrom ? "criou a tarefa (duplicada)" : "criou a tarefa";
      case "status_changed":   return `mudou o status de <strong>${st(d.from)}</strong> para <strong>${st(d.to)}</strong>`;
      case "assignee_changed": return `trocou o responsável de <strong>${UI.escapeHtml(userName(d.from))}</strong> para <strong>${UI.escapeHtml(userName(d.to))}</strong>`;
      case "updated":          return `editou ${(d.fields || []).map((f) => TRACKED_FIELD_LABELS[f] || f).join(", ")}`;
      case "comment":          return `comentou: “${UI.escapeHtml(d.text || "")}”`;
      case "forwarded":        return `encaminhou de <strong>${UI.escapeHtml(userName(d.from))}</strong> para <strong>${UI.escapeHtml(userName(d.to))}</strong>${d.note ? `: “${UI.escapeHtml(d.note)}”` : ""}`;
      case "archived":         return d.auto ? `arquivada automaticamente (concluída há mais de ${d.days || 30} dias)` : "arquivou a tarefa";
      case "unarchived":       return "desarquivou a tarefa";
      case "file_uploaded":    return `enviou o arquivo <strong>${UI.escapeHtml(d.name || "")}</strong>`;
      case "file_version":     return `enviou a versão <strong>v${d.version}</strong> de <strong>${UI.escapeHtml(d.name || "")}</strong>`;
      case "file_removed":     return `removeu o arquivo <strong>${UI.escapeHtml(d.name || "")}</strong> (v${d.version})`;
      case "approval_requested": return `enviou para aprovação do cliente: <strong>${UI.escapeHtml((d.files || []).join(", "))}</strong>${d.message ? ` — “${UI.escapeHtml(d.message)}”` : ""}`;
      case "approval_decided": return (d.decision === "approved" ? "<strong style=\"color:var(--color-success);\">aprovou o material</strong>" : `<strong style="color:var(--color-danger);">pediu ajustes</strong>: “${UI.escapeHtml(d.reason || "")}”`) + (d.onBehalf ? " (registrado em nome do cliente)" : "");
      case "approval_cancelled": return "retirou o material da aprovação do cliente";
      default:                 return UI.escapeHtml(ev.type);
    }
  }

  function taskEventHtml(ev) {
    const actor = ev.actor ? DB.Users.get(ev.actor) : null;
    const who = actor ? `<strong>${UI.escapeHtml(actor.name)}</strong> ` : (ev.actor ? "<strong>Usuário removido</strong> " : "");
    const text = taskEventText(ev);
    const sentence = who ? who + text : (ev.type === "created" ? "Tarefa criada" : text.charAt(0).toUpperCase() + text.slice(1));
    const when = ev.data && ev.data.backfill && ev.type === "created" ? UI.formatDate(ev.created_at.slice(0, 10)) : UI.formatDateTime(ev.created_at);
    return `
      <div style="padding:8px 0;border-bottom:1px solid var(--border-color);">
        <div class="text-sm">${sentence}</div>
        <div class="text-sm text-muted" style="margin-top:2px;">${when}${ev.visibility === "client" ? " · visível ao cliente" : ""}</div>
      </div>`;
  }

  /* ------------------------------------------------------------------ */
  /* Arquivos da tarefa (Storage, com versões)                           */
  /* ------------------------------------------------------------------ */

  function fileIcon(mime) {
    if (!mime) return "📎";
    if (mime.indexOf("image/") === 0) return "🖼️";
    if (mime.indexOf("video/") === 0) return "🎬";
    if (mime === "application/pdf") return "📄";
    if (mime.indexOf("audio/") === 0) return "🎵";
    return "📎";
  }

  function fileSize(bytes) {
    if (!bytes && bytes !== 0) return "";
    if (bytes >= 1048576) return `${(bytes / 1048576).toFixed(1).replace(".", ",")} MB`;
    return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  }

  function bindTaskFiles(overlay, task, canEdit) {
    const box = overlay.querySelector("#tm-files");
    const statusEl = overlay.querySelector("#tm-file-status");
    const openVersions = new Set();
    let groups = [];

    function setStatus(text) {
      if (statusEl) statusEl.textContent = text;
    }

    function fileLink(f, urls, label) {
      const url = urls[f.path];
      return url
        ? `<a class="btn btn-ghost btn-sm" href="${UI.escapeHtml(url)}" target="_blank" rel="noopener">${label}</a>`
        : `<span class="text-sm text-muted">indisponível</span>`;
    }

    function render(urls) {
      if (!box.isConnected) return;
      const visible = groups.filter((g) => g.current);
      if (!visible.length) {
        box.innerHTML = `<div class="text-sm text-muted">Nenhum arquivo enviado.</div>`;
        return;
      }
      box.innerHTML = visible.map((g) => {
        const f = g.current;
        const uploader = DB.Users.get(f.uploaded_by);
        const isImage = (f.mime || "").indexOf("image/") === 0 && urls[f.path];
        const thumb = isImage
          ? `<img src="${UI.escapeHtml(urls[f.path])}" alt="" style="width:48px;height:48px;object-fit:cover;border-radius:8px;border:1px solid var(--border-color);flex-shrink:0;" />`
          : `<div style="width:48px;height:48px;display:flex;align-items:center;justify-content:center;font-size:22px;background:var(--bg-surface-alt);border-radius:8px;flex-shrink:0;">${fileIcon(f.mime)}</div>`;
        const versionsOpen = openVersions.has(g.id);
        return `
          <div style="padding:10px 0;border-bottom:1px solid var(--border-color);">
            <div class="flex items-center gap-2" style="flex-wrap:wrap;">
              ${thumb}
              <div style="flex:1;min-width:160px;">
                <div class="text-sm" style="font-weight:700;word-break:break-word;">${UI.escapeHtml(f.name)}
                  <span class="badge badge-em_andamento" style="font-size:10.5px;margin-left:4px;">v${f.version}</span>
                  ${f.shared_with_client ? `<span class="badge badge-aguardando_aprovacao" style="font-size:10.5px;margin-left:4px;" title="Enviado ao cliente para aprovação">👁 cliente vê</span>` : ""}
                </div>
                <div class="text-sm text-muted">${fileSize(f.size)} · ${UI.escapeHtml(uploader ? uploader.name : "—")} · ${UI.formatDateTime(f.created_at)}</div>
              </div>
              <div class="flex gap-2" style="flex-wrap:wrap;">
                ${fileLink(f, urls, "Abrir")}
                ${g.versions.length > 1 ? `<button type="button" class="btn btn-ghost btn-sm" data-file-versions="${g.id}">Versões (${g.versions.length})</button>` : ""}
                ${canEdit ? `<label class="btn btn-ghost btn-sm" style="cursor:pointer;" title="Enviar nova versão deste material">⬆️ Nova versão<input type="file" hidden data-file-newversion="${g.id}" /></label>` : ""}
                ${canEdit ? `<button type="button" class="btn btn-ghost btn-sm" data-file-remove="${f.id}" title="Remover (fica no histórico)">🗑️</button>` : ""}
              </div>
            </div>
            ${versionsOpen ? `
            <div style="margin:8px 0 0 56px;">
              ${g.versions.slice().reverse().map((v) => `
                <div class="flex items-center gap-2 text-sm" style="padding:4px 0;${v.removed_at ? "opacity:.55;" : ""}">
                  <strong>v${v.version}</strong>
                  <span style="flex:1;word-break:break-word;">${UI.escapeHtml(v.name)} · ${UI.formatDateTime(v.created_at)}${v.removed_at ? " · removida" : ""}</span>
                  ${v.removed_at ? "" : fileLink(v, urls, "Abrir")}
                </div>`).join("")}
            </div>` : ""}
          </div>`;
      }).join("");

      box.querySelectorAll("[data-file-versions]").forEach((btn) => {
        btn.addEventListener("click", () => {
          const id = btn.dataset.fileVersions;
          if (openVersions.has(id)) openVersions.delete(id); else openVersions.add(id);
          render(urls);
        });
      });
      box.querySelectorAll("[data-file-newversion]").forEach((input) => {
        input.addEventListener("change", () => {
          const g = groups.find((x) => x.id === input.dataset.fileNewversion);
          if (g && input.files[0]) uploadFiles([input.files[0]], g);
        });
      });
      box.querySelectorAll("[data-file-remove]").forEach((btn) => {
        btn.addEventListener("click", async () => {
          const g = groups.find((x) => x.current && x.current.id === btn.dataset.fileRemove);
          if (!g || !UI.confirmDialog(`Remover "${g.current.name}"? Ele deixa de aparecer, mas continua registrado no histórico.`)) return;
          const res = await DB.TaskFiles.remove(g.current);
          if (!res.ok) { UI.toast(res.message, "error"); return; }
          UI.toast("Arquivo removido.", "success");
          load();
        });
      });
    }

    function load() {
      const form = overlay.querySelector("#task-form");
      if (form) form.dispatchEvent(new CustomEvent("taskfiles-changed"));
      DB.TaskFiles.list(task.id).then(({ files, unavailable }) => {
        if (!box.isConnected) return;
        if (unavailable) {
          box.innerHTML = `<div class="text-sm text-muted">Envio de arquivos ainda não configurado no banco (migration pendente).</div>`;
          const input = overlay.querySelector("#tm-file-input");
          if (input) input.closest("label").style.display = "none";
          return;
        }
        const byGroup = {};
        files.forEach((f) => { (byGroup[f.group_id] = byGroup[f.group_id] || []).push(f); });
        groups = Object.keys(byGroup).map((id) => {
          const versions = byGroup[id].sort((a, b) => a.version - b.version);
          const active = versions.filter((v) => !v.removed_at);
          return { id, versions, current: active[active.length - 1] || null };
        }).sort((a, b) => ((b.current || {}).created_at || "").localeCompare((a.current || {}).created_at || ""));
        const paths = files.filter((f) => !f.removed_at).map((f) => f.path);
        DB.TaskFiles.signedUrls(paths).then(render);
      });
    }

    async function uploadFiles(fileList, group) {
      const files = Array.from(fileList);
      let ok = 0;
      for (let i = 0; i < files.length; i++) {
        setStatus(`Enviando "${files[i].name}" (${i + 1}/${files.length})...`);
        const nextVersion = group ? Math.max(...group.versions.map((v) => v.version)) + 1 : 1;
        const res = await DB.TaskFiles.upload(task.id, files[i], group ? group.id : null, nextVersion);
        if (res.ok) ok++;
        else UI.toast(res.message, "error");
      }
      setStatus(`Até ${DB.TaskFiles.MAX_UPLOAD_MB} MB por arquivo.`);
      if (ok) UI.toast(group ? "Nova versão enviada." : `${ok} arquivo(s) enviado(s).`, "success");
      load();
    }

    const input = overlay.querySelector("#tm-file-input");
    if (input) {
      input.addEventListener("change", () => {
        if (input.files.length) uploadFiles(input.files, null);
        input.value = "";
      });
    }
    load();
  }

  /* ------------------------------------------------------------------ */
  /* Aprovação do cliente (rodadas em task_approvals)                    */
  /* ------------------------------------------------------------------ */

  const APPROVAL_STATUS = {
    pending:   { label: "Aguardando o cliente", color: "var(--color-primary)", bg: "var(--color-primary-light)", icon: "⏳" },
    approved:  { label: "Aprovado",             color: "var(--color-success)", bg: "var(--color-success-light)", icon: "✅" },
    rejected:  { label: "Ajustes solicitados",  color: "var(--color-danger)",  bg: "var(--color-danger-light)",  icon: "✏️" },
    cancelled: { label: "Substituído/retirado", color: "var(--text-muted)",    bg: "var(--bg-surface-alt)",      icon: "↩️" }
  };

  function approvalRoundHtml(r, filesById, open) {
    const cfg = APPROVAL_STATUS[r.status] || APPROVAL_STATUS.pending;
    const names = (r.file_ids || []).map((id) => {
      const f = filesById[id];
      return f ? `${UI.escapeHtml(f.name)} (v${f.version})` : "arquivo";
    }).join(", ");
    const decider = r.decided_by ? DB.Users.get(r.decided_by) : null;
    return `
      <div style="padding:10px 12px;margin-bottom:8px;border-radius:var(--radius-md);background:${cfg.bg};border:1px solid ${open ? cfg.color : "transparent"};">
        <div class="text-sm" style="font-weight:700;color:${cfg.color};">${cfg.icon} ${cfg.label}</div>
        <div class="text-sm" style="margin-top:4px;">📎 ${names || "—"}</div>
        ${r.message ? `<div class="text-sm" style="margin-top:4px;white-space:pre-wrap;">💬 ${UI.escapeHtml(r.message)}</div>` : ""}
        ${r.reason ? `<div class="text-sm" style="margin-top:4px;white-space:pre-wrap;"><strong>Motivo:</strong> ${UI.escapeHtml(r.reason)}</div>` : ""}
        <div class="text-sm text-muted" style="margin-top:4px;">
          Enviado por ${UI.escapeHtml(userName(r.requested_by))} em ${UI.formatDateTime(r.requested_at)}
          ${r.decided_at && r.status !== "cancelled" ? ` · ${r.status === "approved" ? "aprovado" : "respondido"} por ${UI.escapeHtml(decider ? decider.name : "cliente")} em ${UI.formatDateTime(r.decided_at)}${r.on_behalf ? " (registrado pela equipe)" : ""}` : ""}
        </div>
      </div>`;
  }

  function bindTaskApproval(overlay, ctx, task, canRequest, reopen) {
    const box = overlay.querySelector("#tm-approval");
    if (!box) return;
    const canRegister = DB.canManageTasks(ctx.user);
    const hasCompany = DB.Tasks.companyIdsOf(task).length > 0;
    let formOpen = false;
    let rounds = [];
    let files = [];

    function currentFiles() {
      const byGroup = {};
      files.filter((f) => !f.removed_at).forEach((f) => {
        if (!byGroup[f.group_id] || byGroup[f.group_id].version < f.version) byGroup[f.group_id] = f;
      });
      return Object.values(byGroup).sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
    }

    function render() {
      if (!box.isConnected) return;
      if (DB.TaskApprovals.unavailable()) {
        box.innerHTML = `<div class="text-sm text-muted">Aprovação ainda não configurada no banco (migration pendente).</div>`;
        return;
      }
      const filesById = files.reduce((m, f) => { m[f.id] = f; return m; }, {});
      const pending = rounds.find((r) => r.status === "pending");
      const past = rounds.filter((r) => r !== pending).reverse();
      const latest = past[0];
      const available = currentFiles();

      let html = "";
      if (pending) {
        html += approvalRoundHtml(pending, filesById, true);
        if (canRegister) html += `
          <div class="flex gap-2" style="flex-wrap:wrap;margin:-2px 0 10px;">
            <span class="text-sm text-muted" style="align-self:center;">Cliente respondeu por outro canal?</span>
            <button type="button" class="btn btn-ghost btn-sm" id="tm-appr-onbehalf-ok">Registrar aprovação</button>
            <button type="button" class="btn btn-ghost btn-sm" id="tm-appr-onbehalf-no">Registrar pedido de ajustes</button>
          </div>`;
      } else if (latest) {
        html += approvalRoundHtml(latest, filesById, false);
      } else {
        html += `<div class="text-sm text-muted" style="margin-bottom:8px;">Nenhum material enviado ao cliente ainda.</div>`;
      }

      if (canRequest) {
        if (!hasCompany) {
          html += `<div class="text-sm text-muted">Vincule a tarefa a uma empresa para pedir a aprovação do cliente.</div>`;
        } else if (!formOpen) {
          html += `<button type="button" class="btn btn-primary btn-sm" id="tm-appr-open">📤 ${pending ? "Reenviar com outros arquivos" : "Solicitar aprovação do cliente"}</button>`;
        } else if (!available.length) {
          html += `<div class="text-sm" style="color:var(--color-danger);">Envie o material em "Arquivos e materiais" antes de pedir a aprovação.</div>
            <button type="button" class="btn btn-ghost btn-sm" id="tm-appr-cancel" style="margin-top:6px;">Fechar</button>`;
        } else {
          html += `
          <div style="padding:12px 14px;background:var(--bg-surface-alt);border:1px solid var(--border-color);border-radius:var(--radius-md);">
            <div class="text-sm" style="font-weight:700;margin-bottom:6px;">Quais arquivos o cliente vai avaliar?</div>
            ${available.map((f) => `
              <label class="checkbox-row" style="padding:3px 0;cursor:pointer;">
                <input type="checkbox" class="tm-appr-file" value="${f.id}" checked />
                ${UI.escapeHtml(f.name)} <span class="text-muted">(v${f.version})</span>
              </label>`).join("")}
            <textarea class="form-control" id="tm-appr-msg" rows="2" placeholder="Mensagem para o cliente (opcional)" style="margin-top:8px;"></textarea>
            <div class="text-sm text-muted" style="margin-top:6px;">Os arquivos marcados ficam visíveis no portal do cliente e a tarefa vai para "Aguardando aprovação".${pending ? " O envio anterior deixa de valer." : ""}</div>
            <div class="flex gap-2" style="justify-content:flex-end;margin-top:8px;">
              <button type="button" class="btn btn-ghost btn-sm" id="tm-appr-cancel">Cancelar</button>
              <button type="button" class="btn btn-primary btn-sm" id="tm-appr-send">Enviar para aprovação</button>
            </div>
          </div>`;
        }
      }

      const older = past.slice(pending ? 0 : 1);
      if (older.length) {
        html += `
          <details style="margin-top:10px;">
            <summary class="text-sm" style="cursor:pointer;color:var(--text-muted);">Rodadas anteriores (${older.length})</summary>
            <div style="margin-top:8px;">${older.map((r) => approvalRoundHtml(r, filesById, false)).join("")}</div>
          </details>`;
      }
      box.innerHTML = html;

      const openBtn = box.querySelector("#tm-appr-open");
      if (openBtn) openBtn.addEventListener("click", () => { formOpen = true; load(); });
      const cancelBtn = box.querySelector("#tm-appr-cancel");
      if (cancelBtn) cancelBtn.addEventListener("click", () => { formOpen = false; render(); });
      const sendBtn = box.querySelector("#tm-appr-send");
      if (sendBtn) sendBtn.addEventListener("click", async () => {
        const ids = Array.from(box.querySelectorAll(".tm-appr-file:checked")).map((cb) => cb.value);
        if (!ids.length) { UI.toast("Marque ao menos um arquivo.", "error"); return; }
        sendBtn.disabled = true;
        sendBtn.textContent = "Enviando...";
        const res = await DB.TaskApprovals.request(task.id, ids, box.querySelector("#tm-appr-msg").value.trim());
        if (!res.ok) {
          UI.toast(res.message, "error");
          sendBtn.disabled = false;
          sendBtn.textContent = "Enviar para aprovação";
          return;
        }
        UI.toast("Material enviado para aprovação do cliente.", "success");
        reopen();
      });

      const decideOnBehalf = async (decision) => {
        let reason = null;
        if (decision === "rejected") {
          reason = window.prompt("O que o cliente pediu para ajustar?");
          if (reason === null) return;
          if (reason.trim().length < 3) { UI.toast("Descreva o ajuste pedido pelo cliente.", "error"); return; }
        } else if (!UI.confirmDialog("Registrar que o cliente APROVOU este material? A tarefa será concluída.")) {
          return;
        }
        const res = await DB.TaskApprovals.decide(pending.id, task.id, decision, reason);
        if (!res.ok) { UI.toast(res.message, "error"); return; }
        UI.toast(decision === "approved" ? "Aprovação registrada. Tarefa concluída." : "Pedido de ajustes registrado.", "success");
        reopen();
      };
      const okBtn = box.querySelector("#tm-appr-onbehalf-ok");
      if (okBtn) okBtn.addEventListener("click", () => decideOnBehalf("approved"));
      const noBtn = box.querySelector("#tm-appr-onbehalf-no");
      if (noBtn) noBtn.addEventListener("click", () => decideOnBehalf("rejected"));
    }

    function load() {
      Promise.all([DB.TaskApprovals.list(task.id), DB.TaskFiles.list(task.id)]).then(([r, f]) => {
        rounds = r;
        files = f.files;
        render();
      });
    }

    /* Usado pelo seletor de status e pelo Kanban */
    box.openRequestForm = () => {
      formOpen = true;
      load();
      box.closest(".form-group").scrollIntoView({ block: "start", behavior: "smooth" });
    };
    if (canRequest && box.dataset.autoOpen === "1") formOpen = true;
    /* Arquivo enviado/removido na seção acima → atualiza a lista do formulário */
    /* (no form, que é recriado a cada modal — o overlay é reaproveitado) */
    const form = overlay.querySelector("#task-form");
    if (form) form.addEventListener("taskfiles-changed", () => { if (box.isConnected) load(); });
    load();
  }

  function badge(map, key, extraClass) {
    const labels = map === "status" ? STATUS_LABELS : PRIORITY_LABELS;
    return `<span class="badge badge-${key} ${extraClass || ""}">${labels[key] || key}</span>`;
  }

  /* Todo funcionário enxerga as tarefas do time (a RLS já permite a leitura);
     o filtro de responsável decide o recorte exibido. Por padrão, quem não
     gerencia tarefas abre vendo só as suas — mas pode trocar para ver as
     dos colegas (somente leitura). */
  function getFilteredTasks(ctx) {
    if (state.assignee === null) {
      state.assignee = DB.canSeeAllTasks(ctx.user) ? "" : "__me__";
    }

    let tasks = DB.Tasks.list({ includeArchived: state.showArchived });
    if (state.showArchived) tasks = tasks.filter((t) => t.archived);

    if (state.assignee === "__me__") tasks = tasks.filter((t) => t.assignee === ctx.user.id);
    else if (state.assignee === "__involved__") tasks = tasks.filter((t) => t.assignee !== ctx.user.id && (t.participants || []).includes(ctx.user.id));
    else if (state.assignee) tasks = tasks.filter((t) => t.assignee === state.assignee);

    if (state.search) {
      const q = state.search.toLowerCase();
      tasks = tasks.filter(
        (t) =>
          t.title.toLowerCase().includes(q) ||
          (t.description || "").toLowerCase().includes(q) ||
          (t.tags || []).some((tag) => tag.toLowerCase().includes(q))
      );
    }
    if (state.status) tasks = tasks.filter((t) => t.status === state.status);
    if (state.priority) tasks = tasks.filter((t) => t.priority === state.priority);
    if (state.company) tasks = tasks.filter((t) => DB.Tasks.companyIdsOf(t).includes(state.company));

    const priorityOrder = { urgente: 0, alta: 1, media: 2, baixa: 3 };
    tasks.sort((a, b) => {
      if (state.sort === "dueDate") return a.dueDate.localeCompare(b.dueDate);
      if (state.sort === "priority") return priorityOrder[a.priority] - priorityOrder[b.priority];
      if (state.sort === "title") return a.title.localeCompare(b.title);
      if (state.sort === "createdAt") return b.createdAt.localeCompare(a.createdAt);
      return 0;
    });
    return tasks;
  }

  function userName(id) {
    const u = DB.Users.get(id);
    return u ? u.name : "—";
  }

  function statusSelectHtml(t, canEdit) {
    const cls = DB.Tasks.isOverdue(t) ? "atrasada" : t.status;
    if (!canEdit) return badge("status", t.status, cls === "atrasada" ? "atrasada" : "");
    const options = Object.entries(STATUS_LABELS)
      .map(([k, v]) => `<option value="${k}" ${t.status === k ? "selected" : ""}>${v}</option>`)
      .join("");
    return `<select class="badge badge-${cls} status-select" data-status-id="${t.id}" onclick="event.stopPropagation();">${options}</select>`;
  }

  /* ------------------------------------------------------------------ */
  /* Renderização da listagem                                           */
  /* ------------------------------------------------------------------ */

  function renderList(container, ctx) {
    const tasks = getFilteredTasks(ctx);
    const isAdmin = DB.canManageTasks(ctx.user);
    const canSeeAll = DB.canSeeAllTasks(ctx.user);
    const users = DB.Users.list();
    const companies = DB.Companies.list();

    const filtersHtml = `
      <div class="filters-bar">
        <input type="text" class="search-input" id="f-search" placeholder="Buscar por título, descrição ou tag..." value="${UI.escapeHtml(state.search)}" />
        <select id="f-status">
          <option value="">Todos os status</option>
          ${Object.entries(STATUS_LABELS).map(([k, v]) => `<option value="${k}" ${state.status === k ? "selected" : ""}>${v}</option>`).join("")}
        </select>
        <select id="f-priority">
          <option value="">Todas as prioridades</option>
          ${Object.entries(PRIORITY_LABELS).map(([k, v]) => `<option value="${k}" ${state.priority === k ? "selected" : ""}>${v}</option>`).join("")}
        </select>
        <select id="f-assignee">
          ${canSeeAll ? "" : `<option value="__me__" ${state.assignee === "__me__" ? "selected" : ""}>Minhas tarefas</option>`}
          <option value="__involved__" ${state.assignee === "__involved__" ? "selected" : ""}>Que encaminhei / participei</option>
          <option value="" ${state.assignee === "" ? "selected" : ""}>Todos os responsáveis</option>
          ${users.map((u) => `<option value="${u.id}" ${state.assignee === u.id ? "selected" : ""}>${UI.escapeHtml(u.name)}</option>`).join("")}
        </select>
        ${
          companies.length
            ? `<select id="f-company">
                <option value="">Todas as empresas</option>
                ${companies.map((c) => `<option value="${c.id}" ${state.company === c.id ? "selected" : ""}>${UI.escapeHtml(c.name)}</option>`).join("")}
              </select>`
            : ""
        }
        <select id="f-sort">
          <option value="dueDate" ${state.sort === "dueDate" ? "selected" : ""}>Ordenar por prazo</option>
          <option value="priority" ${state.sort === "priority" ? "selected" : ""}>Ordenar por prioridade</option>
          <option value="title" ${state.sort === "title" ? "selected" : ""}>Ordenar por título</option>
          <option value="createdAt" ${state.sort === "createdAt" ? "selected" : ""}>Mais recentes</option>
        </select>
        <label class="checkbox-row" style="margin-left:auto;">
          <input type="checkbox" id="f-archived" ${state.showArchived ? "checked" : ""}/> Ver arquivadas
        </label>
      </div>`;

    const rowsHtml = tasks.length
      ? tasks
          .map((t) => {
            const checklistDone = (t.checklist || []).filter((c) => c.done).length;
            const canEditRow = isAdmin || t.assignee === ctx.user.id;
            const handoff = lastHandoff(t);
            return `
            <tr data-id="${t.id}" class="task-row" style="cursor:pointer;">
              <td>
                <div style="font-weight:700;">${UI.escapeHtml(t.title)}</div>
                <div class="text-sm text-muted" style="margin-top:3px;">
                  ${(t.tags || []).slice(0, 2).map((tag) => `<span class="tag-pill">${UI.escapeHtml(tag)}</span>`).join(" ")}
                  ${DB.Tasks.companyNamesOf(t).map((name) => `<span class="badge badge-em_andamento" style="font-size:11px;">🏢 ${UI.escapeHtml(name)}</span>`).join(" ")}
                  ${handoff ? `<span class="badge badge-em_revisao" style="font-size:11px;" title="${UI.escapeHtml(handoff.note || "")}">📨 Recebida de ${UI.escapeHtml(userName(handoff.from))}</span>` : ""}
                </div>
              </td>
              <td>
                <div class="flex items-center gap-2">
                  ${UI.avatarHtml(DB.Users.get(t.assignee), "avatar-sm")}
                  <span class="text-sm">${UI.escapeHtml(userName(t.assignee))}</span>
                </div>
              </td>
              <td>${badge("priority", t.priority)}</td>
              <td>${statusSelectHtml(t, canEditRow)}</td>
              <td class="text-sm">${UI.formatDate(t.dueDate)}</td>
              <td class="text-sm">${checklistDone}/${(t.checklist || []).length}</td>
              <td>
                <div class="flex gap-2" onclick="event.stopPropagation();">
                  ${isAdmin ? `<button class="btn btn-ghost btn-sm" data-act="duplicate" data-id="${t.id}" title="Duplicar">⧉</button>` : ""}
                  ${isAdmin ? `<button class="btn btn-ghost btn-sm" data-act="archive" data-id="${t.id}" title="${t.archived ? "Desarquivar" : "Arquivar"}">${t.archived ? "📤" : "🗄️"}</button>` : ""}
                  ${isAdmin ? `<button class="btn btn-ghost btn-sm" data-act="delete" data-id="${t.id}" title="Excluir">🗑️</button>` : ""}
                </div>
              </td>
            </tr>`;
          })
          .join("")
      : `<tr><td colspan="7"><div class="empty-state"><div class="empty-icon">📭</div>Nenhuma tarefa encontrada.</div></td></tr>`;

    container.innerHTML = `
      <div class="page-header">
        <div>
          <h1>Gestão de Tarefas</h1>
          <p class="page-subtitle">${tasks.length} tarefa(s) ${state.showArchived ? "arquivada(s)" : "encontrada(s)"}.</p>
        </div>
        <div class="page-actions">
          ${isAdmin ? `<button class="btn btn-primary" id="btn-new-task">+ Nova Tarefa</button>` : ""}
        </div>
      </div>

      ${filtersHtml}

      <div class="card">
        <div style="overflow-x:auto;">
          <table class="data-table">
            <thead>
              <tr>
                <th>Tarefa</th>
                <th>Responsável</th>
                <th>Prioridade</th>
                <th>Status</th>
                <th>Prazo</th>
                <th>Checklist</th>
                <th></th>
              </tr>
            </thead>
            <tbody>${rowsHtml}</tbody>
          </table>
        </div>
      </div>
    `;

    bindListEvents(container, ctx);
  }

  function bindListEvents(container, ctx) {
    const reRender = () => renderList(container, ctx);

    const searchEl = container.querySelector("#f-search");
    searchEl.addEventListener("input", (e) => {
      state.search = e.target.value;
      reRender();
      container.querySelector("#f-search").focus();
      const val = container.querySelector("#f-search").value;
      container.querySelector("#f-search").setSelectionRange(val.length, val.length);
    });

    container.querySelector("#f-status").addEventListener("change", (e) => { state.status = e.target.value; reRender(); });
    container.querySelector("#f-priority").addEventListener("change", (e) => { state.priority = e.target.value; reRender(); });
    const assigneeEl = container.querySelector("#f-assignee");
    if (assigneeEl) assigneeEl.addEventListener("change", (e) => { state.assignee = e.target.value; reRender(); });
    const companyEl = container.querySelector("#f-company");
    if (companyEl) companyEl.addEventListener("change", (e) => { state.company = e.target.value; reRender(); });
    container.querySelector("#f-sort").addEventListener("change", (e) => { state.sort = e.target.value; reRender(); });
    container.querySelector("#f-archived").addEventListener("change", (e) => { state.showArchived = e.target.checked; reRender(); });

    const newBtn = container.querySelector("#btn-new-task");
    if (newBtn) newBtn.addEventListener("click", () => openTaskModal(ctx, null, reRender));

    container.querySelectorAll(".task-row").forEach((row) => {
      row.addEventListener("click", () => openTaskModal(ctx, row.dataset.id, reRender));
    });

    container.querySelectorAll("[data-status-id]").forEach((sel) => {
      sel.addEventListener("change", (e) => {
        const newStatus = e.target.value;
        if (newStatus === "aguardando_aprovacao") {
          openTaskModal(ctx, sel.dataset.statusId, reRender, { requestApproval: true });
          reRender();
          return;
        }
        DB.Tasks.update(sel.dataset.statusId, { status: newStatus });
        UI.toast(newStatus === "concluida" ? "Tarefa concluída. Será arquivada automaticamente em 30 dias." : "Status atualizado.", "success");
        reRender();
      });
    });

    container.querySelectorAll("[data-act]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.dataset.id;
        const act = btn.dataset.act;
        if (act === "duplicate") {
          DB.Tasks.duplicate(id);
          UI.toast("Tarefa duplicada com sucesso.", "success");
          reRender();
        } else if (act === "archive") {
          const task = DB.Tasks.get(id);
          DB.Tasks.archive(id, !task.archived);
          UI.toast(task.archived ? "Tarefa desarquivada." : "Tarefa arquivada.", "success");
          reRender();
        } else if (act === "delete") {
          if (UI.confirmDialog("Tem certeza que deseja excluir esta tarefa? Esta ação não pode ser desfeita.")) {
            DB.Tasks.remove(id);
            UI.toast("Tarefa excluída.", "success");
            reRender();
          }
        }
      });
    });
  }

  /* ------------------------------------------------------------------ */
  /* Modal de criação / edição / detalhes                                */
  /* ------------------------------------------------------------------ */

  function openTaskModal(ctx, taskId, onSaved, opts) {
    opts = opts || {};
    /* Relê a tarefa antes de abrir: o cliente pode ter aprovado ou pedido
       ajustes enquanto o cache desta tela estava parado. */
    if (taskId && !opts.fresh) {
      DB.Tasks.refresh(taskId).then(() => openTaskModal(ctx, taskId, onSaved, Object.assign({}, opts, { fresh: true })));
      return;
    }
    const isAdmin = DB.canManageTasks(ctx.user);
    const task = taskId ? DB.Tasks.get(taskId) : null;
    const isNew = !task;
    const users = DB.Users.list().filter((u) => u.role !== "company");
    const companies = DB.Companies.list();
    const canEditFull = isAdmin; // admin pode editar tudo; funcionário só status/checklist/comentários/horas
    const isOwner = !!task && task.assignee === ctx.user.id;
    // Dono ou admin: mexe em status/checklist/horas. Colega visitando a tarefa: só acompanha e comenta.
    const canEditProgress = canEditFull || isOwner || isNew;
    const canForward = !isNew && (isOwner || isAdmin);
    const handoffs = task ? task.handoffs || [] : [];
    const receivedHandoff = task && isOwner ? lastHandoff(task) : null;

    let draftChecklist = task ? JSON.parse(JSON.stringify(task.checklist || [])) : [];
    const taskCompanyIds = DB.Tasks.companyIdsOf(task);

    function handoffsHtml() {
      return handoffs
        .slice()
        .reverse()
        .map((h) => `
          <div style="padding:8px 0;border-bottom:1px solid var(--border-color);">
            <div class="text-sm"><strong>${UI.escapeHtml(userName(h.from))}</strong> → <strong>${UI.escapeHtml(userName(h.to))}</strong>
              <span class="text-muted">· ${UI.formatDateTime(h.date)}</span></div>
            ${h.note ? `<div class="text-sm" style="margin-top:4px;white-space:pre-wrap;">${UI.escapeHtml(h.note)}</div>` : ""}
          </div>`)
        .join("");
    }

    function checklistHtml() {
      if (!draftChecklist.length) {
        return `<div class="text-sm text-muted">Nenhum item no checklist.</div>`;
      }
      return draftChecklist
        .map(
          (item, idx) => `
        <div class="flex items-center gap-2" style="margin-bottom:6px;">
          <input type="checkbox" data-checklist-idx="${idx}" ${item.done ? "checked" : ""} ${canEditProgress ? "" : "disabled"} style="width:16px;height:16px;accent-color:var(--color-primary);" />
          <span style="flex:1; ${item.done ? "text-decoration:line-through; color:var(--text-muted);" : ""}">${UI.escapeHtml(item.text)}</span>
          ${isAdmin ? `<button type="button" class="btn btn-ghost btn-sm" data-remove-checklist="${idx}">✕</button>` : ""}
        </div>`
        )
        .join("");
    }

    function commentsHtml() {
      const comments = task ? task.comments || [] : [];
      if (!comments.length) return `<div class="text-sm text-muted">Nenhum comentário ainda.</div>`;
      return comments
        .slice()
        .reverse()
        .map((c) => {
          const author = DB.Users.get(c.author);
          return `
          <div style="padding:10px 0; border-bottom:1px solid var(--border-color);">
            <div class="flex items-center gap-2">
              ${UI.avatarHtml(author, "avatar-sm")}
              <strong class="text-sm">${author ? UI.escapeHtml(author.name) : "Usuário"}</strong>
              <span class="text-sm text-muted">${UI.formatDateTime(c.date)}</span>
            </div>
            <div class="text-sm" style="margin-top:6px; margin-left:38px;">${UI.escapeHtml(c.text)}</div>
          </div>`;
        })
        .join("");
    }

    /* Anexos da versão anterior (só o nome era guardado); ficam visíveis como histórico */
    function legacyAttachmentsHtml() {
      const attachments = task ? task.attachments || [] : [];
      if (!attachments.length) return "";
      return `
        <div class="text-sm text-muted" style="margin-top:10px;">Anexos antigos (apenas o nome foi registrado):</div>
        ${attachments.map((a) => `<div class="text-sm" style="margin-top:4px;">📎 ${UI.escapeHtml(a.name)}</div>`).join("")}`;
    }

    const html = `
      <div class="modal-header">
        <h3>${isNew ? "Nova Tarefa" : (canEditFull ? "Editar Tarefa" : "Detalhes da Tarefa")}</h3>
        <button class="modal-close" id="tm-close">✕</button>
      </div>
      <div class="modal-body">
        ${receivedHandoff ? `
        <div class="form-group" style="background:var(--color-warning-light);border:1px solid var(--color-warning);border-radius:var(--radius-md);padding:10px 14px;">
          <strong style="color:var(--color-warning);">📨 ${UI.escapeHtml(userName(receivedHandoff.from))} encaminhou esta tarefa para você</strong>
          ${receivedHandoff.note ? `<div class="text-sm" style="margin-top:4px;white-space:pre-wrap;">${UI.escapeHtml(receivedHandoff.note)}</div>` : ""}
        </div>` : ""}
        ${task && !isOwner && (task.participants || []).includes(ctx.user.id) && !isAdmin ? `
        <div class="form-group text-sm text-muted">Você participou desta tarefa. Agora ela está com <strong>${UI.escapeHtml(userName(task.assignee))}</strong> — você pode acompanhar e comentar.</div>` : ""}
        <form id="task-form">
          <div class="form-group">
            <label class="form-label">Título</label>
            <input type="text" class="form-control" id="tm-title" value="${task ? UI.escapeHtml(task.title) : ""}" ${canEditFull ? "" : "readonly"} required />
          </div>
          <div class="form-group">
            <label class="form-label">Descrição</label>
            <textarea class="form-control" id="tm-desc" ${canEditFull ? "" : "readonly"}>${task ? UI.escapeHtml(task.description || "") : ""}</textarea>
          </div>

          <div class="form-row">
            <div class="form-group">
              <label class="form-label">Responsável</label>
              <select class="form-control" id="tm-assignee" ${canEditFull ? "" : "disabled"}>
                ${users.map((u) => `<option value="${u.id}" ${task && task.assignee === u.id ? "selected" : (!task && u.id === ctx.user.id ? "selected" : "")}>${u.name}</option>`).join("")}
              </select>
            </div>
            <div class="form-group">
              <label class="form-label">Prioridade</label>
              <select class="form-control" id="tm-priority" ${canEditFull ? "" : "disabled"}>
                ${Object.entries(PRIORITY_LABELS).map(([k, v]) => `<option value="${k}" ${task && task.priority === k ? "selected" : ""}>${v}</option>`).join("")}
              </select>
            </div>
          </div>

          <div class="form-row">
            <div class="form-group">
              <label class="form-label">Status</label>
              <select class="form-control" id="tm-status" ${canEditProgress ? "" : "disabled"}>
                ${Object.entries(STATUS_LABELS).map(([k, v]) => `<option value="${k}" ${task && task.status === k ? "selected" : ""}>${v}</option>`).join("")}
              </select>
            </div>
            <div class="form-group">
              <label class="form-label">Horas registradas</label>
              <input type="number" min="0" step="0.5" class="form-control" id="tm-hours" value="${task ? task.timeLogged || 0 : 0}" ${canEditProgress ? "" : "readonly"} />
            </div>
          </div>

          <div class="form-row">
            <div class="form-group">
              <label class="form-label">Data de início</label>
              <input type="date" class="form-control" id="tm-start" value="${task ? task.startDate : DB.todayISO()}" ${canEditFull ? "" : "readonly"} />
            </div>
            <div class="form-group">
              <label class="form-label">Data de prazo</label>
              <input type="date" class="form-control" id="tm-due" value="${task ? task.dueDate : DB.todayISO(3)}" ${canEditFull ? "" : "readonly"} />
            </div>
          </div>

          <div class="form-group">
            <label class="form-label">Tags (separadas por vírgula)</label>
            <input type="text" class="form-control" id="tm-tags" value="${task ? (task.tags || []).join(", ") : ""}" ${canEditFull ? "" : "readonly"} />
          </div>

          ${canEditFull && companies.length ? `
          <div class="form-group">
            <label class="form-label">🏢 Empresas vinculadas (opcional) <span class="text-muted" id="tm-company-count">${taskCompanyIds.length ? `— ${taskCompanyIds.length} selecionada(s)` : ""}</span></label>
            ${companies.length > 6 ? `<input type="text" class="form-control" id="tm-company-search" placeholder="Buscar empresa..." style="margin-bottom:6px;" />` : ""}
            <div id="tm-company-list" style="max-height:180px;overflow-y:auto;padding:8px 12px;background:var(--bg-surface-alt);border:1px solid var(--border-color);border-radius:var(--radius-md);">
              ${companies.map((c) => `
              <label class="checkbox-row" data-company-name="${UI.escapeHtml(c.name.toLowerCase())}" style="padding:4px 0;cursor:pointer;">
                <input type="checkbox" class="tm-company-cb" value="${c.id}" ${taskCompanyIds.includes(c.id) ? "checked" : ""} />
                ${UI.escapeHtml(c.name)}
              </label>`).join("")}
            </div>
            <div class="text-sm text-muted" style="margin-top:4px;">Todas as empresas selecionadas poderão acompanhar esta tarefa no portal.</div>
          </div>` : (taskCompanyIds.length ? `
          <div class="form-group">
            <label class="form-label">🏢 Empresas vinculadas</label>
            <div style="padding:9px 14px;background:var(--bg-surface-alt);border:1px solid var(--border-color);border-radius:var(--radius-md);font-size:14px;">${UI.escapeHtml(DB.Tasks.companyNamesOf(task).join(", ") || "—")}</div>
          </div>` : "")}

          ${canForward ? `
          <div class="form-group" style="padding:12px 14px;background:var(--bg-surface-alt);border:1px solid var(--border-color);border-radius:var(--radius-md);">
            <label class="form-label">📨 Encaminhar para outro funcionário</label>
            <div class="text-sm text-muted" style="margin-bottom:8px;">Terminou a sua parte? Passe a tarefa adiante. Ela volta para "A Fazer" com o novo responsável, e você continua podendo acompanhar e comentar.</div>
            <select class="form-control" id="tm-forward-to" style="margin-bottom:8px;">
              <option value="">— Selecione o funcionário —</option>
              ${users.filter((u) => u.id !== task.assignee).map((u) => `<option value="${u.id}">${UI.escapeHtml(u.name)}</option>`).join("")}
            </select>
            <textarea class="form-control" id="tm-forward-note" rows="2" placeholder="O que já foi feito e o que falta (opcional)"></textarea>
            <div style="margin-top:8px;text-align:right;">
              <button type="button" class="btn btn-primary btn-sm" id="tm-forward-btn">Encaminhar</button>
            </div>
          </div>` : ""}

          ${handoffs.length ? `
          <div class="form-group">
            <label class="form-label">🔁 Histórico de encaminhamentos</label>
            <div style="max-height:160px;overflow-y:auto;">${handoffsHtml()}</div>
          </div>` : ""}

          <div class="form-group">
            <label class="form-label">Checklist</label>
            <div id="tm-checklist-list">${checklistHtml()}</div>
            ${
              isAdmin
                ? `<div class="flex gap-2" style="margin-top:8px;">
                    <input type="text" class="form-control" id="tm-checklist-new" placeholder="Adicionar item ao checklist..." />
                    <button type="button" class="btn btn-secondary btn-sm" id="tm-checklist-add">Adicionar</button>
                  </div>`
                : ""
            }
          </div>

          ${
            !isNew
              ? `
          <div class="form-group">
            <label class="form-label">📎 Arquivos e materiais</label>
            <div id="tm-files"><div class="text-sm text-muted">Carregando arquivos...</div></div>
            ${canEditProgress ? `
            <div class="flex items-center gap-2" style="margin-top:10px;flex-wrap:wrap;">
              <label class="btn btn-secondary btn-sm" style="cursor:pointer;">⬆️ Enviar arquivos
                <input type="file" id="tm-file-input" multiple hidden />
              </label>
              <span class="text-sm text-muted" id="tm-file-status">Até ${DB.TaskFiles.MAX_UPLOAD_MB} MB por arquivo.</span>
            </div>` : ""}
            ${legacyAttachmentsHtml()}
          </div>

          <div class="form-group">
            <label class="form-label">✅ Aprovação do cliente</label>
            <div id="tm-approval" data-auto-open="${opts.requestApproval ? "1" : ""}"><div class="text-sm text-muted">Carregando...</div></div>
          </div>

          <div class="form-group">
            <label class="form-label">Comentários</label>
            <div id="tm-comments-list" style="max-height:180px; overflow-y:auto;">${commentsHtml()}</div>
            <div class="flex gap-2" style="margin-top:8px;">
              <input type="text" class="form-control" id="tm-comment-new" placeholder="Escreva um comentário..." />
              <button type="button" class="btn btn-secondary btn-sm" id="tm-comment-add">Comentar</button>
            </div>
          </div>

          <div class="form-group">
            <label class="form-label">📜 Histórico da tarefa</label>
            <div id="tm-history" style="max-height:220px;overflow-y:auto;"><div class="text-sm text-muted">Carregando histórico...</div></div>
          </div>`
              : ""
          }
        </form>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" id="tm-cancel">${canEditProgress ? "Cancelar" : "Fechar"}</button>
        ${canEditProgress ? `<button class="btn btn-primary" id="tm-save">${isNew ? "Criar Tarefa" : "Salvar Alterações"}</button>` : ""}
      </div>
    `;

    const overlay = UI.showModal(html, { large: true });

    if (task) {
      DB.TaskEvents.list(task.id).then((events) => {
        const box = overlay.querySelector("#tm-history");
        if (!box || !box.isConnected) return;
        box.innerHTML = events.length
          ? events.slice().reverse().map(taskEventHtml).join("")
          : `<div class="text-sm text-muted">Nenhum registro ainda.</div>`;
      });
    }

    overlay.querySelectorAll(".tm-company-cb").forEach((cb) => {
      cb.addEventListener("change", () => {
        const n = overlay.querySelectorAll(".tm-company-cb:checked").length;
        overlay.querySelector("#tm-company-count").textContent = n ? `— ${n} selecionada(s)` : "";
      });
    });
    const companySearch = overlay.querySelector("#tm-company-search");
    if (companySearch) {
      companySearch.addEventListener("input", () => {
        const q = companySearch.value.trim().toLowerCase();
        overlay.querySelectorAll("#tm-company-list [data-company-name]").forEach((row) => {
          row.style.display = row.dataset.companyName.includes(q) ? "" : "none";
        });
      });
    }

    overlay.querySelector("#tm-close").addEventListener("click", UI.hideModal);
    overlay.querySelector("#tm-cancel").addEventListener("click", UI.hideModal);

    overlay.querySelectorAll("[data-checklist-idx]").forEach((cb) => {
      cb.addEventListener("change", (e) => {
        const idx = Number(e.target.dataset.checklistIdx);
        draftChecklist[idx].done = e.target.checked;
        if (!isNew) DB.Tasks.update(task.id, { checklist: draftChecklist });
      });
    });
    overlay.querySelectorAll("[data-remove-checklist]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        const idx = Number(e.target.dataset.removeChecklist);
        draftChecklist.splice(idx, 1);
        overlay.querySelector("#tm-checklist-list").innerHTML = checklistHtml();
        rebindChecklist();
      });
    });

    function rebindChecklist() {
      overlay.querySelectorAll("[data-checklist-idx]").forEach((cb) => {
        cb.addEventListener("change", (e) => {
          const idx = Number(e.target.dataset.checklistIdx);
          draftChecklist[idx].done = e.target.checked;
        });
      });
      overlay.querySelectorAll("[data-remove-checklist]").forEach((btn) => {
        btn.addEventListener("click", (e) => {
          const idx = Number(e.target.dataset.removeChecklist);
          draftChecklist.splice(idx, 1);
          overlay.querySelector("#tm-checklist-list").innerHTML = checklistHtml();
          rebindChecklist();
        });
      });
    }

    const checklistAddBtn = overlay.querySelector("#tm-checklist-add");
    if (checklistAddBtn) {
      checklistAddBtn.addEventListener("click", () => {
        const input = overlay.querySelector("#tm-checklist-new");
        if (!input.value.trim()) return;
        draftChecklist.push({ text: input.value.trim(), done: false });
        input.value = "";
        overlay.querySelector("#tm-checklist-list").innerHTML = checklistHtml();
        rebindChecklist();
      });
    }

    if (task) bindTaskFiles(overlay, task, canEditProgress);
    if (task) {
      bindTaskApproval(overlay, ctx, task, canEditProgress, () => {
        UI.hideModal();
        if (onSaved) onSaved();
        openTaskModal(ctx, task.id, onSaved);
      });
      if (opts.requestApproval) {
        setTimeout(() => {
          const sec = overlay.querySelector("#tm-approval");
          if (sec && sec.isConnected) sec.closest(".form-group").scrollIntoView({ block: "start" });
        }, 300);
      }
    }

    /* "Aguardando aprovação" só pelo botão de solicitar (escolhendo os arquivos) */
    const statusSel = overlay.querySelector("#tm-status");
    if (statusSel && task) statusSel.addEventListener("change", () => {
      if (statusSel.value !== "aguardando_aprovacao" || task.status === "aguardando_aprovacao") return;
      statusSel.value = task.status;
      UI.toast("Escolha os arquivos que o cliente vai avaliar e clique em \"Enviar para aprovação\".", "info");
      const box = overlay.querySelector("#tm-approval");
      if (box && box.openRequestForm) box.openRequestForm();
    });

    const commentAddBtn = overlay.querySelector("#tm-comment-add");
    if (commentAddBtn) {
      commentAddBtn.addEventListener("click", () => {
        const input = overlay.querySelector("#tm-comment-new");
        if (!input.value.trim() || !task) return;
        DB.Tasks.addComment(task.id, ctx.user.id, input.value.trim());
        input.value = "";
        overlay.querySelector("#tm-comments-list").innerHTML = commentsHtml();
      });
    }

    const forwardBtn = overlay.querySelector("#tm-forward-btn");
    if (forwardBtn) forwardBtn.addEventListener("click", () => {
      const toId = overlay.querySelector("#tm-forward-to").value;
      if (!toId) {
        UI.toast("Selecione para quem encaminhar a tarefa.", "error");
        return;
      }
      if (!UI.confirmDialog(`Encaminhar "${task.title}" para ${userName(toId)}?`)) return;
      DB.Tasks.forward(task.id, toId, overlay.querySelector("#tm-forward-note").value.trim(), {
        timeLogged: Number(overlay.querySelector("#tm-hours").value) || 0,
        checklist: draftChecklist
      });
      UI.toast(`Tarefa encaminhada para ${userName(toId)}.`, "success");
      UI.hideModal();
      if (onSaved) onSaved();
    });

    const saveBtn = overlay.querySelector("#tm-save");
    if (saveBtn) saveBtn.addEventListener("click", () => {
      const title = overlay.querySelector("#tm-title").value.trim();
      if (!title) {
        UI.toast("Informe um título para a tarefa.", "error");
        return;
      }

      let newStatus = overlay.querySelector("#tm-status").value;
      if (newStatus === "aguardando_aprovacao" && (!task || task.status !== "aguardando_aprovacao")) {
        newStatus = task ? task.status : "nao_iniciada";
        if (isNew) UI.toast("Crie a tarefa, envie os arquivos e depois use \"Solicitar aprovação do cliente\".", "info");
      }

      const payload = canEditFull
        ? {
            title,
            description: overlay.querySelector("#tm-desc").value.trim(),
            assignee: overlay.querySelector("#tm-assignee").value,
            priority: overlay.querySelector("#tm-priority").value,
            status: newStatus,
            startDate: overlay.querySelector("#tm-start").value,
            dueDate: overlay.querySelector("#tm-due").value,
            tags: overlay.querySelector("#tm-tags").value.split(",").map((s) => s.trim()).filter(Boolean),
            timeLogged: Number(overlay.querySelector("#tm-hours").value) || 0,
            checklist: draftChecklist,
            companyIds: overlay.querySelector("#tm-company-list")
              ? Array.from(overlay.querySelectorAll(".tm-company-cb:checked")).map((cb) => cb.value)
              : taskCompanyIds
          }
        : {
            status: newStatus,
            timeLogged: Number(overlay.querySelector("#tm-hours").value) || 0,
            checklist: draftChecklist
          };

      if (isNew) {
        DB.Tasks.create(payload);
        UI.toast("Tarefa criada com sucesso.", "success");
      } else {
        DB.Tasks.update(task.id, payload);
        UI.toast("Tarefa atualizada com sucesso.", "success");
      }
      UI.hideModal();
      if (onSaved) onSaved();
    });
  }

  window.Views.openTaskModal = openTaskModal;

  window.Views.tasks = function (container, ctx) {
    const pendingSearch = sessionStorage.getItem("sgt_search_term");
    if (pendingSearch) {
      state.search = pendingSearch;
      sessionStorage.removeItem("sgt_search_term");
    }
    renderList(container, ctx);
  };
})();
