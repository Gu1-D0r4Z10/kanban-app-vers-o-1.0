// Padronização de pastas por empresa: monta o nome da pasta no formato
// "codigo-razao_social-filial" e cria a estrutura de subpastas (fiscal,
// contábil, mensal, anual) dentro da pasta monitorada do servidor.

const fs = require('fs');
const path = require('path');

const MESES = [
  '01_JANEIRO', '02_FEVEREIRO', '03_MARCO', '04_ABRIL', '05_MAIO', '06_JUNHO',
  '07_JULHO', '08_AGOSTO', '09_SETEMBRO', '10_OUTUBRO', '11_NOVEMBRO', '12_DEZEMBRO',
];

// Remove acentos, deixa minúsculo, troca tudo que não é letra/número por "_"
function slugify(text) {
  return String(text || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

// Monta o nome padronizado da pasta: 123 - empresa_exemplo_ltda (- 0002)
// (espaços ao redor dos traços deixam o nome mais limpo de ler)
function clientFolderName(company, filial) {
  const base = `${company.codigo} - ${slugify(company.razao_social)}`;
  if (!filial) return base;
  const filialStr = String(filial).trim();
  const filialFmt = /^\d+$/.test(filialStr) ? filialStr.padStart(4, '0') : slugify(filialStr);
  return `${base} - ${filialFmt}`;
}

// Cria (com segurança — mkdir recursivo, sem apagar nada existente) toda a
// estrutura de pastas de uma empresa para um ano, a partir de um modelo.
function createClientFolders({ watchedFolder, company, ano, filial, template }) {
  const clientDir = clientFolderName(company, filial);
  const root = path.join(watchedFolder, clientDir, String(ano));

  const created = [];

  for (const setor of template.setores || []) {
    for (const categoria of setor.mensal || []) {
      for (const mes of MESES) {
        const dir = path.join(root, setor.nome, setor.mensal_dir || '01_MENSAL', categoria, mes);
        fs.mkdirSync(dir, { recursive: true });
        created.push(dir);
      }
    }
    for (const item of setor.anual || []) {
      const dir = path.join(root, setor.nome, setor.anual_dir || '02_ANUAL', item);
      fs.mkdirSync(dir, { recursive: true });
      created.push(dir);
    }
  }

  for (const extra of template.extras || []) {
    const dir = path.join(root, extra);
    fs.mkdirSync(dir, { recursive: true });
    created.push(dir);
  }

  return { clientDir, root, foldersCreated: created.length };
}

// Tenta identificar a qual empresa uma pasta de nível raiz pertence,
// olhando o código no início do nome — aceita tanto "123 - empresa" (novo
// padrão) quanto "123-empresa" (pastas criadas antes do ajuste de espaços).
function extractCodigoFromFolderName(folderName) {
  const match = String(folderName).match(/^(\d+)\s*-/);
  return match ? Number(match[1]) : null;
}

module.exports = { slugify, clientFolderName, createClientFolders, extractCodigoFromFolderName, MESES };
