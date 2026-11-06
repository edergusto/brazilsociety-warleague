/**
 * api.js
 * Módulo responsável por todas as requisições assíncronas (fetch)
 * ao proxy Node.js e à API oficial do Clash of Clans.
 */

export const SPECIAL_REPORT_CLAN_TAG = '2GYGRQPG2';

export function cleanTag(raw) {
  let decoded = String(raw || '');
  try {
    decoded = decodeURIComponent(decoded);
  } catch {
    // Mantém string original caso não seja URI encoded
  }
  return decoded.replace(/[\s#]/g, '').toUpperCase().replace(/O/g, '0');
}

/**
 * Verifica se a tag informada (ex: "#2GYGRQPG2", "2GYGRQPG2" ou "%232GYGRQPG2")
 * corresponde estritamente ao clã principal habilitado para a aba de Relatório.
 */
export function isReportClanTag(rawTag) {
  return cleanTag(rawTag) === SPECIAL_REPORT_CLAN_TAG;
}

export async function apiRequest(path) {
  const response = await fetch(path);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const err = new Error(data.message || data.reason || 'Erro na comunicação com a API');
    err.status = response.status;
    throw err;
  }
  return data;
}

/**
 * Busca os dados principais de um clã (/api/clan/:tag -> /clans/{clanTag})
 */
export async function fetchClanData(tag) {
  const normalized = cleanTag(tag);
  const encoded = encodeURIComponent('#' + normalized);
  return apiRequest(`/api/clan/${encoded}`);
}

/**
 * Busca clãs por nome usando a API de busca do Clash of Clans (/api/clans?name={name})
 */
export async function searchClansByName(name) {
  const trimmed = String(name || '').trim();
  const encoded = encodeURIComponent(trimmed);
  return apiRequest(`/api/clans?name=${encoded}`);
}

/**
 * Busca o grupo atual da Liga de Guerra de Clãs (/api/league/:tag -> /clans/{clanTag}/currentwar/leaguegroup)
 */
export async function fetchLeagueGroup(tag) {
  const normalized = cleanTag(tag);
  return apiRequest(`/api/league/${normalized}`);
}

/**
 * Retorna o elenco completo de membros inscritos na CWL para um clã específico a partir do grupo.
 */
export async function fetchLeagueGroupClanRoster(tag) {
  const normalized = cleanTag(tag);
  const fullTag = '#' + normalized;
  try {
    const group = await fetchLeagueGroup(tag);
    const clans = Array.isArray(group?.clans) ? group.clans : [];
    const myClan = clans.find(c => cleanTag(c.tag) === normalized || c.tag === fullTag);
    return Array.isArray(myClan?.members) ? myClan.members : [];
  } catch {
    return [];
  }
}

/**
 * Busca os dados detalhados de uma guerra específica da CWL (/api/war/:tag -> /clanwarleagues/wars/{warTag})
 */
export async function fetchWarData(warTag) {
  const normalized = cleanTag(warTag);
  return apiRequest(`/api/war/${normalized}`);
}

/**
 * Localiza o `warTag` da rodada seguinte no grupo da liga e retorna os dados da guerra
 * do clã na próxima rodada (para comparar escalações e mapear substituições).
 */
export async function fetchNextRoundClanWar(clanTag, currentWarTag, knownNextWarTag = null) {
  const fullClanTag = '#' + cleanTag(clanTag);

  if (knownNextWarTag && knownNextWarTag !== '#0') {
    try {
      return await fetchWarData(knownNextWarTag);
    } catch {
      return null;
    }
  }

  if (!currentWarTag) return null;
  const normCurrentWar = cleanTag(currentWarTag);

  try {
    const group = await fetchLeagueGroup(clanTag);
    const rounds = Array.isArray(group?.rounds) ? group.rounds : [];
    const currentRoundIdx = rounds.findIndex(r =>
      (r.warTags || []).some(t => cleanTag(t) === normCurrentWar)
    );

    if (currentRoundIdx === -1 || currentRoundIdx + 1 >= rounds.length) {
      return null;
    }

    const nextWarTags = (rounds[currentRoundIdx + 1]?.warTags || []).filter(
      t => t && t !== '#0'
    );
    if (!nextWarTags.length) return null;

    const nextWars = await Promise.all(
      nextWarTags.map(t => fetchWarData(t).catch(() => null))
    );

    return (
      nextWars.find(
        w => w && (w.clan?.tag === fullClanTag || w.opponent?.tag === fullClanTag)
      ) || null
    );
  } catch {
    return null;
  }
}

/**
 * Busca em paralelo os detalhes dos 8 clãs do grupo (para obter `location`)
 * e todas as partidas válidas (`warTags`) de todas as rodadas do grupo.
 */
export async function fetchGroupDetailsAndWars(group) {
  const clans = Array.isArray(group?.clans) ? group.clans : [];
  const rounds = Array.isArray(group?.rounds) ? group.rounds : [];

  const clanDetailsPromise = Promise.all(
    clans.map(c => fetchClanData(c.tag).catch(() => null))
  );

  const jobs = rounds.flatMap((r, roundIdx) =>
    (r.warTags || [])
      .filter(t => t && t !== '#0')
      .map(warTag => ({ roundIdx, warTag }))
  );

  const warResultsPromise = Promise.allSettled(
    jobs.map(j => fetchWarData(j.warTag))
  );

  const [clanDetailsList, warResults] = await Promise.all([
    clanDetailsPromise,
    warResultsPromise,
  ]);

  return { clanDetailsList, jobs, warResults };
}

/**
 * Formata segundos de duração de ataque (ex: 102 -> "1m 42s" ou 45 -> "45s").
 */
export function formatAttackDuration(seconds) {
  const sec = Math.max(0, Math.round(Number(seconds) || 0));
  if (!sec) return '—';
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m > 0 ? `${m}m ${String(s).padStart(2, '0')}s` : `${s}s`;
}

/**
 * Calcula o Rating (0 a 2000 pontos) de cada jogador do elenco na CWL.
 * Ponderação:
 * - Estrelas (peso principal: até 1250 pts baseados na média de estrelas + taxa de PT 3★)
 * - Destruição % (peso secundário: até 300 pts)
 * - Tempo de Ataque (bônus/desempate: até 150 pts para ataques rápidos, especialmente PTs)
 * - Rodadas Jogadas (fator de participação e confiabilidade: até 300 pts, mantendo justiça
 *   nas médias para que um jogador com 7 guerras medianas não supere um 5/5 perfeito).
 */
export function calculatePlayerRatings(clanRoster = [], myRoundsHistory = []) {
  const playersMap = new Map();

  const ensurePlayer = member => {
    if (!member?.tag) return null;
    if (!playersMap.has(member.tag)) {
      playersMap.set(member.tag, {
        tag: member.tag,
        name: member.name || member.tag,
        townHallLevel: member.townHallLevel || member.townhallLevel || null,
        totalStars: 0,
        totalDestruction: 0,
        totalDuration: 0,
        attacksCount: 0,
        roundsPlayed: 0,
        threeStarsCount: 0,
        missedAttacks: 0,
        speedScoreSum: 0,
      });
    } else {
      const existing = playersMap.get(member.tag);
      if (member.name) existing.name = member.name;
      if (member.townHallLevel || member.townhallLevel) {
        existing.townHallLevel = member.townHallLevel || member.townhallLevel;
      }
    }
    return playersMap.get(member.tag);
  };

  (Array.isArray(clanRoster) ? clanRoster : []).forEach(ensurePlayer);

  let activeOrCompletedWarsCount = 0;

  (Array.isArray(myRoundsHistory) ? myRoundsHistory : []).forEach(round => {
    const side = round?.mySide;
    if (!side || round.state === 'unscheduled' || round.state === 'preparation') return;

    activeOrCompletedWarsCount += 1;
    const members = Array.isArray(side.members) ? side.members : [];

    // Mapa auxiliar de ataques caso estejam em side.attacks
    const sideAttacksByTag = new Map();
    if (Array.isArray(side.attacks)) {
      side.attacks.forEach(atk => {
        if (atk?.attackerTag && !sideAttacksByTag.has(atk.attackerTag)) {
          sideAttacksByTag.set(atk.attackerTag, atk);
        }
      });
    }

    members.forEach(m => {
      const p = ensurePlayer(m);
      if (!p) return;

      const atk = (Array.isArray(m.attacks) && m.attacks[0]) || sideAttacksByTag.get(m.tag) || null;

      // Se a guerra ainda está em andamento e o jogador ainda não atacou, não penaliza antecipadamente
      if (!atk && round.state !== 'warEnded') {
        return;
      }

      p.roundsPlayed += 1;

      if (atk) {
        const stars = Math.max(0, Math.min(3, Number(atk.stars || 0)));
        const dest = Math.max(0, Math.min(100, Number(atk.destructionPercentage || 0)));
        const duration = typeof atk.duration === 'number' && atk.duration > 0
          ? Math.min(180, Math.max(1, atk.duration))
          : 120;

        p.totalStars += stars;
        p.totalDestruction += dest;
        p.totalDuration += duration;
        p.attacksCount += 1;
        if (stars === 3) p.threeStarsCount += 1;

        const rawSpeed = Math.max(0, Math.min(1, (180 - duration) / 150));
        const starWeight = stars === 3 ? 1.0 : stars === 2 ? 0.35 : stars === 1 ? 0.1 : 0;
        p.speedScoreSum += rawSpeed * starWeight;
      } else {
        // Guerra encerrada sem ataque realizado
        p.missedAttacks += 1;
        p.totalDuration += 180;
      }
    });
  });

  const benchmarkRounds = Math.max(1, Math.min(5, activeOrCompletedWarsCount || 1));

  const results = Array.from(playersMap.values()).map(p => {
    if (p.roundsPlayed === 0) {
      return {
        ...p,
        avgStars: 0,
        avgDestruction: 0,
        avgDestructionFormatted: '0%',
        avgTimeSeconds: 0,
        avgTimeFormatted: '—',
        rating: 0,
      };
    }

    const avgStars = p.totalStars / p.roundsPlayed;
    const threeStarRate = p.threeStarsCount / p.roundsPlayed;
    const avgDestruction = p.totalDestruction / p.roundsPlayed;
    const avgTimeSeconds = p.attacksCount > 0
      ? Math.round(p.totalDuration / p.attacksCount)
      : 180;
    const avgSpeedScore = p.speedScoreSum / p.roundsPlayed;

    // 1. Estrelas (até 1250 pts)
    const starPoints = (avgStars / 3) * 950 + threeStarRate * 300;

    // 2. Destruição % (até 300 pts)
    const destructionPoints = (avgDestruction / 100) * 300;

    // 3. Tempo de Ataque (até 150 pts)
    const timePoints = avgSpeedScore * 150;

    // 4. Fator de Participação & Confiabilidade (até 300 pts)
    const reliability = 0.78 + 0.22 * Math.min(1, p.roundsPlayed / benchmarkRounds);
    const qualityFactor = Math.pow(avgStars / 3, 1.35);
    const participationCurve =
      0.65 * Math.min(1, p.roundsPlayed / 5) +
      0.35 * Math.min(1, p.roundsPlayed / 7);
    const participationPoints = 300 * participationCurve * qualityFactor;

    const missedPenalty = p.missedAttacks * 220;

    const rawRating =
      (starPoints + destructionPoints + timePoints) * reliability +
      participationPoints -
      missedPenalty;

    const rating = Math.round(Math.max(0, Math.min(2000, rawRating)));
    const avgDestructionFormatted =
      (Number.isInteger(avgDestruction) ? String(avgDestruction) : avgDestruction.toFixed(1)) + '%';

    return {
      ...p,
      avgStars,
      avgDestruction,
      avgDestructionFormatted,
      avgTimeSeconds,
      avgTimeFormatted: p.attacksCount > 0 ? formatAttackDuration(avgTimeSeconds) : '—',
      rating,
    };
  });

  results.sort(
    (a, b) =>
      b.rating - a.rating ||
      b.totalStars - a.totalStars ||
      b.avgDestruction - a.avgDestruction ||
      (a.avgTimeSeconds || 999) - (b.avgTimeSeconds || 999) ||
      b.roundsPlayed - a.roundsPlayed ||
      a.name.localeCompare(b.name, 'pt-BR')
  );

  return results.map((item, idx) => ({
    ...item,
    rank: idx + 1,
  }));
}

/**
 * Calcula o Rating médio geral do clã na CWL (escala de 0 a 2000 pontos)
 * baseado na pontuação de desempenho do elenco (média dos 15 melhores pontuadores/titulares).
 */
export function calculateClanRating(playerRankings = []) {
  if (!Array.isArray(playerRankings) || playerRankings.length === 0) return 0;
  const rated = playerRankings.filter(p => (Number(p.rating) || 0) > 0);
  if (rated.length === 0) return 0;
  const topTeam = rated.slice(0, 15);
  const sum = topTeam.reduce((acc, p) => acc + Number(p.rating), 0);
  return Math.round(sum / topTeam.length);
}
