/* ==========================================================================
   data.js — Camada de dados do Sistema de Gestão de Tarefas
   Banco de dados: Supabase (Postgres + Auth + RLS).

   Estratégia: em DB.init() todo o conjunto de dados visível ao usuário é
   carregado para um cache em memória (`db`), então as LEITURAS continuam
   síncronas — as views não mudaram. As MUTAÇÕES atualizam o cache e enviam
   a alteração ao Supabase em segundo plano (com toast em caso de falha).
   Operações de usuário/senha são assíncronas (RPCs com SECURITY DEFINER).
   ========================================================================== */

(function (global) {
  "use strict";

  const LEGACY_STORAGE_KEY = "sgt_database_v1"; // usado apenas pela importação
  const THEME_KEY = "sgt_theme";

  /* ------------------------------------------------------------------ */
  /* Utilidades                                                         */
  /* ------------------------------------------------------------------ */

  function uid(prefix) {
    return (
      (prefix || "id") +
      "_" +
      Date.now().toString(36) +
      Math.random().toString(36).slice(2, 8)
    );
  }

  function todayISO(offsetDays) {
    const d = new Date();
    d.setDate(d.getDate() + (offsetDays || 0));
    return d.toISOString().slice(0, 10);
  }

  function clone(obj) {
    return obj === undefined ? undefined : JSON.parse(JSON.stringify(obj));
  }

  function defaultSettings() {
    return {
      companyName: "Minha Empresa",
      logo: "",
      theme: localTheme(),
      notifications: { email: true, push: true, deadlineReminder: true, dailySummary: false }
    };
  }

  function localTheme() {
    try { return localStorage.getItem(THEME_KEY) || "light"; } catch (e) { return "light"; }
  }

  /* ------------------------------------------------------------------ */
  /* Cache em memória                                                    */
  /* ------------------------------------------------------------------ */

  let db = {
    users: [],
    teams: [],
    tasks: [],
    activities: [],
    settings: defaultSettings(),
    companies: [],
    boletos: [],
    costs: [],
    auditLog: [],
    meta: { lastSync: null }
  };

  let currentUser = null;

  /* ------------------------------------------------------------------ */
  /* Supabase — helpers                                                  */
  /* ------------------------------------------------------------------ */

  const configured = !!global.SB;

  function sb() {
    if (!global.SB) throw new Error("Supabase não configurado (js/supabase-config.js).");
    return global.SB;
  }

  function syncError(where, error) {
    console.error("[DB sync] " + where, error);
    if (global.UI && global.UI.toast) {
      global.UI.toast("Falha ao salvar no servidor: " + (error && error.message ? error.message : where), "error");
    }
  }

  /* Envia (upsert) um objeto para uma tabela-documento, em segundo plano */
  function pushRow(table, obj) {
    sb()
      .from(table)
      .upsert({ id: obj.id, data: obj })
      .then(({ error }) => { if (error) syncError(table + "/" + obj.id, error); });
  }

  function deleteRow(table, id) {
    sb()
      .from(table)
      .delete()
      .eq("id", id)
      .then(({ error }) => { if (error) syncError("delete " + table + "/" + id, error); });
  }

  /* Mensagens de erro amigáveis */
  function friendlyError(error) {
    if (!error) return "Erro desconhecido.";
    const msg = error.message || String(error);
    if (msg.indexOf("Invalid login credentials") !== -1) return "E-mail ou senha inválidos.";
    if (msg.indexOf("Email not confirmed") !== -1) return "E-mail ainda não confirmado. Verifique sua caixa de entrada.";
    if (msg.indexOf("User already registered") !== -1) return "Este e-mail já está cadastrado. Faça login.";
    if (msg.indexOf("Password should be") !== -1) return "A senha deve ter pelo menos 6 caracteres.";
    if (msg.indexOf("rate limit") !== -1 || msg.indexOf("Rate limit") !== -1) return "Muitas tentativas. Aguarde alguns minutos e tente de novo.";
    if (msg.indexOf("Failed to fetch") !== -1) return "Sem conexão com o servidor. Verifique sua internet.";
    return msg;
  }

  /* ------------------------------------------------------------------ */
  /* Perfis <-> usuários                                                 */
  /* ------------------------------------------------------------------ */

  function profileToUser(row) {
    return Object.assign(
      { id: row.id, role: row.role, companyId: row.company_id || null },
      row.data || {}
    );
  }

  /* Extrai o jsonb `data` de um objeto de usuário (sem campos de coluna) */
  function userDataOf(user) {
    const data = clone(user);
    delete data.id;
    delete data.role;
    delete data.companyId;
    delete data.password;
    return data;
  }

  function profileRowOf(user) {
    return { role: user.role, company_id: user.companyId || null, data: userDataOf(user) };
  }

  /* ------------------------------------------------------------------ */
  /* Bootstrap: sessão + carga completa do cache                         */
  /* ------------------------------------------------------------------ */

  async function fetchCurrentProfile(userId) {
    const { data, error } = await sb().from("profiles").select("*").eq("id", userId).maybeSingle();
    if (error) throw error;
    currentUser = data ? profileToUser(data) : null;
    return currentUser;
  }

  async function fetchAll() {
    const s = sb();
    const [profiles, teams, companies, boletos, costs, tasks, activities, audit, settings] =
      await Promise.all([
        s.from("profiles").select("*"),
        s.from("teams").select("id,data"),
        s.from("companies").select("id,data"),
        s.from("boletos").select("id,data"),
        s.from("costs").select("id,data"),
        s.from("tasks").select("id,data"),
        s.from("activities").select("id,data").order("updated_at", { ascending: false }).limit(50),
        s.from("audit_log").select("id,data").order("updated_at", { ascending: false }).limit(1000),
        s.from("app_settings").select("id,data").eq("id", "main").maybeSingle()
      ]);

    /* "costs" é opcional: se a migration ainda não foi aplicada no projeto,
       a tabela não existe e a busca vem com erro — isso não pode derrubar
       o login nem o carregamento do resto do sistema. */
    const failed = [profiles, teams, companies, boletos, tasks, activities, audit].find((r) => r.error);
    if (failed) throw failed.error;
    if (costs.error) console.warn("[DB] tabela 'costs' indisponível (migration pendente?):", costs.error.message);

    const rowData = (r) => (r.data || []).map((x) => x.data);

    db.users      = (profiles.data || []).map(profileToUser);
    db.teams      = rowData(teams);
    db.companies  = rowData(companies);
    db.boletos    = rowData(boletos);
    db.costs      = costs.error ? [] : rowData(costs);
    db.tasks      = rowData(tasks);
    db.activities = rowData(activities);
    db.auditLog   = rowData(audit);
    db.settings   = Object.assign(
      defaultSettings(),
      (settings && settings.data && settings.data.data) || {},
      { theme: localTheme() }
    );
    db.meta.lastSync = new Date().toISOString();
  }

  /* Inicializa a sessão e o cache. Retorna o usuário logado ou null. */
  async function init() {
    if (!configured) return null;
    const { data } = await sb().auth.getSession();
    const session = data && data.session;
    if (!session) return null;
    try {
      await fetchCurrentProfile(session.user.id);
      if (!currentUser) {
        await sb().auth.signOut();
        return null;
      }
      await fetchAll();
      return clone(currentUser);
    } catch (e) {
      console.error("[DB.init]", e);
      return null;
    }
  }

  /* Recarrega tudo do servidor (ex.: botão atualizar do portal) */
  function reload() {
    return fetchAll().catch((e) => syncError("reload", e));
  }

  /* ------------------------------------------------------------------ */
  /* Sessão / Autenticação                                               */
  /* ------------------------------------------------------------------ */

  async function login(email, password) {
    if (!configured) return { ok: false, message: "Sistema não configurado (js/supabase-config.js)." };
    const { data, error } = await sb().auth.signInWithPassword({ email: email, password: password });
    if (error) return { ok: false, message: friendlyError(error) };
    try {
      await fetchCurrentProfile(data.user.id);
    } catch (e) {
      return { ok: false, message: "Não foi possível carregar seu perfil: " + friendlyError(e) };
    }
    if (!currentUser) {
      await sb().auth.signOut();
      return { ok: false, message: "Usuário sem perfil no sistema. Contate o administrador." };
    }
    currentUser.status = "online";
    sb().from("profiles").update({ data: userDataOf(currentUser) }).eq("id", currentUser.id)
      .then(({ error: e }) => { if (e) console.warn("[login status]", e); });
    addAuditLog({ action: "Login", type: "Sessão", targetId: currentUser.id, targetName: currentUser.name, targetRole: currentUser.position || currentUser.role });
    return { ok: true, user: clone(currentUser) };
  }

  async function logout() {
    if (currentUser) {
      addAuditLog({ action: "Logout", type: "Sessão", targetId: currentUser.id, targetName: currentUser.name, targetRole: currentUser.position || currentUser.role });
      currentUser.status = "offline";
      try {
        await sb().from("profiles").update({ data: userDataOf(currentUser) }).eq("id", currentUser.id);
      } catch (e) { /* melhor esforço */ }
    }
    currentUser = null;
    try { await sb().auth.signOut(); } catch (e) { /* sessão local já foi limpa */ }
  }

  /* Cadastro público do portal (empresa cliente) */
  async function signUpCompany({ name, email, password, cnpj, phone }) {
    if (!configured) return { ok: false, message: "Sistema não configurado (js/supabase-config.js)." };
    const { data, error } = await sb().auth.signUp({
      email: email,
      password: password,
      options: { data: { name: name } }
    });
    if (error) return { ok: false, message: friendlyError(error) };
    if (!data.session) {
      return {
        ok: false,
        needsConfirm: true,
        message: "Cadastro criado, mas o projeto exige confirmação de e-mail. Desative 'Confirm email' no Supabase ou confirme pelo link enviado."
      };
    }
    const { error: rpcError } = await sb().rpc("register_company", {
      p_name: name, p_cnpj: cnpj || "", p_phone: phone || "", p_email: email
    });
    if (rpcError) return { ok: false, message: friendlyError(rpcError) };
    await fetchCurrentProfile(data.user.id);
    return { ok: true };
  }

  function getSession() {
    return currentUser ? { userId: currentUser.id } : null;
  }

  function getCurrentUser() {
    return currentUser ? clone(currentUser) : null;
  }

  function isAdmin(user) {
    return !!user && user.role === "admin";
  }

  /* "Funcionário 2": funcionário com a permissão extra "tasks:manage" pode
     criar/gerenciar tarefas como o admin, mas continua sem acesso a
     Financeiro, Equipe, Relatórios e Auditoria (restritos ao admin). */
  function canManageTasks(user) {
    return !!user && (user.role === "admin" || (user.permissions || []).includes("tasks:manage"));
  }

  /* Diferente de canManageTasks: só o admin enxerga tarefas/estatísticas de
     TODOS os funcionários. Funcionário 2 gerencia tarefas com poderes de
     admin, mas continua restrito às próprias tarefas em listas e relatórios. */
  function canSeeAllTasks(user) {
    return !!user && user.role === "admin";
  }

  function requireSession(redirectTo) {
    const user = getCurrentUser();
    if (!user) {
      window.location.href = redirectTo || "index.html";
      return null;
    }
    return user;
  }

  /* ------------------------------------------------------------------ */
  /* CRUD: Usuários (assíncrono — envolve Supabase Auth via RPC)         */
  /* ------------------------------------------------------------------ */

  const Users = {
    list() {
      return clone(db.users);
    },
    get(id) {
      const u = db.users.find((x) => x.id === id);
      return u ? clone(u) : null;
    },

    /* Cria usuário (auth + perfil). Requer admin. Retorna {ok, user|message}. */
    async create(data) {
      const d = clone(data);
      const password = d.password;
      delete d.password;
      d.createdAt = d.createdAt || todayISO();
      const role = d.role || "employee";

      const p_data = clone(d);
      delete p_data.role;

      const { data: newId, error } = await sb().rpc("admin_create_user", {
        p_email: d.email,
        p_password: password,
        p_role: role,
        p_data: p_data
      });
      if (error) return { ok: false, message: friendlyError(error) };

      const user = Object.assign({ id: newId, role: role, companyId: d.companyId || null }, (function () {
        const rest = clone(d);
        delete rest.role;
        delete rest.companyId;
        return rest;
      })());
      db.users.push(user);
      addAuditLog({ action: "Criação", type: "Usuário", targetId: user.id, targetName: user.name, targetRole: user.position || user.role });
      return { ok: true, user: clone(user) };
    },

    /* Atualiza perfil e, se patch.password/email, credenciais de acesso. */
    async update(id, patch) {
      const u = db.users.find((x) => x.id === id);
      if (!u) return { ok: false, message: "Usuário não encontrado." };

      const p = clone(patch || {});
      const newPassword = p.password || null;
      delete p.password;
      const emailChanged = p.email && p.email.toLowerCase() !== (u.email || "").toLowerCase();

      if (newPassword || emailChanged) {
        const { error } = await sb().rpc("admin_update_user_credentials", {
          p_user_id: id,
          p_email: emailChanged ? p.email : null,
          p_password: newPassword
        });
        if (error) return { ok: false, message: friendlyError(error) };
      }

      Object.assign(u, p);
      const { error: profileError } = await sb().from("profiles").update(profileRowOf(u)).eq("id", id);
      if (profileError) return { ok: false, message: friendlyError(profileError) };

      if (currentUser && currentUser.id === id) currentUser = clone(u);
      addAuditLog({ action: "Edição", type: "Usuário", targetId: id, targetName: u.name, targetRole: u.position || u.role });
      return { ok: true, user: clone(u) };
    },

    /* Exclui usuário (auth + perfil em cascata). Requer admin. */
    async remove(id) {
      const target = db.users.find((x) => x.id === id);
      const { error } = await sb().rpc("admin_delete_user", { p_user_id: id });
      if (error) return { ok: false, message: friendlyError(error) };
      db.users = db.users.filter((x) => x.id !== id);
      addAuditLog({
        action: "Exclusão", type: "Usuário", targetId: id,
        targetName: target ? target.name : id,
        targetRole: target ? (target.position || target.role) : ""
      });
      return { ok: true };
    }
  };

  /* ------------------------------------------------------------------ */
  /* CRUD: Equipes                                                       */
  /* ------------------------------------------------------------------ */

  const Teams = {
    list() {
      return clone(db.teams);
    },
    get(id) {
      return clone(db.teams.find((t) => t.id === id)) || null;
    },
    create(data) {
      const team = Object.assign({ id: uid("team"), color: "#7c3aed" }, data);
      db.teams.push(team);
      pushRow("teams", team);
      return clone(team);
    },
    update(id, patch) {
      const team = db.teams.find((t) => t.id === id);
      if (!team) return null;
      Object.assign(team, patch);
      pushRow("teams", team);
      return clone(team);
    },
    remove(id) {
      db.teams = db.teams.filter((t) => t.id !== id);
      deleteRow("teams", id);
      return true;
    },
    members(id) {
      return db.users.filter((u) => u.team === id).map(clone);
    }
  };

  /* ------------------------------------------------------------------ */
  /* CRUD: Empresas (clientes atendidos)                                */
  /* ------------------------------------------------------------------ */

  const Companies = {
    list() { return clone(db.companies || []); },
    get(id) { return clone((db.companies || []).find((c) => c.id === id)) || null; },
    create(data) {
      const co = Object.assign({ id: uid("co"), status: "ativo" }, data);
      db.companies.push(co);
      pushRow("companies", co);
      addAuditLog({ action: "Criação", type: "Empresa", targetId: co.id, targetName: co.name, companyId: co.id, companyName: co.name });
      return clone(co);
    },
    update(id, patch) {
      const co = (db.companies || []).find((c) => c.id === id);
      if (!co) return null;
      Object.assign(co, patch);
      pushRow("companies", co);
      addAuditLog({ action: "Edição", type: "Empresa", targetId: id, targetName: co.name, companyId: id, companyName: co.name });
      return clone(co);
    },
    remove(id) {
      const target = (db.companies || []).find((c) => c.id === id);
      const tName = target ? target.name : id;
      db.companies = (db.companies || []).filter((c) => c.id !== id);
      deleteRow("companies", id);
      addAuditLog({ action: "Exclusão", type: "Empresa", targetId: id, targetName: tName, companyId: id, companyName: tName });
      return true;
    },
    signContract(id, signerName) {
      const co = (db.companies || []).find((c) => c.id === id);
      if (!co) return null;
      co.contractSignedAt = new Date().toISOString();
      co.contractSignedBy = signerName;
      pushRow("companies", co);
      addAuditLog({ action: "Assinatura", type: "Contrato", targetId: id, targetName: co.name, companyId: id, companyName: co.name, details: `Assinado por: ${signerName}` });
      return clone(co);
    },
    resetContractSign(id) {
      const co = (db.companies || []).find((c) => c.id === id);
      if (!co) return null;
      co.contractSignedAt = null;
      co.contractSignedBy = null;
      pushRow("companies", co);
      addAuditLog({ action: "Redefinição", type: "Contrato", targetId: id, targetName: co.name, companyId: id, companyName: co.name });
      return clone(co);
    }
  };

  /* ------------------------------------------------------------------ */
  /* CRUD: Boletos                                                       */
  /* ------------------------------------------------------------------ */

  const Boletos = {
    list(filter) {
      let list = clone(db.boletos || []);
      if (filter) {
        if (filter.companyId) list = list.filter((b) => b.companyId === filter.companyId);
        if (filter.month)     list = list.filter((b) => b.month === filter.month);
        if (filter.status)    list = list.filter((b) => b.status === filter.status);
      }
      return list.sort((a, b) => a.dueDate.localeCompare(b.dueDate));
    },
    get(id) { return clone((db.boletos || []).find((b) => b.id === id)) || null; },
    create(data) {
      const bol = Object.assign({ id: uid("bol"), paidDate: null, notes: "", status: "pendente" }, data);
      db.boletos.push(bol);
      pushRow("boletos", bol);
      const bCo = (db.companies || []).find((c) => c.id === bol.companyId);
      addAuditLog({ action: "Criação", type: "Boleto", targetId: bol.id, targetName: bol.description, companyId: bol.companyId, companyName: bCo ? bCo.name : "" });
      return clone(bol);
    },
    update(id, patch) {
      const bol = (db.boletos || []).find((b) => b.id === id);
      if (!bol) return null;
      Object.assign(bol, patch);
      pushRow("boletos", bol);
      const bCo = (db.companies || []).find((c) => c.id === bol.companyId);
      addAuditLog({ action: "Edição", type: "Boleto", targetId: id, targetName: bol.description, companyId: bol.companyId, companyName: bCo ? bCo.name : "" });
      return clone(bol);
    },
    remove(id) {
      const target = (db.boletos || []).find((b) => b.id === id);
      const tName = target ? target.description : id;
      const tCoId = target ? target.companyId : null;
      const tCo = tCoId ? (db.companies || []).find((c) => c.id === tCoId) : null;
      db.boletos = (db.boletos || []).filter((b) => b.id !== id);
      deleteRow("boletos", id);
      addAuditLog({ action: "Exclusão", type: "Boleto", targetId: id, targetName: tName, companyId: tCoId, companyName: tCo ? tCo.name : "" });
      return true;
    }
  };

  /* ------------------------------------------------------------------ */
  /* CRUD: Custos operacionais                                           */
  /* ------------------------------------------------------------------ */

  /* Custos podem ter duração (ex.: "Software" de Out a Dez): o valor
     informado é mensal e se repete em cada mês do intervalo [month, endMonth]. */
  function costMonths(cost) {
    const start = cost.month;
    const end = cost.endMonth && cost.endMonth >= start ? cost.endMonth : start;
    const [sy, sm] = start.split("-").map(Number);
    const [ey, em] = end.split("-").map(Number);
    const months = [];
    let y = sy, m = sm;
    while (y < ey || (y === ey && m <= em)) {
      months.push(`${y}-${String(m).padStart(2, "0")}`);
      m++;
      if (m > 12) { m = 1; y++; }
    }
    return months;
  }

  const Costs = {
    list(filter) {
      let list = clone(db.costs || []);
      if (filter) {
        if (filter.month) list = list.filter((c) => costMonths(c).includes(filter.month));
        if (filter.type)  list = list.filter((c) => c.type === filter.type);
      }
      return list.sort((a, b) => b.month.localeCompare(a.month));
    },
    get(id) { return clone((db.costs || []).find((c) => c.id === id)) || null; },
    monthsOf(cost) { return costMonths(cost); },
    totalForMonth(ym) {
      return (db.costs || []).reduce((s, c) => (costMonths(c).includes(ym) ? s + (c.amount || 0) : s), 0);
    },
    totalAll() {
      return (db.costs || []).reduce((s, c) => s + (c.amount || 0) * costMonths(c).length, 0);
    },
    create(data) {
      const cost = Object.assign({ id: uid("cost") }, data);
      db.costs.push(cost);
      pushRow("costs", cost);
      addAuditLog({ action: "Criação", type: "Custo", targetId: cost.id, targetName: cost.description });
      return clone(cost);
    },
    update(id, patch) {
      const cost = (db.costs || []).find((c) => c.id === id);
      if (!cost) return null;
      Object.assign(cost, patch);
      pushRow("costs", cost);
      addAuditLog({ action: "Edição", type: "Custo", targetId: id, targetName: cost.description });
      return clone(cost);
    },
    remove(id) {
      const target = (db.costs || []).find((c) => c.id === id);
      const tName = target ? target.description : id;
      db.costs = (db.costs || []).filter((c) => c.id !== id);
      deleteRow("costs", id);
      addAuditLog({ action: "Exclusão", type: "Custo", targetId: id, targetName: tName });
      return true;
    }
  };

  /* ------------------------------------------------------------------ */
  /* CRUD: Tarefas                                                       */
  /* ------------------------------------------------------------------ */

  /* Tarefas antigas (antes da migration 20260930) guardavam um único companyId */
  function taskCompanyIds(task) {
    if (!task) return [];
    if (Array.isArray(task.companyIds)) return task.companyIds;
    return task.companyId ? [task.companyId] : [];
  }

  function taskCompanyNames(task) {
    return taskCompanyIds(task)
      .map((cid) => (db.companies || []).find((c) => c.id === cid))
      .filter(Boolean)
      .map((c) => c.name);
  }

  function taskAuditCompany(task) {
    const ids = taskCompanyIds(task);
    const names = taskCompanyNames(task);
    return { companyId: ids.length === 1 ? ids[0] : null, companyName: names.length ? names.join(", ") : null };
  }

  function normalizeTaskCompanies(data) {
    if (data && Array.isArray(data.companyIds)) delete data.companyId;
    return data;
  }

  const Tasks = {
    companyIdsOf: taskCompanyIds,
    companyNamesOf: taskCompanyNames,
    list(filter) {
      let list = clone(db.tasks);
      if (filter) {
        if (filter.assignee)   list = list.filter((t) => t.assignee === filter.assignee);
        if (filter.companyId)  list = list.filter((t) => taskCompanyIds(t).includes(filter.companyId));
        if (filter.includeArchived !== true) list = list.filter((t) => !t.archived);
      }
      return list;
    },
    get(id) {
      return clone(db.tasks.find((t) => t.id === id)) || null;
    },
    create(data) {
      const task = Object.assign(
        {
          id: uid("task"),
          tags: [],
          checklist: [],
          comments: [],
          attachments: [],
          handoffs: [],
          timeLogged: 0,
          archived: false,
          createdAt: todayISO(),
          updatedAt: todayISO()
        },
        normalizeTaskCompanies(data)
      );
      /* RLS só devolve a linha ao criador se ele estiver em participants (upsert relê a linha) */
      task.participants = uniq([currentUser && currentUser.id, task.assignee]);
      db.tasks.push(task);
      pushRow("tasks", task);
      logActivity(currentUser && currentUser.id, `criou a tarefa "${task.title}"`);
      addAuditLog(Object.assign({ action: "Criação", type: "Tarefa", targetId: task.id, targetName: task.title }, taskAuditCompany(task)));
      return clone(task);
    },
    update(id, patch) {
      const task = db.tasks.find((t) => t.id === id);
      if (!task) return null;

      /* Concluir arquiva automaticamente; reabrir uma tarefa concluída desarquiva */
      if (patch.status && patch.status !== task.status && patch.archived === undefined) {
        if (patch.status === "concluida") patch.archived = true;
        else if (task.status === "concluida" && task.archived) patch.archived = false;
      }

      Object.assign(task, patch, { updatedAt: todayISO() });
      normalizeTaskCompanies(task);
      task.participants = uniq((task.participants || []).concat([currentUser && currentUser.id, task.assignee]));
      pushRow("tasks", task);
      addAuditLog(Object.assign({ action: "Edição", type: "Tarefa", targetId: id, targetName: task.title }, taskAuditCompany(task)));
      return clone(task);
    },
    remove(id) {
      const target = db.tasks.find((t) => t.id === id);
      const tName = target ? target.title : id;
      const coInfo = taskAuditCompany(target);
      db.tasks = db.tasks.filter((t) => t.id !== id);
      deleteRow("tasks", id);
      addAuditLog(Object.assign({ action: "Exclusão", type: "Tarefa", targetId: id, targetName: tName }, coInfo));
      return true;
    },
    duplicate(id) {
      const original = db.tasks.find((t) => t.id === id);
      if (!original) return null;
      const copy = clone(original);
      copy.id = uid("task");
      copy.title = original.title + " (cópia)";
      copy.status = "nao_iniciada";
      copy.handoffs = [];
      copy.participants = uniq([currentUser && currentUser.id, copy.assignee]);
      copy.createdAt = todayISO();
      copy.updatedAt = todayISO();
      db.tasks.push(copy);
      pushRow("tasks", copy);
      addAuditLog({ action: "Criação", type: "Tarefa", targetId: copy.id, targetName: copy.title, details: `Duplicada de: ${original.title}` });
      return clone(copy);
    },
    archive(id, archived) {
      const task = db.tasks.find((t) => t.id === id);
      if (!task) return null;
      task.archived = archived !== false;
      pushRow("tasks", task);
      addAuditLog({ action: "Edição", type: "Tarefa", targetId: id, targetName: task.title, details: archived !== false ? "Arquivada" : "Desarquivada" });
      return clone(task);
    },
    addComment(id, author, text) {
      const task = db.tasks.find((t) => t.id === id);
      if (!task) return null;
      task.comments.push({ id: uid("cmt"), author, text, date: new Date().toISOString() });
      pushRow("tasks", task);
      return clone(task);
    },
    isOverdue(task) {
      if (task.status === "concluida") return false;
      return task.dueDate < todayISO();
    },

    /* Passa a tarefa para outro funcionário; quem encaminhou continua em
       participants e segue vendo/comentando, mas só o novo responsável edita. */
    forward(id, toUserId, note, progress) {
      const task = db.tasks.find((t) => t.id === id);
      if (!task || !toUserId || toUserId === task.assignee) return null;
      const fromUserId = task.assignee;
      task.handoffs = (task.handoffs || []).concat([{
        from: fromUserId,
        to: toUserId,
        by: currentUser && currentUser.id,
        note: note || "",
        date: new Date().toISOString()
      }]);
      Object.assign(task, progress || {}, {
        assignee: toUserId,
        status: "nao_iniciada",
        archived: false,
        updatedAt: todayISO()
      });
      task.participants = uniq((task.participants || []).concat([currentUser && currentUser.id, fromUserId, toUserId]));
      pushRow("tasks", task);
      const fromName = (db.users.find((u) => u.id === fromUserId) || {}).name || "—";
      const toName = (db.users.find((u) => u.id === toUserId) || {}).name || "—";
      logActivity(currentUser && currentUser.id, `encaminhou a tarefa "${task.title}" para ${toName}`);
      addAuditLog(Object.assign(
        { action: "Encaminhamento", type: "Tarefa", targetId: id, targetName: task.title, details: `${fromName} → ${toName}${note ? `: ${note}` : ""}` },
        taskAuditCompany(task)
      ));
      return clone(task);
    }
  };

  function uniq(list) {
    return Array.from(new Set(list.filter(Boolean)));
  }

  /* ------------------------------------------------------------------ */
  /* Atividades recentes + auditoria                                     */
  /* ------------------------------------------------------------------ */

  function logActivity(userId, text) {
    if (!userId) return;
    const act = { id: uid("act"), user: userId, text, date: todayISO() };
    db.activities.unshift(act);
    pushRow("activities", act);
    const removed = db.activities.slice(50);
    db.activities = db.activities.slice(0, 50);
    removed.forEach((r) => deleteRow("activities", r.id));
  }

  function addAuditLog({ action, type, targetId, targetName, targetRole, companyId, companyName, details }) {
    const actor = currentUser;
    if (!actor) return;
    const entry = {
      id: uid("audit"),
      timestamp: new Date().toISOString(),
      authorId: actor.id,
      authorName: actor.name,
      authorPosition: actor.position || (actor.role === "admin" ? "Administrador" : actor.role === "employee" ? "Funcionário" : "Empresa"),
      action,
      type,
      targetId: targetId || "",
      targetName: targetName || "",
      targetRole: targetRole || null,
      companyId: companyId || null,
      companyName: companyName || null,
      details: details || ""
    };
    db.auditLog.unshift(entry);
    db.auditLog = db.auditLog.slice(0, 1000);
    pushRow("audit_log", entry);
  }

  const Activities = {
    list(limit) {
      return clone((db.activities || []).slice(0, limit || 10));
    }
  };

  const Audit = {
    list(filter) {
      let logs = clone(db.auditLog || []);
      if (filter) {
        if (filter.days) {
          const cutoff = new Date();
          cutoff.setDate(cutoff.getDate() - filter.days);
          logs = logs.filter((e) => new Date(e.timestamp) >= cutoff);
        }
        if (filter.search) {
          const q = filter.search.toLowerCase();
          logs = logs.filter((e) =>
            (e.authorName  || "").toLowerCase().includes(q) ||
            (e.targetName  || "").toLowerCase().includes(q) ||
            (e.companyName || "").toLowerCase().includes(q) ||
            (e.type        || "").toLowerCase().includes(q) ||
            (e.action      || "").toLowerCase().includes(q)
          );
        }
      }
      return logs;
    },
    clear() {
      db.auditLog = [];
      sb()
        .from("audit_log")
        .delete()
        .neq("id", "")
        .then(({ error }) => { if (error) syncError("audit clear", error); });
    }
  };

  /* ------------------------------------------------------------------ */
  /* Configurações (tema fica local por navegador; resto é compartilhado)*/
  /* ------------------------------------------------------------------ */

  const Settings = {
    get() {
      return Object.assign(clone(db.settings), { theme: localTheme() });
    },
    update(patch) {
      const p = clone(patch || {});
      if (p.theme) {
        try { localStorage.setItem(THEME_KEY, p.theme); } catch (e) { /* sem storage */ }
        delete p.theme;
      }
      if (Object.keys(p).length) {
        db.settings = Object.assign({}, db.settings, p);
        const shared = clone(db.settings);
        delete shared.theme;
        sb()
          .from("app_settings")
          .upsert({ id: "main", data: shared })
          .then(({ error }) => { if (error) syncError("app_settings", error); });
      }
      return Settings.get();
    }
  };

  /* ------------------------------------------------------------------ */
  /* Indicadores / Estatísticas                                          */
  /* ------------------------------------------------------------------ */

  const Stats = {
    overview() {
      const tasks = db.tasks;
      const total = tasks.length;
      const concluded = tasks.filter((t) => t.status === "concluida").length;
      const inProgress = tasks.filter((t) => t.status === "em_andamento").length;
      const overdue = tasks.filter((t) => Tasks.isOverdue(t)).length;
      const activeUsers = db.users.filter((u) => u.status !== "offline").length;
      const productivity = total ? Math.round((concluded / total) * 100) : 0;
      return { total, concluded, inProgress, overdue, activeUsers, productivity };
    },
    tasksByStatus() {
      const statuses = ["backlog", "nao_iniciada", "em_andamento", "em_revisao", "concluida"];
      const tasks = db.tasks;
      return statuses.map((s) => ({
        status: s,
        count: tasks.filter((t) => t.status === s).length
      }));
    },
    tasksByPriority() {
      const priorities = ["baixa", "media", "alta", "urgente"];
      const tasks = db.tasks;
      return priorities.map((p) => ({
        priority: p,
        count: tasks.filter((t) => t.priority === p).length
      }));
    },
    tasksPerUser() {
      return db.users.map((u) => {
        const userTasks = db.tasks.filter((t) => t.assignee === u.id);
        const concluded = userTasks.filter((t) => t.status === "concluida").length;
        return {
          userId: u.id,
          name: u.name,
          total: userTasks.length,
          concluded,
          onTime: userTasks.filter((t) => t.status === "concluida" && t.dueDate >= t.updatedAt).length,
          hours: userTasks.reduce((sum, t) => sum + (t.timeLogged || 0), 0)
        };
      });
    },
    weeklyCompletion() {
      const days = [];
      for (let i = 6; i >= 0; i--) {
        const date = todayISO(-i);
        const count = db.tasks.filter((t) => t.status === "concluida" && t.updatedAt === date).length;
        days.push({ date, count });
      }
      return days;
    },

    /* Custos x recebido no ano corrente, com projeção linear (base: média
       mensal do ano até agora) para o fechamento do ano — "se continuar
       assim, quanto vou gastar/lucrar até dezembro". */
    costAnalysis() {
      const year = new Date().getFullYear();
      const currentYM = todayISO().slice(0, 7);
      const monthsElapsed = Number(currentYM.slice(5, 7)); // Jan..mês atual, inclusive
      const monthsRemaining = 12 - monthsElapsed;

      let totalCostYTD = 0;
      for (let mm = 1; mm <= monthsElapsed; mm++) {
        totalCostYTD += Costs.totalForMonth(`${year}-${String(mm).padStart(2, "0")}`);
      }
      const currentMonthCost = Costs.totalForMonth(currentYM);

      const paidYTD = (db.boletos || []).filter(
        (b) => b.status === "pago" && b.paidDate && b.paidDate >= `${year}-01-01` && b.paidDate <= todayISO()
      );
      const totalReceivedYTD = paidYTD.reduce((s, b) => s + (b.amount || 0), 0);

      const avgMonthlyCost = totalCostYTD / monthsElapsed;
      const avgMonthlyReceived = totalReceivedYTD / monthsElapsed;

      const projectedCost = totalCostYTD + avgMonthlyCost * monthsRemaining;
      const projectedReceived = totalReceivedYTD + avgMonthlyReceived * monthsRemaining;
      const projectedNetProfit = projectedReceived - projectedCost;

      return {
        year,
        monthsElapsed,
        monthsRemaining,
        totalCostYTD,
        totalReceivedYTD,
        currentMonthCost,
        avgMonthlyCost,
        avgMonthlyReceived,
        projectedCost,
        projectedReceived,
        projectedNetProfit
      };
    }
  };

  /* ------------------------------------------------------------------ */
  /* Export / Import — Excel (.xlsx) via SheetJS                        */
  /* ------------------------------------------------------------------ */

  function buildWorkbook() {
    const XLSX = global.XLSX;
    if (!XLSX) throw new Error("Biblioteca SheetJS (XLSX) não carregada.");

    const wb = XLSX.utils.book_new();

    const usersSheet = db.users.map((u) => ({
      ID: u.id,
      Nome: u.name,
      Email: u.email,
      Cargo: u.position,
      Equipe: (db.teams.find((t) => t.id === u.team) || {}).name || "",
      Perfil: u.role === "admin" ? "Administrador" : "Funcionário",
      Status: u.status,
      Desempenho: u.performance
    }));

    const tasksSheet = db.tasks.map((t) => ({
      ID: t.id,
      Titulo: t.title,
      Descricao: t.description,
      Responsavel: (db.users.find((u) => u.id === t.assignee) || {}).name || "",
      Prioridade: t.priority,
      Status: t.status,
      DataInicio: t.startDate,
      DataPrazo: t.dueDate,
      Tags: (t.tags || []).join(", "),
      HorasRegistradas: t.timeLogged,
      Arquivada: t.archived ? "Sim" : "Não"
    }));

    const teamsSheet = db.teams.map((tm) => ({
      ID: tm.id,
      Nome: tm.name,
      Lider: (db.users.find((u) => u.id === tm.lead) || {}).name || "",
      Membros: db.users.filter((u) => u.team === tm.id).length
    }));

    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(usersSheet), "Usuarios");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(tasksSheet), "Tarefas");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(teamsSheet), "Equipes");

    return wb;
  }

  function exportToExcel(filename) {
    const XLSX = global.XLSX;
    if (!XLSX) {
      alert("Biblioteca de exportação (SheetJS) ainda não carregou. Verifique sua conexão e tente novamente.");
      return;
    }
    const wb = buildWorkbook();
    XLSX.writeFile(wb, filename || "banco_de_dados.xlsx");
  }

  function importFromExcel(file, callback) {
    const XLSX = global.XLSX;
    if (!XLSX) {
      callback && callback({ ok: false, message: "Biblioteca SheetJS não carregada." });
      return;
    }
    const reader = new FileReader();
    reader.onload = function (e) {
      try {
        const data = new Uint8Array(e.target.result);
        const workbook = XLSX.read(data, { type: "array" });
        const touched = [];

        if (workbook.Sheets["Tarefas"]) {
          const rows = XLSX.utils.sheet_to_json(workbook.Sheets["Tarefas"]);
          rows.forEach((row) => {
            const existing = db.tasks.find((t) => t.id === row.ID);
            const assigneeUser = db.users.find((u) => u.name === row.Responsavel);
            const payload = {
              title: row.Titulo,
              description: row.Descricao,
              assignee: assigneeUser ? assigneeUser.id : (existing ? existing.assignee : null),
              priority: row.Prioridade,
              status: row.Status,
              startDate: row.DataInicio,
              dueDate: row.DataPrazo,
              tags: row.Tags ? String(row.Tags).split(",").map((s) => s.trim()) : [],
              timeLogged: Number(row.HorasRegistradas) || 0,
              archived: row.Arquivada === "Sim"
            };
            if (existing) {
              Object.assign(existing, payload, { updatedAt: todayISO() });
              touched.push(existing);
            } else {
              const task = Object.assign(
                {
                  id: row.ID || uid("task"),
                  checklist: [],
                  comments: [],
                  attachments: [],
                  createdAt: todayISO(),
                  updatedAt: todayISO()
                },
                payload
              );
              db.tasks.push(task);
              touched.push(task);
            }
          });
        }

        if (touched.length) {
          sb()
            .from("tasks")
            .upsert(touched.map((t) => ({ id: t.id, data: t })))
            .then(({ error }) => { if (error) syncError("import tasks", error); });
        }

        db.meta.lastSync = new Date().toISOString();
        callback && callback({ ok: true, message: "Importação concluída com sucesso." });
      } catch (err) {
        console.error(err);
        callback && callback({ ok: false, message: "Erro ao importar planilha: " + err.message });
      }
    };
    reader.readAsArrayBuffer(file);
  }

  /* ------------------------------------------------------------------ */
  /* Migração única: dados antigos do localStorage → Supabase            */
  /* ------------------------------------------------------------------ */

  function hasLegacyLocalData() {
    try { return !!localStorage.getItem(LEGACY_STORAGE_KEY); } catch (e) { return false; }
  }

  async function importLegacyLocal() {
    let legacy;
    try {
      legacy = JSON.parse(localStorage.getItem(LEGACY_STORAGE_KEY) || "null");
    } catch (e) {
      return { ok: false, message: "Dados locais ilegíveis." };
    }
    if (!legacy) return { ok: false, message: "Nenhum dado antigo encontrado neste navegador." };

    const s = sb();
    const results = {};
    const upsertAll = async (table, list) => {
      if (!list || !list.length) { results[table] = 0; return; }
      const { error } = await s.from(table).upsert(list.map((x) => ({ id: x.id, data: x })));
      if (error) throw new Error(table + ": " + error.message);
      results[table] = list.length;
    };

    try {
      await upsertAll("companies", legacy.companies);
      await upsertAll("boletos", legacy.boletos);
      await upsertAll("teams", legacy.teams);
      await upsertAll("tasks", legacy.tasks);
      if (legacy.settings) {
        const shared = clone(legacy.settings);
        delete shared.theme;
        const { error } = await s.from("app_settings").upsert({ id: "main", data: shared });
        if (error) throw new Error("app_settings: " + error.message);
      }
    } catch (e) {
      return { ok: false, message: "Falha na migração: " + e.message };
    }

    await fetchAll();
    return {
      ok: true,
      message:
        `Migração concluída — empresas: ${results.companies || 0}, boletos: ${results.boletos || 0}, ` +
        `equipes: ${results.teams || 0}, tarefas: ${results.tasks || 0}. ` +
        "Usuários NÃO são migrados: recadastre-os em Equipe (as senhas antigas não são aproveitáveis)."
    };
  }

  /* ------------------------------------------------------------------ */
  /* Compatibilidade                                                     */
  /* ------------------------------------------------------------------ */

  function resetDatabase() {
    if (global.UI && global.UI.toast) {
      global.UI.toast("Reset local desativado: os dados agora ficam no Supabase.", "error");
    }
  }

  const api = {
    baseUrl: null,
    async request() {
      console.warn("[DB.api] Obsoleto: o backend agora é o Supabase (window.SB).");
      return Promise.resolve(null);
    }
  };

  /* ------------------------------------------------------------------ */
  /* Exposição pública                                                    */
  /* ------------------------------------------------------------------ */

  global.DB = {
    configured,
    uid,
    todayISO,
    init,
    login,
    logout,
    signUpCompany,
    getSession,
    getCurrentUser,
    isAdmin,
    canManageTasks,
    canSeeAllTasks,
    requireSession,
    Users,
    Teams,
    Companies,
    Boletos,
    Costs,
    Tasks,
    Activities,
    Audit,
    Settings,
    Stats,
    exportToExcel,
    importFromExcel,
    hasLegacyLocalData,
    importLegacyLocal,
    resetDatabase,
    reload,
    api
  };
})(window);
