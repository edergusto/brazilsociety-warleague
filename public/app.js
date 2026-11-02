import { cleanTag, fetchClanData, fetchLeagueGroup } from './api.js';
import { seasonLabel, loadStandings } from './projections.js';
import { saveToSearchHistory } from './storage.js';
import {
  $,
  el,
  mk,
  DEFAULT_BADGE,
  FEATURED_TAGS,
  updateBannerLocationAndLeague,
  updateBannerStats,
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
  closeDesktopPopovers,
  renderSearchHistory,
  createFeaturedCard,
  renderLeaderboard,
  renderRounds,
  renderProjections,
  updateSimulationUI,
} from './ui.js';

let currentTag = null;
let currentLeagueData = null;

// ---------- Registro do Service Worker (PWA) ----------
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}

// ---------- Carregamento dos Clãs em Destaque na Tela Inicial ----------
async function loadFeaturedClans() {
  if (!el.featured) return;
  el.featured.replaceChildren();

  const placeholders = FEATURED_TAGS.map(rawTag => {
    const card = createFeaturedCard({
      tag: rawTag,
      name: 'Carregando clã…',
      league: 'Consultando CWL…',
      badgeUrl: DEFAULT_BADGE,
    }, search);
    el.featured.append(card);
    return { rawTag, card };
  });

  await Promise.allSettled(
    placeholders.map(async ({ rawTag, card }) => {
      const normalizedWithHash = '#' + cleanTag(rawTag);
      try {
        const clan = await fetchClanData(rawTag);
        const updatedCard = createFeaturedCard({
          tag: clan.tag || normalizedWithHash,
          name: clan.name || normalizedWithHash,
          league: clan.warLeague?.name || 'Sem Liga',
          warLeague: clan.warLeague,
          badgeUrl: clan.badgeUrls?.medium || clan.badgeUrls?.large || clan.badgeUrls?.small || DEFAULT_BADGE,
        }, search);
        card.replaceWith(updatedCard);
      } catch {
        const fallbackCard = createFeaturedCard({
          tag: normalizedWithHash,
          name: `Clã ${normalizedWithHash}`,
          league: 'Toque para buscar CWL',
          badgeUrl: DEFAULT_BADGE,
        }, search);
        card.replaceWith(fallbackCard);
      }
    })
  );
}

function handleReturnToSearch() {
  currentTag = null;
  currentLeagueData = null;
  showSearchView(search);
}

// ---------- Fluxo Principal de Busca e Carregamento da CWL ----------
async function search(raw) {
  const tag = cleanTag(raw);
  if (!tag) return showError('Digite a tag do clã.');
  clearError();
  setLoading(true);

  try {
    const clan = await fetchClanData(tag);
    currentTag = tag;
    const badgeSrc = clan.badgeUrls?.large || clan.badgeUrls?.medium || clan.badgeUrls?.small || DEFAULT_BADGE;

    $('clanName').textContent = clan.name;
    $('clanBadge').src = badgeSrc;
    $('clanLeague').textContent = clan.warLeague?.name || 'Sem liga';
    $('clanSize').textContent = '';
    updateBannerLocationAndLeague(clan);

    $('leaderboard').replaceChildren();
    el.roundsList.replaceChildren();
    $('seasonTitle').textContent = '';
    $('roundInfo').textContent = '';

    saveToSearchHistory({
      tag,
      name: clan.name,
      badgeUrl: clan.badgeUrls?.small || badgeSrc,
    });
    renderSearchHistory(search);

    updateBannerStats(0, 0, 0);
    showDashboardView();

    try {
      const group = await fetchLeagueGroup(tag);
      $('seasonTitle').textContent = seasonLabel(group.season);
      $('roundInfo').textContent = 'Carregando partidas…';

      const leagueData = await loadStandings(group, currentTag);
      currentLeagueData = leagueData;

      $('roundInfo').textContent = `Partida atual: ${leagueData.round}/${leagueData.totalRounds}`;
      const n = leagueData.teamSize || group.clans.find(c => c.tag === '#' + tag)?.members?.length;
      $('clanSize').textContent = n ? `${n}v${n}` : '15v15';

      const myStats = leagueData.statsByTag['#' + tag];
      if (myStats) {
        updateBannerStats(myStats.stars, myStats.missedStars, myStats.bonusStars);
      }

      renderLeaderboard(leagueData.standings, currentTag);
      renderRounds(leagueData, currentTag);
      renderProjections(leagueData, currentTag);
    } catch (e) {
      currentLeagueData = null;
      $('seasonTitle').textContent = 'Liga de Guerras';
      $('roundInfo').textContent = '';
      const msg = e.status === 404
        ? 'Este clã não está participando de uma CWL no momento.'
        : 'Não foi possível carregar a liga.';
      $('leaderboard').append(mk('div', 'notice', msg));
      el.roundsList.append(mk('div', 'notice', msg));
      el.projContent.hidden = true;
      el.projNotice.hidden = false;
      el.projNotice.textContent = msg;
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

// ---------- Eventos Principais (Controller) ----------
function bindEvents() {
  el.tag.addEventListener('input', () => {
    if (el.tag.value.startsWith('#')) el.tag.value = el.tag.value.slice(1);
    clearError();
  });

  el.form.addEventListener('submit', e => {
    e.preventDefault();
    search(el.tag.value);
  });

  $('navSearch').addEventListener('click', handleReturnToSearch);
  el.cwl.addEventListener('click', () => {
    $('main').scrollTo({ top: 0, behavior: 'smooth' });
  });

  el.tabStandingsBtn.addEventListener('click', () => switchTab('standings'));
  el.tabRoundsBtn.addEventListener('click', () => switchTab('rounds'));
  el.tabProjectionsBtn.addEventListener('click', () => switchTab('projections'));

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

  el.simSlider.addEventListener('input', e => {
    if (!currentLeagueData || !currentTag) return;
    updateSimulationUI(currentLeagueData, currentTag, Number(e.target.value));
  });

  $('navMenuBtn').addEventListener('click', () => setMobileMenu(true));
  $('closeMenuBtn').addEventListener('click', () => setMobileMenu(false));
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
  el.cwl.disabled = true;
  bindEvents();
  renderSearchHistory(search);
  loadFeaturedClans();
}

init();
