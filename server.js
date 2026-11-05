require('dotenv').config();
const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const TOKEN = process.env.COC_TOKEN;
const API = process.env.COC_API_BASE || 'https://api.clashofclans.com/v1';

if (!TOKEN) console.warn('⚠ COC_TOKEN não definido no .env');

// Cache simples em memória (evita estourar rate limit da API)
const cache = new Map();
const TTL = 60 * 1000;

// Normaliza a tag: remove espaços/#, maiúsculas, O -> 0 (padrão do jogo)
function normalizeTag(raw) {
  return String(raw || '').replace(/[\s#]/g, '').toUpperCase().replace(/O/g, '0');
}
const TAG_RE = /^[0289PYLQGRJCUV]{3,15}$/;

async function cocGet(endpoint) {
  const hit = cache.get(endpoint);
  if (hit && Date.now() - hit.t < TTL) return hit.v;

  const r = await fetch(API + endpoint, {
    headers: { Authorization: `Bearer ${TOKEN}`, Accept: 'application/json' }
  });
  const body = await r.json().catch(() => ({}));
  const out = { status: r.status, body };
  if (r.ok) cache.set(endpoint, { t: Date.now(), v: out });
  return out;
}

function route(buildEndpoint) {
  return async (req, res) => {
    const tag = normalizeTag(req.params.tag);
    if (!TAG_RE.test(tag)) {
      return res.status(400).json({ reason: 'badTag', message: 'Tag inválida.' });
    }
    try {
      const { status, body } = await cocGet(buildEndpoint(tag));
      res.status(status).json(body);
    } catch (e) {
      res.status(502).json({ reason: 'proxy', message: 'Falha ao contatar a API.' });
    }
  };
}

app.get('/api/clans', async (req, res) => {
  const name = String(req.query.name || '').trim();
  if (!name || name.length < 3) {
    return res.status(400).json({ reason: 'badName', message: 'O nome do clã deve ter pelo menos 3 caracteres.' });
  }
  try {
    const encodedName = encodeURIComponent(name);
    const { status, body } = await cocGet(`/clans?name=${encodedName}&limit=12`);
    res.status(status).json(body);
  } catch (e) {
    res.status(502).json({ reason: 'proxy', message: 'Falha ao contatar a API.' });
  }
});

app.get('/api/clan/:tag', route(t => `/clans/%23${t}`));
app.get('/api/league/:tag', route(t => `/clans/%23${t}/currentwar/leaguegroup`));
// Necessário para calcular estrelas e eventos de guerra: leaguegroup só traz as warTags
app.get('/api/war/:tag', route(t => `/clanwarleagues/wars/%23${t}`));
app.get('/api/clanwarleagues/wars/:tag', route(t => `/clanwarleagues/wars/%23${t}`));

app.use(express.static(path.join(__dirname, 'public')));
if (!process.env.VERCEL) {
  app.listen(PORT, () => console.log(`http://localhost:${PORT}`));
}
module.exports = app;