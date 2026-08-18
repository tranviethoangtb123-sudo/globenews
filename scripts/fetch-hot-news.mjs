// ============================================================
// 环球新闻地球仪 —— 云端定时抓取「热点地点新闻」生成静态 JSON
// 供 GitHub Pages 等纯静态托管使用（无需服务器、电脑可关机）
//
// 运行：node web/scripts/fetch-hot-news.mjs [--limit N] [--skip-tiles]
// 产出：web/public/data/news-hot.json（按国家/城市索引的新闻快照）
//       web/public/data/runtime.json （当前 OpenFreeMap 瓦片地址）
// 逻辑与 server.js 一致：多域名轮换 + 重试 + 今日→近7天→近30天回退
// ============================================================
import { mkdirSync, existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { classifyCategories } from './classify-news.mjs';
import { createRegionMatcher, loadEntityMap } from './entity-regions.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
// 数据目录自动探测（public/data 或 data），随站点发布时数据在 public/data
const CANDIDATES = [join(__dirname, '..', 'public', 'data'), join(__dirname, '..', 'data')];
const DATA = CANDIDATES.find((d) => existsSync(join(d, 'countries.json'))) || CANDIDATES[0];
const OUT = DATA;
mkdirSync(OUT, { recursive: true });

const args = process.argv.slice(2);
const LIMIT = (() => { const i = args.indexOf('--limit'); return i >= 0 ? parseInt(args[i + 1], 10) : 0; })();
const ONLY = (() => { const i = args.indexOf('--only'); return i >= 0 ? args[i + 1].split(',').map((s) => s.trim()).filter(Boolean) : null; })();
const SKIP_TILES = args.includes('--skip-tiles');
const SKIP_SOURCES = args.includes('--skip-sources');
const SKIP_TZ = args.includes('--skip-tz'); // 本地调试用：跳过云端翻译（本机常被墙）

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
  if (attempt < 2 && (!deadline || Date.now() < deadline)) {
    await sleep(1000 + attempt * 1000); // 重试退避 1s / 2s
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
    items.push({ title: t2, link: decodeXml(link), source, published: pub, snippet, cat: classifyCategories(t2 + ' ' + snippet).slice(0, 3) });
  }
  const uniq = [...new Map(items.map((i) => [i.link, i])).values()];
  uniq.sort((a, b) => new Date(b.published || 0) - new Date(a.published || 0));
  return uniq;
}
function decodeXml(s) {
  return String(s || '')
    .replace(/<!\[CDATA\[/g, '').replace(/\]\]>/g, '')   // 去掉 CDATA 标记
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n));
}

/* ---------- 标题中文翻译（云端预翻译，写入 tz 字段，客户端直接显示） ---------- */
const tzNeed = (t) => {
  if (!t) return false;
  const hasLatin = /[a-zA-Z]{2}/.test(t);
  const hasKanaHangul = /[\u3040-\u30ff\uac00-\ud7af\u0600-\u06ff\u0400-\u04ff]/.test(t);
  const hasHan = /[\u4e00-\u9fff]/.test(t);
  return (hasLatin || hasKanaHangul) && (!hasHan || /[\u3040-\u30ff\uac00-\ud7af]/.test(t));
};
const tzQueue = [];
let tzRunning = 0;
const TZ_MAX_CONC = 6;
function translateText(text) {
  return new Promise((resolve) => {
    if (!tzNeed(text)) return resolve('');
    tzQueue.push({ text: text.slice(0, 1500), resolve, tries: 0 });
    pumpTz();
  });
}
function pumpTz() {
  while (tzRunning < TZ_MAX_CONC && tzQueue.length) {
    const { text, resolve, tries } = tzQueue.shift();
    tzRunning++;
    fetch(`https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=zh-CN&dt=t&q=${encodeURIComponent(text)}`, {
      signal: AbortSignal.timeout(12000), headers: UA
    })
      .then((r) => r.json())
      .then((j) => {
        const out = (j && j[0] ? j[0].map((x) => x[0]).join('') : '').trim();
        if (!out && tries < 1) { tzQueue.push({ text, resolve, tries: tries + 1 }); pumpTz(); return; }
        resolve(out);
      })
      .catch(() => { if (tries < 1) { tzQueue.push({ text, resolve, tries: tries + 1 }); pumpTz(); return; } resolve(''); })
      .finally(() => { tzRunning--; pumpTz(); });
  }
}
async function translateItems(items) {
  if (SKIP_TZ) return; // 本地调试：跳过翻译
  const jobs = [];
  for (const it of (items || [])) {
    if (tzNeed(it.title) && !it.tz) jobs.push(translateText(it.title).then((t) => { it.tz = t; }));
  }
  await Promise.all(jobs);
}

async function fetchLocation(q, lang) {
  const deadline = Date.now() + 45000; // 每个地点 45s 总时限
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
  return { ...best, items: best.items.slice(0, 12) };
}

/* ---------- 生成查询清单 ---------- */
const countries = JSON.parse(await readFile(join(DATA, 'countries.json'), 'utf8'));
const cities = JSON.parse(await readFile(join(DATA, 'cities.json'), 'utf8'));

const queries = [];
for (const c of countries) {
  queries.push({ key: `country|${c.iso2}|en`, q: c.name, loc: c.name });
  if (c.pop >= 5000000) queries.push({ key: `country|${c.iso2}|zh`, q: c.zh, loc: c.zh }); // 人口前 ~80 国家附中文
}
const topCities = cities.filter((c) => c.cap === 1 || c.pop >= 500000).sort((a, b) => b.pop - a.pop).slice(0, 220);
for (const c of topCities) {
  queries.push({ key: `city|${c.n.toLowerCase()}|en`, q: c.n, loc: c.n });
  if (c.z) queries.push({ key: `city|${c.z.toLowerCase()}|zh`, q: c.z, loc: c.z });
}
// 实体专题查询（公司/指数/人物/组织/海峡等）：确保实体相关新闻必定被抓取，再按图谱多对多归属
const entityMapQueries = loadEntityMap();
const entityQueryRegions = new Map(); // entity key -> [regions]
(entityMapQueries.queries || []).forEach((eq, i) => {
  const key = `entity|${i}|en`;
  entityQueryRegions.set(key, eq.regions || []);
  queries.push({ key, q: eq.q, loc: eq.loc || eq.q });
});
const list0 = LIMIT ? queries.slice(0, LIMIT) : queries;
const list = ONLY ? list0.filter((x) => ONLY.some((k) => x.key.toLowerCase().includes(k.toLowerCase()) || x.q.toLowerCase().includes(k.toLowerCase()))) : list0;
console.log(`[fetch] 查询清单 ${list.length} 条（国家 ${countries.length} / 城市 ${topCities.length}）`);

/* ---------- 抓取 ---------- */
const entries = {};
const t0 = Date.now();
let ok = 0, fail = 0, consecFail = 0;
for (let i = 0; i < list.length; i++) {
  const { key, q, loc } = list[i];
  const lang = key.endsWith('|zh') ? 'zh' : 'en';
  try {
    const res = await fetchLocation(q, lang);
    if (res.items.length) {
      entries[key] = { window: res.window, label: res.label, fetchedAt: new Date().toISOString(), loc, items: res.items };
      ok++;
      consecFail = 0;
    }
  } catch (e) {
    fail++;
    consecFail++;
    if (fail <= 5) console.log(`[fetch] 失败 ${key} (${q}): ${e.message}`);
    // 连续失败大概率被 Google 限流：整体退避 15-25s 再继续
    if (consecFail >= 8) {
      const backoff = 15000 + Math.random() * 10000;
      console.log(`[fetch] 连续失败 ${consecFail} 次，退避 ${(backoff / 1000).toFixed(0)}s 后继续`);
      await sleep(backoff);
      consecFail = 0;
    }
  }
  if ((i + 1) % 50 === 0 || i === list.length - 1) {
    console.log(`[fetch] ${i + 1}/${list.length} 成功=${ok} 失败=${fail} 耗时=${((Date.now() - t0) / 1000).toFixed(0)}s`);
  }
  await sleep(1200 + Math.random() * 800); // 限速：1.2-2s 随机间隔，避免触发反爬
}

/* ================= 实体关联：多对多归属（替代纯关键词匹配） =================
   1) 汇总全局新闻池（查询结果 + 来源 feeds，按 link 去重）
   2) 全量翻译（每篇只译一次）
   3) 实体→地区 匹配（entity-map.json 知识图谱 + 国家/城市名），得到每篇的关联地区集合
   4) 生成 国家 / 城市 / 国际(公海·争议地区) 条目：每篇新闻自动归入所有相关地区
   ====================================================================== */
const OUT_N = join(OUT, 'n');
mkdirSync(OUT_N, { recursive: true });
const hash = (s) => { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0; return h.toString(36); };
const topCityByN = new Map(topCities.map((c) => [c.n.toLowerCase(), c]));

// 0) 全局新闻池（按 link 去重；loc 保留首个来源标签）
const pool = new Map(); // link -> item
const addPool = (it, loc, originIso2, originRegions) => {
  if (!it || !it.link) return;
  const prev = pool.get(it.link);
  if (prev) {
    if (!prev.originIso2 && originIso2) prev.originIso2 = originIso2;
    if (!prev.originRegions && originRegions && originRegions.length) prev.originRegions = originRegions;
    if (!prev.loc && loc) prev.loc = loc;
    return;
  }
  pool.set(it.link, { ...it, loc: loc || '', originIso2: originIso2 || null, originRegions: (originRegions && originRegions.length) ? originRegions : null });
};
for (const key in entries) {
  const e = entries[key];
  let iso2 = null, originRegions = null;
  if (key.startsWith('country|')) iso2 = key.split('|')[1];
  else if (key.startsWith('city|')) { const rec = topCityByN.get(key.split('|')[1]); if (rec) iso2 = rec.c; }
  else if (key.startsWith('entity|')) originRegions = entityQueryRegions.get(key) || null;
  for (const it of e.items) addPool(it, e.loc, iso2, originRegions);
}

// 1) 抓取「新闻来源」feeds（同时并入池，参与多对多归属）
const sourceOut = [];
if (!SKIP_SOURCES) {
  try {
    const sd = JSON.parse(await readFile(join(__dirname, 'sources-data.json'), 'utf8'));
    const so = (sd && sd.sources) || [];
    for (let i = 0; i < so.length; i++) {
      const src = so[i];
      try {
        const r = await fetch(src.url, { signal: AbortSignal.timeout(8000), headers: UA });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const items = parseRssItems(await r.text());
        if (items.length) {
          const top = items.slice(0, 8);
          for (const it of top) addPool(it, '📰 ' + src.name, null);
          // 用池内（翻译后）的条目作为来源展示数据
          sourceOut.push({ name: src.name, region: src.region, group: src.group, lang: src.lang, items: top.map((it) => pool.get(it.link)).filter(Boolean) });
        }
      } catch (e) { if (i < 3) console.log(`[fetch] 来源失败 ${src.name}: ${e.message}`); }
      if ((i + 1) % 30 === 0) console.log(`[fetch] 来源 ${i + 1}/${so.length}`);
      await sleep(600 + Math.random() * 400);
    }
    await writeFile(join(OUT, 'news-sources.json'), JSON.stringify({ generatedAt: new Date().toISOString(), sources: sourceOut }));
    console.log(`[fetch] 来源抓取完成：${sourceOut.length} 个来源`);
  } catch (e) { console.warn('[fetch] 来源抓取跳过：', e.message); }
}

// 2) 全量翻译（去重后每篇只译一次）
const poolArr = [...pool.values()];
await translateItems(poolArr);

// 3) 实体→地区 匹配（知识图谱多对多）
const matcher = createRegionMatcher(countries, cities, loadEntityMap());
const regionCache = new Map();
for (const it of poolArr) {
  const text = (it.title || '') + ' ' + (it.snippet || '');
  let set = regionCache.get(text);
  if (!set) { set = matcher.matchRegions(text); regionCache.set(text, set); }
  it.regions = new Set(set);
  if (it.originIso2) it.regions.add(it.originIso2); // 原抓取地点必然归属
  if (it.originRegions) for (const r of it.originRegions) it.regions.add(r); // 实体专题查询：图谱归属兜底
}
console.log(`[实体] 图谱别名 ${matcher.aliasCount} 个 / 新闻池 ${poolArr.length} 篇，多对多归属完成`);

// 4) 条目生成
const cap = (arr, n) => arr.slice().sort((a, b) => new Date(b.published || 0) - new Date(a.published || 0)).slice(0, n);
const countryZhQueried = new Set(Object.keys(entries).filter((k) => k.startsWith('country|') && k.endsWith('|zh')));
const finalEntries = {}; // key -> { items, loc, window, label }

// 4a) 国家：全部国家，只要有相关新闻（含实体关联）即生成条目
//     多国归属优先：涉及多国的新闻不设上限、排在前列，确保出现在所有相关国家列表
const byRec = (a, b) => new Date(b.published || 0) - new Date(a.published || 0);
for (const c of countries) {
  const key = `country|${c.iso2}|en`;
  const origin = entries[key];
  const rel = poolArr.filter((it) => it.regions.has(c.iso2));
  if (!rel.length && !origin) continue;
  const multi = rel.filter((it) => it.regions.size >= 2).slice().sort(byRec);
  const single = rel.filter((it) => it.regions.size < 2).slice().sort(byRec).slice(0, 120);
  const items = [...multi, ...single];
  finalEntries[key] = { items, loc: c.name, window: origin ? origin.window : '', label: origin ? origin.label : '实体关联' };
  if (countryZhQueried.has(`country|${c.iso2}|zh`)) {
    finalEntries[`country|${c.iso2}|zh`] = { items, loc: c.zh, window: origin ? origin.window : '', label: origin ? origin.label : '实体关联' };
  }
}

// 4b) 城市：原查询成功的城市 + 池内「标题/摘要提到该城市」的新闻
for (const key of Object.keys(entries)) {
  if (!key.startsWith('city|')) continue;
  const origin = entries[key];
  const name = key.split('|')[1];
  const rec = topCityByN.get(name);
  const rel = rec ? poolArr.filter((it) => matcher.cityMatch(rec.n, rec.z, (it.title || '') + ' ' + (it.snippet || ''))) : origin.items;
  const merged = new Map();
  for (const it of rel) merged.set(it.link, it);
  for (const it of origin.items) merged.set(it.link, it);
  finalEntries[key] = { items: cap([...merged.values()], 60), loc: origin.loc, window: origin.window, label: origin.label };
}

// 4c) 国际 / 公海 / 争议地区（无归属地区分类）
const intlItems = poolArr.filter((it) => it.regions.has('INTL'));
if (intlItems.length) {
  const items = cap(intlItems, 100);
  finalEntries['place|international|zh'] = { items, loc: '国际', window: '', label: '国际 · 公海 · 争议地区' };
  finalEntries['place|international|en'] = { items, loc: 'International', window: '', label: 'International' };
}

// 5) 输出：小索引 + 按需分片 + 标题索引 + 板块聚合
const index = { generatedAt: new Date().toISOString(), count: Object.keys(finalEntries).length, entries: {} };
const titles = [];
const sectors = {};
const seenLink = new Set();
for (const key in finalEntries) {
  const e = finalEntries[key];
  const clean = e.items.map((it) => { const { regions, ...rest } = it; return rest; }); // 去掉运行时字段
  const fname = `${hash(key)}.json`;
  await writeFile(join(OUT_N, fname), JSON.stringify({ window: e.window, label: e.label, fetchedAt: index.generatedAt, loc: e.loc, items: clean }));
  index.entries[key] = { f: `n/${fname}`, loc: e.loc, window: e.window, label: e.label, n: clean.length };
}
for (const it of poolArr) {
  if (!it.link || seenLink.has(it.link)) continue;
  seenLink.add(it.link);
  titles.push({ t: it.title, l: it.link, loc: it.loc, cat: it.cat, p: it.published, tz: it.tz || '' });
  for (const c of it.cat || []) {
    const b = (sectors[c] = sectors[c] || []);
    if (b.length < 60 && !b.some((x) => x.l === it.link)) {
      b.push({ t: it.title, l: it.link, loc: it.loc, s: it.source, p: it.published, sn: it.snippet, tz: it.tz || '' });
    }
  }
}
for (const c in sectors) {
  sectors[c].sort((a, b) => new Date(b.p || 0) - new Date(a.p || 0));
  if (sectors[c].length > 60) sectors[c] = sectors[c].slice(0, 60);
}
await writeFile(join(OUT, 'news-hot.json'), JSON.stringify(index)); // 索引很小，启动即拉取
await writeFile(join(OUT, 'news-titles.json'), JSON.stringify({ generatedAt: index.generatedAt, items: titles })); // 任意地名全文扫描（懒加载）
await writeFile(join(OUT, 'news-sectors.json'), JSON.stringify({ generatedAt: index.generatedAt, sectors })); // 板块视图（懒加载）
console.log(`[fetch] 输出分片 ${Object.keys(index.entries).length} 个 / 标题索引 ${titles.length} / 板块 ${Object.keys(sectors).length} 类`);

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

console.log(`[fetch] 完成 ✓ 地点=${ok} 全部条目=${titles.length}`);
