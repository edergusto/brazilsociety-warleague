/**
 * storage.js
 * Módulo responsável pelo gerenciamento de Favoritos no localStorage.
 */

import { cleanTag } from './api.js';

export const FAVORITES_KEY = 'clanFavorites';
export const DEFAULT_BADGE = './assets/cw_icon.png';

/**
 * Retorna a lista de clãs favoritados (tag, name, badgeUrl, warLeague).
 */
export function getFavorites() {
  try {
    const parsed = JSON.parse(localStorage.getItem(FAVORITES_KEY));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * Verifica se um clã está favoritado.
 */
export function isClanFavorite(tag) {
  const normalized = cleanTag(tag);
  if (!normalized) return false;
  return getFavorites().some(f => cleanTag(f.tag) === normalized);
}

/**
 * Alterna o estado de favorito de um clã (adiciona ou remove).
 * Retorna true se agora está favoritado, false se foi removido.
 */
export function toggleFavorite({ tag, name, badgeUrl, warLeague }) {
  const normalized = cleanTag(tag);
  if (!normalized) return false;

  const favorites = getFavorites();
  const index = favorites.findIndex(f => cleanTag(f.tag) === normalized);

  if (index >= 0) {
    favorites.splice(index, 1);
    try {
      localStorage.setItem(FAVORITES_KEY, JSON.stringify(favorites));
    } catch {}
    return false;
  } else {
    favorites.unshift({
      tag: normalized,
      name: name || `#${normalized}`,
      badgeUrl: badgeUrl || DEFAULT_BADGE,
      warLeague: warLeague || null,
    });
    try {
      localStorage.setItem(FAVORITES_KEY, JSON.stringify(favorites));
    } catch {}
    return true;
  }
}
