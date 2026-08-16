// ============================================================
// 环球新闻地球仪 —— 云端定时抓取「热点地点新闻」生成静态 JSON
// 供 GitHub Pages 等纯静态托管使用（无需服务器、电脑可关机）
//
// 运行：node web/scripts/fetch-hot-news.mjs [--limit N] [--skip-tiles]
// 产出：web/public/data/news-hot.json（按国家/城市索引的新闻快照）
//       web/public/data/runtime.json （当前 OpenFreeMap 瓦片地址）
// 逻辑与 server.js 一致：多域名轮换 + 重试 + 今日→近7天→近30天回退
// ============================================================
import { mkdirSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA = join(__dirname, '..', 'data');
const OUT = join(__dirname, '..', 'public', 'data');
mkdirSync(OUT, { recursive: true });

const args = process.argv.slice(2);
const LIMIT = (() => { const i = args.indexOf('--limit'); return i >= 0 ? parseInt(args[i + 1], 10) : 0; })();
const SKIP_TILES = args.includes('--skip-tiles');

const UA = { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36' };
const MIN_ITEMS = 4;
const WINDOWS = [['1d', '今日'], ['7d', '近7天'], ['1m', '近30天']];
const NEWS_HOSTS = [
  'news.google.com', 'news.google.com.tw', 'news.google.co.jp', 'news.google.de',
  'news.google.co.uk', 'news.google.ca', 'news.google.com.au', 'news.google.co.in'
];
let hostIdx = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------- 解析（与 server.js 相同） ---------- */
function splitSource(t) {
  const s = String(t || '').replace(/^\[[^\]]*\]\s*/, '').trim();
  const idx = s.lastIndexOf(' - ');
  if (idx > 8) {
    const title = s.slice(0, idx).trim();
    const source = s.slice(idx + 3).trim();
    if (title && source && source.length <= 40) return { title, source };
  }
  return { title: s, source: '' };
}
function extractSnippet(s) {
  if (!s) return '';
  const txt = String(s).replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/&#\d+;/g, ' ').replace(/\s+/g, ' ').trim();
  return txt.length > 160 ? txt.slice(0, 160) + '…' : txt;
}

/* ---------- 抓取单个查询（多域名轮换 + 重试 + 总时限） ---------- */
async function fetchWindow(q, lang, when, attempt = 0, deadline = 0) {
  const zh = lang === 'zh';
  const hl = zh ? 'zh-CN' : 'en-US';
  const gl = zh ? 'CN' : 'US';
  const ceid = zh ? 'CN:zh-Hans' : 'US:en';
  const query = encodeURIComponent(`"${q}" when:${when}`);
  let lastErr = null;
  for (let i = 0; i < NEWS_HOSTS.length; i++) {
    if (deadline && Date.now() > deadline) break;
    const host = NEWS_HOSTS[(hostIdx + i) % NEWS_HOSTS.length];
    try {
      const r = await fetch(`https://${host}/rss/search?q=${query}&hl=${hl}&gl=${gl}&ceid=${ceid}`, {
        signal: AbortSignal.timeout(8000), headers: UA
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const txt = await r.text();
      const items = parseRssItems(txt);
      if (items.length) {
        hostIdx = (hostIdx + i + 1) % NEWS_HOSTS.length;
        return items;
      }
      lastErr = new Error(`${host} 返回空`);
    } catch (e) { lastErr = e; }
  }
  if (attempt < 1 && (!deadline || Date.now() < deadline)) {
    await sleep(500);
    return fetchWindow(q, lang, when, attempt + 1, deadline);
  }
  throw lastErr || new Error('全部域名不可用');
}

/* 轻量 RSS 解析（Google News 格式固定，无需第三方库） */
function parseRssItems(xml) {
  const items = [];
  const re = /<item>([\s\S]*?)<\/item>/g;
  let m;
  while ((m = re.exec(xml))) {
    const block = m[1];
    const title = (block.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || '';
    const link = (block.match(/<link>([\s\S]*?)<\/link>/) || [])[1] || '';
    const pub = (block.match(/<pubDate>([\s\S]*?)<\/pubDate>/) || [])[1] || '';
    const desc = (block.match(/<description>([\s\S]*?)<\/description>/) || [])[1] || '';
    if (!title || !link) continue;
    const { title: t2, source } = splitSource(decodeXml(title));
    let snippet = extractSnippet(decodeXml(desc));
    if (source && snippet.endsWith('  ' + source)) snippet = snippet.slice(0, snippet.length - source.length - 2).trim();
    items.push({ title: t2, link: decodeXml(link), source, published: pub, snippet });
  }
  const uniq = [...new Map(items.map((i) => [i.link, i])).values()];
  uniq.sort((a, b) => new Date(b.published || 0) - new Date(a.published || 0));
  return uniq;
}
function decodeXml(s) {
  return String(s || '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n));
}

async function fetchLocation(q, lang) {
  const deadline = Date.now() + 30000; // 每个地点 30s 总时限
  let best = { window: '', label: '', items: [] };
  let lastErr = null;
  for (const [w, label] of WINDOWS) {
    if (Date.now() > deadline) break;
    try {
      const items = await fetchWindow(q, lang, w, 0, deadline);
      if (items.length > best.items.length) best = { window: w, label, items };
      if (items.length >= MIN_ITEMS) break;
    } catch (e) { lastErr = e; }
  }
  if (!best.items.length && lastErr) throw lastErr;
  return { ...best, items: best.items.slice(0, 15) };
}

/* ---------- 生成查询清单 ---------- */
const countries = JSON.parse(await readFile(join(DATA, 'countries.json'), 'utf8'));
const cities = JSON.parse(await readFile(join(DATA, 'cities.json'), 'utf8'));

const queries = [];
for (const c of countries) {
  queries.push({ key: `country|${c.iso2}|en`, q: c.name });
  if (c.pop >= 5000000) queries.push({ key: `country|${c.iso2}|zh`, q: c.zh }); // 人口前 ~80 国家附中文
}
const topCities = cities.filter((c) => c.cap === 1 || c.pop >= 500000).sort((a, b) => b.pop - a.pop).slice(0, 220);
for (const c of topCities) {
  queries.push({ key: `city|${c.n.toLowerCase()}|en`, q: c.n });
  if (c.z) queries.push({ key: `city|${c.z.toLowerCase()}|zh`, q: c.z });
}
const list = LIMIT ? queries.slice(0, LIMIT) : queries;
console.log(`[fetch] 查询清单 ${list.length} 条（国家 ${countries.length} / 城市 ${topCities.length}）`);

/* ---------- 抓取 ---------- */
const entries = {};
const all = [];
const t0 = Date.now();
let ok = 0, fail = 0;
for (let i = 0; i < list.length; i++) {
  const { key, q } = list[i];
  const lang = key.endsWith('|zh') ? 'zh' : 'en';
  try {
    const res = await fetchLocation(q, lang);
    if (res.items.length) {
      entries[key] = { window: res.window, label: res.label, fetchedAt: new Date().toISOString(), items: res.items };
      for (const it of res.items) all.push({ t: it.title, l: it.link, s: it.source, p: it.published, sn: it.snippet });
      ok++;
    }
  } catch (e) {
    fail++;
    if (fail <= 5) console.log(`[fetch] 失败 ${key} (${q}): ${e.message}`);
  }
  if ((i + 1) % 50 === 0 || i === list.length - 1) {
    console.log(`[fetch] ${i + 1}/${list.length} 成功=${ok} 失败=${fail} 耗时=${((Date.now() - t0) / 1000).toFixed(0)}s`);
  }
  await sleep(350); // 限速，避免触发反爬
}

const newsHot = { generatedAt: new Date().toISOString(), count: ok, entries, all };
await writeFile(join(OUT, 'news-hot.json'), JSON.stringify(newsHot));

/* ---------- 固化当前瓦片地址（供静态模式直连） ---------- */
if (!SKIP_TILES) {
  try {
    const r = await fetch('https://tiles.openfreemap.org/planet', { signal: AbortSignal.timeout(20000), headers: UA });
    const j = await r.json();
    if (j && Array.isArray(j.tiles) && j.tiles.length) {
      await writeFile(join(OUT, 'runtime.json'), JSON.stringify({ tiles: j.tiles, generatedAt: new Date().toISOString() }));
      console.log('[fetch] 瓦片地址已固化:', j.tiles[0]);
    }
  } catch (e) { console.warn('[fetch] 瓦片地址获取失败（静态模式将使用默认模板）:', e.message); }
}

console.log(`[fetch] 完成 ✓ 地点=${ok} 全部条目=${all.length} 写入 news-hot.json（${(newsHot.length || 0) > 0 ? '' : ''}${(Buffer.byteLength(JSON.stringify(newsHot)) / 1024).toFixed(0)}KB）`);
