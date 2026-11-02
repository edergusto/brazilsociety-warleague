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
 * Busca o grupo atual da Liga de Guerra de Clãs (/api/league/:tag -> /clans/{clanTag}/currentwar/leaguegroup)
 */
export async function fetchLeagueGroup(tag) {
  const normalized = cleanTag(tag);
  return apiRequest(`/api/league/${normalized}`);
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
