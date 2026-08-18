// ============================================================
// 实体→地区 匹配引擎（知识图谱多对多归属）
// 输入：entity-map.json（可手动维护）+ countries.json + cities.json
// 输出：matchRegions(text) → Set<iso2 | INTL>；cityMatch() 城市级匹配
// 匹配规则：拉丁别名=整词匹配（词边界、大小写不敏感，长词优先）；
//          中文别名=包含匹配（长词优先，子串冲突时只保留最长命中，如「中国国务院」优先于「国务院」）
// ============================================================
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export function loadEntityMap() {
  return JSON.parse(readFileSync(join(__dirname, 'entity-map.json'), 'utf8'));
}

const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// 常见国家别名（countries.json 的英文名之外）
const COUNTRY_ALIASES = {
  'united states': ['US'], 'usa': ['US'], 'u.s.': ['US'], 'u.s.a': ['US'], 'america': ['US'],
  'uk': ['GB'], 'u.k.': ['GB'], 'united kingdom': ['GB'], 'great britain': ['GB'],
  'korea': ['KR', 'KP'], 'czech republic': ['CZ'], 'uae': ['AE'], 'united arab emirates': ['AE'],
  'saudi arabia': ['SA'], 'taiwan': ['TW', 'CN', 'US'], 'venezuela': ['VE'], 'vietnam': ['VN'],
  'north korea': ['KP'], 'south korea': ['KR'], 'iran': ['IR'], 'syria': ['SY'], 'iraq': ['IQ']
};

export function createRegionMatcher(countries, cities, entityMap) {
  const aliasRegions = {}; // 小写别名 -> [regions]
  const add = (alias, regions) => {
    if (!Array.isArray(regions)) return; // 防御：只接受数组（避免误入非映射字段）
    const k = String(alias || '').trim().toLowerCase();
    if (k.length < 2) return; // 避免单字母误匹配
    aliasRegions[k] = regions;
  };
  // 1) 国家：英文名 + 中文名 → 本国
  for (const c of countries || []) {
    add(c.name, [c.iso2]);
    if (c.zh) add(c.zh, [c.iso2]);
  }
  for (const [a, r] of Object.entries(COUNTRY_ALIASES)) add(a, r);
  // 2) 城市：英文名 + 中文名 → 所属国家
  for (const ct of cities || []) {
    if (ct.n && ct.c) add(ct.n, [ct.c]);
    if (ct.z && ct.c) add(ct.z, [ct.c]);
  }
  // 3) 实体知识图谱
  for (const cat of Object.keys(entityMap || {})) {
    if (cat.startsWith('_') || cat === 'queries') continue; // queries 是专题抓取清单，不是映射表
    for (const [alias, regions] of Object.entries(entityMap[cat] || {})) add(alias, regions);
  }

  // 拉丁（词边界整词）与中文（包含）分开构建；均按长度降序（长词优先）
  const latin = [];
  const cjk = [];
  for (const [k, regions] of Object.entries(aliasRegions)) {
    if (/[\u4e00-\u9fff]/.test(k)) cjk.push({ k, regions });
    else latin.push({ k, regions });
  }
  latin.sort((a, b) => b.k.length - a.k.length);
  cjk.sort((a, b) => b.k.length - a.k.length);
  const latinRe = latin.length ? new RegExp(`\\b(?:${latin.map((x) => esc(x.k)).join('|')})\\b`, 'i') : null;

  function matchRegions(text) {
    const found = new Set();
    const t = String(text || '');
    if (!t) return found;
    if (latinRe) {
      const re = new RegExp(latinRe.source, 'gi');
      let m;
      while ((m = re.exec(t))) {
        const k = m[0].toLowerCase();
        // 二分查找不可用（对象序），线性找（命中次数少，量级 ~几千，可接受）
        for (const x of latin) {
          if (x.k === k) { x.regions.forEach((r) => found.add(r)); break; }
        }
      }
    }
    if (cjk.length) {
      const hits = cjk.filter((x) => t.includes(x.k));
      const kept = hits.filter((h) => !hits.some((o) => o.k.length > h.k.length && o.k.includes(h.k)));
      for (const h of kept) h.regions.forEach((r) => found.add(r));
    }
    return found;
  }

  // 城市级匹配（用于 city 条目补充：标题/摘要提到该城市即归属）
  function cityMatch(nameEn, nameZh, text) {
    const t = String(text || '');
    if (!t) return false;
    if (nameZh && t.includes(nameZh)) return true;
    if (nameEn) {
      const re = new RegExp(`\\b${esc(nameEn)}\\b`, 'i');
      if (re.test(t)) return true;
    }
    return false;
  }

  return { matchRegions, cityMatch, aliasCount: Object.keys(aliasRegions).length };
}
