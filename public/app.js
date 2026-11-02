(() => {
  const $ = id => document.getElementById(id);
  const el = {
    form: $('searchForm'), tag: $('clanTag'), err: $('errorMsg'), btnText: $('btnText'), spin: $('btnSpinner'),
    search: $('searchView'), dash: $('dashboardView'), cwl: $('navCwl'),
    featured: $('featuredClans'),
    fav: $('favToggle'), menu: $('menu'), saved: $('savedList'), policy: $('policyText'),
    deskSearchBtn: $('deskSearchBtn'), deskSavedBtn: $('deskSavedBtn'), deskSavedList: $('deskSavedList'),
    deskPolicyBtn: $('deskPolicyBtn'), deskPolicyPopover: $('deskPolicyPopover'),
    statGained: $('statStarsGained'), statLost: $('statStarsLost'), statBonus: $('statStarsBonus'),
    tabStandingsBtn: $('tabStandingsBtn'), tabRoundsBtn: $('tabRoundsBtn'), tabProjectionsBtn: $('tabProjectionsBtn'),
    tabStandings: $('tabStandings'), tabRounds: $('tabRounds'), tabProjections: $('tabProjections'),
    roundsList: $('roundsList'),
    projNotice: $('projectionsNotice'), projContent: $('projectionsContent'),
    promoBadge: $('promoBadge'), promoText: $('promoText'),
    survivalBadge: $('survivalBadge'), survivalText: $('survivalText'),
    h2hSubtitle: $('h2hSubtitle'), h2hBadge: $('h2hBadge'), h2hText: $('h2hText'),
    simSubtitle: $('simSubtitle'), simResultBadge: $('simResultBadge'),
    simSlider: $('simSlider'), simSliderValue: $('simSliderValue'),
    simBonusInfo: $('simBonusInfo'), simLeaderboard: $('simLeaderboard'),
  };

  const FAV_ON = './assets/icone_fita_64.png', FAV_OFF = './assets/icone_fita_mais_64.png';
  const DEFAULT_BADGE = './assets/cw_icon.webp';
  const LS_KEY = 'cwl_saved_clans';
  const FEATURED_TAGS = ['#2GYGRQPG2', '#2JRGG8J99'];
  const MONTHS = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];

  // Constantes da Regra de Negócio CWL (Formato 15v15)
  const CWL_TEAM_SIZE = 15;
  const MAX_ATTACK_STARS = 45; // 15v15 => máximo de 45 estrelas base em ataques por rodada
  const WIN_BONUS_STARS = 10;  // +10 estrelas automáticas por vitória no confronto direto
  const MAX_WAR_TOTAL = MAX_ATTACK_STARS + WIN_BONUS_STARS; // 55 estrelas máximas por guerra

  let currentTag = null;
  let currentLeagueData = null;

  // ---------- Registro do Service Worker (PWA) ----------
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js').catch(() => {});
    });
  }

  // ---------- helpers ----------
  const clean = v => String(v).replace(/[\s#]/g, '').toUpperCase().replace(/O/g, '0');
  const getSaved = () => { try { return JSON.parse(localStorage.getItem(LS_KEY)) || []; } catch { return []; } };
  const setSaved = arr => localStorage.setItem(LS_KEY, JSON.stringify(arr));
  const clamp = (n, min, max) => Math.min(max, Math.max(min, n));

  async function api(path) {
    const r = await fetch(path);
    const data = await r.json().catch(() => ({}));
    if (!r.ok) { const e = new Error(data.message || data.reason || 'Erro'); e.status = r.status; throw e; }
    return data;
  }
  function showError(msg) { el.err.textContent = msg; el.err.hidden = false; el.tag.classList.add('invalid'); }
  function clearError() { el.err.hidden = true; el.tag.classList.remove('invalid'); }
  function loading(on) { el.btnText.hidden = on; el.spin.hidden = !on; }
  const mk = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };

  // ---------- Clãs em Destaque na Tela Inicial (Promoted Clan Banners) ----------
  function createFeaturedCard({ tag, name, league, badgeUrl }) {
    const cleanTag = clean(tag);
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
      mk('span', 'featured-tag', `#${cleanTag}`)
    );

    const leaguePill = mk('span', 'featured-league');
    leaguePill.append(mk('i', 'ph-fill ph-trophy'), document.createTextNode(league));

    body.append(nameRow, leaguePill);
    btn.append(img, body, mk('i', 'ph-bold ph-caret-right featured-arrow'));

    btn.addEventListener('click', () => {
      el.tag.value = cleanTag;
      search(cleanTag);
    });

    return btn;
  }

  async function loadFeaturedClans() {
    if (!el.featured) return;
    el.featured.replaceChildren();

    const placeholders = FEATURED_TAGS.map(rawTag => {
      const card = createFeaturedCard({
        tag: rawTag,
        name: 'Carregando clã…',
        league: 'Consultando CWL…',
        badgeUrl: DEFAULT_BADGE,
      });
      el.featured.append(card);
      return { rawTag, card };
    });

    await Promise.allSettled(
      placeholders.map(async ({ rawTag, card }) => {
        const normalizedWithHash = '#' + clean(rawTag);
        const encodedTag = encodeURIComponent(normalizedWithHash); // %232GYGRQPG2 / %232JRGG8J99
        try {
          const clan = await api(`/api/clan/${encodedTag}`);
          const updatedCard = createFeaturedCard({
            tag: clan.tag || normalizedWithHash,
            name: clan.name || normalizedWithHash,
            league: clan.warLeague?.name || 'Sem Liga',
            badgeUrl: clan.badgeUrls?.medium || clan.badgeUrls?.large || clan.badgeUrls?.small || DEFAULT_BADGE,
          });
          card.replaceWith(updatedCard);
        } catch {
          const fallbackCard = createFeaturedCard({
            tag: normalizedWithHash,
            name: `Clã ${normalizedWithHash}`,
            league: 'Toque para buscar CWL',
            badgeUrl: DEFAULT_BADGE,
          });
          card.replaceWith(fallbackCard);
        }
      })
    );
  }

  // ---------- views & tabs ----------
  function switchTab(tabName) {
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

  function updateBannerStats(gained = 0, lost = 0, bonus = 0) {
    el.statGained.querySelector('span').textContent = String(gained);
    el.statLost.querySelector('span').textContent = `-${lost}`;
    el.statBonus.querySelector('span').textContent = `+${bonus}`;
  }

  function showSearch() {
    el.dash.hidden = true; el.search.hidden = false;
    el.cwl.classList.remove('active'); el.cwl.disabled = true;
    el.tag.value = ''; clearError(); currentTag = null; currentLeagueData = null;
  }

  function showDashboard() {
    el.search.hidden = true; el.dash.hidden = false;
    el.cwl.classList.add('active'); el.cwl.disabled = false;
    switchTab('standings');
    $('main').scrollTop = 0;
  }

  function updateFav() { el.fav.src = getSaved().some(c => c.tag === currentTag) ? FAV_ON : FAV_OFF; }

  // ---------- CWL math & business rules ----------
  function seasonLabel(s) {
    const [y, m] = (s || '').split('-');
    return MONTHS[+m - 1] ? `${MONTHS[+m - 1]} de ${y}` : '—';
  }

  function resolveWarWinner(clanA, clanB) {
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

  function calculateMissedStarsInWar(side, warState) {
    const earned = Number(side?.stars || 0);
    const attacksMade = Number(side?.attacks || 0);
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

  async function loadStandings(group) {
    const myFullTag = '#' + currentTag;
    const totalRounds = Array.isArray(group.rounds) && group.rounds.length ? group.rounds.length : 7;
    const stats = {};

    group.clans.forEach(c => {
      stats[c.tag] = {
        clan: c,
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

    const jobs = group.rounds.flatMap((r, i) =>
      (r.warTags || []).filter(t => t && t !== '#0').map(t => ({ roundIdx: i, warTag: t }))
    );
    const results = await Promise.allSettled(jobs.map(j => api('/api/war/' + clean(j.warTag))));

    const warsByRound = Array.from({ length: totalRounds }, () => []);
    let teamSize = null;

    results.forEach((res, k) => {
      if (res.status !== 'fulfilled' || !res.value) return;
      const w = res.value;
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
          myMatchInRound = { day: i + 1, state: w.state, mySide: w.clan, oppSide: w.opponent, teamSize: w.teamSize || CWL_TEAM_SIZE };
        } else if (w.opponent?.tag === myFullTag) {
          myMatchInRound = { day: i + 1, state: w.state, mySide: w.opponent, oppSide: w.clan, teamSize: w.teamSize || CWL_TEAM_SIZE };
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

  // ---------- ABA 1: CLASSIFICAÇÃO ----------
  function renderLeaderboard(standings) {
    const box = $('leaderboard'); box.replaceChildren();
    standings.forEach((s, i) => {
      const row = mk('div', 'row' + (s.clan.tag === '#' + currentTag ? ' me' : ''));
      row.append(mk('span', 'pos', i + 1));
      const status = i < 2 ? ['up', 'ph-fill ph-caret-up'] : i >= standings.length - 2 ? ['down', 'ph-fill ph-caret-down'] : ['mid', 'ph-bold ph-minus'];
      row.append(mk('i', `st ${status[0]} ${status[1]}`));
      const img = mk('img'); img.src = s.clan.badgeUrls?.small || DEFAULT_BADGE; img.alt = '';
      row.append(img, mk('div', 'nm', s.clan.name));
      const st = mk('div', 'stars'); st.append(mk('i', 'ph-fill ph-star'), document.createTextNode(s.stars));
      row.append(st); box.append(row);
    });
  }

  // ---------- ABA 2: CONFRONTOS (HEAD-TO-HEAD ROUNDS) ----------
  function renderRounds(data) {
    const box = el.roundsList;
    box.replaceChildren();

    const { myRoundsHistory, statsByTag } = data;
    const myFullTag = '#' + currentTag;
    const myClanName = statsByTag[myFullTag]?.clan?.name || $('clanName').textContent || 'Nosso Clã';

    myRoundsHistory.forEach(item => {
      if (item.state === 'unscheduled' || !item.mySide || !item.oppSide) {
        const card = mk('div', 'round-card');
        const head = mk('div', 'round-head');
        head.append(
          mk('span', 'round-day', `Dia ${item.day}`),
          mk('span', 'round-status', 'Aguardando Sorteio')
        );
        card.append(head, mk('p', 'round-summary', `Dia ${item.day}: ${myClanName} vs. A definir`));
        box.append(card);
        return;
      }

      const myStars = Number(item.mySide.stars || 0);
      const oppStars = Number(item.oppSide.stars || 0);
      const myDest = Number(item.mySide.destructionPercentage || 0).toFixed(1);
      const oppDest = Number(item.oppSide.destructionPercentage || 0).toFixed(1);

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
      const head = mk('div', 'round-head');
      head.append(
        mk('span', 'round-day', `Dia ${item.day}`),
        mk('span', `round-status ${badgeMod}`.trim(), badgeText)
      );

      const matchup = mk('div', 'round-matchup');

      const leftTeam = mk('div', 'round-team');
      const leftImg = mk('img');
      leftImg.src = item.mySide.badgeUrls?.small || DEFAULT_BADGE;
      leftImg.alt = '';
      leftTeam.append(leftImg, mk('span', 'round-team-name', item.mySide.name));

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
      rightTeam.append(rightImg, mk('span', 'round-team-name', item.oppSide.name));

      matchup.append(leftTeam, scoreBox, rightTeam);

      const summaryText = item.state === 'preparation'
        ? `Dia ${item.day}: ${item.mySide.name} vs. ${item.oppSide.name} - [Em preparação]`
        : `Dia ${item.day}: ${item.mySide.name} vs. ${item.oppSide.name} - [${myStars}★ a ${oppStars}★]`;

      card.append(head, matchup, mk('p', 'round-summary', summaryText));
      box.append(card);
    });
  }

  // ---------- ABA 3: PROJEÇÕES (MONEYBALL) ----------
  function renderProjections(data) {
    const { standings, statsByTag, totalRounds, currentOpponentTag, currentMyWar } = data;
    const myFullTag = '#' + currentTag;
    const myIndex = standings.findIndex(s => s.clan.tag === myFullTag);

    if (myIndex === -1 || standings.length < 2) {
      el.projContent.hidden = true;
      el.projNotice.hidden = false;
      el.projNotice.textContent = 'Dados insuficientes no grupo para gerar projeções analíticas.';
      return;
    }

    el.projNotice.hidden = true;
    el.projContent.hidden = false;

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

    if (myIndex < 2 && magicStarsNeeded === 0) {
      el.promoBadge.textContent = 'Promovido';
      el.promoBadge.className = 'proj-badge ok';
    } else if (myIndex < 2) {
      el.promoBadge.textContent = `${myIndex + 1}º Lugar • Top 2`;
      el.promoBadge.className = 'proj-badge ok';
    } else {
      el.promoBadge.textContent = `${myIndex + 1}º Lugar`;
      el.promoBadge.className = 'proj-badge warn';
    }

    el.promoText.textContent =
      `Para garantir a promoção matematicamente, precisamos de ${magicStarsNeeded} estrelas nas ${remainingWars} guerras restantes.`;

    // 2. MÉDIA DE SOBREVIVÊNCIA (RISCO DE REBAIXAMENTO - 6º LUGAR PARA CIMA)
    const safeZoneIndex = Math.max(0, standings.length - 3);
    const relegationIndex = Math.max(0, standings.length - 2);
    const sixthClan = standings[safeZoneIndex];
    const seventhClan = standings[relegationIndex];

    let starsToEscapeRisk = 0;
    if (myIndex > safeZoneIndex) {
      const immediateGap = Math.max(1, (sixthClan.stars + 1) - myStats.stars);
      const sixthPacePerWar = sixthClan.warsPlayed > 0
        ? Math.round(sixthClan.stars / sixthClan.warsPlayed)
        : (sixthClan.avgAttackStars + 5);
      const projectedSixthTotal = sixthClan.stars + (remainingWars * sixthPacePerWar);
      starsToEscapeRisk = remainingWars > 0
        ? Math.max(immediateGap, (projectedSixthTotal + 1) - myStats.stars)
        : immediateGap;

      el.survivalBadge.textContent = 'Zona de Risco';
      el.survivalBadge.className = 'proj-badge danger';
    } else {
      const seventhPacePerWar = seventhClan.warsPlayed > 0
        ? Math.round(seventhClan.stars / seventhClan.warsPlayed)
        : seventhClan.avgAttackStars;
      const projectedSeventhTotal = seventhClan.stars + (remainingWars * seventhPacePerWar);
      starsToEscapeRisk = remainingWars > 0
        ? Math.max(0, (projectedSeventhTotal + 1) - myStats.stars)
        : 0;

      el.survivalBadge.textContent = `${myIndex + 1}º • Zona Segura`;
      el.survivalBadge.className = 'proj-badge ok';
    }

    const rawSurvivalAvg = remainingWars > 0 ? (starsToEscapeRisk / remainingWars) : 0;
    const formattedSurvivalAvg = Number.isInteger(rawSurvivalAvg)
      ? String(rawSurvivalAvg)
      : rawSurvivalAvg.toFixed(1).replace('.', ',');

    el.survivalText.textContent =
      `Faltam ${starsToEscapeRisk} estrelas para sair da zona de risco. Uma média de ${formattedSurvivalAvg} estrelas por guerra garante a permanência.`;

    // 3. CENÁRIO DE CONFRONTO DIRETO
    let h2hTarget = null;
    if (myIndex > 0) {
      h2hTarget = standings[myIndex - 1];
      el.h2hSubtitle.textContent = `Acima na Tabela (${myIndex}º Lugar) • Bônus +10★`;
    } else if (currentOpponentTag && statsByTag[currentOpponentTag] && currentOpponentTag !== myFullTag) {
      h2hTarget = statsByTag[currentOpponentTag];
      el.h2hSubtitle.textContent = 'Adversário da Rodada Atual • Bônus +10★';
    } else {
      h2hTarget = standings[1];
      el.h2hSubtitle.textContent = 'Vice-Líder do Grupo • Bônus +10★';
    }

    const starsAhead = Math.max(0, h2hTarget.stars - myStats.stars);
    const minAttackToOvertake = starsAhead > 0
      ? Math.max(1, starsAhead - WIN_BONUS_STARS + 1)
      : clamp(h2hTarget.avgAttackStars + 1, 1, MAX_ATTACK_STARS);

    el.h2hBadge.textContent = starsAhead > 0 ? `-${starsAhead}★` : 'Líder';
    el.h2hBadge.className = 'proj-badge ' + (starsAhead === 0 ? 'ok' : starsAhead <= 25 ? 'warn' : 'danger');

    el.h2hText.textContent =
      `O clã ${h2hTarget.clan.name} está ${starsAhead} estrelas à frente. Precisamos vencer o confronto direto fazendo pelo menos ${minAttackToOvertake} estrelas no ataque (contando com o bônus de vitória) para ultrapassá-los.`;

    // 4. SIMULADOR DE DESEMPENHO (INTERATIVO - 0 A 45 ESTRELAS)
    const initialSliderStars = currentMyWar && currentMyWar.war.state !== 'preparation'
      ? clamp(Number(currentMyWar.mySide?.stars || myStats.avgAttackStars), 0, MAX_ATTACK_STARS)
      : clamp(myStats.avgAttackStars, 0, MAX_ATTACK_STARS);

    el.simSlider.value = String(initialSliderStars);
    updateSimulation(initialSliderStars);
  }

  function updateSimulation(simAttackStars) {
    if (!currentLeagueData) return;
    const { standings, statsByTag, activeRoundIdx, warsByRound, currentOpponentTag } = currentLeagueData;
    const myFullTag = '#' + currentTag;
    const simStars = clamp(Number(simAttackStars) || 0, 0, MAX_ATTACK_STARS);

    el.simSliderValue.textContent = String(simStars);
    const pct = ((simStars / MAX_ATTACK_STARS) * 100).toFixed(1) + '%';
    el.simSlider.style.setProperty('--pct', pct);

    const fallbackOpp = standings.find(s => s.clan.tag !== myFullTag)?.clan.tag || null;
    const oppTag = currentOpponentTag && statsByTag[currentOpponentTag] ? currentOpponentTag : fallbackOpp;
    const oppStats = oppTag ? statsByTag[oppTag] : null;
    const oppAvgStars = oppStats ? oppStats.avgAttackStars : 30;
    const oppName = oppStats ? oppStats.clan.name : 'Adversário';

    el.simSubtitle.textContent = `Rodada ${activeRoundIdx + 1} vs ${oppName} (Média: ${oppAvgStars}★)`;

    let mySimBonus = 0;
    let oppSimBonus = 0;

    if (simStars > oppAvgStars) {
      mySimBonus = WIN_BONUS_STARS;
      el.simResultBadge.textContent = 'Vitória (+10★)';
      el.simResultBadge.className = 'proj-badge ok';
      el.simBonusInfo.className = 'sim-bonus-info win';
      el.simBonusInfo.textContent =
        `Vitória projetada contra ${oppName} (${simStars}★ vs média de ${oppAvgStars}★): bônus automático de +10 estrelas aplicado! Total na rodada: ${simStars + WIN_BONUS_STARS} estrelas.`;
    } else if (simStars === oppAvgStars) {
      el.simResultBadge.textContent = 'Empate (+0★)';
      el.simResultBadge.className = 'proj-badge warn';
      el.simBonusInfo.className = 'sim-bonus-info tie';
      el.simBonusInfo.textContent =
        `Empate projetado contra ${oppName} (${simStars}★ vs ${oppAvgStars}★): pela regra da CWL, nenhum dos clãs ganha o bônus de +10 estrelas.`;
    } else {
      oppSimBonus = WIN_BONUS_STARS;
      el.simResultBadge.textContent = 'Derrota (+0★)';
      el.simResultBadge.className = 'proj-badge danger';
      el.simBonusInfo.className = 'sim-bonus-info loss';
      el.simBonusInfo.textContent =
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
        simStars: totalSimulatedStars,
        destruction: s.destruction,
        earnedBonus,
        prevPos: originalRank[tag] || 1,
      };
    });

    simStandings.sort((a, b) => b.simStars - a.simStars || b.destruction - a.destruction);

    el.simLeaderboard.replaceChildren();
    simStandings.forEach((item, idx) => {
      const newPos = idx + 1;
      const isMe = item.clan.tag === myFullTag;
      const row = mk('div', 'row' + (isMe ? ' me' : ''));

      row.append(mk('span', 'pos', newPos));
      const status = idx < 2 ? ['up', 'ph-fill ph-caret-up'] : idx >= simStandings.length - 2 ? ['down', 'ph-fill ph-caret-down'] : ['mid', 'ph-bold ph-minus'];
      row.append(mk('i', `st ${status[0]} ${status[1]}`));

      const img = mk('img');
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

  // ---------- search & API flow ----------
  async function search(raw) {
    const tag = clean(raw);
    if (!tag) return showError('Digite a tag do clã.');
    clearError(); loading(true);
    try {
      const clan = await api('/api/clan/' + tag);
      currentTag = tag;
      $('clanName').textContent = clan.name;
      $('clanBadge').src = clan.badgeUrls?.large || clan.badgeUrls?.medium || DEFAULT_BADGE;
      $('clanLeague').textContent = clan.warLeague?.name || 'Sem liga';
      $('clanSize').textContent = '';
      $('leaderboard').replaceChildren();
      el.roundsList.replaceChildren();
      $('seasonTitle').textContent = '';
      $('roundInfo').textContent = '';
      updateBannerStats(0, 0, 0);
      updateFav(); showDashboard();

      try {
        const group = await api('/api/league/' + tag);
        $('seasonTitle').textContent = seasonLabel(group.season);
        $('roundInfo').textContent = 'Carregando partidas…';
        const leagueData = await loadStandings(group);
        currentLeagueData = leagueData;

        $('roundInfo').textContent = `Partida atual: ${leagueData.round}/${leagueData.totalRounds}`;
        const n = leagueData.teamSize || group.clans.find(c => c.tag === '#' + tag)?.members?.length;
        $('clanSize').textContent = n ? `${n}v${n}` : '15v15';

        const myStats = leagueData.statsByTag['#' + tag];
        if (myStats) {
          updateBannerStats(myStats.stars, myStats.missedStars, myStats.bonusStars);
        }

        renderLeaderboard(leagueData.standings);
        renderRounds(leagueData);
        renderProjections(leagueData);
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
      showError(e.status === 404 ? 'Clã não encontrado.' : e.status === 400 ? 'Tag inválida.' : 'Erro ao consultar. Tente novamente.');
    } finally { loading(false); }
  }

  // ---------- Renderização de Clãs Salvos (Mobile + Desktop) ----------
  function populateSavedContainer(container, onSelect) {
    const list = getSaved();
    container.replaceChildren();
    if (!list.length) {
      container.append(mk('p', 'muted', 'Nenhum clã salvo ainda.'));
      return;
    }
    list.forEach(c => {
      const b = mk('button', '', `${c.name} (#${c.tag})`);
      b.addEventListener('click', () => {
        onSelect();
        search(c.tag);
      });
      container.append(b);
    });
  }

  // ---------- events ----------
  el.tag.addEventListener('input', () => { if (el.tag.value.startsWith('#')) el.tag.value = el.tag.value.slice(1); clearError(); });
  el.form.addEventListener('submit', e => { e.preventDefault(); search(el.tag.value); });
  $('navSearch').addEventListener('click', showSearch);
  el.cwl.addEventListener('click', () => { $('main').scrollTo({ top: 0, behavior: 'smooth' }); });

  el.tabStandingsBtn.addEventListener('click', () => switchTab('standings'));
  el.tabRoundsBtn.addEventListener('click', () => switchTab('rounds'));
  el.tabProjectionsBtn.addEventListener('click', () => switchTab('projections'));

  el.simSlider.addEventListener('input', e => {
    updateSimulation(Number(e.target.value));
  });

  el.fav.addEventListener('click', () => {
    if (!currentTag) return;
    const list = getSaved();
    const i = list.findIndex(c => c.tag === currentTag);
    if (i >= 0) list.splice(i, 1); else list.push({ tag: currentTag, name: $('clanName').textContent });
    setSaved(list); updateFav();
  });

  const setMenu = open => { el.menu.classList.toggle('open', open); el.menu.setAttribute('aria-hidden', !open); };
  $('navMenuBtn').addEventListener('click', () => setMenu(true));
  $('closeMenuBtn').addEventListener('click', () => setMenu(false));

  $('savedBtn').addEventListener('click', () => {
    el.policy.hidden = true;
    populateSavedContainer(el.saved, () => setMenu(false));
    el.saved.hidden = !el.saved.hidden;
  });
  $('policyBtn').addEventListener('click', () => { el.saved.hidden = true; el.policy.hidden = !el.policy.hidden; });

  // Eventos da barra de navegação Desktop
  function closeDesktopPopovers() {
    if (el.deskSavedList) el.deskSavedList.hidden = true;
    if (el.deskPolicyPopover) el.deskPolicyPopover.hidden = true;
    if (el.deskSavedBtn) el.deskSavedBtn.setAttribute('aria-expanded', 'false');
    if (el.deskPolicyBtn) el.deskPolicyBtn.setAttribute('aria-expanded', 'false');
  }

  if (el.deskSearchBtn) {
    el.deskSearchBtn.addEventListener('click', () => {
      closeDesktopPopovers();
      showSearch();
    });
  }

  if (el.deskSavedBtn) {
    el.deskSavedBtn.addEventListener('click', e => {
      e.stopPropagation();
      const willOpen = el.deskSavedList.hidden;
      closeDesktopPopovers();
      if (willOpen) {
        populateSavedContainer(el.deskSavedList, closeDesktopPopovers);
        el.deskSavedList.hidden = false;
        el.deskSavedBtn.setAttribute('aria-expanded', 'true');
      }
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

  el.cwl.disabled = true;

  loadFeaturedClans();
})();
