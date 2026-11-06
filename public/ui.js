/**
 * ui.js
 * Módulo responsável por toda a manipulação do DOM, renderização de componentes
 * (Banner do Clã, Classificação, Confrontos, View Dedicada de War Events, Relatório e Favoritos)
 * e gerenciamento de navegação SPA (Single Page Application).
 */

import {
  cleanTag,
  isReportClanTag,
  fetchClanData,
  fetchWarData,
  fetchNextRoundClanWar,
  fetchGroupDetailsAndWars,
  fetchLeagueGroupClanRoster,
  calculatePlayerRatings,
  calculateClanRating,
} from './api.js';
import {
  getFavorites,
  isClanFavorite,
  toggleFavorite,
  DEFAULT_BADGE,
} from './storage.js';

export const CWL_TEAM_SIZE = 15;
export const MAX_ATTACK_STARS = 45;
export const WIN_BONUS_STARS = 10;

export const MONTHS = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
];

export function seasonLabel(s) {
  const [y, m] = (s || '').split('-');
  return MONTHS[+m - 1] ? `${MONTHS[+m - 1]} de ${y}` : '—';
}

export function resolveWarWinner(clanA, clanB) {
  const starsA = Number(clanA?.stars || 0);
  const starsB = Number(clanB?.stars || 0);
  if (starsA > starsB) return clanA.tag;
  if (starsB > starsA) return clanB.tag;

  const destA = Number(clanA?.destructionPercentage || 0);
  const destB = Number(clanB?.destructionPercentage || 0);
  if (destA > destB) return clanA.tag;
  if (destB > destA) return clanB.tag;

  return null;
}

export function extractSideAttacks(side) {
  if (!side) return [];
  const seen = new Set();
  const list = [];

  const pushAttack = atk => {
    if (!atk || typeof atk !== 'object') return;
    const key = `${atk.attackerTag || ''}_${atk.defenderTag || ''}_${atk.order ?? list.length}`;
    if (seen.has(key)) return;
    seen.add(key);
    list.push(atk);
  };

  if (Array.isArray(side.attacks)) {
    side.attacks.forEach(pushAttack);
  }

  if (Array.isArray(side.members)) {
    side.members.forEach(m => {
      if (Array.isArray(m.attacks)) {
        m.attacks.forEach(atk => pushAttack({ ...atk, attackerTag: atk.attackerTag || m.tag }));
      }
    });
  }

  return list;
}

export function countSideAttacks(side) {
  const extracted = extractSideAttacks(side);
  if (extracted.length > 0) return extracted.length;
  if (typeof side?.attacks === 'number') return side.attacks;
  return 0;
}

export function parseCocTimestamp(raw) {
  if (!raw) return NaN;
  const str = String(raw).trim();
  const compact = str.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(?:\.\d+)?Z?$/);
  if (compact) {
    const [, y, mo, d, h, mi, s] = compact;
    return Date.UTC(+y, +mo - 1, +d, +h, +mi, +s);
  }
  return Date.parse(str);
}

export function formatWarTimeRemaining(endTime, state) {
  const endMs = parseCocTimestamp(endTime);
  if (Number.isNaN(endMs)) {
    if (state === 'warEnded') return 'Encerrada';
    if (state === 'preparation') return 'Em preparação';
    return 'Em andamento';
  }
  const diffMs = endMs - Date.now();
  if (state === 'warEnded' || diffMs <= 0) {
    return 'Encerrada (0h 0m)';
  }
  const totalMins = Math.floor(diffMs / 60000);
  const days = Math.floor(totalMins / 1440);
  const hours = Math.floor((totalMins % 1440) / 60);
  const mins = totalMins % 60;
  if (days > 0) return `${days}d ${hours}h ${mins}m restantes`;
  if (hours > 0) return `${hours}h ${mins}m restantes`;
  return `${mins}m restantes`;
}

export function calculateMissedStarsInWar(side, warState) {
  const earned = Number(side?.stars || 0);
  const attacksMade = countSideAttacks(side);
  if (warState === 'warEnded') {
    const maxFromAttacks = attacksMade > 0 ? attacksMade * 3 : MAX_ATTACK_STARS;
    const missedOnAttacks = Math.max(0, maxFromAttacks - earned);
    const missedTotalBase = Math.max(0, MAX_ATTACK_STARS - earned);
    return Math.max(missedOnAttacks, missedTotalBase);
  }
  if (attacksMade > 0) {
    return Math.max(0, (attacksMade * 3) - earned);
  }
  return 0;
}

export function buildWarEvents(mySide, oppSide) {
  const memberMap = new Map();
  (mySide?.members || []).forEach(m => {
    if (m?.tag) memberMap.set(m.tag, m.name || m.tag);
  });
  (oppSide?.members || []).forEach(m => {
    if (m?.tag) memberMap.set(m.tag, m.name || m.tag);
  });

  const myAttacks = extractSideAttacks(mySide).map(atk => ({ ...atk, isMyAttack: true }));
  const oppAttacks = extractSideAttacks(oppSide).map(atk => ({ ...atk, isMyAttack: false }));

  const allAttacks = [...myAttacks, ...oppAttacks];
  allAttacks.sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0));

  const chronological = allAttacks.map((atk, idx) => {
    const attackerName = memberMap.get(atk.attackerTag) || atk.attackerName || atk.attackerTag || 'Atacante';
    const defenderName = memberMap.get(atk.defenderTag) || atk.defenderName || atk.defenderTag || 'Defensor';
    const stars = Number(atk.stars || 0);
    const pct = Number(atk.destructionPercentage || 0);
    const destructionFormatted = Number.isInteger(pct) ? String(pct) : pct.toFixed(1);
    return {
      order: atk.order || idx + 1,
      attackerName,
      defenderName,
      stars,
      destructionFormatted,
      isMyAttack: atk.isMyAttack,
    };
  });

  return chronological.reverse();
}

let lastLoadedLeagueData = null;

/**
 * Calcula o histórico de participação de cada jogador até a rodada informada:
 * - roundsPlayed: quantas rodadas o jogador foi escalado como titular (0 = prioridade máxima)
 * - failedLastAttack: se o jogador falhou (< 3 estrelas ou sem ataque) na última rodada em que participou
 */
function buildPlayerRotationStats(myRoundsHistory = [], upToRoundDay = 7) {
  const statsMap = new Map();

  const ensurePlayer = (tag, name, th) => {
    if (!statsMap.has(tag)) {
      statsMap.set(tag, {
        tag,
        name: name || tag,
        townHallLevel: Number(th) || 0,
        roundsPlayed: 0,
        failedLastAttack: false,
      });
    }
    return statsMap.get(tag);
  };

  const sortedRounds = [...(Array.isArray(myRoundsHistory) ? myRoundsHistory : [])]
    .filter(r => Number(r?.day) <= Number(upToRoundDay) && r?.mySide && Array.isArray(r.mySide.members))
    .sort((a, b) => (Number(a.day) || 0) - (Number(b.day) || 0));

  sortedRounds.forEach(round => {
    const isCurrentUnfinished = Number(round.day) === Number(upToRoundDay) && round.state === 'preparation';
    if (isCurrentUnfinished) return;

    const sideAttacks = extractSideAttacks(round.mySide);
    const attacksByAttacker = new Map();
    sideAttacks.forEach(atk => {
      if (!atk?.attackerTag) return;
      if (!attacksByAttacker.has(atk.attackerTag)) {
        attacksByAttacker.set(atk.attackerTag, []);
      }
      attacksByAttacker.get(atk.attackerTag).push(atk);
    });

    (round.mySide.members || []).forEach(m => {
      if (!m?.tag) return;
      const entry = ensurePlayer(m.tag, m.name, m.townhallLevel || m.townHallLevel);
      entry.roundsPlayed += 1;

      if (Number(round.day) < Number(upToRoundDay)) {
        const mAtks = Array.isArray(m.attacks) && m.attacks.length > 0
          ? m.attacks
          : (attacksByAttacker.get(m.tag) || []);
        const atk = mAtks[0] || null;
        const stars = atk ? Number(atk.stars || 0) : 0;
        if (round.state === 'warEnded') {
          entry.failedLastAttack = !atk || stars < 3;
        } else if (atk) {
          entry.failedLastAttack = stars < 3;
        }
      }
    });
  });

  return statsMap;
}

/**
 * Ordena a fila de Reservas seguindo estritamente a prioridade:
 * 1. Maior Prioridade (Topo da fila): Jogadores com 0 rodadas jogadas na liga até o momento.
 * 2. Prioridade Intermediária: Jogadores com > 0 rodadas que não falharam ataque recentemente (menor nº de rodadas primeiro).
 * 3. Menor Prioridade (Fim da fila): Jogadores que acabaram de falhar um ataque.
 */
function sortReservesQueue(reservesList, rotationStatsMap, currentActiveTags = new Set()) {
  return [...reservesList].sort((a, b) => {
    const statA = rotationStatsMap.get(a.tag);
    const statB = rotationStatsMap.get(b.tag);

    const roundsA = (statA?.roundsPlayed ?? 0) + (currentActiveTags.has(a.tag) && !statA ? 1 : 0);
    const roundsB = (statB?.roundsPlayed ?? 0) + (currentActiveTags.has(b.tag) && !statB ? 1 : 0);

    const justFailedA = a.justFailedAttack ? 1 : 0;
    const justFailedB = b.justFailedAttack ? 1 : 0;
    if (justFailedA !== justFailedB) return justFailedA - justFailedB;

    const zeroRoundsA = roundsA === 0 ? 0 : 1;
    const zeroRoundsB = roundsB === 0 ? 0 : 1;
    if (zeroRoundsA !== zeroRoundsB) return zeroRoundsA - zeroRoundsB;

    const prevFailedA = statA?.failedLastAttack ? 1 : 0;
    const prevFailedB = statB?.failedLastAttack ? 1 : 0;
    if (prevFailedA !== prevFailedB) return prevFailedA - prevFailedB;

    if (roundsA !== roundsB) return roundsA - roundsB;

    const thA = Number(a.townHallLevel || a.townhallLevel || statA?.townHallLevel || 0);
    const thB = Number(b.townHallLevel || b.townhallLevel || statB?.townHallLevel || 0);
    return thB - thA;
  });
}

export function buildClanPerformanceReport(
  mySide,
  nextMySide = null,
  fullRoster = [],
  roundDay = 1,
  myRoundsHistory = [],
  warState = 'inWar'
) {
  const members = Array.isArray(mySide?.members) ? [...mySide.members] : [];
  members.sort((a, b) => (Number(a.mapPosition) || 0) - (Number(b.mapPosition) || 0));

  const nextMembers = Array.isArray(nextMySide?.members) ? [...nextMySide.members] : [];
  nextMembers.sort((a, b) => (Number(a.mapPosition) || 0) - (Number(b.mapPosition) || 0));

  const hasNextRoundRoster = nextMembers.length > 0;
  const currentTags = new Set(members.map(m => m.tag));
  const nextTags = new Set(nextMembers.map(m => m.tag));

  const subbedOutMembers = hasNextRoundRoster
    ? members.filter(m => !nextTags.has(m.tag))
    : [];
  const subbedInMembers = hasNextRoundRoster
    ? nextMembers.filter(m => !currentTags.has(m.tag))
    : [];

  const subbedInByOutTag = new Map();
  const usedReserveTags = new Set();
  subbedOutMembers.forEach((outMember, idx) => {
    const incoming = subbedInMembers[idx] || null;
    if (incoming) {
      subbedInByOutTag.set(outMember.tag, {
        tag: incoming.tag,
        name: incoming.name || incoming.tag,
        mapPosition: incoming.mapPosition,
      });
      usedReserveTags.add(incoming.tag);
    }
  });

  const rotationStatsMap = buildPlayerRotationStats(myRoundsHistory, roundDay);
  const rawReserves = (Array.isArray(fullRoster) ? fullRoster : []).filter(
    m => m?.tag && !currentTags.has(m.tag)
  );
  const prioritizedReserves = sortReservesQueue(rawReserves, rotationStatsMap, currentTags);
  const availableQueue = prioritizedReserves.filter(r => !usedReserveTags.has(r.tag));

  const attacksByAttacker = new Map();
  extractSideAttacks(mySide).forEach(atk => {
    if (!atk?.attackerTag) return;
    if (!attacksByAttacker.has(atk.attackerTag)) {
      attacksByAttacker.set(atk.attackerTag, []);
    }
    attacksByAttacker.get(atk.attackerTag).push(atk);
  });

  const relegatedPlayers = [];

  const activeRows = members.map((member, idx) => {
    const memberAttacks = Array.isArray(member.attacks) && member.attacks.length > 0
      ? member.attacks
      : (attacksByAttacker.get(member.tag) || []);

    const atk = memberAttacks[0] || null;
    const hasAttacked = Boolean(atk);
    const stars = hasAttacked ? Number(atk.stars || 0) : 0;
    const pct = hasAttacked ? Number(atk.destructionPercentage || 0) : 0;
    const destructionFormatted = Number.isInteger(pct) ? String(pct) : pct.toFixed(1);

    // Avaliação Imediata: Assim que o jogador ataca e faz < 3 estrelas (ou a guerra encerra sem ataque),
    // projeta imediatamente sua substituição puxando o próximo jogador do topo da fila de Reservas.
    const failedAttackNow = (hasAttacked && stars < 3) || (warState === 'warEnded' && !hasAttacked);
    const substitutedOut = hasNextRoundRoster && !nextTags.has(member.tag);
    const needsSubstitution = failedAttackNow || substitutedOut;

    let substitutedIn = subbedInByOutTag.get(member.tag) || null;
    if (needsSubstitution && !substitutedIn && availableQueue.length > 0) {
      const nextFromQueue = availableQueue.shift();
      if (nextFromQueue) {
        substitutedIn = {
          tag: nextFromQueue.tag,
          name: nextFromQueue.name || nextFromQueue.tag,
        };
        usedReserveTags.add(nextFromQueue.tag);
      }
    }

    if (needsSubstitution) {
      relegatedPlayers.push({
        tag: member.tag,
        name: member.name || member.tag || `Jogador #${idx + 1}`,
        townHallLevel: member.townhallLevel || member.townHallLevel,
        justFailedAttack: true,
      });
    }

    return {
      lineupOrder: idx + 1,
      mapPosition: member.mapPosition || idx + 1,
      tag: member.tag,
      name: member.name || member.tag || `Jogador #${idx + 1}`,
      townhallLevel: member.townhallLevel,
      hasAttacked,
      stars,
      destructionFormatted,
      substitutedOut,
      substitutedIn,
      needsSubstitution,
    };
  });

  return {
    activeRows,
    reservesQueue: [...availableQueue, ...relegatedPlayers],
    rotationStatsMap,
  };
}

/**
 * Calcula o histórico de guerras concluídas (Vitórias, Derrotas, Empates) na CWL
 * para o clã ativo iterando pelas rodadas.
 */
export function calculateClanWarRecord(myRoundsHistory = [], clanTag = '') {
  const normalizedTag = cleanTag(clanTag);
  let wins = 0;
  let losses = 0;
  let ties = 0;

  (Array.isArray(myRoundsHistory) ? myRoundsHistory : []).forEach(round => {
    if (round.state !== 'warEnded' || !round.mySide || !round.oppSide) return;
    const winnerTag = resolveWarWinner(round.mySide, round.oppSide);
    const myTag = round.mySide.tag;
    const oppTag = round.oppSide.tag;

    if (winnerTag && cleanTag(winnerTag) === cleanTag(myTag)) {
      wins += 1;
    } else if (winnerTag && cleanTag(winnerTag) === cleanTag(oppTag)) {
      losses += 1;
    } else {
      ties += 1;
    }
  });

  return { wins, losses, ties };
}

export async function loadStandings(group, currentTag) {
  const myFullTag = '#' + currentTag;
  const totalRounds = Array.isArray(group.rounds) && group.rounds.length ? group.rounds.length : 7;
  const stats = {};

  group.clans.forEach(c => {
    stats[c.tag] = {
      clan: c,
      location: null,
      stars: 0,
      attackStars: 0,
      missedStars: 0,
      bonusStars: 0,
      destruction: 0,
      warsPlayed: 0,
      completedWars: 0,
      wins: 0,
      losses: 0,
      ties: 0,
    };
  });

  const { clanDetailsList, jobs, warResults } = await fetchGroupDetailsAndWars(group);

  clanDetailsList.forEach((detail, idx) => {
    const clanTag = group.clans[idx]?.tag;
    if (clanTag && stats[clanTag]) {
      stats[clanTag].location = detail?.location || null;
    }
  });

  const warsByRound = Array.from({ length: totalRounds }, () => []);
  let teamSize = null;

  warResults.forEach((res, k) => {
    if (res.status !== 'fulfilled' || !res.value) return;
    const w = { ...res.value, warTag: jobs[k].warTag };
    const rIdx = jobs[k].roundIdx;
    teamSize = teamSize || w.teamSize;
    warsByRound[rIdx].push(w);
  });

  let activeRoundIdx = -1;
  for (let i = 0; i < totalRounds; i++) {
    if (warsByRound[i].some(w => w.state === 'inWar')) { activeRoundIdx = i; break; }
  }
  if (activeRoundIdx === -1) {
    for (let i = totalRounds - 1; i >= 0; i--) {
      if (warsByRound[i].some(w => w.state === 'warEnded')) { activeRoundIdx = i; break; }
    }
  }
  if (activeRoundIdx === -1) activeRoundIdx = 0;

  const myRoundsHistory = [];

  for (let i = 0; i < totalRounds; i++) {
    const roundWars = warsByRound[i] || [];
    let myMatchInRound = null;

    for (const w of roundWars) {
      if (w.clan?.tag === myFullTag) {
        myMatchInRound = {
          day: i + 1,
          warTag: w.warTag,
          state: w.state,
          endTime: w.endTime,
          startTime: w.startTime,
          mySide: w.clan,
          oppSide: w.opponent,
          teamSize: w.teamSize || CWL_TEAM_SIZE,
        };
      } else if (w.opponent?.tag === myFullTag) {
        myMatchInRound = {
          day: i + 1,
          warTag: w.warTag,
          state: w.state,
          endTime: w.endTime,
          startTime: w.startTime,
          mySide: w.opponent,
          oppSide: w.clan,
          teamSize: w.teamSize || CWL_TEAM_SIZE,
        };
      }

      if (w.state === 'preparation') continue;
      const size = w.teamSize || CWL_TEAM_SIZE;
      const winnerTag = w.state === 'warEnded' ? resolveWarWinner(w.clan, w.opponent) : null;

      [w.clan, w.opponent].forEach(side => {
        if (!side || !stats[side.tag]) return;
        const s = stats[side.tag];
        const atkStars = Number(side.stars || 0);
        const dest = Number(side.destructionPercentage || 0) * size;
        const wonBonus = winnerTag && winnerTag === side.tag ? WIN_BONUS_STARS : 0;
        const missed = calculateMissedStarsInWar(side, w.state);

        s.stars += atkStars + wonBonus;
        s.attackStars += atkStars;
        s.missedStars += missed;
        s.bonusStars += wonBonus;
        s.destruction += dest;
        s.warsPlayed += 1;
        if (w.state === 'warEnded') {
          s.completedWars += 1;
          if (winnerTag === side.tag) {
            s.wins += 1;
          } else if (winnerTag === null) {
            s.ties += 1;
          } else {
            s.losses += 1;
          }
        }
      });
    }

    if (myMatchInRound) {
      myRoundsHistory.push(myMatchInRound);
    } else {
      myRoundsHistory.push({ day: i + 1, state: 'unscheduled', mySide: null, oppSide: null, teamSize: CWL_TEAM_SIZE });
    }
  }

  const myClanObj = (Array.isArray(group?.clans) ? group.clans : []).find(
    c => cleanTag(c.tag) === cleanTag(currentTag)
  );
  const clanRoster = Array.isArray(myClanObj?.members) ? myClanObj.members : [];
  const playerRankings = calculatePlayerRatings(clanRoster, myRoundsHistory);
  const clanRating = calculateClanRating(playerRankings);

  const standings = Object.values(stats).sort((a, b) => b.stars - a.stars || b.destruction - a.destruction);
  const leagueData = {
    standings,
    statsByTag: stats,
    round: activeRoundIdx + 1,
    activeRoundIdx,
    totalRounds,
    teamSize: teamSize || CWL_TEAM_SIZE,
    myRoundsHistory,
    clanRoster,
    playerRankings,
    clanRating,
  };
  lastLoadedLeagueData = leagueData;
  return leagueData;
}

export const $ = id => document.getElementById(id);

export const el = {
  form: $('searchForm'),
  tag: $('clanTag'),
  err: $('errorMsg'),
  btnText: $('btnText'),
  spin: $('btnSpinner'),
  searchResultsDropdown: $('searchResultsDropdown'),
  searchResultsCount: $('searchResultsCount'),
  searchResultsList: $('searchResultsList'),
  search: $('searchView'),
  dash: $('dashboardView'),
  favoriteBtn: $('favoriteBtn'),
  headerMenuBtn: $('headerMenuBtn'),
  favAccordionBtn: $('favAccordionBtn'),
  menuFavoritesList: $('menuFavoritesList'),
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
  menu: $('menu'),
  clearCacheBtn: $('clearCacheBtn'),
  policy: $('policyText'),
  deskSearchBtn: $('deskSearchBtn'),
  deskPolicyBtn: $('deskPolicyBtn'),
  deskPolicyPopover: $('deskPolicyPopover'),
  clanLoc: $('clanLocation'),
  clanLeague: $('clanLeague'),
  clanLeagueIcon: $('clanLeagueIcon'),
  clanRating: $('clanRating'),
  statWarsWon: $('statWarsWon'),
  statWarsLost: $('statWarsLost'),
  statWarsTied: $('statWarsTied'),
  statGained: $('statStarsGained'),
  statLost: $('statStarsLost'),
  statBonus: $('statStarsBonus'),
  tabStandingsBtn: $('tabStandingsBtn'),
  tabRoundsBtn: $('tabRoundsBtn'),
  tabRankingBtn: $('tabRankingBtn'),
  tabStandings: $('tabStandings'),
  tabRounds: $('tabRounds'),
  tabRanking: $('tabRanking'),
  roundsList: $('roundsList'),
  rankingList: $('rankingList'),
};

export const DEFAULT_UNRANKED_LEAGUE_ICON = './assets/leagues/29000000.png';
export const INTERNATIONAL_FLAG_PATH = './assets/flags/international.svg';
export const UP_IMG_PATH = './assets/up.png';
export const DOWN_IMG_PATH = './assets/down.png';
export const STAY_IMG_PATH = './assets/stay.png';
export { DEFAULT_BADGE };

export const mk = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};

export function getLeagueIconPath(warLeague) {
  const id = warLeague?.id;
  if (!id) return null;
  const lastTwoDigits = String(id).slice(-2).padStart(2, '0');
  return `./assets/leagues/290000${lastTwoDigits}.png`;
}

export function createLocationFlagNode(location, forLeaderboard = false) {
  const flagImg = mk('img', forLeaderboard ? 'row-flag' : 'loc-flag');
  const locName = location?.name || 'International';

  if (location && location.isCountry !== false && location.countryCode) {
    const code = String(location.countryCode).trim().toLowerCase();
    flagImg.src = `./assets/flags/${code}.svg`;
    flagImg.alt = locName;
    flagImg.title = locName;
    flagImg.addEventListener('error', () => {
      flagImg.src = INTERNATIONAL_FLAG_PATH;
    }, { once: true });
    return flagImg;
  }

  flagImg.src = INTERNATIONAL_FLAG_PATH;
  flagImg.alt = locName;
  flagImg.title = locName;
  return flagImg;
}

export function updateBannerRating(rating) {
  if (el.clanRating) {
    if (rating != null && rating !== '' && Number(rating) > 0) {
      el.clanRating.textContent = `Rating: ${rating}`;
      el.clanRating.hidden = false;
    } else {
      el.clanRating.textContent = 'Rating: —';
      el.clanRating.hidden = false;
    }
  }
}

/**
 * Reordena os elementos informativos do Banner estritamente de cima para baixo:
 * 1. Clan Name
 * 2. League Name (League Icon + Text)
 * 3. Rating (Renderizado puramente como texto, e.g. "Rating: 1788", sem ícones)
 * 4. Location (Bandeira + Nome do País)
 */
export function renderBannerInfo(clan, rating = null) {
  const bannerInfo = document.querySelector('.banner-info');
  if (!bannerInfo) return;

  const clanName = $('clanName');
  const leagueWrap = document.querySelector('.league-wrap');
  const clanRating = $('clanRating');
  const clanLoc = $('clanLocation');

  if (clanName) bannerInfo.appendChild(clanName);
  if (leagueWrap) bannerInfo.appendChild(leagueWrap);
  if (clanRating) bannerInfo.appendChild(clanRating);
  if (clanLoc) bannerInfo.appendChild(clanLoc);

  if (rating !== undefined && rating !== null) {
    updateBannerRating(rating);
  }
}

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
      el.clanLeagueIcon.onerror = () => {
        el.clanLeagueIcon.onerror = () => { el.clanLeagueIcon.hidden = true; };
        el.clanLeagueIcon.src = DEFAULT_UNRANKED_LEAGUE_ICON;
      };
    } else {
      el.clanLeagueIcon.hidden = true;
    }
  }

  renderBannerInfo(clan);
}

/**
 * Renderiza os números absolutos das estatísticas do clã no grid 2x3:
 * Linha 1: Vitórias | Derrotas | Empates
 * Linha 2: Ganhas | Perdidas | Bônus
 */
export function updateBannerStats(gained = 0, lost = 0, bonus = 0, wins = 0, losses = 0, ties = 0) {
  if (el.statWarsWon) el.statWarsWon.querySelector('span').textContent = String(Math.abs(wins));
  if (el.statWarsLost) el.statWarsLost.querySelector('span').textContent = String(Math.abs(losses));
  if (el.statWarsTied) el.statWarsTied.querySelector('span').textContent = String(Math.abs(ties));
  if (el.statGained) el.statGained.querySelector('span').textContent = String(Math.abs(gained));
  if (el.statLost) el.statLost.querySelector('span').textContent = String(Math.abs(lost));
  if (el.statBonus) el.statBonus.querySelector('span').textContent = String(Math.abs(bonus));
}

export function updateFavoriteButton(tag) {
  if (!el.favoriteBtn) return;
  const fav = isClanFavorite(tag);
  el.favoriteBtn.classList.toggle('active', fav);
  el.favoriteBtn.setAttribute('aria-pressed', String(fav));
  el.favoriteBtn.title = fav ? 'Remover dos Favoritos' : 'Adicionar aos Favoritos';
  const icon = el.favoriteBtn.querySelector('.fav-icon');
  if (icon) {
    icon.className = fav ? 'ph-fill ph-star fav-icon' : 'ph-bold ph-star fav-icon';
  }
}

export function renderMenuFavorites(onSelectClan) {
  if (!el.menuFavoritesList) return;
  el.menuFavoritesList.replaceChildren();
  const list = getFavorites();

  if (!list.length) {
    el.menuFavoritesList.append(
      mk('div', 'menu-fav-empty', 'Nenhum clã favoritado ainda. Toque na estrela no banner do clã para salvar.')
    );
    return;
  }

  list.forEach(fav => {
    const item = mk('button', 'menu-fav-item');
    item.type = 'button';

    const img = mk('img', 'menu-fav-badge');
    img.src = fav.badgeUrl || DEFAULT_BADGE;
    img.alt = '';

    const info = mk('div', 'menu-fav-info');
    info.append(
      mk('span', 'menu-fav-name', fav.name),
      mk('span', 'menu-fav-tag', `#${cleanTag(fav.tag)}`)
    );

    item.append(img, info, mk('i', 'ph-bold ph-caret-right menu-fav-arrow'));
    item.addEventListener('click', () => {
      setMobileMenu(false);
      if (typeof onSelectClan === 'function') onSelectClan(fav.tag);
    });

    el.menuFavoritesList.append(item);
  });
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

function setElementVisibility(node, visible) {
  if (!node) return;
  node.hidden = !visible;
  node.classList.toggle('hidden', !visible);
}

export function switchTab(tabName) {
  const tabs = [
    { name: 'standings', btn: el.tabStandingsBtn, panel: el.tabStandings },
    { name: 'rounds', btn: el.tabRoundsBtn, panel: el.tabRounds },
    { name: 'ranking', btn: el.tabRankingBtn, panel: el.tabRanking },
  ];
  tabs.forEach(t => {
    if (!t.btn || !t.panel) return;
    const active = t.name === tabName;
    t.btn.classList.toggle('active', active);
    t.btn.setAttribute('aria-selected', String(active));
    t.panel.hidden = !active;
  });
}

export function showSearchView() {
  setElementVisibility(el.dash, false);
  setElementVisibility(el.warEventsView, false);
  setElementVisibility(el.search, true);
  el.tag.value = '';
  clearError();
  if (el.searchResultsDropdown) el.searchResultsDropdown.hidden = true;
}

export function showDashboardView() {
  setElementVisibility(el.search, false);
  setElementVisibility(el.warEventsView, false);
  setElementVisibility(el.dash, true);
  if (el.searchResultsDropdown) el.searchResultsDropdown.hidden = true;
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

export function toggleFavoritesAccordion(forceOpen = null) {
  const btn = el.favAccordionBtn || $('favAccordionBtn');
  const list = el.menuFavoritesList || $('menuFavoritesList');
  if (!btn || !list) return;
  const isCurrentlyOpen = !list.hidden;
  const nextOpen = forceOpen !== null ? Boolean(forceOpen) : !isCurrentlyOpen;
  list.hidden = !nextOpen;
  btn.classList.toggle('expanded', nextOpen);
  btn.setAttribute('aria-expanded', String(nextOpen));
}

export function setMobileMenu(open, onSelectClan) {
  el.menu.classList.toggle('open', open);
  el.menu.setAttribute('aria-hidden', !open);
  if (open) {
    renderMenuFavorites(onSelectClan);
  } else {
    toggleFavoritesAccordion(false);
  }
}

export async function clearAppCache() {
  try {
    localStorage.clear();
    sessionStorage.clear();
  } catch {}

  if ('caches' in window) {
    try {
      await caches.keys().then(keys => Promise.all(keys.map(key => caches.delete(key))));
    } catch {}
  }

  if ('serviceWorker' in navigator) {
    try {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(registrations.map(reg => reg.unregister()));
    } catch {}
  }

  window.alert('Cache limpo com sucesso!');
  window.location.reload(true);
}

export function closeDesktopPopovers() {
  if (el.deskPolicyPopover) el.deskPolicyPopover.hidden = true;
  if (el.deskPolicyBtn) el.deskPolicyBtn.setAttribute('aria-expanded', 'false');
}

/**
 * Renderiza o dropdown dinâmico com a lista de resultados da busca por nome.
 * Exibe: Escudo, Nome do Clã, Liga de Guerra (ícone + nome) e Membros (ex: "45/50").
 */
export function renderSearchResults(clans, onSelectClan) {
  if (!el.searchResultsDropdown || !el.searchResultsList) return;
  el.searchResultsList.replaceChildren();

  if (!clans || clans.length === 0) {
    el.searchResultsCount.textContent = '0 encontrados';
    el.searchResultsList.append(mk('div', 'search-result-empty', 'Nenhum clã encontrado com este nome.'));
    el.searchResultsDropdown.hidden = false;
    return;
  }

  el.searchResultsCount.textContent = `${clans.length} encontrado(s)`;

  clans.forEach(clan => {
    const item = mk('button', 'search-result-row');
    item.type = 'button';

    const badge = mk('img', 'search-result-badge');
    badge.src = clan.badgeUrls?.small || clan.badgeUrls?.medium || DEFAULT_BADGE;
    badge.alt = '';

    const info = mk('div', 'search-result-info');
    const titleRow = mk('div', 'search-result-title-row');
    titleRow.append(
      mk('span', 'search-result-name', clan.name),
      mk('span', 'search-result-tag', clan.tag)
    );

    const metaRow = mk('div', 'search-result-meta-row');
    const leagueWrap = mk('span', 'search-result-league');
    const iconPath = getLeagueIconPath(clan.warLeague);
    if (iconPath) {
      const lImg = mk('img', 'search-result-league-icon');
      lImg.src = iconPath;
      lImg.alt = '';
      lImg.onerror = () => {
        lImg.onerror = () => lImg.remove();
        lImg.src = DEFAULT_UNRANKED_LEAGUE_ICON;
      };
      leagueWrap.append(lImg);
    }
    leagueWrap.append(document.createTextNode(clan.warLeague?.name || 'Sem liga'));

    const membersBadge = mk('span', 'search-result-members', `${clan.members || 0}/50`);
    metaRow.append(leagueWrap, membersBadge);

    info.append(titleRow, metaRow);
    item.append(badge, info, mk('i', 'ph-bold ph-caret-right search-result-arrow'));

    item.addEventListener('click', () => {
      el.searchResultsDropdown.hidden = true;
      if (typeof onSelectClan === 'function') onSelectClan(clan.tag);
    });

    el.searchResultsList.append(item);
  });

  el.searchResultsDropdown.hidden = false;
}

/**
 * Renderiza a Aba 1: Classificação usando imagens locais para tendências
 * e tornando as linhas interativas (ao clicar, carrega o dashboard do clã correspondente).
 */
export function renderLeaderboard(standings, currentTag, onSelectClan) {
  const box = $('leaderboard');
  box.replaceChildren();
  const normalizedCurrentTag = cleanTag(currentTag);

  standings.forEach((s, i) => {
    const isMe = cleanTag(s.clan.tag) === normalizedCurrentTag;
    const row = mk('div', 'row leaderboard-row' + (isMe ? ' me' : ''));
    row.dataset.tag = s.clan.tag;
    row.setAttribute('role', 'button');
    row.setAttribute('tabindex', '0');
    row.setAttribute('title', `Ver dados de ${s.clan.name}`);

    row.append(mk('span', 'pos', i + 1));

    const trendImg = mk('img', 'trend-icon');
    if (i < 2) {
      trendImg.src = UP_IMG_PATH;
      trendImg.alt = 'Up';
    } else if (i >= standings.length - 2) {
      trendImg.src = DOWN_IMG_PATH;
      trendImg.alt = 'Down';
    } else {
      trendImg.src = STAY_IMG_PATH;
      trendImg.alt = 'Stay';
    }
    row.append(trendImg);

    row.append(createLocationFlagNode(s.location, true));

    const img = mk('img', 'row-shield');
    img.src = s.clan.badgeUrls?.small || DEFAULT_BADGE;
    img.alt = '';
    row.append(img, mk('div', 'nm', s.clan.name));

    const st = mk('div', 'stars');
    st.append(mk('i', 'ph-fill ph-star'), document.createTextNode(s.stars));
    row.append(st);

    const handleSelect = () => {
      const selectedTag = row.dataset.tag || s.clan.tag;
      if (typeof onSelectClan === 'function' && selectedTag) {
        onSelectClan(selectedTag);
        const mainEl = $('main');
        if (mainEl) mainEl.scrollTop = 0;
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
    };

    row.addEventListener('click', handleSelect);
    row.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        handleSelect();
      }
    });

    box.append(row);
  });
}

/**
 * Renderiza a Aba 3: Ranking de Jogadores (Sistema de Rating 0 a 2000 pontos).
 * - Cada linha exibe: Posição (#1, #2...), Nome do Jogador e Rating (ex: "🏆 1850").
 * - Ao clicar na linha, expande/recolhe o resumo estatístico do jogador:
 *   Total de Estrelas, Destruição Média, Tempo Médio e Rodadas Jogadas.
 */
export function renderRanking(leagueData) {
  const box = el.rankingList;
  if (!box) return;
  box.replaceChildren();

  const rankings = Array.isArray(leagueData?.playerRankings)
    ? leagueData.playerRankings
    : calculatePlayerRatings(leagueData?.clanRoster || [], leagueData?.myRoundsHistory || []);

  if (!rankings.length) {
    box.append(mk('div', 'notice', 'Nenhum jogador encontrado no elenco desta CWL.'));
    return;
  }

  rankings.forEach(player => {
    const card = mk('div', 'ranking-card' + (player.rank <= 3 && player.rating > 0 ? ` top-${player.rank}` : ''));
    card.setAttribute('role', 'button');
    card.setAttribute('tabindex', '0');
    card.setAttribute('aria-expanded', 'false');

    const mainRow = mk('div', 'ranking-main');
    const posEl = mk('span', 'ranking-pos', `#${player.rank}`);
    const nameWrap = mk('div', 'ranking-name-wrap');
    nameWrap.append(mk('span', 'ranking-name', player.name));

    const rightWrap = mk('div', 'ranking-right');
    const scoreBadge = mk('span', 'ranking-score', `🏆 ${player.rating}`);
    const caretIcon = mk('i', 'ph-bold ph-caret-down ranking-caret');
    rightWrap.append(scoreBadge, caretIcon);

    mainRow.append(posEl, nameWrap, rightWrap);

    const details = mk('div', 'ranking-details');
    details.hidden = true;

    const statsGrid = mk('div', 'ranking-stats-grid');
    const statItems = [
      { label: 'Estrelas Totais', value: `${player.totalStars}★` },
      { label: 'Destruição Média', value: player.avgDestructionFormatted },
      { label: 'Tempo Médio', value: player.avgTimeFormatted },
      { label: 'Rodadas Jogadas', value: `${player.roundsPlayed}` },
    ];

    statItems.forEach(st => {
      const boxItem = mk('div', 'ranking-stat-box');
      boxItem.append(
        mk('span', 'ranking-stat-label', st.label),
        mk('span', 'ranking-stat-value', st.value)
      );
      statsGrid.append(boxItem);
    });

    details.append(statsGrid);
    card.append(mainRow, details);

    const toggleExpand = () => {
      const willExpand = details.hidden;
      details.hidden = !willExpand;
      card.classList.toggle('expanded', willExpand);
      card.setAttribute('aria-expanded', String(willExpand));
    };

    card.addEventListener('click', toggleExpand);
    card.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        toggleExpand();
      }
    });

    box.append(card);
  });
}

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

export async function exportReportToPng() {
  if (!el.warReportList || typeof window.html2canvas !== 'function') return;

  const roundNumber = Number(activeReportRoundDay) || 1;
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

    const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
    const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
    const isMobilePWA = isStandalone && isMobile;

    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    if (!blob) return;

    const fileName = `substituicoes_rodada_${roundNumber}.png`;
    const file = new File([blob], fileName, { type: 'image/png' });

    if (isMobilePWA && navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({
        files: [file],
        title: `Relatório CWL - Rodada ${roundNumber}`,
      });
    } else {
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = objectUrl;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    }
  } catch {
  } finally {
    if (btn) btn.disabled = false;
    if (labelSpan) labelSpan.textContent = prevLabel;
  }
}

/**
 * Renderiza o Relatório dos 15 jogadores "Titulares" e da fila de "Reservas":
 * 1. Cabeçalhos: "Titulares" e "Reservas", com `.report-section-hint` exibindo "Rodada [X]".
 * 2. Avaliação em tempo real: Assim que um titular ataca e faz < 3 estrelas (ou a guerra encerra sem ataque),
 *    projeta imediatamente sua substituição puxando o próximo jogador do topo da fila de "Reservas".
 * 3. Prioridade da Fila de Reservas:
 *    - Maior Prioridade (Topo): Jogadores com 0 rodadas jogadas na liga até o momento.
 *    - Menor Prioridade (Fim): Jogadores que acabaram de falhar um ataque vão para o final da fila.
 */
function renderClanPerformanceReport(
  mySide,
  nextMySide = null,
  fullRoster = [],
  roundDay = 1,
  myRoundsHistory = [],
  warState = 'inWar'
) {
  if (!el.warReportList) return;
  el.warReportList.replaceChildren();

  const effectiveHistory = Array.isArray(myRoundsHistory) && myRoundsHistory.length > 0
    ? myRoundsHistory
    : (lastLoadedLeagueData?.myRoundsHistory || []);
  const effectiveRoster = Array.isArray(fullRoster) && fullRoster.length > 0
    ? fullRoster
    : (lastLoadedLeagueData?.clanRoster || []);

  const { activeRows: reportRows, reservesQueue, rotationStatsMap } = buildClanPerformanceReport(
    mySide,
    nextMySide,
    effectiveRoster,
    roundDay,
    effectiveHistory,
    warState
  );

  if (reportRows.length === 0) {
    el.warReportList.append(
      mk('div', 'war-events-empty', 'Escalação não disponível para esta rodada.')
    );
    return;
  }

  // 1. Cabeçalho dos 15 Titulares
  const activeSectionBar = mk('div', 'report-section-divider first');
  activeSectionBar.append(
    mk('span', 'label', 'Titulares'),
    mk('span', 'report-section-hint', `Rodada ${roundDay}`)
  );
  el.warReportList.append(activeSectionBar);

  reportRows.forEach(player => {
    const row = mk(
      'div',
      `war-report-row ${player.needsSubstitution ? 'penalty' : ''}`.trim()
    );

    const posEl = mk('span', 'war-event-num', `#${player.lineupOrder}`);
    const playerCol = mk('div', 'war-report-player');

    // Layout Vertical de Substituição
    if (player.substitutedIn) {
      playerCol.classList.add('sub-vertical');

      // Linha 1: Substituto (quem entra)
      const inLine = mk('div', 'sub-line in-line');
      inLine.append(
        mk('span', 'war-report-name', player.substitutedIn.name),
        (() => {
          const img = mk('img', 'trend-icon report-trend');
          img.src = UP_IMG_PATH;
          img.alt = 'Up';
          img.title = `Entra na próxima rodada: ${player.substitutedIn.name}`;
          return img;
        })()
      );

      // Linha 2: Substituído (quem sai)
      const outLine = mk('div', 'sub-line out-line');
      outLine.append(
        mk('span', 'war-report-name', player.name),
        (() => {
          const img = mk('img', 'trend-icon report-trend');
          img.src = DOWN_IMG_PATH;
          img.alt = 'Down';
          img.title = 'Substituído na próxima rodada';
          return img;
        })()
      );

      playerCol.append(inLine, outLine);
    } else {
      playerCol.append(mk('span', 'war-report-name', player.name));

      if (player.needsSubstitution) {
        const downImg = mk('img', 'trend-icon report-trend');
        downImg.src = DOWN_IMG_PATH;
        downImg.alt = 'Down';
        downImg.title = player.substitutedOut
          ? 'Substituído na próxima rodada'
          : player.hasAttacked
            ? `Apenas ${player.stars} estrela(s) — sugerida substituição`
            : 'Ataque não realizado — sugerida substituição';
        playerCol.append(downImg);
      }
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

  // 2. Seção de Reservas (Fila Priorizada)
  if (reservesQueue.length > 0) {
    const divider = mk('div', 'report-section-divider');
    divider.append(
      mk('span', 'label', 'Reservas'),
      mk('span', 'report-section-hint', `Rodada ${roundDay}`)
    );
    el.warReportList.append(divider);

    reservesQueue.forEach((res, idx) => {
      const row = mk('div', 'war-report-row reserve-row');
      const posEl = mk('span', 'war-event-num', `#${idx + 1}`);

      const playerCol = mk('div', 'war-report-player');
      playerCol.append(mk('span', 'war-report-name', res.name || res.tag));

      const thLevel = res.townHallLevel || res.townhallLevel;
      if (thLevel) {
        const thTag = mk('span', 'war-report-bench-tag', `CV${thLevel}`);
        playerCol.append(thTag);
      }

      const stat = rotationStatsMap.get(res.tag);
      const roundsPlayed = stat?.roundsPlayed ?? 0;
      const statusText = res.justFailedAttack
        ? 'Fim da fila'
        : roundsPlayed === 0
          ? '0 rodadas'
          : `${roundsPlayed} rod.`;

      const statusTag = mk('span', 'war-report-bench-tag', statusText);

      row.append(posEl, playerCol, statusTag);
      el.warReportList.append(row);
    });
  }
}

export function populateAndShowWarEventsView(warData, day, currentTag, nextWarData = null, fullRoster = []) {
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

  const isSpecialClan = isReportClanTag(currentTag);
  setElementVisibility(el.warEventsModeTabs, isSpecialClan);
  switchWarEventsMode('events');

  if (isSpecialClan) {
    renderClanPerformanceReport(
      mySide,
      nextMySide,
      fullRoster,
      activeReportRoundDay,
      lastLoadedLeagueData?.myRoundsHistory || [],
      warData.state
    );
  } else if (el.warReportList) {
    el.warReportList.replaceChildren();
  }

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
    const starsRow = mk('div', 'war-events-hero-stars');
    starsRow.append(
      document.createTextNode(`${myStars} `),
      mk('img', '', ''),
      document.createTextNode(` ${oppStars}`)
    );
    const centerStarImg = starsRow.querySelector('img');
    if (centerStarImg) {
      centerStarImg.src = 'assets/gold_star.png';
      centerStarImg.alt = 'Stars';
    }

    centerScore.append(
      starsRow,
      mk('span', 'war-events-hero-dest', `${myDest}% × ${oppDest}%`),
      mk('span', 'war-events-hero-time')
    );
    const heroTime = centerScore.querySelector('.war-events-hero-time');
    heroTime.append(mk('i', 'ph-bold ph-clock'), document.createTextNode(timeRemainingText));

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

  const warEvents = buildWarEvents(mySide, oppSide);

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
        mk('span', 'round-team-name', myClanName)
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
        mk('span', 'round-team-name', 'A definir')
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
      mk('span', 'round-team-name', item.mySide.name)
    );
    leftTeam.append(leftImg, leftInfo);

    const scoreBox = mk('div', 'round-score-box');
    const scoreStars = mk('div', 'round-stars');
    scoreStars.append(
      document.createTextNode(`${myStars} `),
      mk('i', 'ph-fill ph-star'),
      document.createTextNode(` ${oppStars}`)
    );
    scoreBox.append(scoreStars);

    const rightTeam = mk('div', 'round-team opp');
    const rightImg = mk('img');
    rightImg.src = item.oppSide.badgeUrls?.small || DEFAULT_BADGE;
    rightImg.alt = '';
    const rightInfo = mk('div', 'round-team-info');
    rightInfo.append(
      mk('span', 'round-team-name', item.oppSide.name)
    );
    rightTeam.append(rightImg, rightInfo);

    mainRow.append(leftTeam, scoreBox, rightTeam);

    const metaRow = mk('div', 'round-matchup-meta');
    const ctaEl = mk('span', 'round-events-cta');
    const ctaLabel = mk('span', '', 'Eventos');
    const ctaIcon = mk('i', 'ph-bold ph-arrow-right');
    ctaEl.append(ctaLabel, ctaIcon);

    metaRow.append(ctaEl);
    matchup.append(mainRow, metaRow);

    const handleOpenWarEvents = async () => {
      const warTag = card.dataset.warTag;
      if (!warTag || card.classList.contains('loading')) return;

      card.classList.add('loading');
      const prevText = ctaLabel.textContent;
      ctaLabel.textContent = 'Carregando…';
      ctaIcon.className = 'ph-bold ph-circle-notch spin';

      try {
        const nextRoundItem = myRoundsHistory.find(r => r.day === item.day + 1);
        const knownNextWarTag = nextRoundItem?.warTag || null;

        const [warData, nextWarData, fullRoster] = await Promise.all([
          fetchWarData(warTag),
          isReportClanTag(currentTag)
            ? fetchNextRoundClanWar(currentTag, warTag, knownNextWarTag)
            : Promise.resolve(null),
          isReportClanTag(currentTag)
            ? fetchLeagueGroupClanRoster(currentTag)
            : Promise.resolve([]),
        ]);

        populateAndShowWarEventsView(warData, item.day, currentTag, nextWarData, fullRoster);
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
