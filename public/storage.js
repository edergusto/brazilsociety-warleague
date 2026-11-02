/**
 * storage.js
 * Módulo responsável pelo gerenciamento de buscas recentes no localStorage.
 */

import { cleanTag } from './api.js';

export const HISTORY_KEY = 'clanSearchHistory';
export const MAX_HISTORY_ITEMS = 5;
export const DEFAULT_BADGE = './assets/cw_icon.png';

/**
 * Retorna a lista de clãs buscados recentemente (máx. 5 itens).
 */
export function getSearchHistory() {
  try {
    const parsed = JSON.parse(localStorage.getItem(HISTORY_KEY));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * Salva um clã no topo do histórico de buscas recentes, sem duplicatas e limitado a 5 itens.
 */
export function saveToSearchHistory({ tag, name, badgeUrl }) {
  const normalizedTag = cleanTag(tag);
  if (!normalizedTag) return getSearchHistory();

  const history = getSearchHistory().filter(item => cleanTag(item.tag) !== normalizedTag);
  history.unshift({
    tag: normalizedTag,
    name: name || `#${normalizedTag}`,
    badgeUrl: badgeUrl || DEFAULT_BADGE,
  });

  const trimmed = history.slice(0, MAX_HISTORY_ITEMS);
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(trimmed));
  } catch {
    // Ignora falhas de quota/privacidade do navegador
  }
  return trimmed;
}
