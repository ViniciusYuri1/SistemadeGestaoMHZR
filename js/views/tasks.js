/* ==========================================================================
   views/tasks.js — Gestão de Tarefas: listagem, filtros, busca, ordenação,
   criação/edição, duplicar, arquivar, excluir e modal de detalhes
   (checklist, comentários, anexos, horas registradas).
   ========================================================================== */

(function () {
  "use strict";
  window.Views = window.Views || {};

  const STATUS_LABELS = {
    backlog: "Backlog",
    nao_iniciada: "A Fazer",
    em_andamento: "Em Progresso",
    em_revisao: "Revisão",
    concluida: "Concluído"
  };
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

  function blockersLabel(blockers) {
    return blockers
      .map((b) => `"${b.title}" (${userName(b.assignee)}, ${STATUS_LABELS[b.status] || b.status})`)
      .join(", ");
  }

  /* Antes de aplicar uma mudança de status, avisa (sem impedir) se a tarefa
     ainda depende de outra(s) tarefa(s) não concluídas. */
  function confirmIfBlocked(task, newStatus) {
    if (!newStatus || newStatus === task.status) return true;
    if (newStatus === "backlog" || newStatus === "nao_iniciada") return true;
    const blockers = DB.Tasks.blockers(task);
    if (!blockers.length) return true;
    return UI.confirmDialog(
      `Esta tarefa depende de ${blockersLabel(blockers)}, que ainda não ${blockers.length > 1 ? "foram concluídas" : "foi concluída"}.\n\nDeseja continuar mesmo assim?`
    );
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
            const blockers = DB.Tasks.blockers(t);
            return `
            <tr data-id="${t.id}" class="task-row" style="cursor:pointer;">
              <td>
                <div style="font-weight:700;">${UI.escapeHtml(t.title)}</div>
                <div class="text-sm text-muted" style="margin-top:3px;">
                  ${(t.tags || []).slice(0, 2).map((tag) => `<span class="tag-pill">${UI.escapeHtml(tag)}</span>`).join(" ")}
                  ${DB.Tasks.companyNamesOf(t).map((name) => `<span class="badge badge-em_andamento" style="font-size:11px;">🏢 ${UI.escapeHtml(name)}</span>`).join(" ")}
                  ${blockers.length ? `<span class="badge badge-atrasada" style="font-size:11px;" title="Aguardando: ${UI.escapeHtml(blockersLabel(blockers))}">⛔ Aguardando</span>` : ""}
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
        const task = DB.Tasks.get(sel.dataset.statusId);
        if (!confirmIfBlocked(task, newStatus)) { reRender(); return; }
        DB.Tasks.update(sel.dataset.statusId, { status: newStatus });
        UI.toast(newStatus === "concluida" ? "Tarefa concluída e arquivada." : "Status atualizado.", "success");
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

  function openTaskModal(ctx, taskId, onSaved) {
    const isAdmin = DB.canManageTasks(ctx.user);
    const task = taskId ? DB.Tasks.get(taskId) : null;
    const isNew = !task;
    const users = DB.Users.list().filter((u) => u.role !== "company");
    const companies = DB.Companies.list();
    const canEditFull = isAdmin; // admin pode editar tudo; funcionário só status/checklist/comentários/horas
    const isOwner = !!task && task.assignee === ctx.user.id;
    // Dono ou admin: mexe em status/checklist/horas. Colega visitando a tarefa: só acompanha e comenta.
    const canEditProgress = canEditFull || isOwner || isNew;
    const blockers = task ? DB.Tasks.blockers(task) : [];
    const dependents = task ? DB.Tasks.dependents(task.id).filter((d) => d.status !== "concluida") : [];

    let draftChecklist = task ? JSON.parse(JSON.stringify(task.checklist || [])) : [];
    let draftDependsOn = task ? (task.dependsOn || []).slice() : [];
    const taskCompanyIds = DB.Tasks.companyIdsOf(task);

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

    function attachmentsHtml() {
      const attachments = task ? task.attachments || [] : [];
      if (!attachments.length) return `<div class="text-sm text-muted">Nenhum anexo.</div>`;
      return attachments
        .map(
          (a, idx) => `
        <div class="flex items-center gap-2" style="margin-bottom:6px;">
          📎 <span class="text-sm" style="flex:1;">${UI.escapeHtml(a.name)}</span>
          ${canEditProgress ? `<button type="button" class="btn btn-ghost btn-sm" data-remove-attachment="${idx}">✕</button>` : ""}
        </div>`
        )
        .join("");
    }

    const html = `
      <div class="modal-header">
        <h3>${isNew ? "Nova Tarefa" : (canEditFull ? "Editar Tarefa" : "Detalhes da Tarefa")}</h3>
        <button class="modal-close" id="tm-close">✕</button>
      </div>
      <div class="modal-body">
        ${blockers.length ? `
        <div class="form-group" style="background:var(--color-danger-light);border:1px solid var(--color-danger);border-radius:var(--radius-md);padding:10px 14px;">
          <strong style="color:var(--color-danger);">⛔ Aguardando outra(s) tarefa(s)</strong>
          <div class="text-sm" style="margin-top:4px;">${UI.escapeHtml(blockersLabel(blockers))}</div>
        </div>` : ""}
        ${dependents.length ? `
        <div class="form-group" style="background:var(--color-warning-light);border:1px solid var(--color-warning);border-radius:var(--radius-md);padding:10px 14px;">
          <strong style="color:var(--color-warning);">👀 ${dependents.length} tarefa(s) esperam a conclusão desta</strong>
          <div class="text-sm" style="margin-top:4px;">${dependents.map((d) => `"${UI.escapeHtml(d.title)}" (${UI.escapeHtml(userName(d.assignee))})`).join(", ")}</div>
        </div>` : ""}
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

          ${canEditFull ? `
          <div class="form-group">
            <label class="form-label">🔗 Depende de (aguardar concluir antes)</label>
            <select class="form-control" id="tm-dependson" multiple size="4">
              ${DB.Tasks.list({ includeArchived: false })
                .filter((t) => t.id !== (task && task.id))
                .map((t) => `<option value="${t.id}" ${draftDependsOn.includes(t.id) ? "selected" : ""}>${UI.escapeHtml(t.title)} — ${UI.escapeHtml(userName(t.assignee))} (${STATUS_LABELS[t.status] || t.status})</option>`)
                .join("")}
            </select>
            <div class="text-sm text-muted" style="margin-top:4px;">Ctrl/Cmd + clique para selecionar mais de uma. Enquanto elas não forem concluídas, esta tarefa aparece como "aguardando".</div>
          </div>` : (task && (task.dependsOn || []).length ? `
          <div class="form-group">
            <label class="form-label">🔗 Depende de</label>
            <div class="text-sm">${(task.dependsOn || []).map((depId) => {
              const dep = DB.Tasks.get(depId);
              return dep ? `${UI.escapeHtml(dep.title)} — ${UI.escapeHtml(userName(dep.assignee))} (${STATUS_LABELS[dep.status] || dep.status})` : null;
            }).filter(Boolean).join(", ") || "—"}</div>
          </div>` : "")}

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
            <label class="form-label">Anexos</label>
            <div id="tm-attachments-list">${attachmentsHtml()}</div>
            ${canEditProgress ? `
            <div class="flex gap-2" style="margin-top:8px;">
              <input type="text" class="form-control" id="tm-attachment-new" placeholder="Nome do arquivo (simulação de upload)..." />
              <button type="button" class="btn btn-secondary btn-sm" id="tm-attachment-add">Anexar</button>
            </div>` : ""}
          </div>

          <div class="form-group">
            <label class="form-label">Comentários</label>
            <div id="tm-comments-list" style="max-height:180px; overflow-y:auto;">${commentsHtml()}</div>
            <div class="flex gap-2" style="margin-top:8px;">
              <input type="text" class="form-control" id="tm-comment-new" placeholder="Escreva um comentário..." />
              <button type="button" class="btn btn-secondary btn-sm" id="tm-comment-add">Comentar</button>
            </div>
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

    const attachmentAddBtn = overlay.querySelector("#tm-attachment-add");
    if (attachmentAddBtn) {
      attachmentAddBtn.addEventListener("click", () => {
        const input = overlay.querySelector("#tm-attachment-new");
        if (!input.value.trim() || !task) return;
        const updated = DB.Tasks.get(task.id);
        updated.attachments.push({ name: input.value.trim(), url: "#" });
        DB.Tasks.update(task.id, { attachments: updated.attachments });
        input.value = "";
        overlay.querySelector("#tm-attachments-list").innerHTML = attachmentsHtml();
        bindAttachmentRemove();
      });
    }
    function bindAttachmentRemove() {
      overlay.querySelectorAll("[data-remove-attachment]").forEach((btn) => {
        btn.addEventListener("click", (e) => {
          const idx = Number(e.target.dataset.removeAttachment);
          const updated = DB.Tasks.get(task.id);
          updated.attachments.splice(idx, 1);
          DB.Tasks.update(task.id, { attachments: updated.attachments });
          overlay.querySelector("#tm-attachments-list").innerHTML = attachmentsHtml();
          bindAttachmentRemove();
        });
      });
    }
    bindAttachmentRemove();

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

    const saveBtn = overlay.querySelector("#tm-save");
    if (saveBtn) saveBtn.addEventListener("click", () => {
      const title = overlay.querySelector("#tm-title").value.trim();
      if (!title) {
        UI.toast("Informe um título para a tarefa.", "error");
        return;
      }

      const newStatus = overlay.querySelector("#tm-status").value;
      if (task && !confirmIfBlocked(task, newStatus)) return;

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
              : taskCompanyIds,
            dependsOn: Array.from(overlay.querySelector("#tm-dependson").selectedOptions).map((o) => o.value)
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
