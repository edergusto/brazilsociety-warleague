/**
 * ui.js
 * Módulo responsável por toda a manipulação do DOM, renderização de componentes
 * (Banner do Clã, Classificação, Confrontos, View Dedicada de War Events, Projeções, Simulador)
 * e gerenciamento de navegação SPA (Single Page Application).
 */

import { cleanTag, isReportClanTag, fetchWarData, fetchNextRoundClanWar } from './api.js';
import { getSearchHistory, MAX_HISTORY_ITEMS, DEFAULT_BADGE } from './storage.js';
import {
  CWL_TEAM_SIZE,
  resolveWarWinner,
  countSideAttacks,
  formatWarTimeRemaining,
  buildWarEvents,
  buildClanPerformanceReport,
  calculateProjectionsMetrics,
  calculateSimulationScenario,
} from './projections.js';

export const $ = id => document.getElementById(id);

export const el = {
  form: $('searchForm'),
  tag: $('clanTag'),
  err: $('errorMsg'),
  btnText: $('btnText'),
  spin: $('btnSpinner'),
  search: $('searchView'),
  dash: $('dashboardView'),
  warEventsView: $('war-events-view'),
  backToRoundsBtn: $('back-to-rounds'),
  warEventsModeTabs: $('war-events-mode-tabs'),
  warTabEventsBtn: $('war-tab-events-btn'),
  warTabReportBtn: $('war-tab-report-btn'),
  warEventsHeader: $('war-events-header'),
  warEventsAttacksPanel: $('war-events-attacks-panel'),
  warEventsFilter: $('war-events-filter'),
  warEventsListContainer: $('war-events-list-container'),
  warEventsReportContainer: $('war-events-report-container'),
  warReportList: $('war-report-list'),
  exportReportBtn: $('export-report-btn'),
  cwl: $('navCwl'),
  featured: $('featuredClans'),
  recentSection: $('recentSearchesSection'),
  recentList: $('recentSearchesList'),
  menu: $('menu'),
  clearCacheBtn: $('clearCacheBtn'),
  policy: $('policyText'),
  deskSearchBtn: $('deskSearchBtn'),
  deskPolicyBtn: $('deskPolicyBtn'),
  deskPolicyPopover: $('deskPolicyPopover'),
  clanLoc: $('clanLocation'),
  clanLeagueIcon: $('clanLeagueIcon'),
  statGained: $('statStarsGained'),
  statLost: $('statStarsLost'),
  statBonus: $('statStarsBonus'),
  tabStandingsBtn: $('tabStandingsBtn'),
  tabRoundsBtn: $('tabRoundsBtn'),
  tabProjectionsBtn: $('tabProjectionsBtn'),
  tabStandings: $('tabStandings'),
  tabRounds: $('tabRounds'),
  tabProjections: $('tabProjections'),
  roundsList: $('roundsList'),
  projNotice: $('projectionsNotice'),
  projContent: $('projectionsContent'),
  promoBadge: $('promoBadge'),
  promoText: $('promoText'),
  survivalBadge: $('survivalBadge'),
  survivalText: $('survivalText'),
  h2hSubtitle: $('h2hSubtitle'),
  h2hBadge: $('h2hBadge'),
  h2hText: $('h2hText'),
  simSubtitle: $('simSubtitle'),
  simResultBadge: $('simResultBadge'),
  simSlider: $('simSlider'),
  simSliderValue: $('simSliderValue'),
  simBonusInfo: $('simBonusInfo'),
  simLeaderboard: $('simLeaderboard'),
};

export const WORLD_ICON_PATH = './assets/world_icon.png';
export const FEATURED_TAGS = ['#2GYGRQPG2', '#2JRGG8J99'];
export { DEFAULT_BADGE };

export const mk = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};

/**
 * Extrai os 2 últimos dígitos do warLeague.id (ex: 48000018 -> "18")
 * e retorna o caminho local ./assets/{digits}.png
 */
export function getLeagueIconPath(warLeague) {
  const id = warLeague?.id;
  if (!id) return null;
  const extractedDigits = String(id).slice(-2);
  return `./assets/${extractedDigits}.png`;
}

/**
 * Cria o elemento visual de bandeira (Flag CDN) quando isCountry === true,
 * ou ícone de globo/mundo para clãs Internacionais (isCountry === false ou ausente).
 */
export function createLocationFlagNode(location, forLeaderboard = false) {
  if (location?.isCountry && location?.countryCode) {
    const code = String(location.countryCode).toLowerCase();
    const flagImg = mk('img', forLeaderboard ? 'row-flag' : 'loc-flag');
    flagImg.src = `https://flagcdn.com/w20/${code}.png`;
    flagImg.alt = location.name || code.toUpperCase();
    flagImg.title = location.name || code.toUpperCase();
    return flagImg;
  }

  const worldImg = mk('img', forLeaderboard ? 'row-world-img' : 'loc-world');
  worldImg.src = WORLD_ICON_PATH;
  worldImg.alt = location?.name || 'International';
  worldImg.title = location?.name || 'International';
  worldImg.addEventListener('error', () => {
    const globeIcon = mk('i', (forLeaderboard ? 'row-world-icon' : 'loc-world') + ' ph-bold ph-globe');
    globeIcon.title = location?.name || 'International';
    globeIcon.setAttribute('aria-label', location?.name || 'International');
    worldImg.replaceWith(globeIcon);
  }, { once: true });
  return worldImg;
}

/**
 * Atualiza o elemento #clanLocation e o ícone #clanLeagueIcon no Banner Principal do Clã
 */
export function updateBannerLocationAndLeague(clan) {
  if (el.clanLoc) {
    el.clanLoc.replaceChildren();
    if (clan?.location) {
      const flagNode = createLocationFlagNode(clan.location, false);
      const locName = mk('span', '', clan.location.name || 'International');
      el.clanLoc.append(flagNode, locName);
      el.clanLoc.hidden = false;
    } else {
      el.clanLoc.hidden = true;
    }
  }

  if (el.clanLeagueIcon) {
    const iconPath = getLeagueIconPath(clan?.warLeague);
    if (iconPath) {
      el.clanLeagueIcon.src = iconPath;
      el.clanLeagueIcon.alt = clan.warLeague?.name || 'League Icon';
      el.clanLeagueIcon.hidden = false;
      el.clanLeagueIcon.onerror = () => { el.clanLeagueIcon.hidden = true; };
    } else {
      el.clanLeagueIcon.hidden = true;
    }
  }
}

export function updateBannerStats(gained = 0, lost = 0, bonus = 0) {
  el.statGained.querySelector('span').textContent = String(gained);
  el.statLost.querySelector('span').textContent = `-${lost}`;
  el.statBonus.querySelector('span').textContent = `+${bonus}`;
}

export function showError(msg) {
  el.err.textContent = msg;
  el.err.hidden = false;
  el.tag.classList.add('invalid');
}

export function clearError() {
  el.err.hidden = true;
  el.tag.classList.remove('invalid');
}

export function setLoading(on) {
  el.btnText.hidden = on;
  el.spin.hidden = !on;
}

// ---------- SPA Navigation & View Switching ----------
function setElementVisibility(node, visible) {
  if (!node) return;
  node.hidden = !visible;
  node.classList.toggle('hidden', !visible);
}

export function switchTab(tabName) {
  const tabs = [
    { name: 'standings', btn: el.tabStandingsBtn, panel: el.tabStandings },
    { name: 'rounds', btn: el.tabRoundsBtn, panel: el.tabRounds },
    { name: 'projections', btn: el.tabProjectionsBtn, panel: el.tabProjections },
  ];
  tabs.forEach(t => {
    const active = t.name === tabName;
    t.btn.classList.toggle('active', active);
    t.btn.setAttribute('aria-selected', String(active));
    t.panel.hidden = !active;
  });
}

export function showSearchView(onSelectTag) {
  setElementVisibility(el.dash, false);
  setElementVisibility(el.warEventsView, false);
  setElementVisibility(el.search, true);
  el.cwl.classList.remove('active');
  el.cwl.disabled = true;
  el.tag.value = '';
  clearError();
  renderSearchHistory(onSelectTag);
}

export function showDashboardView() {
  setElementVisibility(el.search, false);
  setElementVisibility(el.warEventsView, false);
  setElementVisibility(el.dash, true);
  const cwlImg = el.cwl.querySelector('img');
  if (cwlImg) cwlImg.src = DEFAULT_BADGE;
  el.cwl.classList.add('active');
  el.cwl.disabled = false;
  switchTab('standings');
  $('main').scrollTop = 0;
}

export function showWarEventsView() {
  setElementVisibility(el.search, false);
  setElementVisibility(el.dash, false);
  setElementVisibility(el.warEventsView, true);
  $('main').scrollTop = 0;
}

export function hideWarEventsViewAndReturnToRounds() {
  setElementVisibility(el.warEventsView, false);
  setElementVisibility(el.dash, true);
  switchTab('rounds');
  $('main').scrollTop = 0;
}

export function setMobileMenu(open) {
  el.menu.classList.toggle('open', open);
  el.menu.setAttribute('aria-hidden', !open);
}

/**
 * Limpa completamente o localStorage e todos os caches do Service Worker (PWA Cache Storage),
 * exibe alerta de confirmação e recarrega a aplicação do zero.
 */
export async function clearAppCache() {
  try {
    localStorage.clear();
  } catch {
    // Ignora bloqueios de storage
  }

  if ('caches' in window) {
    try {
      await caches.keys().then(keys => Promise.all(keys.map(key => caches.delete(key))));
    } catch {
      // Ignora falhas da API de Cache
    }
  }

  window.alert('Cache limpo com sucesso!');
  window.location.reload(true);
}

export function closeDesktopPopovers() {
  if (el.deskPolicyPopover) el.deskPolicyPopover.hidden = true;
  if (el.deskPolicyBtn) el.deskPolicyBtn.setAttribute('aria-expanded', 'false');
}

export function renderSearchHistory(onSelectTag) {
  if (!el.recentSection || !el.recentList) return;
  const history = getSearchHistory();
  el.recentList.replaceChildren();

  if (!history.length) {
    el.recentSection.hidden = true;
    return;
  }

  el.recentSection.hidden = false;
  history.slice(0, MAX_HISTORY_ITEMS).forEach(item => {
    const itemTag = cleanTag(item.tag);
    const btn = mk('button', 'recent-item');
    btn.type = 'button';
    btn.setAttribute('aria-label', `Buscar novamente o clã ${item.name}`);

    const img = mk('img', 'recent-badge');
    img.src = item.badgeUrl || DEFAULT_BADGE;
    img.alt = '';

    const info = mk('div', 'recent-info');
    info.append(
      mk('span', 'recent-name', item.name),
      mk('span', 'recent-tag', `#${itemTag}`)
    );

    btn.append(img, info, mk('i', 'ph-bold ph-arrow-right recent-go'));
    btn.addEventListener('click', () => {
      el.tag.value = itemTag;
      if (typeof onSelectTag === 'function') onSelectTag(itemTag);
    });

    el.recentList.append(btn);
  });
}

export function createFeaturedCard({ tag, name, league, warLeague, badgeUrl }, onSelectTag) {
  const normalizedTag = cleanTag(tag);
  const btn = mk('button', 'featured-card');
  btn.type = 'button';
  btn.setAttribute('aria-label', `Abrir CWL do clã ${name}`);

  const img = mk('img', 'featured-badge');
  img.src = badgeUrl || DEFAULT_BADGE;
  img.alt = `Escudo ${name}`;

  const body = mk('div', 'featured-body');
  const nameRow = mk('div', 'featured-name-row');
  nameRow.append(
    mk('span', 'featured-name', name),
    mk('span', 'featured-tag', `#${normalizedTag}`)
  );

  const leaguePill = mk('span', 'featured-league');
  const leagueIconPath = getLeagueIconPath(warLeague);
  if (leagueIconPath) {
    const lImg = mk('img');
    lImg.src = leagueIconPath;
    lImg.alt = '';
    lImg.onerror = () => lImg.replaceWith(mk('i', 'ph-fill ph-trophy'));
    leaguePill.append(lImg);
  } else {
    leaguePill.append(mk('i', 'ph-fill ph-trophy'));
  }
  leaguePill.append(document.createTextNode(league));

  body.append(nameRow, leaguePill);
  btn.append(img, body, mk('i', 'ph-bold ph-caret-right featured-arrow'));

  btn.addEventListener('click', () => {
    el.tag.value = normalizedTag;
    if (typeof onSelectTag === 'function') onSelectTag(normalizedTag);
  });

  return btn;
}

/**
 * Renderiza a Aba 1: Classificação (com Bandeira do País antes do Escudo do Clã)
 */
export function renderLeaderboard(standings, currentTag) {
  const box = $('leaderboard');
  box.replaceChildren();
  standings.forEach((s, i) => {
    const row = mk('div', 'row' + (s.clan.tag === '#' + currentTag ? ' me' : ''));
    row.append(mk('span', 'pos', i + 1));
    const status = i < 2
      ? ['up', 'ph-fill ph-caret-up']
      : i >= standings.length - 2
        ? ['down', 'ph-fill ph-caret-down']
        : ['mid', 'ph-bold ph-minus'];
    row.append(mk('i', `st ${status[0]} ${status[1]}`));

    row.append(createLocationFlagNode(s.location, true));

    const img = mk('img', 'row-shield');
    img.src = s.clan.badgeUrls?.small || DEFAULT_BADGE;
    img.alt = '';
    row.append(img, mk('div', 'nm', s.clan.name));

    const st = mk('div', 'stars');
    st.append(mk('i', 'ph-fill ph-star'), document.createTextNode(s.stars));
    row.append(st);
    box.append(row);
  });
}

/**
 * Renderiza a lista flat de ataques filtrada por clã ('all' | 'my' | 'opp').
 */
function renderFilteredWarEventsList(warEvents, activeFilter = 'all') {
  if (!el.warEventsListContainer) return;
  el.warEventsListContainer.replaceChildren();

  const filtered = warEvents.filter(ev => {
    if (activeFilter === 'my') return ev.isMyAttack === true;
    if (activeFilter === 'opp') return ev.isMyAttack === false;
    return true;
  });

  if (filtered.length === 0) {
    el.warEventsListContainer.append(
      mk('div', 'war-events-empty', 'Nenhum ataque registrado para este filtro.')
    );
    return;
  }

  filtered.forEach(ev => {
    const row = mk(
      'div',
      `war-event-flat-row ${ev.isMyAttack ? 'my-attack' : 'opp-attack'}`
    );

    const orderEl = mk('span', 'war-event-num', `#${ev.order}`);

    const playersEl = mk('div', 'war-event-players');
    playersEl.append(
      mk('span', 'war-event-attacker', ev.attackerName),
      mk('span', 'war-event-vs', 'VS'),
      mk('span', 'war-event-defender', ev.defenderName)
    );

    const outcomeEl = mk('div', 'war-event-outcome');
    const starImg = mk('img');
    starImg.src = 'assets/gold_star.png';
    starImg.alt = 'Stars';
    outcomeEl.append(
      starImg,
      mk('span', 'outcome-stars', `${ev.stars}`),
      mk('span', 'outcome-sep', '•'),
      mk('span', 'outcome-dest', `${ev.destructionFormatted}%`)
    );

    row.append(orderEl, playersEl, outcomeEl);
    el.warEventsListContainer.append(row);
  });
}

let activeReportRoundDay = 1;

export function switchWarEventsMode(mode = 'events') {
  const isReport = mode === 'report';
  if (el.warTabEventsBtn) {
    el.warTabEventsBtn.classList.toggle('active', !isReport);
    el.warTabEventsBtn.setAttribute('aria-selected', String(!isReport));
  }
  if (el.warTabReportBtn) {
    el.warTabReportBtn.classList.toggle('active', isReport);
    el.warTabReportBtn.setAttribute('aria-selected', String(isReport));
  }
  setElementVisibility(el.warEventsAttacksPanel, !isReport);
  setElementVisibility(el.warEventsReportContainer, isReport);
}

/**
 * Exporta o contêiner de Relatório (#war-report-list) como imagem PNG usando html2canvas,
 * preservando o tema Dark Gaming e baixando automaticamente `substitutions_round_[X].png`.
 */
export async function exportReportToPng() {
  if (!el.warReportList || typeof window.html2canvas !== 'function') return;

  const btn = el.exportReportBtn;
  const labelSpan = btn?.querySelector('span');
  const prevLabel = labelSpan ? labelSpan.textContent : 'Exportar';

  if (btn) btn.disabled = true;
  if (labelSpan) labelSpan.textContent = 'Gerando…';

  try {
    const canvas = await window.html2canvas(el.warReportList, {
      backgroundColor: '#100920',
      scale: 2,
      useCORS: true,
      logging: false,
    });

    const dataUrl = canvas.toDataURL('image/png');
    const link = document.createElement('a');
    link.download = `substitutions_round_${activeReportRoundDay}.png`;
    link.href = dataUrl;
    document.body.appendChild(link);
    link.click();
    link.remove();
  } catch {
    // Ignora falha silenciosamente e restaura o botão
  } finally {
    if (btn) btn.disabled = false;
    if (labelSpan) labelSpan.textContent = prevLabel;
  }
}

/**
 * Renderiza o Relatório dos 15 jogadores do clã na guerra (ordenados por mapPosition),
 * comparando com a próxima rodada para mapear substituições:
 * Ex: "Player A [Red Down] ➔ Player B [Green Up]"
 */
function renderClanPerformanceReport(mySide, nextMySide = null) {
  if (!el.warReportList) return;
  el.warReportList.replaceChildren();

  const reportRows = buildClanPerformanceReport(mySide, nextMySide);
  if (reportRows.length === 0) {
    el.warReportList.append(
      mk('div', 'war-events-empty', 'Escalação não disponível para esta rodada.')
    );
    return;
  }

  reportRows.forEach(player => {
    const row = mk(
      'div',
      `war-report-row ${player.needsSubstitution ? 'penalty' : ''}`.trim()
    );

    const posEl = mk('span', 'war-event-num', `#${player.lineupOrder}`);

    const playerCol = mk('div', 'war-report-player');
    playerCol.append(mk('span', 'war-report-name', player.name));

    if (player.needsSubstitution) {
      const penaltyArrow = mk('i', 'ph-bold ph-arrow-down report-penalty-arrow');
      penaltyArrow.style.color = '#ff4444';
      penaltyArrow.title = player.substitutedOut
        ? 'Substituído na próxima rodada'
        : player.hasAttacked
          ? `Apenas ${player.stars} estrela(s) — sugerida substituição`
          : 'Ataque não realizado — sugerida substituição';
      penaltyArrow.setAttribute('aria-label', 'Substituído / Penalidade');
      playerCol.append(penaltyArrow);
    }

    if (player.substitutedIn) {
      const sepEl = mk('span', 'report-sub-sep', '➔');
      const inNameEl = mk('span', 'report-sub-in-name', player.substitutedIn.name);
      const upArrow = mk('i', 'ph-bold ph-arrow-up report-sub-in-arrow');
      upArrow.style.color = '#22c55e';
      upArrow.title = `Entrou na próxima rodada: ${player.substitutedIn.name}`;
      upArrow.setAttribute('aria-label', 'Substituto que entrou');
      playerCol.append(sepEl, inNameEl, upArrow);
    }

    let outcomeEl;
    if (player.hasAttacked) {
      outcomeEl = mk('div', 'war-event-outcome');
      const starImg = mk('img');
      starImg.src = 'assets/gold_star.png';
      starImg.alt = 'Stars';
      outcomeEl.append(
        starImg,
        mk('span', 'outcome-stars', `${player.stars}`),
        mk('span', 'outcome-sep', '•'),
        mk('span', 'outcome-dest', `${player.destructionFormatted}%`)
      );
    } else {
      outcomeEl = mk('span', 'war-report-missed', 'Sem ataque');
    }

    row.append(posEl, playerCol, outcomeEl);
    el.warReportList.append(row);
  });
}

/**
 * Popula a view dedicada #war-events-view com os dados da guerra buscada sob demanda (Lazy Loading)
 * e alterna a visualização SPA.
 */
export function populateAndShowWarEventsView(warData, day, currentTag, nextWarData = null) {
  activeReportRoundDay = Number(day) || 1;
  const myFullTag = '#' + cleanTag(currentTag);
  const isClanSide = warData.clan?.tag === myFullTag;
  const mySide = isClanSide ? warData.clan : warData.opponent;
  const oppSide = isClanSide ? warData.opponent : warData.clan;
  const teamSize = warData.teamSize || CWL_TEAM_SIZE;

  let nextMySide = null;
  if (nextWarData) {
    nextMySide = nextWarData.clan?.tag === myFullTag
      ? nextWarData.clan
      : nextWarData.opponent?.tag === myFullTag
        ? nextWarData.opponent
        : null;
  }

  const myName = mySide?.name || 'Nosso Clã';
  const oppName = oppSide?.name || 'Adversário';
  const myStars = Number(mySide?.stars || 0);
  const oppStars = Number(oppSide?.stars || 0);
  const myDest = Number(mySide?.destructionPercentage || 0).toFixed(1);
  const oppDest = Number(oppSide?.destructionPercentage || 0).toFixed(1);
  const myAttacksCount = countSideAttacks(mySide);
  const oppAttacksCount = countSideAttacks(oppSide);
  const timeRemainingText = formatWarTimeRemaining(warData.endTime, warData.state);

  // Condição Crítica: Exibe as abas "War Events" e "Relatório" APENAS se o clã atual for #2GYGRQPG2 (%232GYGRQPG2)
  const isSpecialClan = isReportClanTag(currentTag);
  setElementVisibility(el.warEventsModeTabs, isSpecialClan);
  switchWarEventsMode('events');

  if (isSpecialClan) {
    renderClanPerformanceReport(mySide, nextMySide);
  } else if (el.warReportList) {
    el.warReportList.replaceChildren();
  }

  // Cabeçalho do Confronto (sem título redundante, com "Ataques: X/Y")
  if (el.warEventsHeader) {
    el.warEventsHeader.replaceChildren();

    const grid = mk('div', 'war-events-hero-grid');

    const leftTeam = mk('div', 'war-events-hero-team');
    const leftImg = mk('img');
    leftImg.src = mySide?.badgeUrls?.medium || mySide?.badgeUrls?.small || DEFAULT_BADGE;
    leftImg.alt = myName;
    leftTeam.append(
      leftImg,
      mk('span', 'war-events-hero-name', myName),
      mk('span', 'war-events-hero-sub', `Ataques: ${myAttacksCount}/${teamSize}`)
    );

    const centerScore = mk('div', 'war-events-hero-score');
    const starsLine = mk('div', 'war-events-hero-stars');
    const goldStarHero = mk('img');
    goldStarHero.src = 'assets/gold_star.png';
    goldStarHero.alt = 'Stars';
    starsLine.append(
      document.createTextNode(`${myStars} `),
      goldStarHero,
      document.createTextNode(` ${oppStars}`)
    );
    const destLine = mk(
      'span',
      'war-events-hero-dest',
      warData.state === 'preparation' ? 'Em preparação' : `${myDest}% × ${oppDest}%`
    );
    const timeLine = mk('span', 'war-events-hero-time');
    timeLine.append(mk('i', 'ph-bold ph-clock'), document.createTextNode(timeRemainingText));
    centerScore.append(starsLine, destLine, timeLine);

    const rightTeam = mk('div', 'war-events-hero-team');
    const rightImg = mk('img');
    rightImg.src = oppSide?.badgeUrls?.medium || oppSide?.badgeUrls?.small || DEFAULT_BADGE;
    rightImg.alt = oppName;
    rightTeam.append(
      rightImg,
      mk('span', 'war-events-hero-name', oppName),
      mk('span', 'war-events-hero-sub', `Ataques: ${oppAttacksCount}/${teamSize}`)
    );

    grid.append(leftTeam, centerScore, rightTeam);
    el.warEventsHeader.append(grid);
  }

  // Lista de Ataques (já ordenada em ordem cronológica reversa por buildWarEvents)
  const warEvents = buildWarEvents(mySide, oppSide);

  // Toggle de Filtro ("Todos", "[Clan A Name]", "[Clan B Name]")
  if (el.warEventsFilter) {
    el.warEventsFilter.replaceChildren();
    const filterOptions = [
      { key: 'all', label: 'Todos' },
      { key: 'my', label: myName },
      { key: 'opp', label: oppName },
    ];

    const buttons = filterOptions.map(opt => {
      const btn = mk('button', 'war-filter-btn' + (opt.key === 'all' ? ' active' : ''), opt.label);
      btn.type = 'button';
      btn.setAttribute('role', 'tab');
      btn.setAttribute('aria-selected', String(opt.key === 'all'));
      btn.title = opt.label;
      btn.addEventListener('click', () => {
        buttons.forEach(b => {
          b.classList.remove('active');
          b.setAttribute('aria-selected', 'false');
        });
        btn.classList.add('active');
        btn.setAttribute('aria-selected', 'true');
        renderFilteredWarEventsList(warEvents, opt.key);
      });
      el.warEventsFilter.append(btn);
      return btn;
    });
  }

  renderFilteredWarEventsList(warEvents, 'all');
  showWarEventsView();
}

/**
 * Renderiza a Aba 2: Confrontos (7 Dias) com cards de alto nível e Lazy Loading ao clicar.
 */
export function renderRounds(data, currentTag) {
  const box = el.roundsList;
  box.replaceChildren();

  const { myRoundsHistory, statsByTag } = data;
  const myFullTag = '#' + currentTag;
  const myClanObj = statsByTag[myFullTag]?.clan;
  const myClanName = myClanObj?.name || $('clanName').textContent || 'Nosso Clã';
  const myClanBadge = myClanObj?.badgeUrls?.small || $('clanBadge').src || DEFAULT_BADGE;

  myRoundsHistory.forEach(item => {
    const teamSize = item.teamSize || CWL_TEAM_SIZE;

    if (item.state === 'unscheduled' || !item.mySide || !item.oppSide) {
      const card = mk('div', 'round-card unscheduled');
      const head = mk('div', 'round-head');
      head.append(
        mk('span', 'round-day', `Dia ${item.day}`),
        mk('span', 'round-status', 'Aguardando Sorteio')
      );

      const matchup = mk('div', 'round-matchup');
      const mainRow = mk('div', 'round-matchup-main');

      const leftTeam = mk('div', 'round-team');
      const leftImg = mk('img');
      leftImg.src = myClanBadge;
      leftImg.alt = '';
      const leftInfo = mk('div', 'round-team-info');
      leftInfo.append(
        mk('span', 'round-team-name', myClanName),
        mk('span', 'round-team-attacks', `Attacks: 0/${teamSize}`)
      );
      leftTeam.append(leftImg, leftInfo);

      const scoreBox = mk('div', 'round-score-box');
      scoreBox.append(mk('span', 'round-dest', 'vs'));

      const rightTeam = mk('div', 'round-team opp');
      const rightImg = mk('img');
      rightImg.src = DEFAULT_BADGE;
      rightImg.alt = '';
      const rightInfo = mk('div', 'round-team-info');
      rightInfo.append(
        mk('span', 'round-team-name', 'A definir'),
        mk('span', 'round-team-attacks', `Attacks: 0/${teamSize}`)
      );
      rightTeam.append(rightImg, rightInfo);

      mainRow.append(leftTeam, scoreBox, rightTeam);
      matchup.append(mainRow);
      card.append(head, matchup);
      box.append(card);
      return;
    }

    const myStars = Number(item.mySide.stars || 0);
    const oppStars = Number(item.oppSide.stars || 0);
    const myDest = Number(item.mySide.destructionPercentage || 0).toFixed(1);
    const oppDest = Number(item.oppSide.destructionPercentage || 0).toFixed(1);
    const myAttacksCount = countSideAttacks(item.mySide);
    const oppAttacksCount = countSideAttacks(item.oppSide);
    const timeRemainingText = formatWarTimeRemaining(item.endTime, item.state);

    let cardMod = 'prep';
    let badgeText = 'Preparação';
    let badgeMod = '';

    if (item.state === 'inWar') {
      cardMod = 'live';
      badgeText = 'Em Guerra';
      badgeMod = 'live';
    } else if (item.state === 'warEnded') {
      const winner = resolveWarWinner(item.mySide, item.oppSide);
      if (winner === myFullTag) {
        cardMod = 'win';
        badgeText = 'Vitória (+10★)';
        badgeMod = 'win';
      } else if (winner === item.oppSide.tag) {
        cardMod = 'loss';
        badgeText = 'Derrota';
        badgeMod = 'loss';
      } else {
        cardMod = '';
        badgeText = 'Empate (+0★)';
      }
    }

    const card = mk('div', `round-card ${cardMod}`.trim());
    if (item.warTag) {
      card.dataset.warTag = item.warTag;
    }
    card.dataset.day = String(item.day);
    card.setAttribute('role', 'button');
    card.setAttribute('tabindex', '0');

    const head = mk('div', 'round-head');
    head.append(
      mk('span', 'round-day', `Dia ${item.day}`),
      mk('span', `round-status ${badgeMod}`.trim(), badgeText)
    );

    const matchup = mk('div', 'round-matchup');
    if (item.warTag) {
      matchup.dataset.warTag = item.warTag;
    }

    const mainRow = mk('div', 'round-matchup-main');

    const leftTeam = mk('div', 'round-team');
    const leftImg = mk('img');
    leftImg.src = item.mySide.badgeUrls?.small || DEFAULT_BADGE;
    leftImg.alt = '';
    const leftInfo = mk('div', 'round-team-info');
    leftInfo.append(
      mk('span', 'round-team-name', item.mySide.name),
      mk('span', 'round-team-attacks', `Attacks: ${myAttacksCount}/${teamSize}`)
    );
    leftTeam.append(leftImg, leftInfo);

    const scoreBox = mk('div', 'round-score-box');
    const scoreStars = mk('div', 'round-stars');
    scoreStars.append(
      document.createTextNode(`${myStars} `),
      mk('i', 'ph-fill ph-star'),
      document.createTextNode(` ${oppStars}`)
    );
    const scoreDest = mk('span', 'round-dest', item.state === 'preparation' ? 'vs' : `${myDest}% × ${oppDest}%`);
    scoreBox.append(scoreStars, scoreDest);

    const rightTeam = mk('div', 'round-team opp');
    const rightImg = mk('img');
    rightImg.src = item.oppSide.badgeUrls?.small || DEFAULT_BADGE;
    rightImg.alt = '';
    const rightInfo = mk('div', 'round-team-info');
    rightInfo.append(
      mk('span', 'round-team-name', item.oppSide.name),
      mk('span', 'round-team-attacks', `Attacks: ${oppAttacksCount}/${teamSize}`)
    );
    rightTeam.append(rightImg, rightInfo);

    mainRow.append(leftTeam, scoreBox, rightTeam);

    const metaRow = mk('div', 'round-matchup-meta');
    const timeWrap = mk('span', 'round-time');
    timeWrap.append(mk('i', 'ph-bold ph-clock'), document.createTextNode(timeRemainingText));

    const ctaEl = mk('span', 'round-events-cta');
    const ctaLabel = mk('span', '', 'Ver Eventos de Guerra');
    const ctaIcon = mk('i', 'ph-bold ph-arrow-right');
    ctaEl.append(ctaLabel, ctaIcon);

    metaRow.append(timeWrap, ctaEl);
    matchup.append(mainRow, metaRow);

    const handleOpenWarEvents = async () => {
      const warTag = card.dataset.warTag;
      if (!warTag || card.classList.contains('loading')) return;

      card.classList.add('loading');
      const prevText = ctaLabel.textContent;
      ctaLabel.textContent = 'Carregando…';
      ctaIcon.className = 'ph-bold ph-circle-notch spin';

      try {
        // Lazy Loading: busca a guerra atual e, se for o clã #2GYGRQPG2, a guerra da próxima rodada para mapear substituições
        const nextRoundItem = myRoundsHistory.find(r => r.day === item.day + 1);
        const knownNextWarTag = nextRoundItem?.warTag || null;

        const [warData, nextWarData] = await Promise.all([
          fetchWarData(warTag),
          isReportClanTag(currentTag)
            ? fetchNextRoundClanWar(currentTag, warTag, knownNextWarTag)
            : Promise.resolve(null),
        ]);

        populateAndShowWarEventsView(warData, item.day, currentTag, nextWarData);
      } catch {
        ctaLabel.textContent = 'Erro ao carregar';
      } finally {
        card.classList.remove('loading');
        ctaLabel.textContent = prevText;
        ctaIcon.className = 'ph-bold ph-arrow-right';
      }
    };

    card.addEventListener('click', handleOpenWarEvents);
    card.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        handleOpenWarEvents();
      }
    });

    card.append(head, matchup);
    box.append(card);
  });
}

/**
 * Renderiza a Aba 3: Projeções Analíticas (Moneyball) e inicializa o Simulador.
 */
export function renderProjections(data, currentTag) {
  const metrics = calculateProjectionsMetrics(data, currentTag);

  if (!metrics) {
    el.projContent.hidden = true;
    el.projNotice.hidden = false;
    el.projNotice.textContent = 'Dados insuficientes no grupo para gerar projeções analíticas.';
    return;
  }

  el.projNotice.hidden = true;
  el.projContent.hidden = false;

  el.promoBadge.textContent = metrics.promoBadgeText;
  el.promoBadge.className = metrics.promoBadgeClass;
  el.promoText.textContent = metrics.promoText;

  el.survivalBadge.textContent = metrics.survivalBadgeText;
  el.survivalBadge.className = metrics.survivalBadgeClass;
  el.survivalText.textContent = metrics.survivalText;

  el.h2hSubtitle.textContent = metrics.h2hSubtitle;
  el.h2hBadge.textContent = metrics.h2hBadgeText;
  el.h2hBadge.className = metrics.h2hBadgeClass;
  el.h2hText.textContent = metrics.h2hText;

  el.simSlider.value = String(metrics.initialSliderStars);
  updateSimulationUI(data, currentTag, metrics.initialSliderStars);
}

/**
 * Atualiza a tabela e os indicadores visuais do Simulador de Desempenho (0 a 45 estrelas).
 */
export function updateSimulationUI(leagueData, currentTag, simAttackStars) {
  const scenario = calculateSimulationScenario(leagueData, currentTag, simAttackStars);
  if (!scenario) return;

  const myFullTag = '#' + currentTag;

  el.simSliderValue.textContent = String(scenario.simStars);
  el.simSlider.style.setProperty('--pct', scenario.pct);
  el.simSubtitle.textContent = scenario.simSubtitle;
  el.simResultBadge.textContent = scenario.resultBadgeText;
  el.simResultBadge.className = scenario.resultBadgeClass;
  el.simBonusInfo.className = scenario.bonusInfoClass;
  el.simBonusInfo.textContent = scenario.bonusInfoText;

  el.simLeaderboard.replaceChildren();
  scenario.simStandings.forEach((item, idx) => {
    const newPos = idx + 1;
    const isMe = item.clan.tag === myFullTag;
    const row = mk('div', 'row' + (isMe ? ' me' : ''));

    row.append(mk('span', 'pos', newPos));
    const status = idx < 2
      ? ['up', 'ph-fill ph-caret-up']
      : idx >= scenario.simStandings.length - 2
        ? ['down', 'ph-fill ph-caret-down']
        : ['mid', 'ph-bold ph-minus'];
    row.append(mk('i', `st ${status[0]} ${status[1]}`));

    row.append(createLocationFlagNode(item.location, true));

    const img = mk('img', 'row-shield');
    img.src = item.clan.badgeUrls?.small || DEFAULT_BADGE;
    img.alt = '';
    row.append(img, mk('div', 'nm', item.clan.name));

    const delta = item.prevPos - newPos;
    if (delta > 0) {
      row.append(mk('span', 'sim-tag delta-up', `▲ +${delta}`));
    } else if (delta < 0) {
      row.append(mk('span', 'sim-tag delta-down', `▼ ${delta}`));
    }

    if (isMe && item.earnedBonus) {
      row.append(mk('span', 'sim-tag bonus', '+10★'));
    }

    const st = mk('div', 'stars');
    st.append(mk('i', 'ph-fill ph-star'), document.createTextNode(item.simStars));
    row.append(st);

    el.simLeaderboard.append(row);
  });
}
