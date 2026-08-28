// Aba "Diretórios" — navega pela pasta monitorada do servidor, cria a
// estrutura padronizada de pastas por empresa, e permite editar o modelo.
// Reaproveita api()/token/currentUser/escapeHtml já definidos em app.js.

let currentDirPath = '';
let allCompaniesForFolders = [];

async function loadDirectory(relativePath) {
  const errorBanner = document.getElementById('directoriesError');
  errorBanner.classList.add('hidden');
  currentDirPath = relativePath || '';

  try {
    const data = await api(`/api/directories?path=${encodeURIComponent(currentDirPath)}`);
    document.getElementById('dirWatchedPath').textContent = data.watched_folder;
    renderBreadcrumb(currentDirPath);
    renderDirTable(data.items);
  } catch (err) {
    errorBanner.textContent = `Não foi possível carregar a pasta: ${err.message}`;
    errorBanner.classList.remove('hidden');
    document.getElementById('dirTableBody').innerHTML = '';
  }
}

function reloadCurrentDirectory() {
  loadDirectory(currentDirPath);
}

document.getElementById('dirRefreshBtn').addEventListener('click', () => loadDirectory(currentDirPath));

function renderBreadcrumb(relativePath) {
  const parts = relativePath ? relativePath.split('/').filter(Boolean) : [];
  const crumb = document.getElementById('dirBreadcrumb');
  crumb.innerHTML = '';

  const rootBtn = document.createElement('button');
  rootBtn.textContent = '🏠 Início';
  rootBtn.className = 'breadcrumb-btn';
  rootBtn.addEventListener('click', () => loadDirectory(''));
  crumb.appendChild(rootBtn);

  let accum = '';
  parts.forEach((part) => {
    accum = accum ? `${accum}/${part}` : part;
    const sep = document.createElement('span');
    sep.textContent = ' / ';
    sep.style.color = 'var(--gray-text)';
    crumb.appendChild(sep);

    const btn = document.createElement('button');
    btn.textContent = part;
    btn.className = 'breadcrumb-btn';
    const target = accum;
    btn.addEventListener('click', () => loadDirectory(target));
    crumb.appendChild(btn);
  });
}

function formatBytes(bytes) {
  if (bytes === null || bytes === undefined) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function renderDirTable(items) {
  const tbody = document.getElementById('dirTableBody');
  tbody.innerHTML = '';

  if (items.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--gray-text);padding:20px;">Pasta vazia.</td></tr>';
    return;
  }

  items.forEach((item) => {
    const tr = document.createElement('tr');
    const icon = item.type === 'dir' ? '📁' : '📄';
    const modified = item.mtime ? new Date(item.mtime).toLocaleDateString('pt-BR') : '—';

    let companyCell = '—';
    if (item.type === 'dir' && item.company) {
      companyCell = `<span style="color:var(--green);">✔ ${escapeHtml(item.company.razao_social)}</span>`;
    } else if (item.type === 'dir' && item.unmatched) {
      companyCell = `<span style="color:var(--amber);" title="Nome começa com um código que não bate com nenhuma empresa cadastrada">⚠ não vinculada</span>`;
    }

    tr.innerHTML = `
      <td>${icon}</td>
      <td>${item.type === 'dir' ? `<button data-action="open" style="color:var(--navy);background:transparent;font-weight:600;">${escapeHtml(item.name)}</button>` : escapeHtml(item.name)}</td>
      <td>${companyCell}</td>
      <td>${item.type === 'file' ? formatBytes(item.size) : ''}</td>
      <td>${modified}</td>
    `;

    if (item.type === 'dir') {
      tr.querySelector('[data-action="open"]').addEventListener('click', () => {
        loadDirectory(currentDirPath ? `${currentDirPath}/${item.name}` : item.name);
      });
    } else {
      tr.style.cursor = 'pointer';
      tr.addEventListener('click', () => {
        const filePath = currentDirPath ? `${currentDirPath}/${item.name}` : item.name;
        window.open(`/api/directories/download?path=${encodeURIComponent(filePath)}&token=${token}`, '_blank');
      });
    }

    tbody.appendChild(tr);
  });
}

// ---------- Criar pasta de cliente ----------
const createFolderModal = document.getElementById('createFolderModal');

document.getElementById('dirCreateFolderBtn').addEventListener('click', async () => {
  const select = document.getElementById('cfCompanySelect');
  if (allCompaniesForFolders.length === 0) {
    try {
      allCompaniesForFolders = await api('/api/companies');
    } catch (err) {
      alert('Não foi possível carregar a lista de empresas: ' + err.message);
      return;
    }
  }
  select.innerHTML = allCompaniesForFolders
    .map((c) => `<option value="${c.id}" data-codigo="${c.codigo}" data-razao="${escapeAttrLocal(c.razao_social)}">${c.codigo} — ${escapeHtml(c.razao_social)}</option>`)
    .join('');
  document.getElementById('cfAno').value = new Date().getFullYear();
  document.getElementById('cfFilial').value = '';
  updateFolderPreview();
  createFolderModal.classList.remove('hidden');
});

function escapeAttrLocal(str) {
  return String(str).replace(/"/g, '&quot;');
}

function updateFolderPreview() {
  const select = document.getElementById('cfCompanySelect');
  const opt = select.options[select.selectedIndex];
  if (!opt) return;
  const codigo = opt.dataset.codigo;
  const razao = opt.dataset.razao || '';
  const slug = razao.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  const filial = document.getElementById('cfFilial').value.trim();
  const filialFmt = filial ? '-' + (/^\d+$/.test(filial) ? filial.padStart(4, '0') : filial) : '';
  document.getElementById('cfPreview').textContent = `${codigo}-${slug}${filialFmt}`;
}
document.getElementById('cfCompanySelect').addEventListener('change', updateFolderPreview);
document.getElementById('cfFilial').addEventListener('input', updateFolderPreview);

document.getElementById('cfCancelBtn').addEventListener('click', () => createFolderModal.classList.add('hidden'));

document.getElementById('createFolderForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const companyId = document.getElementById('cfCompanySelect').value;
  const ano = document.getElementById('cfAno').value;
  const filial = document.getElementById('cfFilial').value.trim() || null;

  try {
    const result = await api(`/api/directories/create-for-company/${companyId}`, {
      method: 'POST',
      body: JSON.stringify({ ano, filial }),
    });
    createFolderModal.classList.add('hidden');
    showToast(`📁 Estrutura criada: ${result.clientDir} (${result.foldersCreated} pastas)`);
    loadDirectory('');
  } catch (err) {
    alert(err.message);
  }
});

// ---------- Editar modelo de pastas ----------
const templateModal = document.getElementById('templateModal');
let editingTemplate = null;

document.getElementById('dirEditTemplateBtn').addEventListener('click', async () => {
  try {
    editingTemplate = await api('/api/directories/template');
    renderTemplateEditor();
    templateModal.classList.remove('hidden');
  } catch (err) {
    alert(err.message);
  }
});

document.getElementById('templateCancelBtn').addEventListener('click', () => templateModal.classList.add('hidden'));

function renderTemplateEditor() {
  const setoresEl = document.getElementById('templateSetores');
  setoresEl.innerHTML = '';

  editingTemplate.setores.forEach((setor, si) => {
    const card = document.createElement('div');
    card.className = 'ficha-section';
    card.innerHTML = `
      <div class="row">
        <div><label style="font-size:11px;">Nome do setor (pasta)</label>
          <input type="text" class="tpl-setor-nome" value="${escapeAttrLocal(setor.nome)}" data-si="${si}" />
        </div>
        <div style="flex:0;align-self:flex-end;">
          <button type="button" data-action="remove-setor" data-si="${si}" style="color:var(--red);background:transparent;font-size:12px;">Remover setor</button>
        </div>
      </div>
      <label style="font-size:11px;margin-top:8px;">Categorias mensais (uma subpasta por mês)</label>
      <div class="tpl-list" data-si="${si}" data-kind="mensal"></div>
      <button type="button" class="btn-secondary" data-action="add-item" data-si="${si}" data-kind="mensal" style="font-size:11.5px;padding:4px 10px;">+ categoria mensal</button>

      <label style="font-size:11px;margin-top:8px;display:block;">Itens anuais (uma única subpasta)</label>
      <div class="tpl-list" data-si="${si}" data-kind="anual"></div>
      <button type="button" class="btn-secondary" data-action="add-item" data-si="${si}" data-kind="anual" style="font-size:11.5px;padding:4px 10px;">+ item anual</button>
    `;
    setoresEl.appendChild(card);

    ['mensal', 'anual'].forEach((kind) => {
      const listEl = card.querySelector(`.tpl-list[data-kind="${kind}"]`);
      renderTplList(listEl, setor[kind] || [], si, kind);
    });
  });

  attachTemplateEditorHandlers();
  renderTplExtras();
}

function renderTplList(listEl, items, si, kind) {
  listEl.innerHTML = items
    .map((item, ii) => `
      <span class="tpl-chip">
        <input type="text" class="tpl-item-input" value="${escapeAttrLocal(item)}" data-si="${si}" data-kind="${kind}" data-ii="${ii}" />
        <button type="button" data-action="remove-item" data-si="${si}" data-kind="${kind}" data-ii="${ii}">✕</button>
      </span>
    `)
    .join('');
}

function renderTplExtras() {
  const extrasEl = document.getElementById('templateExtras');
  extrasEl.innerHTML = (editingTemplate.extras || [])
    .map((item, ei) => `
      <span class="tpl-chip">
        <input type="text" class="tpl-extra-input" value="${escapeAttrLocal(item)}" data-ei="${ei}" />
        <button type="button" data-action="remove-extra" data-ei="${ei}">✕</button>
      </span>
    `)
    .join('');
  extrasEl.querySelectorAll('.tpl-extra-input').forEach((input) => {
    input.addEventListener('input', (e) => {
      editingTemplate.extras[Number(e.target.dataset.ei)] = e.target.value;
    });
  });
  extrasEl.querySelectorAll('[data-action="remove-extra"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      editingTemplate.extras.splice(Number(btn.dataset.ei), 1);
      renderTplExtras();
    });
  });
}

function attachTemplateEditorHandlers() {
  const setoresEl = document.getElementById('templateSetores');

  setoresEl.querySelectorAll('.tpl-setor-nome').forEach((input) => {
    input.addEventListener('input', (e) => {
      editingTemplate.setores[Number(e.target.dataset.si)].nome = e.target.value;
    });
  });

  setoresEl.querySelectorAll('[data-action="remove-setor"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      editingTemplate.setores.splice(Number(btn.dataset.si), 1);
      renderTemplateEditor();
    });
  });

  setoresEl.querySelectorAll('.tpl-item-input').forEach((input) => {
    input.addEventListener('input', (e) => {
      const { si, kind, ii } = e.target.dataset;
      editingTemplate.setores[Number(si)][kind][Number(ii)] = e.target.value;
    });
  });

  setoresEl.querySelectorAll('[data-action="remove-item"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const { si, kind, ii } = btn.dataset;
      editingTemplate.setores[Number(si)][kind].splice(Number(ii), 1);
      renderTemplateEditor();
    });
  });

  setoresEl.querySelectorAll('[data-action="add-item"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const { si, kind } = btn.dataset;
      if (!editingTemplate.setores[Number(si)][kind]) editingTemplate.setores[Number(si)][kind] = [];
      editingTemplate.setores[Number(si)][kind].push('NOVA_PASTA');
      renderTemplateEditor();
    });
  });
}

document.getElementById('templateAddSetorBtn').addEventListener('click', () => {
  editingTemplate.setores.push({ nome: 'NOVO_SETOR', mensal_dir: '01_MENSAL', anual_dir: '02_ANUAL', mensal: [], anual: [] });
  renderTemplateEditor();
});

document.getElementById('templateAddExtraBtn').addEventListener('click', () => {
  if (!editingTemplate.extras) editingTemplate.extras = [];
  editingTemplate.extras.push('NOVA_PASTA_EXTRA');
  renderTplExtras();
});

document.getElementById('templateSaveBtn').addEventListener('click', async () => {
  try {
    await api('/api/directories/template', { method: 'PUT', body: JSON.stringify(editingTemplate) });
    templateModal.classList.add('hidden');
    showToast('✔ Modelo de pastas atualizado.');
  } catch (err) {
    alert(err.message);
  }
});
