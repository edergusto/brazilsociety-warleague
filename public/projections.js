/**
 * projections.js
 * Módulo de regras de negócio CWL, matemática de estrelas, eventos de guerra,
 * limites de promoção/rebaixamento (Moneyball) e lógica do simulador interativo.
 */

import { fetchGroupDetailsAndWars } from './api.js';

export const MONTHS = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
];

// Constantes da Regra de Negócio CWL (Formato 15v15)
export const CWL_TEAM_SIZE = 15;
export const MAX_ATTACK_STARS = 45; // 15v15 => máximo de 45 estrelas base em ataques por rodada
export const WIN_BONUS_STARS = 10;  // +10 estrelas automáticas por vitória no confronto direto
export const MAX_WAR_TOTAL = MAX_ATTACK_STARS + WIN_BONUS_STARS; // 55 estrelas máximas por guerra

export const clamp = (n, min, max) => Math.min(max, Math.max(min, n));

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

/**
 * Extrai todos os objetos de ataque de um lado da guerra (clan ou opponent),
 * suportando tanto `side.members[].attacks` quanto `side.attacks` (se for array).
 */
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

/**
 * Mapeia attackerTag e defenderTag usando os membros de `mySide.members` e `oppSide.members`
 * e retorna a lista cronológica de ataques da guerra.
 */
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

  // Ordem cronológica reversa: o ataque mais recente (último ataque) no topo e o #1 na base
  return chronological.reverse();
}

/**
 * Avalia o desempenho dos 15 jogadores do clã na rodada (ordenados por `mapPosition`)
 * e compara com a escalação da próxima rodada (`nextMySide.members`) para mapear substituições:
 * - Substituted Out: Presente na rodada atual e ausente na próxima (Seta vermelha para baixo).
 * - Substituted In: Ausente na rodada atual e presente na próxima (Seta verde para cima ao lado do substituído).
 */
export function buildClanPerformanceReport(mySide, nextMySide = null) {
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
  subbedOutMembers.forEach((outMember, idx) => {
    const incoming = subbedInMembers[idx] || null;
    if (incoming) {
      subbedInByOutTag.set(outMember.tag, {
        tag: incoming.tag,
        name: incoming.name || incoming.tag,
        mapPosition: incoming.mapPosition,
      });
    }
  });

  const attacksByAttacker = new Map();
  extractSideAttacks(mySide).forEach(atk => {
    if (!atk?.attackerTag) return;
    if (!attacksByAttacker.has(atk.attackerTag)) {
      attacksByAttacker.set(atk.attackerTag, []);
    }
    attacksByAttacker.get(atk.attackerTag).push(atk);
  });

  return members.map((member, idx) => {
    const memberAttacks = Array.isArray(member.attacks) && member.attacks.length > 0
      ? member.attacks
      : (attacksByAttacker.get(member.tag) || []);

    const atk = memberAttacks[0] || null;
    const hasAttacked = Boolean(atk);
    const stars = hasAttacked ? Number(atk.stars || 0) : 0;
    const pct = hasAttacked ? Number(atk.destructionPercentage || 0) : 0;
    const destructionFormatted = Number.isInteger(pct) ? String(pct) : pct.toFixed(1);

    const substitutedOut = hasNextRoundRoster && !nextTags.has(member.tag);
    const substitutedIn = subbedInByOutTag.get(member.tag) || null;
    const penaltyByAttack = !hasAttacked || stars < 3;
    const needsSubstitution = hasNextRoundRoster
      ? (substitutedOut || penaltyByAttack)
      : penaltyByAttack;

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

/**
 * Carrega e consolida a classificação, estatísticas de estrelas e histórico de confrontos do grupo.
 */
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
      baseStars: 0,
      baseDestruction: 0,
      avgAttackStars: 30,
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
          if (wonBonus > 0) s.wins += 1;
        }

        if (i < activeRoundIdx) {
          s.baseStars += atkStars + wonBonus;
          s.baseDestruction += dest;
        }
      });
    }

    if (myMatchInRound) {
      myRoundsHistory.push(myMatchInRound);
    } else {
      myRoundsHistory.push({ day: i + 1, state: 'unscheduled', mySide: null, oppSide: null, teamSize: CWL_TEAM_SIZE });
    }
  }

  Object.values(stats).forEach(s => {
    s.avgAttackStars = s.warsPlayed > 0
      ? clamp(Math.round(s.attackStars / s.warsPlayed), 0, MAX_ATTACK_STARS)
      : 30;
  });

  const activeMatch = myRoundsHistory[activeRoundIdx] && myRoundsHistory[activeRoundIdx].mySide
    ? myRoundsHistory[activeRoundIdx]
    : null;
  const currentOpponentTag = activeMatch?.oppSide?.tag || null;

  const standings = Object.values(stats).sort((a, b) => b.stars - a.stars || b.destruction - a.destruction);
  return {
    standings,
    statsByTag: stats,
    round: activeRoundIdx + 1,
    activeRoundIdx,
    totalRounds,
    teamSize: teamSize || CWL_TEAM_SIZE,
    warsByRound,
    currentOpponentTag,
    currentMyWar: activeMatch ? { war: { state: activeMatch.state }, mySide: activeMatch.mySide, oppSide: activeMatch.oppSide } : null,
    myRoundsHistory,
  };
}

/**
 * Calcula todos os indicadores analíticos Moneyball (Promoção, Sobrevivência, Confronto Direto e valor inicial do Simulador).
 */
export function calculateProjectionsMetrics(data, currentTag) {
  const { standings, statsByTag, totalRounds, currentOpponentTag, currentMyWar } = data;
  const myFullTag = '#' + currentTag;
  const myIndex = standings.findIndex(s => s.clan.tag === myFullTag);

  if (myIndex === -1 || standings.length < 2) {
    return null;
  }

  const myStats = standings[myIndex];
  const remainingWars = Math.max(0, totalRounds - myStats.completedWars);

  // 1. META DE PROMOÇÃO (NÚMERO MÁGICO - TOP 2)
  const promoCutoffClan = myIndex < 2
    ? (standings[2] || standings[standings.length - 1])
    : standings[1];

  const rivalRemainingWars = Math.max(0, totalRounds - promoCutoffClan.completedWars);
  const rivalMaxPossible = promoCutoffClan.stars + (rivalRemainingWars * MAX_WAR_TOTAL);
  const magicStarsNeeded = remainingWars > 0
    ? Math.max(0, (rivalMaxPossible + 1) - myStats.stars)
    : Math.max(0, (promoCutoffClan.stars + 1) - myStats.stars);

  let promoBadgeText = '';
  let promoBadgeClass = 'proj-badge ';
  if (myIndex < 2 && magicStarsNeeded === 0) {
    promoBadgeText = 'Promovido';
    promoBadgeClass += 'ok';
  } else if (myIndex < 2) {
    promoBadgeText = `${myIndex + 1}º Lugar • Top 2`;
    promoBadgeClass += 'ok';
  } else {
    promoBadgeText = `${myIndex + 1}º Lugar`;
    promoBadgeClass += 'warn';
  }

  const promoText =
    `Para garantir a promoção matematicamente, precisamos de ${magicStarsNeeded} estrelas nas ${remainingWars} guerras restantes.`;

  // 2. MÉDIA DE SOBREVIVÊNCIA (RISCO DE REBAIXAMENTO - 6º LUGAR PARA CIMA)
  const safeZoneIndex = Math.max(0, standings.length - 3);
  const relegationIndex = Math.max(0, standings.length - 2);
  const sixthClan = standings[safeZoneIndex];
  const seventhClan = standings[relegationIndex];

  let starsToEscapeRisk = 0;
  let survivalBadgeText = '';
  let survivalBadgeClass = 'proj-badge ';

  if (myIndex > safeZoneIndex) {
    const immediateGap = Math.max(1, (sixthClan.stars + 1) - myStats.stars);
    const sixthPacePerWar = sixthClan.warsPlayed > 0
      ? Math.round(sixthClan.stars / sixthClan.warsPlayed)
      : (sixthClan.avgAttackStars + 5);
    const projectedSixthTotal = sixthClan.stars + (remainingWars * sixthPacePerWar);
    starsToEscapeRisk = remainingWars > 0
      ? Math.max(immediateGap, (projectedSixthTotal + 1) - myStats.stars)
      : immediateGap;

    survivalBadgeText = 'Zona de Risco';
    survivalBadgeClass += 'danger';
  } else {
    const seventhPacePerWar = seventhClan.warsPlayed > 0
      ? Math.round(seventhClan.stars / seventhClan.warsPlayed)
      : seventhClan.avgAttackStars;
    const projectedSeventhTotal = seventhClan.stars + (remainingWars * seventhPacePerWar);
    starsToEscapeRisk = remainingWars > 0
      ? Math.max(0, (projectedSeventhTotal + 1) - myStats.stars)
      : 0;

    survivalBadgeText = `${myIndex + 1}º • Zona Segura`;
    survivalBadgeClass += 'ok';
  }

  const rawSurvivalAvg = remainingWars > 0 ? (starsToEscapeRisk / remainingWars) : 0;
  const formattedSurvivalAvg = Number.isInteger(rawSurvivalAvg)
    ? String(rawSurvivalAvg)
    : rawSurvivalAvg.toFixed(1).replace('.', ',');

  const survivalText =
    `Faltam ${starsToEscapeRisk} estrelas para sair da zona de risco. Uma média de ${formattedSurvivalAvg} estrelas por guerra garante a permanência.`;

  // 3. CENÁRIO DE CONFRONTO DIRETO
  let h2hTarget = null;
  let h2hSubtitle = '';
  if (myIndex > 0) {
    h2hTarget = standings[myIndex - 1];
    h2hSubtitle = `Acima na Tabela (${myIndex}º Lugar) • Bônus +10★`;
  } else if (currentOpponentTag && statsByTag[currentOpponentTag] && currentOpponentTag !== myFullTag) {
    h2hTarget = statsByTag[currentOpponentTag];
    h2hSubtitle = 'Adversário da Rodada Atual • Bônus +10★';
  } else {
    h2hTarget = standings[1];
    h2hSubtitle = 'Vice-Líder do Grupo • Bônus +10★';
  }

  const starsAhead = Math.max(0, h2hTarget.stars - myStats.stars);
  const minAttackToOvertake = starsAhead > 0
    ? Math.max(1, starsAhead - WIN_BONUS_STARS + 1)
    : clamp(h2hTarget.avgAttackStars + 1, 1, MAX_ATTACK_STARS);

  const h2hBadgeText = starsAhead > 0 ? `-${starsAhead}★` : 'Líder';
  const h2hBadgeClass = 'proj-badge ' + (starsAhead === 0 ? 'ok' : starsAhead <= 25 ? 'warn' : 'danger');
  const h2hText =
    `O clã ${h2hTarget.clan.name} está ${starsAhead} estrelas à frente. Precisamos vencer o confronto direto fazendo pelo menos ${minAttackToOvertake} estrelas no ataque (contando com o bônus de vitória) para ultrapassá-los.`;

  // 4. VALOR INICIAL DO SIMULADOR (0 A 45 ESTRELAS)
  const initialSliderStars = currentMyWar && currentMyWar.war.state !== 'preparation'
    ? clamp(Number(currentMyWar.mySide?.stars || myStats.avgAttackStars), 0, MAX_ATTACK_STARS)
    : clamp(myStats.avgAttackStars, 0, MAX_ATTACK_STARS);

  return {
    promoBadgeText,
    promoBadgeClass,
    promoText,
    survivalBadgeText,
    survivalBadgeClass,
    survivalText,
    h2hSubtitle,
    h2hBadgeText,
    h2hBadgeClass,
    h2hText,
    initialSliderStars,
  };
}

/**
 * Calcula o cenário simulado da rodada atual com base nas estrelas estimadas no slider (0 a 45).
 */
export function calculateSimulationScenario(leagueData, currentTag, simAttackStars) {
  if (!leagueData) return null;
  const { standings, statsByTag, activeRoundIdx, warsByRound, currentOpponentTag } = leagueData;
  const myFullTag = '#' + currentTag;
  const simStars = clamp(Number(simAttackStars) || 0, 0, MAX_ATTACK_STARS);
  const pct = ((simStars / MAX_ATTACK_STARS) * 100).toFixed(1) + '%';

  const fallbackOpp = standings.find(s => s.clan.tag !== myFullTag)?.clan.tag || null;
  const oppTag = currentOpponentTag && statsByTag[currentOpponentTag] ? currentOpponentTag : fallbackOpp;
  const oppStats = oppTag ? statsByTag[oppTag] : null;
  const oppAvgStars = oppStats ? oppStats.avgAttackStars : 30;
  const oppName = oppStats ? oppStats.clan.name : 'Adversário';

  const simSubtitle = `Rodada ${activeRoundIdx + 1} vs ${oppName} (Média: ${oppAvgStars}★)`;

  let mySimBonus = 0;
  let oppSimBonus = 0;
  let resultBadgeText = '';
  let resultBadgeClass = '';
  let bonusInfoClass = '';
  let bonusInfoText = '';

  if (simStars > oppAvgStars) {
    mySimBonus = WIN_BONUS_STARS;
    resultBadgeText = 'Vitória (+10★)';
    resultBadgeClass = 'proj-badge ok';
    bonusInfoClass = 'sim-bonus-info win';
    bonusInfoText =
      `Vitória projetada contra ${oppName} (${simStars}★ vs média de ${oppAvgStars}★): bônus automático de +10 estrelas aplicado! Total na rodada: ${simStars + WIN_BONUS_STARS} estrelas.`;
  } else if (simStars === oppAvgStars) {
    resultBadgeText = 'Empate (+0★)';
    resultBadgeClass = 'proj-badge warn';
    bonusInfoClass = 'sim-bonus-info tie';
    bonusInfoText =
      `Empate projetado contra ${oppName} (${simStars}★ vs ${oppAvgStars}★): pela regra da CWL, nenhum dos clãs ganha o bônus de +10 estrelas.`;
  } else {
    oppSimBonus = WIN_BONUS_STARS;
    resultBadgeText = 'Derrota (+0★)';
    resultBadgeClass = 'proj-badge danger';
    bonusInfoClass = 'sim-bonus-info loss';
    bonusInfoText =
      `Derrota projetada contra ${oppName} (${simStars}★ vs média de ${oppAvgStars}★): sem bônus de vitória (+0★). ${oppName} recebe +10★.`;
  }

  const originalRank = {};
  standings.forEach((s, idx) => { originalRank[s.clan.tag] = idx + 1; });

  const simStandings = standings.map(s => {
    const tag = s.clan.tag;
    let totalSimulatedStars = s.baseStars;
    let earnedBonus = false;

    if (tag === myFullTag) {
      totalSimulatedStars = s.baseStars + simStars + mySimBonus;
      earnedBonus = mySimBonus > 0;
    } else if (tag === oppTag) {
      totalSimulatedStars = s.baseStars + oppAvgStars + oppSimBonus;
      earnedBonus = oppSimBonus > 0;
    } else {
      const roundWars = warsByRound[activeRoundIdx] || [];
      const hasActiveWar = roundWars.some(w =>
        w.state !== 'preparation' && (w.clan?.tag === tag || w.opponent?.tag === tag)
      );
      totalSimulatedStars = hasActiveWar ? s.stars : s.baseStars + s.avgAttackStars;
    }

    return {
      clan: s.clan,
      location: s.location,
      simStars: totalSimulatedStars,
      destruction: s.destruction,
      earnedBonus,
      prevPos: originalRank[tag] || 1,
    };
  });

  simStandings.sort((a, b) => b.simStars - a.simStars || b.destruction - a.destruction);

  return {
    simStars,
    pct,
    simSubtitle,
    resultBadgeText,
    resultBadgeClass,
    bonusInfoClass,
    bonusInfoText,
    simStandings,
  };
}
