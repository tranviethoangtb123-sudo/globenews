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

/* ---------- 输出：小索引 + 按需分片 + 标题扫描索引 + 板块聚合（点开才下载，秒开） ---------- */
const OUT_N = join(OUT, 'n');
mkdirSync(OUT_N, { recursive: true });
const hash = (s) => { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0; return h.toString(36); };

const index = { generatedAt: new Date().toISOString(), count: ok, entries: {} };
const titles = [];
const sectors = {};
const seenLink = new Set();
for (const key in entries) {
  const e = entries[key];
  await translateItems(e.items); // 云端预翻译全部标题（写入 it.tz，客户端直接显示）
  const fname = `${hash(key)}.json`;
  await writeFile(join(OUT_N, fname), JSON.stringify(e));
  index.entries[key] = { f: `n/${fname}`, loc: e.loc, window: e.window, label: e.label, n: e.items.length };
  for (const it of e.items) {
    if (!it.link || seenLink.has(it.link)) continue;
    seenLink.add(it.link);
    titles.push({ t: it.title, l: it.link, loc: e.loc, cat: it.cat, p: it.published, tz: it.tz || '' });
    for (const c of it.cat || []) {
      (sectors[c] = sectors[c] || []).push({ t: it.title, l: it.link, loc: e.loc, s: it.source, p: it.published, sn: it.snippet, tz: it.tz || '' });
    }
  }
}
await writeFile(join(OUT, 'news-hot.json'), JSON.stringify(index)); // 索引很小，启动即拉取
await writeFile(join(OUT, 'news-titles.json'), JSON.stringify({ generatedAt: index.generatedAt, items: titles })); // 任意地名全文扫描（懒加载）

/* ---------- 抓取「新闻来源」feeds（用户提供的国内/国外来源分类） ---------- */
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
        await translateItems(top); // 来源标题全部预翻译
        sourceOut.push({ name: src.name, region: src.region, group: src.group, lang: src.lang, items: top });
        // 同时并入板块聚合（来源名作为地点标签）
        for (const it of top) {
          for (const c of it.cat || []) {
            if (!seenLink.has(it.link)) {
              seenLink.add(it.link);
              titles.push({ t: it.title, l: it.link, loc: '📰 ' + src.name, cat: it.cat, p: it.published, tz: it.tz || '' });
            }
            const b = (sectors[c] = sectors[c] || []);
            if (b.length < 60 && !b.some((x) => x.l === it.link)) {
              b.push({ t: it.title, l: it.link, loc: '📰 ' + src.name, s: it.source || src.name, p: it.published, sn: it.snippet, tz: it.tz || '' });
            }
          }
        }
      }
    } catch (e) {
      if (i < 3) console.log(`[fetch] 来源失败 ${src.name}: ${e.message}`);
    }
    if ((i + 1) % 30 === 0) console.log(`[fetch] 来源 ${i + 1}/${so.length}`);
    await sleep(600 + Math.random() * 400); // 来源抓取同样限速
  }
  await writeFile(join(OUT, 'news-sources.json'), JSON.stringify({ generatedAt: new Date().toISOString(), sources: sourceOut }));
  console.log(`[fetch] 来源抓取完成：${sourceOut.length} 个来源`);
  } catch (e) { console.warn('[fetch] 来源抓取跳过：', e.message); }
}

for (const c in sectors) {
  sectors[c].sort((a, b) => new Date(b.p || 0) - new Date(a.p || 0));
  if (sectors[c].length > 60) sectors[c] = sectors[c].slice(0, 60);
}
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
