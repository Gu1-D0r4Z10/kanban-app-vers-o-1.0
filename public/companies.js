// Módulo "Controle de Empresas" — reaproveita a função api() e o token/user
// já definidos em app.js (este arquivo é carregado logo depois dele).

const STATUS_META = {
  '-1': { label: 'Atrasado', className: 'st-atrasado' },
  '0': { label: 'Entregue', className: 'st-entregue' },
  '1': { label: 'Em Andamento', className: 'st-andamento' },
  'null': { label: 'Sem status', className: 'st-sem' },
};

let companiesCache = [];
let companiesFiltersLoaded = false;
let editingCompanyId = null;

function statusMeta(statusCode) {
  const key = statusCode === null || statusCode === undefined ? 'null' : String(statusCode);
  return STATUS_META[key] || STATUS_META['null'];
}

function formatDateBR(iso) {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso || '—';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

function deadlineBadge(company) {
  if (!company.data_limite) return '';
  const map = {
    overdue: '<span class="tag alta">Atrasado</span>',
    today: '<span class="tag media">Vence hoje</span>',
    soon: '<span class="tag media">Vence em breve</span>',
  };
  return map[company.deadline_state] || '';
}

// ---------- Painel resumo ----------
async function loadCompanySummary() {
  const summary = await api('/api/companies/summary');
  const cards = [
    { label: 'Total de empresas', value: summary.total, className: '' },
    { label: 'Entregue', value: summary.entregue, className: 'sc-green' },
    { label: 'Em andamento', value: summary.em_andamento, className: 'sc-blue' },
    { label: 'Atrasado', value: summary.atrasado, className: 'sc-red' },
    { label: 'Vencendo hoje', value: summary.due_today, className: 'sc-amber' },
    { label: 'Vencendo em breve', value: summary.due_soon, className: 'sc-amber' },
  ];

  document.getElementById('summaryCards').innerHTML = cards
    .map((c) => `
      <div class="summary-card ${c.className}">
        <div class="summary-value">${c.value}</div>
        <div class="summary-label">${c.label}</div>
      </div>
    `)
    .join('');

  if (!companiesFiltersLoaded) {
    const estadoSel = document.getElementById('filterEstado');
    const tribSel = document.getElementById('filterTributacao');
    const userSel = document.getElementById('filterUsuario');
    const newCompUserSel = document.getElementById('newCompUsuario');
    summary.filtros.estados.forEach((e) => (estadoSel.innerHTML += `<option value="${e}">${e}</option>`));
    summary.filtros.tributacoes.forEach((t) => (tribSel.innerHTML += `<option value="${t}">${t}</option>`));
    summary.filtros.usuarios.forEach((u) => {
      userSel.innerHTML += `<option value="${u}">${u}</option>`;
      newCompUserSel.innerHTML += `<option value="${u}">${u}</option>`;
    });
    companiesFiltersLoaded = true;
  }
}

// ---------- Nova empresa ----------
const newCompanyModal = document.getElementById('newCompanyModal');
let taxRegimesCache = [];

async function loadTaxRegimesIntoSelect() {
  const select = document.getElementById('newCompTributacao');
  try {
    taxRegimesCache = await api('/api/tax-regimes');
  } catch (err) {
    taxRegimesCache = [];
  }
  select.innerHTML = '<option value="">Selecione...</option>' +
    taxRegimesCache.map((r) => `<option value="${escapeAttr(r)}">${escapeHtml(r)}</option>`).join('') +
    '<option value="__novo__">+ Novo regime...</option>';
}

document.getElementById('newCompanyBtn').addEventListener('click', async () => {
  document.getElementById('newCompanyForm').reset();
  await loadTaxRegimesIntoSelect();
  newCompanyModal.classList.remove('hidden');
});

document.getElementById('newCompTributacao').addEventListener('change', async (e) => {
  if (e.target.value !== '__novo__') return;
  const novo = prompt('Nome do novo regime tributário:');
  if (!novo || !novo.trim()) {
    e.target.value = '';
    return;
  }
  try {
    await api('/api/tax-regimes', { method: 'POST', body: JSON.stringify({ nome: novo.trim() }) });
    await loadTaxRegimesIntoSelect();
    e.target.value = novo.trim();
  } catch (err) {
    alert(err.message);
    e.target.value = '';
  }
});

document.getElementById('cancelNewCompanyBtn').addEventListener('click', () => {
  newCompanyModal.classList.add('hidden');
});

document.getElementById('newCompanyForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const payload = {
    razao_social: document.getElementById('newCompRazaoSocial').value.trim(),
    cnpj: document.getElementById('newCompCnpj').value.trim() || null,
    tributacao: document.getElementById('newCompTributacao').value || null,
    municipio: document.getElementById('newCompMunicipio').value.trim() || null,
    estado: document.getElementById('newCompEstado').value.trim().toUpperCase() || null,
    usuario: document.getElementById('newCompUsuario').value || null,
    data_limite: document.getElementById('newCompDataLimite').value || null,
    procuracoes: document.getElementById('newCompProcuracoes').value.trim() || null,
  };

  try {
    await api('/api/companies', { method: 'POST', body: JSON.stringify(payload) });
    newCompanyModal.classList.add('hidden');
    loadCompanies();
  } catch (err) {
    alert(err.message);
  }
});

// ---------- Lista/tabela ----------
async function loadCompanies({ preserveScroll = false } = {}) {
  const errorBanner = document.getElementById('companiesError');
  errorBanner.classList.add('hidden');
  errorBanner.textContent = '';

  const scrollY = preserveScroll ? window.scrollY : null;

  const params = new URLSearchParams();
  const q = document.getElementById('companySearch').value.trim();
  const status = document.getElementById('filterStatus').value;
  const estado = document.getElementById('filterEstado').value;
  const tributacao = document.getElementById('filterTributacao').value;
  const usuario = document.getElementById('filterUsuario').value;

  if (q) params.set('q', q);
  if (status) params.set('status', status);
  if (estado) params.set('estado', estado);
  if (tributacao) params.set('tributacao', tributacao);
  if (usuario) params.set('usuario', usuario);

  try {
    companiesCache = await api(`/api/companies?${params.toString()}`);
    renderCompaniesTable();
    await loadCompanySummary();
    document.getElementById('companyCount').textContent = `${companiesCache.length} empresa(s)`;
  } catch (err) {
    errorBanner.textContent = `Não foi possível carregar o Controle de Empresas: ${err.message}`;
    errorBanner.classList.remove('hidden');
    document.getElementById('companiesTableBody').innerHTML = '';
    document.getElementById('companyCount').textContent = '';
  }

  if (preserveScroll && scrollY !== null) window.scrollTo(0, scrollY);
}

function renderCompaniesTable() {
  const tbody = document.getElementById('companiesTableBody');
  tbody.innerHTML = '';

  if (companiesCache.length === 0) {
    tbody.innerHTML = '<tr><td colspan="10" style="text-align:center;color:var(--gray-text);padding:20px;">Nenhuma empresa encontrada. Se a lista está vazia, rode <code>npm run import-empresas</code> no servidor para importar sua planilha.</td></tr>';
    return;
  }

  companiesCache.forEach((c) => {
    const tr = document.createElement('tr');
    tr.dataset.id = c.id;
    const isEditing = editingCompanyId === c.id;
    const meta = statusMeta(c.status_code);

    if (isEditing) {
      tr.innerHTML = `
        <td>${c.codigo ?? '—'}</td>
        <td>${escapeHtml(c.razao_social)}</td>
        <td>${escapeHtml(c.cnpj || '—')}</td>
        <td>${escapeHtml(c.tributacao || '—')}</td>
        <td>${escapeHtml(c.estado || '—')}</td>
        <td><input type="text" class="edit-usuario" value="${escapeAttr(c.usuario || '')}" /></td>
        <td><input type="date" class="edit-data-limite" value="${c.data_limite && /^\d{4}-\d{2}-\d{2}$/.test(c.data_limite) ? c.data_limite : ''}" /></td>
        <td>
          <select class="edit-status">
            <option value="1" ${c.status_code === 1 ? 'selected' : ''}>Em Andamento</option>
            <option value="0" ${c.status_code === 0 ? 'selected' : ''}>Entregue</option>
            <option value="-1" ${c.status_code === -1 ? 'selected' : ''}>Atrasado</option>
            <option value="" ${c.status_code === null ? 'selected' : ''}>Sem status</option>
          </select>
        </td>
        <td><input type="text" class="edit-procuracoes" value="${escapeAttr(c.procuracoes || '')}" /></td>
        <td>
          <button data-action="save" style="color:var(--green);background:transparent;">Salvar</button>
          <button data-action="cancel" style="color:var(--gray-text);background:transparent;">Cancelar</button>
        </td>
      `;
      tr.querySelector('[data-action="save"]').addEventListener('click', () => saveCompanyEdit(c.id));
      tr.querySelector('[data-action="cancel"]').addEventListener('click', () => {
        editingCompanyId = null;
        renderCompaniesTable();
      });
    } else {
      tr.innerHTML = `
        <td>${c.codigo ?? '—'}</td>
        <td>${escapeHtml(c.razao_social)}</td>
        <td>${escapeHtml(c.cnpj || '—')}</td>
        <td>${escapeHtml(c.tributacao || '—')}</td>
        <td>${escapeHtml(c.estado || '—')}</td>
        <td>${escapeHtml(c.usuario || '—')}</td>
        <td>${formatDateBR(c.data_limite)} ${deadlineBadge(c)}</td>
        <td><span class="status-pill ${meta.className}">${escapeHtml(c.acompanhamento || meta.label)}</span></td>
        <td>${escapeHtml(c.procuracoes || '—')}</td>
        <td>
          <button data-action="ficha" style="color:var(--navy);background:transparent;">📋 Ficha</button>
          <button data-action="edit" style="color:var(--blue);background:transparent;">Editar</button>
        </td>
      `;
      tr.querySelector('[data-action="ficha"]').addEventListener('click', () => openFicha(c.id));
      tr.querySelector('[data-action="edit"]').addEventListener('click', () => {
        editingCompanyId = c.id;
        renderCompaniesTable();
      });
    }

    tbody.appendChild(tr);
  });
}

async function saveCompanyEdit(id) {
  const row = document.querySelector(`#companiesTableBody tr[data-id="${id}"]`);
  const statusVal = row.querySelector('.edit-status').value;

  const payload = {
    usuario: row.querySelector('.edit-usuario').value || null,
    data_limite: row.querySelector('.edit-data-limite').value || null,
    status_code: statusVal === '' ? null : Number(statusVal),
    procuracoes: row.querySelector('.edit-procuracoes').value || null,
  };

  try {
    await api(`/api/companies/${id}`, { method: 'PATCH', body: JSON.stringify(payload) });
    editingCompanyId = null;
    loadCompanies({ preserveScroll: true });
  } catch (err) {
    alert(err.message);
  }
}

function escapeAttr(str) {
  return String(str).replace(/"/g, '&quot;');
}

// ---------- Ficha completa da empresa ----------
const OBLIGATION_VALUE_CLASS = {
  OK: 'val-ok',
  'N/A': 'val-na',
  'S/M': 'val-sm',
};

const INSTALLMENT_FLAG_CATALOG = {
  ativo: ['Simples Nacional', 'RELP SN', 'PERT SN', 'Não Previdenciário', 'Previdenciário', 'Demais Débitos', 'DCTF-Web', 'PGFN', 'PMSP', 'Dívida Ativa Mun', 'Parcelamento P.P.I', 'Estadual'],
  encerrado: ['Simples Nacional', 'RELP SN', 'PERT SN', 'Não Previdenciário', 'Previdenciário', 'DCTF-Web', 'PGFN', 'PMSP', 'Dívida Ativa Mun', 'Parcelamento P.P.I', 'Estadual'],
};

function obligationValueBadge(value) {
  if (!value) return '<span class="obl-val val-empty">—</span>';
  const cls = OBLIGATION_VALUE_CLASS[value] || 'val-other';
  return `<span class="obl-val ${cls}">${escapeHtml(value)}</span>`;
}

let currentFichaCompanyId = null;
let currentFichaData = null;
let fichaEditingSection = null; // null | 'municipal' | 'estadual' | 'federal' | 'anual' | 'ativo' | 'encerrado'

async function openFicha(companyId) {
  const modal = document.getElementById('fichaModal');
  const content = document.getElementById('fichaContent');
  content.innerHTML = '<p style="color:var(--gray-text);">Carregando ficha...</p>';
  modal.classList.remove('hidden');
  currentFichaCompanyId = companyId;
  fichaEditingSection = null;

  await reloadFicha();
}

async function reloadFicha() {
  const content = document.getElementById('fichaContent');
  try {
    currentFichaData = await api(`/api/companies/${currentFichaCompanyId}/ficha`);
    content.innerHTML = renderFicha(currentFichaData);
    attachFichaHandlers();
  } catch (err) {
    content.innerHTML = `<p style="color:var(--red);">Não foi possível carregar a ficha: ${escapeHtml(err.message)}</p>`;
  }
}

document.getElementById('closeFichaBtn').addEventListener('click', () => {
  document.getElementById('fichaModal').classList.add('hidden');
});

function renderFicha(data) {
  const c = data.company;
  const meta = statusMeta(c.status_code);

  const deleteBtn = currentUser.role === 'admin'
    ? `<button data-action="delete-company" style="color:var(--red);background:transparent;font-size:12px;margin-top:6px;">🗑 Excluir empresa</button>`
    : '';

  const header = `
    <div class="ficha-header">
      <div>
        <h2 style="margin:0;">${escapeHtml(c.razao_social)}</h2>
        <p style="margin:4px 0 0;color:var(--gray-text);font-size:13px;">
          Código ${c.codigo ?? '—'} · CNPJ ${escapeHtml(c.cnpj || '—')} · ${escapeHtml(c.tributacao || '—')}
          ${c.municipio ? ` · ${escapeHtml(c.municipio)}/${escapeHtml(c.estado || '')}` : ''}
        </p>
        ${deleteBtn}
      </div>
      <span class="status-pill ${meta.className}" style="font-size:13px;">${escapeHtml(c.acompanhamento || meta.label)}</span>
    </div>
    <div class="ficha-grid-basic">
      <div><span class="ficha-label">Responsável</span><span>${escapeHtml(c.usuario || '—')}</span></div>
      <div><span class="ficha-label">Prazo atual</span><span>${formatDateBR(c.data_limite)} ${deadlineBadge(c)}</span></div>
      <div><span class="ficha-label">Procurações</span><span>${escapeHtml(c.procuracoes || '—')}</span></div>
      <div><span class="ficha-label">Envio de documentos</span><span>${escapeHtml(c.envio_documentos || '—')}</span></div>
      <div><span class="ficha-label">Partes relacionadas</span><span>${escapeHtml(c.partes_relacionadas || '—')}</span></div>
      <div><span class="ficha-label">Eventos</span><span>${escapeHtml(c.eventos || '—')}</span></div>
    </div>
  `;

  const obligationsHtml = data.obligations.map((group) => renderObligationSection(group)).join('');

  const installmentsHtml =
    renderInstallmentSection('ativo', '💳 Parcelamento Ativo', data.installments.ativo) +
    renderInstallmentSection('encerrado', '📁 Parcelamento Encerrado', data.installments.encerrado);

  return header + obligationsHtml + installmentsHtml;
}

function renderObligationSection(group) {
  const isEditing = fichaEditingSection === group.tipo;

  if (isEditing) {
    const rows = group.itens
      .map((item, i) => `
        <div class="obl-row">
          <span class="obl-label">${escapeHtml(item.label)}</span>
          <input type="text" class="obl-edit-input" data-idx="${i}" value="${escapeAttr(item.value || '')}" style="width:110px;" placeholder="OK / N/A / S/M" />
        </div>
      `)
      .join('');
    return `
      <div class="ficha-section" data-tipo="${group.tipo}">
        <h3>${escapeHtml(group.titulo)}</h3>
        <div class="obl-grid">${rows}</div>
        <div class="modal-actions" style="margin-top:10px;">
          <button type="button" data-action="cancel-obligation" style="color:var(--gray-text);background:transparent;font-size:12.5px;">Cancelar</button>
          <button type="button" data-action="save-obligation" data-tipo="${group.tipo}" style="color:var(--green);background:transparent;font-size:12.5px;">Salvar</button>
        </div>
      </div>
    `;
  }

  const rows = group.itens.length
    ? group.itens.map((item) => `
        <div class="obl-row">
          <span class="obl-label">${escapeHtml(item.label)}</span>
          ${obligationValueBadge(item.value)}
        </div>
      `).join('')
    : '<p style="color:var(--gray-text);font-size:12.5px;">Nenhum item cadastrado ainda.</p>';

  return `
    <div class="ficha-section" data-tipo="${group.tipo}">
      <h3>${escapeHtml(group.titulo)}
        <button type="button" data-action="edit-obligation" data-tipo="${group.tipo}" style="color:var(--blue);background:transparent;font-size:11.5px;font-weight:400;">Editar</button>
      </h3>
      <div class="obl-grid">${rows}</div>
    </div>
  `;
}

function renderInstallmentSection(tipo, label, plan) {
  const isEditing = fichaEditingSection === tipo;
  const catalog = INSTALLMENT_FLAG_CATALOG[tipo];
  const activeLabels = new Set((plan?.flags || []).map((f) => f.label));

  if (isEditing) {
    const checkboxes = catalog
      .map((flagLabel) => `
        <label style="display:inline-flex;align-items:center;gap:4px;margin:2px 10px 2px 0;font-size:12px;font-weight:400;">
          <input type="checkbox" class="inst-flag" value="${escapeAttr(flagLabel)}" ${activeLabels.has(flagLabel) ? 'checked' : ''} />
          ${escapeHtml(flagLabel)}
        </label>
      `)
      .join('');

    return `
      <div class="ficha-section" data-tipo="${tipo}">
        <h3>${label}</h3>
        <div class="row">
          <div><label style="font-size:11px;">Situação</label><input type="text" class="inst-situacao" value="${escapeAttr(plan?.situacao || '')}" /></div>
          <div><label style="font-size:11px;">Responsável</label><input type="text" class="inst-usuario" value="${escapeAttr(plan?.usuario || '')}" /></div>
        </div>
        <label style="font-size:11px;">Forma de envio</label>
        <input type="text" class="inst-forma-envio" value="${escapeAttr(plan?.forma_envio || '')}" />
        <label style="font-size:11px;margin-top:8px;display:block;">Tipos de parcelamento</label>
        <div style="margin:4px 0;">${checkboxes}</div>
        <label style="font-size:11px;">Observações</label>
        <textarea class="inst-observacoes" rows="2" style="width:100%;font-family:inherit;font-size:12.5px;padding:6px;border:1px solid var(--gray-border);border-radius:6px;">${escapeHtml(plan?.observacoes || '')}</textarea>
        <div class="modal-actions" style="margin-top:10px;">
          <button type="button" data-action="cancel-obligation" style="color:var(--gray-text);background:transparent;font-size:12.5px;">Cancelar</button>
          <button type="button" data-action="save-installment" data-tipo="${tipo}" style="color:var(--green);background:transparent;font-size:12.5px;">Salvar</button>
        </div>
      </div>
    `;
  }

  const flagsHtml = plan && plan.flags.length
    ? plan.flags.map((f) => `<span class="tag media" style="margin:2px 4px 2px 0;">${escapeHtml(f.label)}</span>`).join('')
    : '<span style="color:var(--gray-text);font-size:12.5px;">Nenhum tipo marcado.</span>';

  return `
    <div class="ficha-section" data-tipo="${tipo}">
      <h3>${label} ${plan && plan.situacao ? `<span class="status-pill st-entregue" style="font-size:11px;">${escapeHtml(plan.situacao)}</span>` : ''}
        <button type="button" data-action="edit-installment" data-tipo="${tipo}" style="color:var(--blue);background:transparent;font-size:11.5px;font-weight:400;">Editar</button>
      </h3>
      ${plan ? `
        <div class="obl-row"><span class="obl-label">Responsável</span><span>${escapeHtml(plan.usuario || '—')}</span></div>
        <div class="obl-row"><span class="obl-label">Forma de envio</span><span>${escapeHtml(plan.forma_envio || '—')}</span></div>
        <div style="margin:8px 0;">${flagsHtml}</div>
        ${plan.observacoes ? `<p style="font-size:12.5px;background:var(--code-bg);padding:8px 10px;border-radius:6px;margin:6px 0 0;">${escapeHtml(plan.observacoes)}</p>` : ''}
      ` : '<p style="color:var(--gray-text);font-size:12.5px;">Nenhum registro encontrado.</p>'}
    </div>
  `;
}

function attachFichaHandlers() {
  const content = document.getElementById('fichaContent');

  content.querySelectorAll('[data-action="edit-obligation"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      fichaEditingSection = btn.dataset.tipo;
      content.innerHTML = renderFicha(currentFichaData);
      attachFichaHandlers();
    });
  });

  content.querySelectorAll('[data-action="edit-installment"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      fichaEditingSection = btn.dataset.tipo;
      content.innerHTML = renderFicha(currentFichaData);
      attachFichaHandlers();
    });
  });

  content.querySelectorAll('[data-action="cancel-obligation"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      fichaEditingSection = null;
      content.innerHTML = renderFicha(currentFichaData);
      attachFichaHandlers();
    });
  });

  content.querySelectorAll('[data-action="save-obligation"]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const tipo = btn.dataset.tipo;
      const section = content.querySelector(`.ficha-section[data-tipo="${tipo}"]`);
      const group = currentFichaData.obligations.find((g) => g.tipo === tipo);
      const inputs = section.querySelectorAll('.obl-edit-input');
      const itens = group.itens.map((item, i) => ({ label: item.label, value: inputs[i].value.trim() || null }));

      try {
        await api(`/api/companies/${currentFichaCompanyId}/obligations/${tipo}`, {
          method: 'PATCH',
          body: JSON.stringify({ itens }),
        });
        fichaEditingSection = null;
        await reloadFicha();
        loadCompanies({ preserveScroll: true });
      } catch (err) {
        alert(err.message);
      }
    });
  });

  content.querySelectorAll('[data-action="save-installment"]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const tipo = btn.dataset.tipo;
      const section = content.querySelector(`.ficha-section[data-tipo="${tipo}"]`);
      const flags = Array.from(section.querySelectorAll('.inst-flag'))
        .filter((cb) => cb.checked)
        .map((cb) => ({ label: cb.value, active: true }));

      const payload = {
        situacao: section.querySelector('.inst-situacao').value.trim() || null,
        usuario: section.querySelector('.inst-usuario').value.trim() || null,
        forma_envio: section.querySelector('.inst-forma-envio').value.trim() || null,
        observacoes: section.querySelector('.inst-observacoes').value.trim() || null,
        flags,
      };

      try {
        await api(`/api/companies/${currentFichaCompanyId}/installments/${tipo}`, {
          method: 'PATCH',
          body: JSON.stringify(payload),
        });
        fichaEditingSection = null;
        await reloadFicha();
      } catch (err) {
        alert(err.message);
      }
    });
  });

  const deleteBtn = content.querySelector('[data-action="delete-company"]');
  if (deleteBtn) {
    deleteBtn.addEventListener('click', async () => {
      if (!confirm(`Excluir "${currentFichaData.company.razao_social}" e todos os seus dados (obrigações, parcelamentos)? Essa ação não pode ser desfeita.`)) return;
      try {
        await api(`/api/companies/${currentFichaCompanyId}`, { method: 'DELETE' });
        document.getElementById('fichaModal').classList.add('hidden');
        loadCompanies();
      } catch (err) {
        alert(err.message);
      }
    });
  }
}
let searchDebounce = null;
document.getElementById('companySearch').addEventListener('input', () => {
  clearTimeout(searchDebounce);
  searchDebounce = setTimeout(loadCompanies, 300);
});
['filterStatus', 'filterEstado', 'filterTributacao', 'filterUsuario'].forEach((id) => {
  document.getElementById(id).addEventListener('change', () => loadCompanies());
});
document.getElementById('clearCompanyFilters').addEventListener('click', () => {
  document.getElementById('companySearch').value = '';
  document.getElementById('filterStatus').value = '';
  document.getElementById('filterEstado').value = '';
  document.getElementById('filterTributacao').value = '';
  document.getElementById('filterUsuario').value = '';
  loadCompanies();
});

// ---------- Importar planilha direto pela tela ----------
if (currentUser.role !== 'admin') {
  document.getElementById('importToolbar').classList.add('hidden');
}

document.getElementById('importBtn').addEventListener('click', async () => {
  const input = document.getElementById('importFileInput');
  const statusEl = document.getElementById('importStatus');

  if (!input.files[0]) {
    statusEl.textContent = 'Escolha um arquivo .xlsx primeiro.';
    statusEl.style.color = 'var(--red)';
    return;
  }

  statusEl.textContent = 'Importando...';
  statusEl.style.color = 'var(--gray-text)';

  const formData = new FormData();
  formData.append('file', input.files[0]);

  try {
    const result = await api('/api/companies/import', { method: 'POST', body: formData });
    statusEl.textContent = `✔ ${result.imported} empresa(s) nova(s) importada(s)${result.already_existing ? ` · ${result.already_existing} já existiam e foram mantidas como estão` : ''}.`;
    statusEl.style.color = 'var(--green)';
    input.value = '';
    loadCompanies();
  } catch (err) {
    statusEl.textContent = `Erro: ${err.message}`;
    statusEl.style.color = 'var(--red)';
  }
});

// ---------- Criar responsáveis e tarefas a partir da planilha ----------
document.getElementById('importUsersTasksBtn').addEventListener('click', async () => {
  const confirmMsg =
    'Isso vai:\n\n' +
    '• Criar uma conta para cada responsável da planilha que ainda não existir no sistema\n' +
    '• Criar uma tarefa por empresa, vinculada ao responsável, prazo e status originais da planilha\n' +
    '• Não duplica nada em execuções futuras\n\n' +
    'Usa o arquivo escolhido no campo de importação acima, ou a planilha padrão do servidor se nenhum for escolhido. Continuar?';
  if (!confirm(confirmMsg)) return;

  const input = document.getElementById('importFileInput');
  const statusEl = document.getElementById('importStatus');
  statusEl.textContent = 'Criando responsáveis e tarefas...';
  statusEl.style.color = 'var(--gray-text)';

  const formData = new FormData();
  if (input.files[0]) formData.append('file', input.files[0]);

  try {
    const result = await api('/api/companies/import-users-tasks', { method: 'POST', body: formData });
    statusEl.textContent =
      `✔ ${result.users_created.length} responsável(is) criado(s), ${result.tasks_created} tarefa(s) criada(s) ` +
      `(${result.tasks_skipped_already_imported} já existiam, ${result.tasks_skipped_no_responsavel} sem responsável na planilha).`;
    statusEl.style.color = 'var(--green)';

    if (result.users_created.length > 0) {
      showNewUsersCredentials(result.users_created);
    }
    loadCompanies();
    if (typeof loadTasks === 'function') loadTasks();
    if (typeof loadCompanyFilter === 'function') loadCompanyFilter();
  } catch (err) {
    statusEl.textContent = `Erro: ${err.message}`;
    statusEl.style.color = 'var(--red)';
  }
});

function showNewUsersCredentials(users) {
  const rows = users
    .map((u) => `${escapeHtml(u.name)} — ${escapeHtml(u.email)} — senha temporária: ${escapeHtml(u.tempPassword)}`)
    .join('\n');
  alert(
    `${users.length} conta(s) nova(s) criada(s). Anote e repasse para cada responsável ` +
    `(essa senha só aparece agora, e recomendamos que cada um troque no primeiro acesso):\n\n${rows}`
  );
}
