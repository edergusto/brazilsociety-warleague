import { cleanTag, fetchClanData, searchClansByName, fetchLeagueGroup } from './api.js';
import { toggleFavorite } from './storage.js';
import {
  $,
  el,
  mk,
  DEFAULT_BADGE,
  seasonLabel,
  loadStandings,
  updateBannerLocationAndLeague,
  renderBannerInfo,
  updateBannerRating,
  updateBannerStats,
  calculateClanWarRecord,
  updateFavoriteButton,
  renderSearchResults,
  showError,
  clearError,
  setLoading,
  switchTab,
  showSearchView,
  showDashboardView,
  hideWarEventsViewAndReturnToRounds,
  switchWarEventsMode,
  exportReportToPng,
  setMobileMenu,
  toggleFavoritesAccordion,
  clearAppCache,
  closeDesktopPopovers,
  renderLeaderboard,
  renderRounds,
  renderRanking,
} from './ui.js';

let currentTag = null;
let currentClanData = null;
let currentLeagueData = null;

// ---------- Registro do Service Worker (PWA) ----------
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}

function handleReturnToSearch() {
  currentTag = null;
  currentClanData = null;
  currentLeagueData = null;
  showSearchView();
}

/**
 * Busca por Tag exata do clã (chamada diretamente ou ao selecionar um clã dos resultados)
 */
async function searchByTag(rawTag) {
  const tag = cleanTag(rawTag);
  if (!tag) return showError('Digite a tag do clã.');
  clearError();
  setLoading(true);
  if (el.searchResultsDropdown) el.searchResultsDropdown.hidden = true;

  try {
    const clan = await fetchClanData(tag);
    currentTag = tag;
    currentClanData = clan;
    const badgeSrc = clan.badgeUrls?.large || clan.badgeUrls?.medium || clan.badgeUrls?.small || DEFAULT_BADGE;

    $('clanName').textContent = clan.name;
    $('clanBadge').src = badgeSrc;
    $('clanLeague').textContent = clan.warLeague?.name || 'Sem liga';
    updateBannerLocationAndLeague(clan);
    updateBannerRating(clan.rating || null);
    renderBannerInfo(clan, clan.rating || null);
    updateFavoriteButton(tag);

    $('leaderboard').replaceChildren();
    el.roundsList.replaceChildren();
    if (el.rankingList) el.rankingList.replaceChildren();
    $('seasonTitle').textContent = '';
    $('roundInfo').textContent = '';

    updateBannerStats(0, 0, 0, 0, 0, 0);
    showDashboardView();

    const mainEl = $('main');
    if (mainEl) mainEl.scrollTop = 0;
    window.scrollTo({ top: 0, behavior: 'smooth' });

    try {
      const group = await fetchLeagueGroup(tag);
      $('seasonTitle').textContent = seasonLabel(group.season);
      $('roundInfo').textContent = 'Carregando partidas…';

      const leagueData = await loadStandings(group, currentTag);
      currentLeagueData = leagueData;

      $('roundInfo').textContent = `Partida atual: ${leagueData.round}/${leagueData.totalRounds}`;

      const myStats = leagueData.statsByTag['#' + tag];
      const record = calculateClanWarRecord(leagueData.myRoundsHistory, tag);
      const wins = myStats?.wins ?? record.wins;
      const losses = myStats?.losses ?? record.losses;
      const ties = myStats?.ties ?? record.ties;

      if (myStats) {
        updateBannerStats(myStats.stars, myStats.missedStars, myStats.bonusStars, wins, losses, ties);
      } else {
        updateBannerStats(0, 0, 0, wins, losses, ties);
      }

      updateBannerRating(leagueData.clanRating);
      renderBannerInfo(clan, leagueData.clanRating);

      renderLeaderboard(leagueData.standings, currentTag, searchByTag);
      renderRounds(leagueData, currentTag);
      renderRanking(leagueData);
    } catch (e) {
      currentLeagueData = null;
      $('seasonTitle').textContent = 'Liga de Guerras';
      $('roundInfo').textContent = '';
      const msg = e.status === 404
        ? 'Este clã não está participando de uma CWL no momento.'
        : 'Não foi possível carregar a liga.';
      $('leaderboard').append(mk('div', 'notice', msg));
      el.roundsList.append(mk('div', 'notice', msg));
      if (el.rankingList) el.rankingList.append(mk('div', 'notice', msg));
    }
  } catch (e) {
    showError(
      e.status === 404
        ? 'Clã não encontrado.'
        : e.status === 400
          ? 'Tag inválida.'
          : 'Erro ao consultar a API. Tente novamente.'
    );
  } finally {
    setLoading(false);
  }
}

/**
 * Roteamento Inteligente da Busca:
 * - Se começar com '#' (ou for tag formatada como letras/números válidos sem espaços): busca por Tag.
 * - Caso contrário: busca por Nome (/api/clans?name=...) e renderiza o dropdown de resultados.
 */
async function handleSearch(query) {
  const trimmed = String(query || '').trim();
  if (!trimmed) return showError('Digite o nome ou a tag do clã.');
  clearError();

  if (trimmed.startsWith('#')) {
    return searchByTag(trimmed);
  }

  // Verifica se o texto é uma tag digitada sem hash (apenas caracteres válidos de tag de 3 a 12 letras sem vogais proibidas)
  const clean = cleanTag(trimmed);
  const isLikelyTag = clean.length >= 3 && clean.length <= 12 && /^[0289PYLQGRJCUV]+$/.test(clean) && !trimmed.includes(' ');

  // Se o usuário digitou algo com espaço ou nome comum, busca por nome primeiro
  setLoading(true);
  try {
    const searchRes = await searchClansByName(trimmed);
    const items = Array.isArray(searchRes?.items) ? searchRes.items : [];

    if (items.length > 0) {
      renderSearchResults(items, searchByTag);
      setLoading(false);
      return;
    }

    // Se a busca por nome retornou vazio e o padrão lembra tag, tenta por tag
    if (isLikelyTag) {
      return searchByTag(trimmed);
    }

    renderSearchResults([], searchByTag);
  } catch (err) {
    if (isLikelyTag) {
      return searchByTag(trimmed);
    }
    showError(err.message || 'Erro ao buscar clãs por nome.');
  } finally {
    setLoading(false);
  }
}

// ---------- Eventos Principais (Controller) ----------
function bindEvents() {
  el.tag.addEventListener('input', () => {
    clearError();
  });

  el.form.addEventListener('submit', e => {
    e.preventDefault();
    handleSearch(el.tag.value);
  });

  $('navSearch').addEventListener('click', handleReturnToSearch);

  el.tabStandingsBtn.addEventListener('click', () => switchTab('standings'));
  el.tabRoundsBtn.addEventListener('click', () => switchTab('rounds'));
  if (el.tabRankingBtn) {
    el.tabRankingBtn.addEventListener('click', () => switchTab('ranking'));
  }

  if (el.backToRoundsBtn) {
    el.backToRoundsBtn.addEventListener('click', hideWarEventsViewAndReturnToRounds);
  }

  if (el.warTabEventsBtn) {
    el.warTabEventsBtn.addEventListener('click', () => switchWarEventsMode('events'));
  }

  if (el.warTabReportBtn) {
    el.warTabReportBtn.addEventListener('click', () => switchWarEventsMode('report'));
  }

  if (el.exportReportBtn) {
    el.exportReportBtn.addEventListener('click', exportReportToPng);
  }

  if (el.favoriteBtn) {
    el.favoriteBtn.addEventListener('click', () => {
      if (!currentTag) return;
      const badgeSrc = currentClanData?.badgeUrls?.large || currentClanData?.badgeUrls?.medium || currentClanData?.badgeUrls?.small || DEFAULT_BADGE;
      toggleFavorite({
        tag: currentTag,
        name: currentClanData?.name || `#${currentTag}`,
        badgeUrl: badgeSrc,
        warLeague: currentClanData?.warLeague || null,
      });
      updateFavoriteButton(currentTag);
    });
  }

  const headerMenuBtn = el.headerMenuBtn || $('headerMenuBtn') || $('navMenuBtn');
  if (headerMenuBtn) {
    headerMenuBtn.addEventListener('click', () => setMobileMenu(true, searchByTag));
  }

  const favAccordionBtn = el.favAccordionBtn || $('favAccordionBtn');
  if (favAccordionBtn) {
    favAccordionBtn.addEventListener('click', () => toggleFavoritesAccordion());
  }

  const closeMenuBtn = $('closeMenuBtn');
  if (closeMenuBtn) {
    closeMenuBtn.addEventListener('click', () => setMobileMenu(false));
  }
  if (el.clearCacheBtn) {
    el.clearCacheBtn.addEventListener('click', clearAppCache);
  }
  $('policyBtn').addEventListener('click', () => {
    el.policy.hidden = !el.policy.hidden;
  });

  if (el.deskSearchBtn) {
    el.deskSearchBtn.addEventListener('click', () => {
      closeDesktopPopovers();
      handleReturnToSearch();
    });
  }

  if (el.deskPolicyBtn) {
    el.deskPolicyBtn.addEventListener('click', e => {
      e.stopPropagation();
      const willOpen = el.deskPolicyPopover.hidden;
      closeDesktopPopovers();
      if (willOpen) {
        el.deskPolicyPopover.hidden = false;
        el.deskPolicyBtn.setAttribute('aria-expanded', 'true');
      }
    });
  }

  document.addEventListener('click', closeDesktopPopovers);
}

// ---------- Inicialização ----------
function init() {
  bindEvents();
}

init();
