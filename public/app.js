const token = localStorage.getItem('token');
const currentUser = JSON.parse(localStorage.getItem('user') || 'null');

if (!token || !currentUser) {
  window.location.href = '/login.html';
}

const PRIORITY_LABEL = { alta: 'Alta', media: 'Média', baixa: 'Baixa' };

// Gera uma cor consistente (sempre a mesma para o mesmo nome) e as iniciais
// para os avatares circulares — não temos fotos de perfil neste sistema.
const AVATAR_PALETTE = ['#7c3aed', '#2563eb', '#0891b2', '#16a34a', '#d97706', '#dc2626', '#db2777', '#4f46e5'];
function colorForName(name) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return AVATAR_PALETTE[Math.abs(hash) % AVATAR_PALETTE.length];
}
function initials(name) {
  const parts = name.trim().split(/\s+/);
  const first = parts[0]?.[0] || '';
  const last = parts.length > 1 ? parts[parts.length - 1][0] : '';
  return (first + last).toUpperCase();
}
let allUsers = [];
let currentTaskFiles = [];
let openTaskId = null; // id da tarefa aberta no modal (usado para saber onde recarregar arquivos ao vincular)

// ---------- Helpers de API ----------
async function api(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: {
      ...(options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
      Authorization: `Bearer ${token}`,
      ...(options.headers || {}),
    },
  });
  if (res.status === 401) {
    localStorage.clear();
    window.location.href = '/login.html';
    return;
  }

  const contentType = res.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    // Isso normalmente acontece quando o servidor está rodando uma versão
    // antiga do código (sem essa rota) e devolve a página HTML em vez de
    // JSON. Levanta um erro claro em vez de falhar silenciosamente.
    throw new Error('Resposta inesperada do servidor. Reinicie o servidor (pare com Ctrl+C e rode novamente) para carregar as atualizações mais recentes.');
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Erro na requisição.');
  return data;
}

// ---------- Topbar ----------
document.getElementById('userName').textContent = currentUser.name;
document.getElementById('userRole').textContent = currentUser.role === 'admin' ? 'Admin' : 'Membro';
{
  const avatarEl = document.getElementById('userAvatar');
  avatarEl.textContent = initials(currentUser.name);
  avatarEl.style.background = colorForName(currentUser.name);
}
if (currentUser.role !== 'admin') {
  document.getElementById('manageUsersBtn').classList.add('hidden');
}

document.getElementById('logoutBtn').addEventListener('click', () => {
  localStorage.clear();
  window.location.href = '/login.html';
});

// ---------- Carregar usuários (para filtros e atribuição) ----------
async function loadUsers() {
  allUsers = await api('/api/users');
  const filterSel = document.getElementById('filterAssignee');
  const taskSel = document.getElementById('taskAssignee');
  filterSel.innerHTML = '<option value="">Todos os responsáveis</option>';
  taskSel.innerHTML = '<option value="">Sem responsável</option>';
  allUsers.forEach((u) => {
    filterSel.innerHTML += `<option value="${u.id}">${u.name}</option>`;
    taskSel.innerHTML += `<option value="${u.id}">${u.name}</option>`;
  });
}

// Popula o filtro "Empresa" do quadro só com empresas que realmente têm
// alguma tarefa vinculada — evita listar centenas de empresas sem nada a
// mostrar quando filtradas.
async function loadCompanyFilter() {
  const companies = await api('/api/companies?com_tarefas=1');
  const sel = document.getElementById('filterCompany');
  sel.innerHTML = '<option value="">Todas as empresas</option>' +
    companies.map((c) => `<option value="${c.id}">${c.codigo} — ${escapeHtml(c.razao_social)}</option>`).join('');
}

// ---------- Board ----------
async function loadTasks() {
  const assignee = document.getElementById('filterAssignee').value;
  const priority = document.getElementById('filterPriority').value;
  const tipo = document.getElementById('filterTipo').value;
  const companyId = document.getElementById('filterCompany').value;
  const competencia = document.getElementById('competenciaSelect').value;
  const params = new URLSearchParams();
  if (assignee) params.set('assignee', assignee);
  if (priority) params.set('priority', priority);
  if (tipo) params.set('tipo', tipo);
  if (companyId) params.set('company_id', companyId);
  if (competencia) params.set('competencia', competencia);

  const tasks = await api(`/api/tasks?${params.toString()}`);
  ['todo', 'doing', 'done'].forEach((status) => {
    document.getElementById(`col-${status}`).innerHTML = '';
  });

  const counts = { todo: 0, doing: 0, done: 0 };
  tasks.forEach((t) => {
    counts[t.status]++;
    document.getElementById(`col-${t.status}`).appendChild(renderCard(t));
  });
  ['todo', 'doing', 'done'].forEach((s) => {
    document.getElementById(`count-${s}`).textContent = counts[s];
  });
}

// ---------- Seletor de competência (mês/ano) ----------
const MONTH_NAMES_PT = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

function populateCompetenciaSelect() {
  const now = new Date();

  const monthSelect = document.getElementById('compMonthSelect');
  monthSelect.innerHTML = MONTH_NAMES_PT.map((m, i) => `<option value="${i + 1}">${m}</option>`).join('');

  const yearSelect = document.getElementById('compYearSelect');
  const currentYear = now.getFullYear();
  const years = [];
  for (let y = currentYear - 3; y <= currentYear + 3; y++) years.push(y);
  yearSelect.innerHTML = years.map((y) => `<option value="${y}">${y}</option>`).join('');

  setCompetencia(currentYear, now.getMonth() + 1);
}

function setCompetencia(year, month) {
  document.getElementById('compYearSelect').value = String(year);
  document.getElementById('compMonthSelect').value = String(month);
  const value = `${year}-${String(month).padStart(2, '0')}`;
  document.getElementById('competenciaSelect').value = value;
  // garante que o <option> exista antes de setar o value (select oculto simples)
  const hidden = document.getElementById('competenciaSelect');
  if (hidden.value !== value) {
    hidden.innerHTML = `<option value="${value}">${value}</option>`;
    hidden.value = value;
  }
  loadTasks();
}

function shiftCompetencia(delta) {
  const y = Number(document.getElementById('compYearSelect').value);
  const m = Number(document.getElementById('compMonthSelect').value);
  const d = new Date(y, m - 1 + delta, 1);
  setCompetencia(d.getFullYear(), d.getMonth() + 1);
}

document.getElementById('compPrevBtn').addEventListener('click', () => shiftCompetencia(-1));
document.getElementById('compNextBtn').addEventListener('click', () => shiftCompetencia(1));
document.getElementById('compTodayBtn').addEventListener('click', () => {
  const now = new Date();
  setCompetencia(now.getFullYear(), now.getMonth() + 1);
});
document.getElementById('compMonthSelect').addEventListener('change', () => {
  setCompetencia(Number(document.getElementById('compYearSelect').value), Number(document.getElementById('compMonthSelect').value));
});
document.getElementById('compYearSelect').addEventListener('change', () => {
  setCompetencia(Number(document.getElementById('compYearSelect').value), Number(document.getElementById('compMonthSelect').value));
});

populateCompetenciaSelect();
document.getElementById('filterTipo').addEventListener('change', loadTasks);
document.getElementById('filterCompany').addEventListener('change', loadTasks);

const TASK_TYPE_LABEL = {
  imposto: 'Imposto', parcelamento: 'Parcelamento', declaracao: 'Declaração',
  obrigacao_acessoria: 'Obrig. acessória', administrativa: 'Administrativa', outros: 'Outros',
};

function renderCard(task) {
  const el = document.createElement('div');
  el.className = `card p-${task.priority}`;
  el.draggable = true;
  el.dataset.id = task.id;

  const due = task.due_date ? `📅 ${task.due_date}` : '';
  const filesBadge = task.file_count > 0 ? ` · 📎 ${task.file_count}` : '';
  const requiredBadge = task.requer_arquivo ? ' · 📌 exige arquivo' : '';
  const recurrenceBadge = task.recurrence_type && task.recurrence_type !== 'none'
    ? `<span class="recurrence-badge" title="${recurrenceLabel(task)}">🔁 ${recurrenceLabel(task)}</span>`
    : '';
  const typeBadge = task.tipo_tarefa && task.tipo_tarefa !== 'outros'
    ? `<span class="recurrence-badge">${TASK_TYPE_LABEL[task.tipo_tarefa] || task.tipo_tarefa}</span>`
    : '';
  const companyBadge = task.company_codigo
    ? `<span class="recurrence-badge" title="${escapeHtml(task.company_razao_social || '')}" style="background:var(--chip-bg);color:var(--navy);">🏢 ${task.company_codigo}</span>`
    : '';

  const assigneeAvatar = task.assignee_name
    ? `<div class="avatar-circle sm" style="background:${colorForName(task.assignee_name)};" title="${escapeHtml(task.assignee_name)}">${initials(task.assignee_name)}</div>`
    : `<div class="avatar-circle sm" style="background:var(--gray-border);color:var(--gray-text);" title="Sem responsável">?</div>`;

  el.innerHTML = `
    <span class="tag ${task.priority}">${PRIORITY_LABEL[task.priority]}</span>
    <h3>${escapeHtml(task.title)}</h3>
    ${task.description ? `<p class="desc">${escapeHtml(task.description)}</p>` : ''}
    <div class="meta">
      <span>${due}${filesBadge}${requiredBadge}</span>
      ${assigneeAvatar}
    </div>
    ${(recurrenceBadge || typeBadge || companyBadge) ? `<div class="meta" style="margin-top:6px;gap:4px;flex-wrap:wrap;">${companyBadge}${typeBadge}${recurrenceBadge}</div>` : ''}
    <div class="card-actions">
      <button data-action="edit">✎ Editar</button>
      <button data-action="delete" class="danger">🗑 Excluir</button>
    </div>
  `;

  el.addEventListener('dragstart', (e) => {
    e.dataTransfer.setData('text/plain', task.id);
  });

  el.querySelector('[data-action="edit"]').addEventListener('click', () => openTaskModal(task));
  el.querySelector('[data-action="delete"]').addEventListener('click', async () => {
    if (!confirm('Excluir esta tarefa?')) return;
    try {
      await api(`/api/tasks/${task.id}`, { method: 'DELETE' });
      loadTasks();
    } catch (err) {
      alert(err.message);
    }
  });

  return el;
}

// Gera uma cor consistente (sempre a mesma para o mesmo nome) e as iniciais
// para os avatares circulares — não temos fotos de perfil neste sistema.

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

const RECURRENCE_LABELS = { daily: 'dia(s)', weekly: 'semana(s)', monthly: 'mês(es)', yearly: 'ano(s)' };
function recurrenceLabel(task) {
  const unit = RECURRENCE_LABELS[task.recurrence_type];
  if (!unit) return '';
  const n = task.recurrence_interval || 1;
  return n > 1 ? `A cada ${n} ${unit}` : `A cada ${unit.replace('(s)', '')}`;
}

// Drag & drop entre colunas
document.querySelectorAll('.column').forEach((col) => {
  col.addEventListener('dragover', (e) => {
    e.preventDefault();
    col.classList.add('drag-over');
  });
  col.addEventListener('dragleave', () => col.classList.remove('drag-over'));
  col.addEventListener('drop', async (e) => {
    e.preventDefault();
    col.classList.remove('drag-over');
    const taskId = e.dataTransfer.getData('text/plain');
    const newStatus = col.dataset.status;
    try {
      const updated = await api(`/api/tasks/${taskId}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: newStatus }),
      });
      loadTasks();
      if (updated && updated.spawned_task_id) {
        showToast('🔁 Tarefa recorrente concluída — próxima ocorrência criada em "A Fazer".');
      }
    } catch (err) {
      alert(err.message);
    }
  });
});

function showToast(message) {
  let toast = document.getElementById('appToast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'appToast';
    toast.className = 'toast';
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(showToast._timer);
  showToast._timer = setTimeout(() => toast.classList.remove('show'), 4000);
}

document.getElementById('filterAssignee').addEventListener('change', loadTasks);
document.getElementById('filterPriority').addEventListener('change', loadTasks);

// ---------- Modal de tarefa ----------
const taskModal = document.getElementById('taskModal');

document.getElementById('newTaskBtn').addEventListener('click', () => openTaskModal(null));
document.getElementById('cancelTaskBtn').addEventListener('click', () => {
  taskModal.classList.add('hidden');
  openTaskId = null;
});

// ---------- Vincular tarefa a uma empresa (busca por código/nome) ----------
let allCompaniesCache = [];

async function ensureCompaniesCache() {
  if (allCompaniesCache.length > 0) return allCompaniesCache;
  try {
    allCompaniesCache = await api('/api/companies');
  } catch (err) {
    allCompaniesCache = [];
  }
  return allCompaniesCache;
}

function populateTaskCompanyList() {
  const list = document.getElementById('taskCompanyList');
  list.innerHTML = allCompaniesCache
    .map((c) => `<option value="${escapeAttrTask(c.codigo + ' - ' + c.razao_social)}"></option>`)
    .join('');
}

function escapeAttrTask(str) {
  return String(str).replace(/"/g, '&quot;');
}

// Sugestões de nome/padrão de arquivo, de acordo com o tipo de tarefa e o
// regime tributário da empresa selecionada. É só um atalho — o campo de
// texto ao lado continua livre para editar/digitar qualquer coisa.
const FILE_PATTERN_SUGGESTIONS = {
  imposto: {
    'Simples Nacional': ['DAS'],
    MEI: ['DAS MEI'],
    'Lucro Presumido': ['DARF IRPJ', 'DARF CSLL', 'DARF PIS', 'DARF COFINS'],
    'Lucro Real': ['DARF IRPJ', 'DARF CSLL', 'DARF PIS', 'DARF COFINS'],
    _default: ['DAS', 'DARF', 'GARE ICMS', 'Guia ISS'],
  },
  parcelamento: {
    _default: ['Guia de Parcelamento', 'Comprovante de Parcelamento', 'Extrato do Parcelamento'],
  },
  declaracao: {
    'Simples Nacional': ['DEFIS', 'DASN-SIMEI'],
    MEI: ['DASN-SIMEI'],
    'Lucro Presumido': ['ECF', 'ECD', 'DCTF'],
    'Lucro Real': ['ECF', 'ECD', 'DCTF'],
    _default: ['DIRF', 'SPED Fiscal', 'EFD-Reinf'],
  },
  obrigacao_acessoria: {
    _default: ['EFD ICMS/IPI', 'EFD Contribuições', 'DCTFWeb', 'GFIP', 'eSocial'],
  },
  administrativa: {
    _default: ['Procuração', 'Contrato Social', 'Alvará'],
  },
  outros: { _default: [] },
};

function updateFilePatternSuggestions() {
  const tipo = document.getElementById('taskTipo').value;
  const companyId = document.getElementById('taskCompanyId').value;
  const company = companyId ? allCompaniesCache.find((c) => String(c.id) === String(companyId)) : null;
  const tributacao = company ? company.tributacao : null;

  const group = FILE_PATTERN_SUGGESTIONS[tipo] || FILE_PATTERN_SUGGESTIONS.outros;
  const options = (tributacao && group[tributacao]) || group._default || [];

  const select = document.getElementById('taskArquivoPadraoSelect');
  select.innerHTML =
    '<option value="">— escolher uma sugestão —</option>' +
    options.map((o) => `<option value="${escapeAttrTask(o)}">${escapeHtml(o)}</option>`).join('') +
    '<option value="__custom__">Outro (digitar ao lado)</option>';
}
document.getElementById('taskArquivoPadraoSelect').addEventListener('change', (e) => {
  if (e.target.value && e.target.value !== '__custom__') {
    document.getElementById('taskArquivoPadrao').value = e.target.value;
  }
});
document.getElementById('taskTipo').addEventListener('change', updateFilePatternSuggestions);

function applyCompanySelection(company) {
  const hint = document.getElementById('taskCompanyHint');
  document.getElementById('taskCompanyId').value = company ? company.id : '';

  if (!company) {
    hint.classList.add('hidden');
    updateFilePatternSuggestions();
    return;
  }

  // Vincula o responsável: se o campo ainda não tiver ninguém escolhido e o
  // nome do responsável da empresa bater com um usuário do sistema, já
  // preenche sozinho (a pessoa pode trocar manualmente se quiser).
  const assigneeSelect = document.getElementById('taskAssignee');
  let matchedUser = null;
  if (company.usuario) {
    matchedUser = allUsers.find((u) => u.name.trim().toLowerCase() === company.usuario.trim().toLowerCase());
    if (matchedUser && !assigneeSelect.value) {
      assigneeSelect.value = matchedUser.id;
    }
  }

  const parts = [];
  if (company.tributacao) parts.push(`Regime: ${company.tributacao}`);
  if (company.usuario) parts.push(matchedUser ? `Responsável vinculado: ${matchedUser.name}` : `Responsável na ficha: ${company.usuario} (sem conta correspondente no sistema)`);
  hint.textContent = parts.join(' · ') || 'Empresa vinculada.';
  hint.classList.remove('hidden');

  updateFilePatternSuggestions();
}

document.getElementById('taskCompanySearch').addEventListener('input', (e) => {
  const typed = e.target.value.trim();
  const match = typed.match(/^(\d+)\s*-/);
  const codigo = match ? Number(match[1]) : null;
  const company = codigo !== null ? allCompaniesCache.find((c) => c.codigo === codigo) : null;
  applyCompanySelection(company || null);
});

async function openTaskModal(task) {
  openTaskId = task ? task.id : null;
  document.getElementById('taskModalTitle').textContent = task ? 'Editar tarefa' : 'Nova tarefa';
  document.getElementById('taskId').value = task ? task.id : '';
  document.getElementById('taskTitle').value = task ? task.title : '';
  document.getElementById('taskDesc').value = task ? task.description : '';
  document.getElementById('taskPriority').value = task ? task.priority : 'media';
  document.getElementById('taskAssignee').value = task ? (task.assignee_id || '') : '';
  document.getElementById('taskDue').value = task ? (task.due_date || '') : '';
  document.getElementById('taskTipo').value = task ? (task.tipo_tarefa || 'outros') : 'outros';
  document.getElementById('taskCompetencia').value = task ? (task.competencia || '') : document.getElementById('competenciaSelect').value;
  document.getElementById('taskRecurrenceType').value = task ? (task.recurrence_type || 'none') : 'none';
  document.getElementById('taskRecurrenceInterval').value = task ? (task.recurrence_interval || 1) : 1;
  document.getElementById('taskRequerArquivo').checked = task ? !!task.requer_arquivo : false;
  document.getElementById('taskArquivoPadrao').value = task ? (task.arquivo_padrao || '') : '';
  document.getElementById('taskPastaRelacionada').value = task ? (task.pasta_relacionada || '') : '';

  await ensureCompaniesCache();
  populateTaskCompanyList();
  if (task && task.company_id) {
    document.getElementById('taskCompanySearch').value = `${task.company_codigo} - ${task.company_razao_social}`;
    document.getElementById('taskCompanyId').value = task.company_id;
    const company = allCompaniesCache.find((c) => c.id === task.company_id);
    applyCompanySelection(company || null);
  } else {
    document.getElementById('taskCompanySearch').value = '';
    document.getElementById('taskCompanyId').value = '';
    document.getElementById('taskCompanyHint').classList.add('hidden');
  }

  toggleRecurrenceFields();
  toggleRequerArquivoFields();
  updateFilePatternSuggestions();
  currentTaskFiles = [];
  document.getElementById('fileList').innerHTML = '';
  document.getElementById('fileInput').value = '';

  if (task) loadFiles(task.id);

  taskModal.classList.remove('hidden');
}

function toggleRecurrenceFields() {
  const isRecurring = document.getElementById('taskRecurrenceType').value !== 'none';
  document.getElementById('recurrenceIntervalWrap').classList.toggle('hidden', !isRecurring);
  document.getElementById('recurrenceHint').classList.toggle('hidden', !isRecurring);
}
document.getElementById('taskRecurrenceType').addEventListener('change', toggleRecurrenceFields);

function toggleRequerArquivoFields() {
  document.getElementById('requerArquivoFields').classList.toggle('hidden', !document.getElementById('taskRequerArquivo').checked);
}
document.getElementById('taskRequerArquivo').addEventListener('change', toggleRequerArquivoFields);

document.getElementById('taskForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = document.getElementById('taskId').value;
  const payload = {
    title: document.getElementById('taskTitle').value,
    description: document.getElementById('taskDesc').value,
    priority: document.getElementById('taskPriority').value,
    assignee_id: document.getElementById('taskAssignee').value || null,
    due_date: document.getElementById('taskDue').value || null,
    tipo_tarefa: document.getElementById('taskTipo').value,
    competencia: document.getElementById('taskCompetencia').value || null,
    recurrence_type: document.getElementById('taskRecurrenceType').value,
    recurrence_interval: Number(document.getElementById('taskRecurrenceInterval').value) || 1,
    requer_arquivo: document.getElementById('taskRequerArquivo').checked,
    arquivo_padrao: document.getElementById('taskArquivoPadrao').value.trim() || null,
    pasta_relacionada: document.getElementById('taskPastaRelacionada').value.trim() || null,
    company_id: document.getElementById('taskCompanyId').value || null,
  };

  try {
    let taskId = id;
    if (id) {
      await api(`/api/tasks/${id}`, { method: 'PATCH', body: JSON.stringify(payload) });
    } else {
      const created = await api('/api/tasks', { method: 'POST', body: JSON.stringify(payload) });
      taskId = created.id;
    }

    const fileInput = document.getElementById('fileInput');
    if (fileInput.files[0] && taskId) {
      const formData = new FormData();
      formData.append('file', fileInput.files[0]);
      await api(`/api/tasks/${taskId}/files`, { method: 'POST', body: formData });
    }

    taskModal.classList.add('hidden');
    loadTasks();
  } catch (err) {
    alert(err.message);
  }
});

// ---------- Arquivos dentro da tarefa ----------
async function loadFiles(taskId) {
  const files = await api(`/api/tasks/${taskId}/files`);
  const list = document.getElementById('fileList');
  list.innerHTML = files.length
    ? ''
    : '<div style="font-size:12px;color:#5b6472;">Nenhum arquivo anexado ainda.</div>';

  files.forEach((f) => {
    const row = document.createElement('div');
    row.className = 'file-item';
    row.innerHTML = `
      <a href="/api/tasks/${taskId}/files/${f.id}/download?token=${token}" target="_blank">📎 ${escapeHtml(f.original_name)}</a>
      <button data-id="${f.id}">Remover</button>
    `;
    row.querySelector('button').addEventListener('click', async () => {
      if (!confirm('Remover este arquivo?')) return;
      await api(`/api/tasks/${taskId}/files/${f.id}`, { method: 'DELETE' });
      loadFiles(taskId);
    });
    list.appendChild(row);
  });
}

// Nota: o link de download acima usa ?token= na URL para simplificar o clique direto.
// Para reforçar segurança em produção, considere validar o token também via query string
// no servidor (o server.js atual espera o header Authorization; ajuste files.js se for
// usar downloads via link direto).

// ---------- Modal de usuários (admin) ----------
const usersModal = document.getElementById('usersModal');

document.getElementById('manageUsersBtn').addEventListener('click', async () => {
  await renderUsersList();
  usersModal.classList.remove('hidden');
});
document.getElementById('closeUsersBtn').addEventListener('click', () => usersModal.classList.add('hidden'));

async function renderUsersList() {
  const users = await api('/api/users');
  const container = document.getElementById('usersList');
  container.innerHTML = '';
  users.forEach((u) => {
    const row = document.createElement('div');
    row.className = 'file-item';
    row.innerHTML = `
      <span>${escapeHtml(u.name)} — ${escapeHtml(u.email)} <em style="color:#5b6472;">(${u.role})</em></span>
      <button data-id="${u.id}" ${u.id === currentUser.id ? 'disabled' : ''}>Remover</button>
    `;
    row.querySelector('button').addEventListener('click', async () => {
      if (!confirm(`Remover ${u.name}?`)) return;
      try {
        await api(`/api/users/${u.id}`, { method: 'DELETE' });
        renderUsersList();
        loadUsers();
      } catch (err) {
        alert(err.message);
      }
    });
    container.appendChild(row);
  });
}

document.getElementById('newUserForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const payload = {
    name: document.getElementById('newUserName').value,
    email: document.getElementById('newUserEmail').value,
    password: document.getElementById('newUserPassword').value,
    role: document.getElementById('newUserRole').value,
  };
  try {
    await api('/api/users', { method: 'POST', body: JSON.stringify(payload) });
    e.target.reset();
    renderUsersList();
    loadUsers();
  } catch (err) {
    alert(err.message);
  }
});

// ---------- Sincronia em tempo real (WebSocket) ----------
let ws = null;
let wsReconnectTimer = null;

function connectRealtime() {
  const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${protocol}://${window.location.host}/ws?token=${token}`);

  ws.addEventListener('open', () => setSyncStatus(true));
  ws.addEventListener('close', () => {
    setSyncStatus(false);
    // Tenta reconectar automaticamente depois de alguns segundos
    clearTimeout(wsReconnectTimer);
    wsReconnectTimer = setTimeout(connectRealtime, 3000);
  });
  ws.addEventListener('error', () => ws.close());

  ws.addEventListener('message', (event) => {
    const { type, payload } = JSON.parse(event.data);

    switch (type) {
      case 'task:created':
        loadCompanyFilter();
        loadTasks();
        break;
      case 'task:updated':
      case 'task:deleted':
        loadTasks();
        break;
      case 'task:files_changed':
        loadTasks();
        if (openTaskId && payload.task_id === openTaskId) loadFiles(openTaskId);
        break;
      case 'indexed_file:added':
      case 'indexed_file:changed':
      case 'indexed_file:removed':
        // Se o painel de arquivos do servidor estiver aberto, atualiza a lista
        if (!document.getElementById('serverFilesModal').classList.contains('hidden')) {
          renderServerFiles();
        }
        break;
      case 'company:updated':
      case 'company:created':
      case 'company:deleted':
        // Se a view de Controle de Empresas estiver aberta, atualiza a lista
        if (!document.getElementById('companiesView').classList.contains('hidden') && typeof loadCompanies === 'function') {
          loadCompanies({ preserveScroll: true });
        }
        break;
      case 'companies:imported':
        if (!document.getElementById('companiesView').classList.contains('hidden') && typeof loadCompanies === 'function') {
          loadCompanies();
        }
        break;
      case 'directories:changed':
      case 'directories:template_updated':
        if (!document.getElementById('directoriesView').classList.contains('hidden') && typeof reloadCurrentDirectory === 'function') {
          reloadCurrentDirectory();
        }
        break;
    }
  });
}

function setSyncStatus(connected) {
  const el = document.getElementById('syncStatus');
  el.textContent = connected ? '● em tempo real' : '● reconectando...';
  el.style.background = connected ? 'rgba(22,163,74,0.35)' : 'rgba(217,119,6,0.35)';
}

connectRealtime();

// ---------- Arquivos do servidor (indexação reversa) ----------
const serverFilesModal = document.getElementById('serverFilesModal');

document.getElementById('serverFilesBtn').addEventListener('click', () => {
  document.getElementById('serverFilesTitle').textContent = 'Arquivos do servidor';
  renderServerFiles();
  serverFilesModal.classList.remove('hidden');
});

document.getElementById('linkServerFileBtn').addEventListener('click', () => {
  if (!openTaskId) {
    alert('Salve a tarefa primeiro (clique em Salvar) antes de vincular um arquivo do servidor.');
    return;
  }
  document.getElementById('serverFilesTitle').textContent = 'Vincular arquivo a esta tarefa';
  renderServerFiles({ linkMode: true });
  serverFilesModal.classList.remove('hidden');
});

document.getElementById('closeServerFilesBtn').addEventListener('click', () => {
  serverFilesModal.classList.add('hidden');
});

async function renderServerFiles({ linkMode = false } = {}) {
  const container = document.getElementById('serverFilesList');
  container.innerHTML = '<div style="font-size:12px;color:#5b6472;">Carregando...</div>';

  const files = await api(`/api/indexed-files${linkMode ? '?unlinked=1' : ''}`);
  container.innerHTML = files.length
    ? ''
    : '<div style="font-size:12px;color:#5b6472;">Nenhum arquivo encontrado na pasta monitorada.</div>';

  files.forEach((f) => {
    const row = document.createElement('div');
    row.className = 'file-item';
    const sizeKb = f.size ? `${Math.round(f.size / 1024)} KB` : '';
    row.innerHTML = `
      <span>📄 ${escapeHtml(f.relative_path)} <em style="color:#5b6472;">${sizeKb}</em>
        ${f.linked_task_id ? '<em style="color:#16a34a;"> · vinculado</em>' : ''}
      </span>
    `;

    const btn = document.createElement('button');
    if (linkMode) {
      btn.textContent = 'Vincular';
      btn.addEventListener('click', async () => {
        try {
          await api(`/api/indexed-files/${f.id}/link`, {
            method: 'POST',
            body: JSON.stringify({ task_id: openTaskId }),
          });
          serverFilesModal.classList.add('hidden');
          loadFiles(openTaskId);
          loadTasks();
        } catch (err) {
          alert(err.message);
        }
      });
    } else {
      btn.textContent = f.linked_task_id ? 'Desvincular' : '—';
      btn.disabled = !f.linked_task_id;
      btn.addEventListener('click', async () => {
        await api(`/api/indexed-files/${f.id}/unlink`, { method: 'POST' });
        renderServerFiles({ linkMode });
        loadTasks();
      });
    }
    row.appendChild(btn);
    container.appendChild(row);
  });
}

// ---------- Modo escuro ----------
function updateDarkModeIcon() {
  const isDark = document.documentElement.classList.contains('dark-mode');
  document.getElementById('darkModeToggle').textContent = isDark ? '☀️' : '🌙';
}
document.getElementById('darkModeToggle').addEventListener('click', () => {
  const isDark = document.documentElement.classList.toggle('dark-mode');
  localStorage.setItem('darkMode', isDark ? '1' : '0');
  updateDarkModeIcon();
});
updateDarkModeIcon();

// ---------- Troca de view (Quadro / Controle de Empresas) ----------
document.querySelectorAll('.view-tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.view-tab').forEach((t) => t.classList.remove('active'));
    tab.classList.add('active');
    const view = tab.dataset.view;
    document.getElementById('pageTitle').textContent = tab.textContent.trim().replace(/^\S+\s/, '');
    document.getElementById('boardView').classList.toggle('hidden', view !== 'board');
    document.getElementById('companiesView').classList.toggle('hidden', view !== 'companies');
    document.getElementById('directoriesView').classList.toggle('hidden', view !== 'directories');
    if (view === 'companies' && typeof loadCompanies === 'function') {
      loadCompanies().catch((err) => {
        console.error(err);
        document.getElementById('summaryCards').innerHTML = '';
        document.getElementById('companiesTableBody').innerHTML =
          `<tr><td colspan="10" style="text-align:center;color:var(--red);padding:20px;">
             Não foi possível carregar as empresas: ${escapeHtml(err.message)}<br>
             <span style="font-size:11.5px;color:var(--gray-text);">
               Dica: pare o servidor (Ctrl+C) e rode <code>iniciar-teste.bat</code> de novo — o Node não recarrega
               sozinho quando os arquivos do projeto são atualizados.
             </span>
           </td></tr>`;
      });
    }
    if (view === 'directories' && typeof loadDirectory === 'function') {
      loadDirectory('');
    }
  });
});

// ---------- Inicialização ----------
(async function init() {
  try {
    await loadUsers();
    await loadCompanyFilter();
    await loadTasks();
  } catch (err) {
    console.error(err);
  }
})();
