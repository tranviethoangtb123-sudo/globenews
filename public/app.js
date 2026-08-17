/* ============================================================
 * 环球新闻地球仪 · Globe News
 * MapLibre 矢量地球仪 + 国家/城市列表 + Google News 按地点聚合
 * ============================================================ */
'use strict';
/* global maplibregl */

const $ = (id) => document.getElementById(id);
const el = (tag, cls, html) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  return e;
};
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const state = {
  lang: localStorage.getItem('gn.lang') === 'en' ? 'en' : 'zh',
  view: 'globe',
  mode: 'server', // server(本地/服务器实时) | static(静态托管，读云端定时快照)
  countries: [],
  countryByIso2: new Map(),
  cities: [],
  citiesGeo: null,
  geo: null,
  styleBase: null,
  tileTiles: ['https://tiles.openfreemap.org/planet/{z}/{x}/{y}.pbf'],
  map: null,
  globe: null,
  mapMode: 'night', // night(夜景地球,默认) | vector(矢量地图：街道/路名)
  projection: 'globe',
  selected: null,
  selectedGeoId: null,
  newsReqId: 0,
  newsCat: 'ALL',      // 新闻面板板块过滤
  sectorIndex: null,   // 板块视图聚合数据（懒加载）
  sectorSel: 'ALL',    // 板块视图当前选中
  srcRegion: '国内',    // 来源视图：国内/国外
  srcGroup: null,       // 来源视图：当前分类组
  labelLayerIds: [],
  toastTimer: null,
  toastSeen: new Set()
};

/* ---------------- 基础数据 ---------------- */
const CONTINENTS = [
  { id: 'asia', zh: '亚洲', en: 'Asia', icon: '🗺️' },
  { id: 'europe', zh: '欧洲', en: 'Europe', icon: '🏰' },
  { id: 'africa', zh: '非洲', en: 'Africa', icon: '🦁' },
  { id: 'namerica', zh: '北美洲', en: 'North America', icon: '🏔️' },
  { id: 'samerica', zh: '南美洲', en: 'South America', icon: '🌴' },
  { id: 'oceania', zh: '大洋洲', en: 'Oceania', icon: '🦘' },
  { id: 'polar', zh: '南极洲', en: 'Antarctica', icon: '🐧' }
];
const continentOf = (c) => {
  if (c.region === 'Asia') return 'asia';
  if (c.region === 'Europe') return 'europe';
  if (c.region === 'Africa') return 'africa';
  if (c.region === 'Oceania') return 'oceania';
  if (c.region === 'Polar') return 'polar';
  if (c.region === 'Americas') return (c.subregion === 'South America') ? 'samerica' : 'namerica';
  return 'asia';
};
// 新闻搜索用名覆盖（避免政治表述干扰搜索结果）
const QUERY_OVERRIDES = { TW: '台湾', HK: '香港', MO: '澳门', XK: '科索沃', PS: '巴勒斯坦', KP: '朝鲜', KR: '韩国', AE: '阿联酋', SA: '沙特阿拉伯' };
const HOT_CITIES = [];

const zhName = (c) => (state.lang === 'zh' ? c.zh : c.name);
const queryName = (c) => {
  if (state.lang === 'zh') return QUERY_OVERRIDES[c.iso2] || c.zh;
  return c.name;
};

/* ---------------- 数据加载 ---------------- */
async function detectMode() {
  // 有 /api 说明跑在本地服务器（实时新闻）；纯静态托管则用云端定时快照
  try {
    const r = await fetch('api/ping', { signal: AbortSignal.timeout(3000) });
    if (r.ok) return 'server';
  } catch (e) { /* 静态 */ }
  return 'static';
}

async function loadData() {
  const tilejsonP = fetch('api/tilejson')
    .then((r) => r.json())
    .catch(async () => {
      try { // 静态模式：读云端抓取时固化的瓦片地址
        const rt = await (await fetch('data/runtime.json')).json();
        if (rt && Array.isArray(rt.tiles) && rt.tiles.length) return { tiles: rt.tiles };
      } catch (e) { /* 无 */ }
      return { tiles: ['https://tiles.openfreemap.org/planet/{z}/{x}/{y}.pbf'] };
    });
  const [countries, geo, cities, styleBase, tilejson] = await Promise.all([
    fetch('data/countries.json').then((r) => r.json()),
    fetch('data/countries.geo.json').then((r) => r.json()),
    fetch('data/cities.json').then((r) => r.json()),
    fetch('data/style-liberty.json').then((r) => r.json()),
    tilejsonP
  ]);
  state.countries = countries;
  state.geo = geo;
  state.cities = cities;
  state.styleBase = styleBase;
  state.tileTiles = (tilejson && tilejson.tiles && tilejson.tiles.length) ? tilejson.tiles : ['https://tiles.openfreemap.org/planet/{z}/{x}/{y}.pbf'];
  for (const c of countries) state.countryByIso2.set(c.iso2, c);
  state.citiesGeo = {
    type: 'FeatureCollection',
    features: cities.map((c) => ({
      type: 'Feature',
      properties: { n: c.n, z: c.z, c: c.c, cap: c.cap, r: c.r },
      geometry: { type: 'Point', coordinates: [c.lng, c.lat] }
    }))
  };
}

/* ---------------- 经纬网 ---------------- */
function buildGraticule() {
  const feats = [];
  const step = 15;
  const lonLine = (lon) => ({ type: 'Feature', geometry: { type: 'LineString', coordinates: [[lon, -90], [lon, 90]] } });
  const latLine = (lat) => ({
    type: 'Feature', geometry: {
      type: 'LineString',
      coordinates: Array.from({ length: 181 }, (_, i) => [-180 + i * 2, lat])
    }
  });
  for (let lat = -90; lat <= 90; lat += step) if (lat !== 0) feats.push({ ...latLine(lat), properties: { major: 0 } });
  for (let lon = -180; lon <= 180; lon += step) if (lon !== 0) feats.push({ ...lonLine(lon), properties: { major: 0 } });
  feats.push({ ...latLine(0), properties: { major: 1 } });
  feats.push({ ...lonLine(0), properties: { major: 1 } });
  // 经纬度标注（每 45°）
  for (let lat = -90; lat <= 90; lat += 45) {
    if (lat === 0) continue;
    feats.push({ type: 'Feature', properties: { t: `${lat > 0 ? 'N' : 'S'}${Math.abs(lat)}°` }, geometry: { type: 'Point', coordinates: [0, lat] } });
  }
  for (let lon = -180; lon <= 180; lon += 45) {
    if (lon === 0) continue;
    feats.push({ type: 'Feature', properties: { t: `${lon > 0 ? 'E' : 'W'}${Math.abs(lon)}°` }, geometry: { type: 'Point', coordinates: [lon, 0] } });
  }
  return { type: 'FeatureCollection', features: feats };
}

/* ---------------- 深色样式改造 ---------------- */
function parseColor(v) {
  v = String(v).trim();
  const hex = v.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (hex) {
    let h = hex[1];
    if (h.length === 3) h = h.split('').map((x) => x + x).join('');
    return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16), a: 1 };
  }
  const rgb = v.match(/^rgba?\(([^)]+)\)$/i);
  if (rgb) {
    const parts = rgb[1].split(',').map((x) => parseFloat(x.trim()));
    return { r: parts[0] || 0, g: parts[1] || 0, b: parts[2] || 0, a: parts.length > 3 ? parts[3] : 1 };
  }
  return null;
}
function toRgba(c) {
  return `rgba(${Math.round(c.r)},${Math.round(c.g)},${Math.round(c.b)},${c.a})`;
}
function rgb2hsl({ r, g, b }) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0; const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (max === g) h = ((b - r) / d + 2) / 6;
    else h = ((r - g) / d + 4) / 6;
  }
  return { h: h * 360, s, l };
}
function hsl2rgb({ h, s, l }) {
  h = ((h % 360) + 360) % 360 / 360;
  const hue2rgb = (p, q, t) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return { r: hue2rgb(p, q, h + 1 / 3) * 255, g: hue2rgb(p, q, h) * 255, b: hue2rgb(p, q, h - 1 / 3) * 255 };
}
function adjust(v, lMul, sMul) {
  const c = parseColor(v);
  if (!c) return v;
  const hsl = rgb2hsl(c);
  hsl.l = Math.max(0, Math.min(1, hsl.l * lMul));
  hsl.s = Math.max(0, Math.min(1, hsl.s * (sMul == null ? 1 : sMul)));
  const rgb = hsl2rgb(hsl);
  return toRgba({ ...rgb, a: c.a });
}

function darkenLayer(l) {
  const p = l.paint || {};
  const id = l.id;
  const isLabel = id.startsWith('label_') || id.endsWith('_label');
  const isWater = id.startsWith('water') || id === 'water';
  const isRoad = /road|highway|bridge|tunnel|rail/.test(id);
  const isBoundary = id.startsWith('boundary');
  const isBuilding = id.startsWith('building');
  const isLand = /landcover|landuse|park/.test(id);
  const isAero = id.startsWith('aeroway');
  const isPoi = id.startsWith('poi');
  const KEYS = ['background-color', 'fill-color', 'fill-outline-color', 'fill-extrusion-color', 'line-color', 'text-color', 'text-halo-color', 'circle-color', 'icon-color'];
  for (const k of KEYS) {
    const v = p[k];
    if (typeof v !== 'string' || !v || !v.startsWith('#')) continue;
    if (k === 'text-color') p[k] = isLabel ? '#e6f0ff' : adjust(v, 0.9, 0.7);
    else if (k === 'text-halo-color') p[k] = '#04060c';
    else if (l.type === 'background') p[k] = '#04060c';
    else if (isWater) p[k] = (id === 'water') ? '#06101f' : adjust(v, 0.35, 0.4);
    else if (isRoad) p[k] = adjust(v, 0.3, 0.3);
    else if (isBoundary) p[k] = '#3fa7e0';
    else if (isBuilding) p[k] = '#131c2e';
    else if (isLand) p[k] = adjust(v, 0.22, 0.35);
    else if (isAero) p[k] = adjust(v, 0.3, 0.3);
    else if (isPoi) p[k] = '#dbe7f7';
    else p[k] = adjust(v, 0.3, 0.5);
  }
  if (isBoundary) {
    const lo = p['line-opacity'];
    if (typeof lo === 'number') p['line-opacity'] = Math.min(0.9, lo);
    else if (lo == null) p['line-opacity'] = 0.6;
    if (typeof p['line-width'] === 'number') p['line-width'] = Math.max(0.7, p['line-width']);
  }
  if (isWater && typeof p['fill-opacity'] === 'number') p['fill-opacity'] = p['fill-opacity'] * 0.9;
  return l;
}

function firstFont(style) {
  for (const l of style.layers || []) {
    const f = l.layout && l.layout['text-font'];
    if (Array.isArray(f) && f.length) return f;
  }
  return ['Noto Sans Regular'];
}

function adaptStyle(base) {
  const s = JSON.parse(JSON.stringify(base));
  s.layers = s.layers.filter((l) => l.id !== 'natural_earth'); // 去掉卫星晕渲，纯矢量深色
  delete s.sources['ne2_shaded'];
  s.layers = s.layers.map(darkenLayer);

  const font = firstFont(s);
  // 矢量瓦片源：显式使用代理解析出的瓦片地址（避免浏览器跨域拉取 style JSON）
  if (s.sources && s.sources['openmaptiles']) {
    const omt = s.sources['openmaptiles'];
    delete omt.url;
    omt.tiles = state.tileTiles;
  }
  s.sources['graticule'] = { type: 'geojson', data: buildGraticule() };
  s.sources['countries'] = { type: 'geojson', data: state.geo, promoteId: 'id' };
  s.sources['cities'] = { type: 'geojson', data: state.citiesGeo };
  s.sources['terrain-dem'] = {
    type: 'raster-dem',
    tiles: ['https://elevation-tiles-prod.s3.amazonaws.com/terrarium/{z}/{x}/{y}.png'],
    encoding: 'terrarium',
    tileSize: 256,
    maxzoom: 15
  };

  // —— 自定义图层 ——
  const graticule = {
    id: 'graticule', type: 'line', source: 'graticule',
    filter: ['==', ['geometry-type'], 'LineString'],
    paint: {
      'line-color': '#1d3350', 'line-width': 0.5,
      'line-opacity': ['interpolate', ['linear'], ['zoom'], 0, 0.3, 2, 0.2, 5, 0.08, 8, 0.02]
    }
  };
  const graticuleMajor = {
    id: 'graticule-major', type: 'line', source: 'graticule',
    filter: ['all', ['==', ['geometry-type'], 'LineString'], ['==', ['get', 'major'], 1]],
    paint: { 'line-color': '#2a4a73', 'line-width': 0.7, 'line-opacity': ['interpolate', ['linear'], ['zoom'], 0, 0.45, 2, 0.3, 6, 0.08] }
  };
  const graticuleLabel = {
    id: 'graticule-label', type: 'symbol', source: 'graticule',
    filter: ['==', ['geometry-type'], 'Point'],
    layout: { 'text-field': ['get', 't'], 'text-size': 9, 'text-allow-overlap': false, 'text-font': font },
    paint: {
      'text-color': '#3d5a7d', 'text-halo-color': '#04060c', 'text-halo-width': 1,
      'text-opacity': ['interpolate', ['linear'], ['zoom'], 0, 0.7, 3, 0.4, 6, 0]
    }
  };
  const countriesFill = {
    id: 'countries', type: 'fill', source: 'countries',
    paint: {
      'fill-color': [
        'case',
        ['boolean', ['feature-state', 'selected'], false], 'rgba(74,222,128,0.26)',
        ['boolean', ['feature-state', 'hover'], false], 'rgba(96,165,250,0.16)',
        'rgba(0,0,0,0)'
      ],
      'fill-opacity': 1
    }
  };
  // 国家边界发光（worldmonitor 风格：外圈柔光 + 内圈亮线）
  const countriesGlow = {
    id: 'countries-glow', type: 'line', source: 'countries',
    paint: {
      'line-color': ['case', ['boolean', ['feature-state', 'selected'], false], '#4ade80', '#60a5fa'],
      'line-width': ['interpolate', ['linear'], ['zoom'], 0, 2.4, 6, 4.5],
      'line-opacity': 0.15, 'line-blur': 2.2
    }
  };
  const countriesOutline = {
    id: 'countries-outline', type: 'line', source: 'countries',
    paint: {
      'line-color': ['case', ['boolean', ['feature-state', 'selected'], false], '#86efac', '#93c5fd'],
      'line-width': ['interpolate', ['linear'], ['zoom'], 0, 0.8, 6, 1.3],
      'line-opacity': 0.9
    }
  };
  // 城市发光点（外圈光晕 + 亮核），首都琥珀色
  const cityGlow = {
    id: 'city-glow', type: 'circle', source: 'cities',
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 0.5, 5, 2, 8, 5, 12],
      'circle-color': ['case', ['==', ['get', 'cap'], 1], '#febc2e', '#60a5fa'],
      'circle-opacity': ['interpolate', ['linear'], ['zoom'], 0.5, 0.14, 5, 0.22],
      'circle-blur': 1
    }
  };
  const cityDots = {
    id: 'city-dots', type: 'circle', source: 'cities',
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 0.5, 1.4, 2, 2.3, 5, 3.4],
      'circle-color': ['case', ['==', ['get', 'cap'], 1], '#fde68a', '#bfdbfe'],
      'circle-opacity': ['interpolate', ['linear'], ['zoom'], 0.5, 0.95, 5, 1],
      'circle-stroke-color': ['case', ['==', ['get', 'cap'], 1], '#92400e', '#1d4ed8'],
      'circle-stroke-width': 0.6
    }
  };
  const cityDotsHit = {
    id: 'city-dots-hit', type: 'circle', source: 'cities',
    paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 0.5, 7, 5, 11], 'circle-opacity': 0 }
  };
  const cityLabels = {
    id: 'city-labels', type: 'symbol', source: 'cities', minzoom: 2.4,
    filter: ['any', ['==', ['get', 'cap'], 1], ['<=', ['get', 'r'], 2]],
    layout: {
      'text-field': ['get', 'n'],
      'text-size': 10.5, 'text-anchor': 'top', 'text-offset': [0, 0.7],
      'text-allow-overlap': false, 'text-font': font
    },
    paint: { 'text-color': '#dff0ff', 'text-halo-color': '#04060c', 'text-halo-width': 1.3 }
  };

  s.layers.push(graticule, graticuleMajor, graticuleLabel, countriesFill, countriesGlow, countriesOutline, cityGlow, cityDots, cityDotsHit, cityLabels);
  return s;
}

/* ---------------- 地图 ---------------- */
function initMap() {
  const style = adaptStyle(state.styleBase);
  state.map = new maplibregl.Map({
    container: 'map',
    style,
    projection: 'globe',
    center: [18, 24],
    zoom: 1.05,
    minZoom: 0.3,
    maxZoom: 14,
    antialias: true,
    preserveDrawingBuffer: true,
    attributionControl: false,
    renderWorldCopies: false,
    dragRotate: true,
    touchPitch: true
  });
  state.map.addControl(new maplibregl.AttributionControl({
    compact: true,
    customAttribution: '© OpenStreetMap · OpenFreeMap · Natural Earth · Google News'
  }), 'bottom-right');
  state.map.on('load', () => {
    bindMapEvents();
    applyLabelLang();
    try { state.map.setProjection({ type: 'globe' }); } catch (e) { /* 保持默认 */ } // 强制 3D 球体
    try { state.map.setTerrain({ source: 'terrain-dem', exaggeration: 1.2 }); } catch (e) { /* 不支持则忽略 */ }
    // 矢量地图拉远到一定程度自动回到夜景
    state.map.on('zoomend', () => {
      if (state.mapMode === 'vector' && state.map && state.map.getZoom() < 3.0) switchToNight();
    });
  });
  state.map.on('error', (e) => {
    window.__mapErrors = window.__mapErrors || [];
    window.__mapErrors.push((e && e.error && e.error.message) || String(e && e.error) || 'unknown');
    const msg = (e && e.error && e.error.message) || '';
    if (/tile|fetch|network|style/i.test(msg)) toastOnce('地图数据加载异常，可切换「列表」模式使用');
  });
}

// 2D 平面 / 3D 地球仪切换（一个按钮：3D=立体地球+地貌，2D=平面地图）
function setProjection(t) {
  if (!state.map) return;
  state.projection = t;
  try {
    state.map.setProjection({ type: t }); // v5.24 必须传对象，字符串会静默失效
    if (t === 'globe') {
      try { state.map.setTerrain({ source: 'terrain-dem', exaggeration: 1.2 }); } catch (e) { /* ignore */ }
    } else {
      state.map.setPitch(0);
      try { state.map.setTerrain(null); } catch (e) { /* ignore */ }
    }
  } catch (e) {
    toast('切换失败');
    return;
  }
  $('projBtn').textContent = t === 'globe' ? '3D' : '2D';
  $('projBtn').classList.toggle('on', t === 'globe');
  $('projBtn').title = t === 'globe' ? '切换为 2D 平面地图' : '切换为 3D 地球仪';
}

function bindMapEvents() {
  const map = state.map;
  // 收集样式里已有的地名标注图层，点击后按地名搜新闻
  state.labelLayerIds = (map.getStyle().layers || [])
    .filter((l) => l.id.startsWith('label_') || l.id === 'label_other')
    .map((l) => l.id);

  const clickable = ['city-dots-hit', 'countries', ...state.labelLayerIds];
  for (const id of clickable) {
    map.on('mouseenter', id, () => { map.getCanvas().style.cursor = 'pointer'; });
    map.on('mouseleave', id, () => { map.getCanvas().style.cursor = ''; });
  }

  map.on('click', 'city-dots-hit', (e) => {
    const f = e.features[0];
    if (!f) return;
    const p = f.properties || {};
    selectCity({ n: p.n, z: p.z, c: p.c, lat: f.geometry.coordinates[1], lng: f.geometry.coordinates[0] });
  });

  map.on('click', 'countries', (e) => {
    const f = e.features[0];
    if (!f) return;
    const iso2 = f.properties && f.properties.iso2;
    let c = iso2 ? state.countryByIso2.get(iso2) : null;
    if (!c && f.properties && f.properties.name) {
      c = state.countries.find((x) => x.name.toLowerCase() === f.properties.name.toLowerCase()) || null;
    }
    if (c) selectCountry(c);
    else selectPlace({ nameZh: (f.properties && f.properties.zh) || f.properties.name, name: f.properties.name, coords: f.geometry.type === 'Point' ? f.geometry.coordinates : null });
  });

  for (const id of state.labelLayerIds) {
    map.on('click', id, (e) => {
      const f = e.features[0];
      if (!f) return;
      const p = f.properties || {};
      const nameZh = p['name:zh'] || p['name:nonlatin'] || '';
      const name = p['name:en'] || p['name'] || p['name:latin'] || '';
      const nm = nameZh || name;
      if (!nm) return;
      const coords = (f.geometry && f.geometry.coordinates) || null;
      // 若该地名正好是国家名，则按国家处理
      const c = state.countries.find((x) => x.name.toLowerCase() === name.toLowerCase());
      if (c) return selectCountry(c);
      selectPlace({ nameZh: nameZh || nm, name, coords });
    });
  }

  // 空白处点击关闭面板（点击城市/国家/地名时不触发）
  map.on('click', (e) => {
    if (e.defaultPrevented) return;
    const hit = map.queryRenderedFeatures(e.point, { layers: ['city-dots-hit', 'countries', ...state.labelLayerIds] });
    if (hit.length) return;
    clearCountrySelected();
    closeSheet();
  });

  // 国家悬停高亮
  let hovered = null;
  map.on('mousemove', 'countries', (e) => {
    const f = e.features[0];
    const id = f && f.id;
    if (hovered !== id) {
      if (hovered != null) map.setFeatureState({ source: 'countries', id: hovered }, { hover: false });
      hovered = id;
      if (id != null) map.setFeatureState({ source: 'countries', id }, { hover: true });
    }
  });
  map.on('mouseleave', 'countries', () => {
    if (hovered != null) { map.setFeatureState({ source: 'countries', id: hovered }, { hover: false }); hovered = null; }
  });
}

/* ---------------- 3D 夜景地球（Three.js NightEarth 模块，默认模式，懒加载） ---------------- */
function initGlobe() {
  if (state.globe) return;
  if (typeof NightEarth === 'undefined') {
    toast('3D 引擎加载失败');
    return;
  }
  const bj = state.cities.find((c) => c.n.toLowerCase() === 'beijing');
  state.globe = new NightEarth($('map'), {
    data: { borders: state.geo, cities: state.cities, countries: state.countries },
    utcEl: $('utcClock'),
    onZoomIn: () => switchToVector(), // 放大到街道级别 → 自动切矢量地图
    onCityClick: (city) => selectCity(city),
    onCountryClick: (props) => {
      const iso2 = props && props.iso2;
      const c = iso2 ? state.countryByIso2.get(iso2) : null;
      if (c) selectCountry(c);
      else if (props && props.name) selectPlace({ nameZh: props.zh || props.name, name: props.name, coords: null });
    },
    onMarkerClick: () => { if (bj) selectCity(bj); }
  });
  state.globe.renderer.domElement.style.display = 'block';
}

// 矢量地图懒加载（MapLibre 约 1MB，首次切到矢量时才动态加载，加速首屏）
let mapLoading = null;
function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error('脚本加载失败: ' + src));
    document.head.appendChild(s);
  });
}
function ensureMap() {
  if (state.map) return Promise.resolve();
  if (mapLoading) return mapLoading;
  mapLoading = (async () => {
    if (typeof maplibregl === 'undefined') {
      await loadScript('vendor/maplibre-gl.js');
    }
    if (!document.querySelector('link[href="vendor/maplibre-gl.css"]')) {
      const l = document.createElement('link');
      l.rel = 'stylesheet';
      l.href = 'vendor/maplibre-gl.css';
      document.head.appendChild(l);
    }
    initMap();
  })().catch((e) => { console.error(e); toast('矢量地图加载失败，可继续使用夜景模式'); });
  return mapLoading;
}

function showMode(mode) {
  state.mapMode = mode;
  if (state.map) state.map.getContainer().style.display = mode === 'vector' ? 'block' : 'none';
  if (state.globe) state.globe.renderer.domElement.style.display = mode === 'night' ? 'block' : 'none';
  $('utcClock').style.display = mode === 'night' ? 'block' : 'none';
  $('nightBtn').textContent = mode === 'night' ? '🗺 矢量' : '🌙 夜景';
}

// 夜景 → 矢量（街道/路名）
async function switchToVector() {
  if (state.mapMode === 'vector') return;
  await ensureMap();
  if (!state.map) return;
  const [lon, lat] = state.globe ? state.globe.getCenterLonLat() : [18, 24];
  const zoom = 6.5;
  showMode('vector');
  setTimeout(() => {
    state.map.jumpTo({ center: [lon, lat], zoom });
  }, 120);
}

// 矢量 → 夜景（拉远自动回到夜景）
function switchToNight() {
  if (state.mapMode === 'night') return;
  if (!state.globe) initGlobe();
  if (!state.globe) return;
  const c = state.map ? state.map.getCenter() : { lng: 18, lat: 24 };
  showMode('night');
  state.globe.setView(c.lng, c.lat, 2.6);
}

// 手动切换
function toggleGlobeMode() {
  if (state.mapMode === 'night') switchToVector();
  else switchToNight();
}

// 地图标签语言：中文=地名用 name:zh；英文=保持英文
function applyLabelLang() {
  if (!state.map || !state.map.isStyleLoaded()) return;
  const zh = state.lang === 'zh';
  const layers = state.map.getStyle().layers || [];
  for (const l of layers) {
    if (!l.layout || !l.layout['text-field']) continue;
    if (l.id.startsWith('label_')) {
      const field = zh
        ? ['coalesce', ['get', 'name:zh'], ['get', 'name:en'], ['get', 'name']]
        : ['case', ['has', 'name:nonlatin'], ['concat', ['get', 'name:latin'], '\n', ['get', 'name:nonlatin']], ['coalesce', ['get', 'name_en'], ['get', 'name']]];
      try { state.map.setLayoutProperty(l.id, 'text-field', field); } catch (e) { /* ignore */ }
    }
  }
  try {
    state.map.setLayoutProperty('city-labels', 'text-field', zh ? ['coalesce', ['get', 'z'], ['get', 'n']] : ['get', 'n']);
  } catch (e) { /* ignore */ }
}

// 传 zoom 语义值；矢量=缩放级别，夜景=换算相机距离
function flyTo(coords, zoom) {
  if (!coords) return;
  if (state.mapMode === 'vector') {
    if (!state.map) return;
    state.map.flyTo({ center: coords, zoom: zoom || 3, duration: 1800, essential: true });
  } else {
    if (!state.globe) return;
    const dist = Math.max(1.62, Math.min(2.8, 3.2 - (zoom || 3) * 0.22));
    state.globe.flyTo(coords[0], coords[1], dist);
  }
}

function clearCountrySelected() {
  if (state.map && state.selectedGeoId != null) {
    try { state.map.setFeatureState({ source: 'countries', id: state.selectedGeoId }, { selected: false }); } catch (e) { /* ignore */ }
  }
  state.selectedGeoId = null;
}

function zoomForCountry(c) {
  const a = c.area || 1e6;
  const z = Math.round(9 - Math.log10(a + 1) * 1.1);
  return Math.max(2.8, Math.min(7.5, z));
}

/* ---------------- 选中与新闻 ---------------- */
function selectCountry(c, opts = {}) {
  clearCountrySelected();
  state.selected = {
    type: 'country', iso2: c.iso2, name: c.name, nameZh: c.zh,
    q: queryName(c),
    coords: (c.lat != null && c.lng != null) ? [c.lng, c.lat] : null
  };
  if (state.mapMode === 'vector' && state.map) {
    const feat = state.geo.features.find((f) => f.properties.iso2 === c.iso2);
    if (feat && feat.id != null) {
      state.selectedGeoId = feat.id;
      try { state.map.setFeatureState({ source: 'countries', id: feat.id }, { selected: true }); } catch (e) { /* ignore */ }
    }
  }
  if (opts.fly !== false && state.selected.coords) flyTo(state.selected.coords, zoomForCountry(c));
  openSheet(sheetTitle(state.selected), '');
  loadNews(state.selected);
  if (state.view === 'list') highlightListCountry(c.iso2);
}

function selectCity(c) {
  clearCountrySelected();
  const rec = state.cities.find((x) => x.n === c.n && (!c.c || x.c === c.c)) || c;
  state.selected = {
    type: 'city', name: rec.n, nameZh: rec.z || rec.n,
    q: (state.lang === 'zh' && rec.z) ? rec.z : rec.n,
    coords: [rec.lng, rec.lat]
  };
  flyTo(state.selected.coords, 6.5);
  openSheet(sheetTitle(state.selected), '');
  loadNews(state.selected);
}

function selectPlace(pl) {
  clearCountrySelected();
  state.selected = {
    type: 'place', name: pl.name, nameZh: pl.nameZh || pl.name,
    q: (state.lang === 'zh' && pl.nameZh) ? pl.nameZh : pl.name,
    coords: pl.coords || null
  };
  if (pl.coords) flyTo(pl.coords, 7);
  openSheet(sheetTitle(state.selected), '');
  loadNews(state.selected);
}

function sheetTitle(sel) {
  if (sel.type === 'country') {
    const en = sel.name && sel.name !== sel.nameZh ? ` · ${sel.name}` : '';
    return `${sel.nameZh}${en}`;
  }
  if (sel.type === 'city') {
    const en = sel.name && sel.name !== sel.nameZh ? ` · ${sel.name}` : '';
    return `🏙️ ${sel.nameZh}${en}`;
  }
  return `📍 ${sel.nameZh}`;
}

async function loadNews(sel) {
  const reqId = ++state.newsReqId;
  state.newsCat = 'ALL'; // 切换地点时重置板块过滤
  renderSheetStatus(spinnerEl(), '正在加载当地新闻…');

  // 静态模式：直接查云端定时生成的新闻快照
  if (state.mode === 'static') {
    const data = await newsFromStatic(sel);
    if (reqId !== state.newsReqId) return;
    if (data && data.items.length) {
      renderNews({ ...data, fallback: 'static', fetchedAt: data.fetchedAt || '' });
    } else {
      renderSheetStatus('📭', '该地点暂无新闻', '云端快照中没有匹配内容，可切换新闻语言或换一个地点试试');
    }
    return;
  }

  // 服务器模式：实时接口 8s 内返回则用实时新闻；同时并行准备静态兜底，避免傻等
  const staticP = newsFromStatic(sel).catch(() => null);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const r = await fetch(`api/news?q=${encodeURIComponent(sel.q)}&lang=${state.lang}`, { signal: ctrl.signal });
    const j = await r.json();
    if (reqId !== state.newsReqId) return;
    if (!r.ok) throw new Error(j.error || '加载失败');
    renderNews(j);
  } catch (e) {
    if (reqId !== state.newsReqId) return;
    const snap = await staticP;
    if (snap && snap.items.length) { renderNews({ ...snap, fallback: 'static' }); return; }
    const msg = (e.name === 'AbortError') ? '实时新闻源响应慢，且暂无离线数据' : (e.message || '加载失败');
    const box = renderSheetStatus('😢', msg, '点击下方按钮重试');
    const retry = el('button', 'chip', '↻ 重试');
    retry.style.marginTop = '4px';
    retry.addEventListener('click', () => loadNews(state.selected || sel));
    box.appendChild(retry);
  } finally {
    clearTimeout(timer);
    state.newsLoading = false;
  }
}

/* ---- 静态新闻（data/news-hot.json 小索引 + n/*.json 按需分片，点开即秒） ---- */
let staticIndexPromise = null;
let entryCache = null;
function getStaticIndex() {
  if (!staticIndexPromise) {
    entryCache = new Map();
    staticIndexPromise = fetch('data/news-hot.json')
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null);
  }
  return staticIndexPromise;
}
async function getEntryFile(f) {
  if (!entryCache) await getStaticIndex();
  if (!f) return null;
  if (entryCache.has(f)) return entryCache.get(f);
  const p = fetch(`data/${f}`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  entryCache.set(f, p);
  return p;
}

async function newsFromStatic(sel) {
  const idx = await getStaticIndex();
  if (!idx || !idx.entries) return null;
  const lang = state.lang;
  const tries = [];
  const push = (k) => { const e = idx.entries[k]; if (e && !tries.includes(e)) tries.push(e); };
  if (sel.type === 'country') {
    push(`country|${sel.iso2}|${lang}`);
    push(`country|${sel.iso2}|en`);
    push(`country|${sel.iso2}|zh`);
  } else if (sel.type === 'city') {
    if (lang === 'zh' && sel.nameZh) push(`city|${sel.nameZh.toLowerCase()}|zh`);
    push(`city|${sel.name.toLowerCase()}|${lang}`);
    push(`city|${sel.name.toLowerCase()}|en`);
  } else {
    if (lang === 'zh' && sel.nameZh) push(`place|${sel.nameZh.toLowerCase()}|zh`);
    push(`place|${(sel.name || sel.nameZh || '').toLowerCase()}|${lang}`);
    push(`place|${(sel.name || sel.nameZh || '').toLowerCase()}|en`);
  }
  for (const e of tries) {
    const entry = await getEntryFile(e.f);
    if (entry && entry.items && entry.items.length) return { ...entry, fetchedAt: idx.generatedAt };
  }
  // 兜底：标题全文匹配（懒加载 titles 索引）
  const ql = sel.q.toLowerCase();
  if (ql) {
    const ti = await fetch('data/news-titles.json').then((r) => (r.ok ? r.json() : null)).catch(() => null);
    if (ti && ti.items) {
      const hits = ti.items.filter((it) => (it.t || '').toLowerCase().includes(ql)).slice(0, 20);
      if (hits.length) {
        return {
          window: 'scan', label: '全文匹配',
          items: hits.map((h) => ({ title: h.t, link: h.l, source: '', published: h.p || '', snippet: '', cat: h.cat, loc: h.loc })),
          fetchedAt: idx.generatedAt
        };
      }
    }
  }
  return null;
}

/* ---- 英文→中文翻译（免费接口，按需排队，缓存） ---- */
const transCache = new Map();
let transQueue = Promise.resolve();
function translateText(text) {
  const t = String(text || '').trim();
  if (!t || t.length < 3) return Promise.resolve('');
  if (transCache.has(t)) return Promise.resolve(transCache.get(t));
  const p = transQueue.then(async () => {
    try {
      const r = await fetch(`https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=zh-CN&dt=t&q=${encodeURIComponent(t.slice(0, 1500))}`);
      const j = await r.json();
      const out = (j && j[0] ? j[0].map((x) => x[0]).join('') : '').trim();
      transCache.set(t, out);
      return out;
    } catch (e) { return ''; }
  });
  transQueue = p.catch(() => {});
  return p;
}
// 非中文标题一律附中文翻译：优先用云端预翻译的 it.tz，否则客户端按需翻译
const needsZh = (s) => {
  const t = s || '';
  if (!/[a-zA-Z]{2}/.test(t) && !/[\u3040-\u30ff\uac00-\ud7af\u0600-\u06ff\u0400-\u04ff]/.test(t)) return false;
  return !/[\u4e00-\u9fff]/.test(t) || /[\u3040-\u30ff\uac00-\ud7af]/.test(t);
};
function fillTranslation(a, it) {
  const slot = a.querySelector('.a-tz');
  if (!slot) return;
  if (state.lang !== 'zh') return; // 英文模式：全部英文，不显示中文
  if (it && it.tz) { slot.textContent = it.tz; return; }
  const text = it ? it.title : '';
  if (needsZh(text)) {
    translateText(text).then((zh) => { if (zh && slot && slot.parentNode) slot.textContent = zh; });
  }
}

function relTime(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return '';
  const s = (Date.now() - d.getTime()) / 1000;
  if (s < 60) return '刚刚';
  if (s < 3600) return `${Math.floor(s / 60)} 分钟前`;
  if (s < 86400) return `${Math.floor(s / 3600)} 小时前`;
  return `${Math.floor(s / 86400)} 天前`;
}

/* ---- A-Y 板块元信息（标签/标题，供前端展示） ---- */
const SECTORS_META = [
  { key: 'A', title: '时政/官方/政策/法规', icon: '🏛️' }, { key: 'B', title: '外交/国际关系/地缘政治/地区冲突', icon: '🌍' },
  { key: 'C', title: '军事/国防/战争/军工', icon: '🪖' }, { key: 'D', title: '财经/金融/市场/股市/公司/IPO/央行/外汇', icon: '📈' },
  { key: 'E', title: '宏观经济/经济数据/经济政策', icon: '📊' }, { key: 'F', title: '科技/AI/半导体/互联网', icon: '🤖' },
  { key: 'G', title: '能源/石油/天然气/新能源', icon: '🛢️' }, { key: 'H', title: '贵金属/稀土/有色/大宗商品', icon: '🥇' },
  { key: 'I', title: '医药/生物科技/医疗健康', icon: '💊' }, { key: 'J', title: '人物/观点/深度评论', icon: '✍️' },
  { key: 'K', title: '国际综合/突发/快讯', icon: '🌐' }, { key: 'L', title: '中东/区域专报', icon: '🕌' },
  { key: 'M', title: '气候/环境/可持续发展', icon: '🌱' }, { key: 'N', title: '航天/航空/交通物流', icon: '🚀' },
  { key: 'O', title: '汽车/新能源车/出行', icon: '🚗' }, { key: 'P', title: '房地产/基建/城市化', icon: '🏗️' },
  { key: 'Q', title: '农业/食品/农产品', icon: '🌾' }, { key: 'R', title: '加密货币/数字资产/区块链', icon: '🪙' },
  { key: 'S', title: '法律/监管/合规/制裁', icon: '⚖️' }, { key: 'T', title: '社会/文化/教育/体育/娱乐', icon: '🎭' },
  { key: 'U', title: '数据/报告/智库研究', icon: '📑' }, { key: 'V', title: '港澳台/区域新闻', icon: '🏙️' },
  { key: 'W', title: '网络安全/隐私/数字治理', icon: '🛡️' }, { key: 'X', title: '公共卫生/灾害/应急', icon: '🚑' },
  { key: 'Y', title: '移民/难民/人道主义', icon: '🕊️' }
];
const CAT_COLORS = ['#38bdf8', '#fbbf24', '#f472b6', '#34d399', '#a78bfa', '#f87171', '#60a5fa', '#facc15', '#4ade80', '#fb923c'];
const catColor = (key) => CAT_COLORS[((key.charCodeAt(0) - 65) % CAT_COLORS.length + CAT_COLORS.length) % CAT_COLORS.length];
const secShort = (key) => { const s = SECTORS_META.find((x) => x.key === key); return s ? s.title.split('/')[0] : key; };

function renderNews(data) {
  const body = $('sheetBody');
  body.innerHTML = '';
  const badge = $('sheetBadge');
  badge.textContent = `${data.label || ''} · ${data.items.length} 条`;
  badge.classList.toggle('hidden', false);
  badge.classList.toggle('warn', data.window !== '1d' && data.items.length > 0);

  if (data.window !== '1d' && data.items.length > 0 && data.fallback !== 'snapshot') {
    body.appendChild(el('div', 'sheet-hint', `⏱️ 当日相关新闻较少，已自动扩大范围为「${data.label}」`));
  }
  if (data.fallback === 'snapshot') {
    body.appendChild(el('div', 'sheet-hint', `📦 联网新闻源暂不可用，已展示离线快照备用数据（${data.label}）`));
  }
  if (data.fallback === 'static') {
    body.appendChild(el('div', 'sheet-hint', '☁️ 数据来自云端定时更新的新闻快照，每天自动刷新'));
  }
  if (!data.items.length) {
    body.appendChild(el('div', 'status',
      `<div class="s-icon">📭</div><div class="s-msg">该地点近期暂无相关新闻</div>` +
      `<div class="s-sub">可切换新闻语言（中文 / English）或点击邻近城市试试</div>`));
    return;
  }
  // 板块过滤条
  const cats = [...new Set(data.items.flatMap((it) => it.cat || []))].sort();
  if (cats.length) {
    const bar = el('div', 'news-filter');
    const mk = (key, label) => {
      const b = el('button', 'nf-chip' + (state.newsCat === key ? ' on' : ''), label);
      b.addEventListener('click', () => { state.newsCat = key; renderNews(data); });
      bar.appendChild(b);
    };
    mk('ALL', '全部');
    for (const c of cats) mk(c, secShort(c));
    body.appendChild(bar);
  }
  const items = (state.newsCat && state.newsCat !== 'ALL')
    ? data.items.filter((it) => (it.cat || []).includes(state.newsCat))
    : data.items;
  if (!items.length) {
    body.appendChild(el('div', 'status', '<div class="s-icon">🗂️</div><div class="s-msg">该板块暂无内容</div>'));
    return;
  }
  const today = new Date().toDateString();
  for (const it of items) {
    const isNew = new Date(it.published).toDateString() === today;
    const a = el('a', 'article', `
      <div class="a-title">${esc(it.title)}</div>
      <div class="a-tz"></div>
      ${it.snippet ? `<div class="a-snippet">${esc(it.snippet)}</div>` : ''}
      <div class="a-meta">
        ${it.source ? `<span class="a-src">${esc(it.source)}</span>` : ''}
        ${isNew ? '<span class="a-new">今日</span>' : ''}
        <span>${relTime(it.published)}</span>
        <span class="a-open">↗ 原文</span>
      </div>`);
    a.href = it.link;
    a.target = '_blank';
    a.rel = 'noopener';
    body.appendChild(a);
    fillTranslation(a, it);
  }
}

/* ---------------- 底部面板 ---------------- */
function openSheet(titleHtml, badgeHtml) {
  $('sheetTitle').innerHTML = titleHtml;
  $('sheetBadge').classList.add('hidden');
  $('sheet').classList.add('open');
  $('sheet').setAttribute('aria-hidden', 'false');
}
function closeSheet() {
  $('sheet').classList.remove('open');
  $('sheet').setAttribute('aria-hidden', 'true');
}
function renderSheetStatus(iconHtml, msg, sub) {
  const body = $('sheetBody');
  body.innerHTML = '';
  const box = el('div', 'status',
    `<div class="s-icon">${iconHtml}</div><div class="s-msg">${esc(msg)}</div>` +
    (sub ? `<div class="s-sub">${esc(sub)}</div>` : ''));
  body.appendChild(box);
  return box;
}
function spinnerEl() {
  const d = el('div', 'spinner');
  return d.outerHTML;
}

/* ---------------- 列表视图 ---------------- */
function groupCountries() {
  const groups = CONTINENTS.map((g) => ({ ...g, countries: [] }));
  for (const c of state.countries) {
    const g = groups.find((x) => x.id === continentOf(c));
    if (g) g.countries.push(c);
  }
  for (const g of groups) {
    g.countries.sort((a, b) => (state.lang === 'zh' ? a.zh.localeCompare(b.zh, 'zh-CN') : a.name.localeCompare(b.name)));
  }
  return groups;
}

function citiesFor(c) {
  const recs = state.cities.filter((x) => x.c === c.iso2).sort((a, b) => b.pop - a.pop);
  const out = [];
  const seen = new Set();
  if (c.capital) {
    const capRec = recs.find((x) => x.cap === 1) || recs.find((x) => x.n.toLowerCase() === c.capital.toLowerCase());
    if (capRec) { out.push(capRec); seen.add(capRec.n.toLowerCase()); }
  }
  for (const r of recs) {
    if (out.length >= 5) break;
    const k = r.n.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(r);
  }
  return out;
}

function renderList(filterText) {
  const root = $('listView');
  root.innerHTML = '';
  const q = (filterText || '').trim().toLowerCase();

  if (q) {
    const res = doSearch(q);
    const frag = document.createDocumentFragment();
    if (!res.countries.length && !res.cities.length) {
      frag.appendChild(el('div', 'status', '<div class="s-icon">🔎</div><div class="s-msg">未找到匹配的国家或城市</div>'));
    }
    if (res.countries.length) {
      frag.appendChild(el('div', 'sr-head', '🏳️ 国家 / 地区'));
      for (const c of res.countries) frag.appendChild(countryRow(c, true));
    }
    if (res.cities.length) {
      frag.appendChild(el('div', 'sr-head', '🏙️ 城市'));
      for (const c of res.cities) {
        const row = el('div', 'country-row');
        const co = state.countryByIso2.get(c.c);
        row.innerHTML = `<span class="flag">${co ? co.emoji : '📍'}</span>
          <span class="cname">${esc(c.z || c.n)}<i>${esc(c.n)} · ${co ? esc(zhName(co)) : ''}</i></span>
          <span class="news-btn">新闻</span>`;
        row.addEventListener('click', () => selectCity(c));
        frag.appendChild(row);
      }
    }
    root.appendChild(frag);
    return;
  }

  const groups = groupCountries();
  for (const g of groups) {
    const group = el('div', 'lv-group');
    const head = el('div', 'lv-group-head', `${g.icon} ${state.lang === 'zh' ? g.zh : g.en} <span class="cnt">${g.countries.length} 个</span> <span class="chev">▾</span>`);
    const body = el('div', 'lv-group-body');
    for (const c of g.countries) {
      body.appendChild(countryRow(c, false));
    }
    head.addEventListener('click', () => group.classList.toggle('open'));
    group.appendChild(head);
    group.appendChild(body);
    root.appendChild(group);
  }
}

function countryRow(c, expanded) {
  const wrap = el('div', '');
  const row = el('div', 'country-row');
  row.innerHTML = `<span class="flag">${c.emoji || '🏳️'}</span>
    <span class="cname">${esc(zhName(c))}<i>${esc(c.name)}${c.capital ? ' · 首都 ' + esc(c.capital) : ''}</i></span>
    <button class="news-btn">新闻</button>
    <span class="chev">▸</span>`;
  const citiesBox = el('div', 'country-cities');
  const btn = row.querySelector('.news-btn');
  btn.addEventListener('click', (e) => { e.stopPropagation(); selectCountry(c); });
  row.addEventListener('click', () => {
    row.classList.toggle('open');
    const chev = row.querySelector('.chev');
    chev.textContent = row.classList.contains('open') ? '▾' : '▸';
  });
  const cityRecs = citiesFor(c);
  if (cityRecs.length) {
    for (const r of cityRecs) {
      const cityRow = el('div', 'city-row');
      const capTag = r.cap === 1 ? '<span class="cap-tag">首都</span>' : '';
      const popTxt = r.pop >= 1000000 ? `${(r.pop / 1000000).toFixed(1)}M` : r.pop >= 1000 ? `${Math.round(r.pop / 1000)}K` : '';
      cityRow.innerHTML = `<span>${esc(r.z || r.n)}</span>${capTag}<span class="sub">${esc(r.n)} ${popTxt}</span>`;
      cityRow.addEventListener('click', () => selectCity(r));
      citiesBox.appendChild(cityRow);
    }
  } else {
    citiesBox.appendChild(el('div', 'city-row', `<span style="color:var(--faint)">（暂无更多城市数据）</span>`));
  }
  wrap.appendChild(row);
  wrap.appendChild(citiesBox);
  if (expanded) { row.classList.add('open'); }
  return wrap;
}

function highlightListCountry(iso2) {
  // 在列表中滚动到并闪烁该国家
  const rows = $('listView').querySelectorAll('.country-row');
  for (const r of rows) {
    const btn = r.querySelector('.news-btn');
    if (!btn) continue;
    const c = state.countries.find((x) => x.name === r.querySelector('i')?.textContent.split(' · ')[0]);
    if (c && c.iso2 === iso2) {
      r.scrollIntoView({ behavior: 'smooth', block: 'center' });
      r.style.background = 'rgba(56,189,248,.25)';
      setTimeout(() => { r.style.background = ''; }, 1400);
    }
  }
}

/* ---------------- 板块视图（A-Y 分类浏览，懒加载 news-sectors.json） ---------------- */
let sectorDataPromise = null;
function getSectorData() {
  if (!sectorDataPromise) {
    sectorDataPromise = fetch('data/news-sectors.json')
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null);
  }
  return sectorDataPromise;
}

async function renderSectors() {
  const tabs = $('sectorTabs');
  const list = $('sectorList');
  tabs.innerHTML = '';
  list.innerHTML = '';
  renderSectorStatus(list, '⏳', '正在汇总板块新闻…', '');
  const data = await getSectorData();
  if (!data || !data.sectors) {
    renderSectorStatus(list, '📭', '暂无板块数据', '静态新闻数据未生成（请运行云端抓取，或访问公网版）');
    return;
  }
  const buckets = data.sectors;
  const total = Object.values(buckets).reduce((n, a) => n + a.length, 0);
  const mk = (key, label) => {
    const b = el('button', 'sector-tab' + (state.sectorSel === key ? ' on' : ''), label);
    b.addEventListener('click', () => { state.sectorSel = key; renderSectorsList(buckets); });
    tabs.appendChild(b);
  };
  mk('ALL', `全部 ${total}`);
  for (const s of SECTORS_META) {
    const n = (buckets[s.key] || []).length;
    mk(s.key, `${s.icon} ${secShort(s.key)}${n ? `<span class="cnt">${n}</span>` : ''}`);
  }
  renderSectorsList(buckets);
}

function renderSectorStatus(list, icon, msg, sub) {
  list.innerHTML = '';
  list.appendChild(el('div', 'status',
    `<div class="s-icon">${icon}</div><div class="s-msg">${esc(msg)}</div>` +
    (sub ? `<div class="s-sub">${esc(sub)}</div>` : '')));
}

function renderSectorsList(buckets) {
  const list = $('sectorList');
  const sel = state.sectorSel;
  const items = (sel === 'ALL' ? Object.values(buckets).flat() : (buckets[sel] || [])) || [];
  list.innerHTML = '';
  if (sel !== 'ALL') {
    const s = SECTORS_META.find((x) => x.key === sel);
    if (s) list.appendChild(el('div', 'sector-head', `${s.icon} 板块 ${s.key} · ${s.title}`));
  }
  if (!items.length) {
    list.appendChild(el('div', 'status', '<div class="s-icon">🗂️</div><div class="s-msg">该板块暂无新闻</div>'));
    return;
  }
  const today = new Date().toDateString();
  for (const it of items) {
    const isNew = new Date(it.p).toDateString() === today;
    const a = el('a', 'article', `
      <div class="a-title">${esc(it.t)}</div>
      <div class="a-tz"></div>
      ${it.sn ? `<div class="a-snippet">${esc(it.sn)}</div>` : ''}
      <div class="a-meta">
        ${it.loc ? `<span class="s-loc">📍 ${esc(it.loc)}</span>` : ''}
        ${it.s ? `<span class="a-src">${esc(it.s)}</span>` : ''}
        ${isNew ? '<span class="a-new">今日</span>' : ''}
        <span>${relTime(it.p)}</span>
      </div>`);
    a.href = it.l;
    a.target = '_blank';
    a.rel = 'noopener';
    list.appendChild(a);
    fillTranslation(a, it);
  }
}

/* ---------------- 来源视图（用户提供的国内/国外新闻来源分类） ---------------- */
let srcDataPromise = null;
function getSourceData() {
  if (!srcDataPromise) {
    srcDataPromise = fetch('data/news-sources.json')
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null);
  }
  return srcDataPromise;
}

async function renderSources() {
  const regionEl = $('srcRegion');
  const tabs = $('srcTabs');
  const list = $('srcList');
  regionEl.innerHTML = '';
  tabs.innerHTML = '';
  renderSectorStatus(list, '⏳', '正在加载来源新闻…', '');
  const data = await getSourceData();
  if (!data || !data.sources || !data.sources.length) {
    renderSectorStatus(list, '📭', '暂无来源数据', '云端暂未抓取来源，请稍后再试');
    return;
  }
  // 国内 / 国外 切换
  for (const rg of ['国内', '国外']) {
    const b = el('button', 'seg-item' + (state.srcRegion === rg ? ' on' : ''), rg);
    b.addEventListener('click', () => { state.srcRegion = rg; state.srcGroup = null; renderSources(); });
    regionEl.appendChild(b);
  }
  const srcs = data.sources.filter((s) => s.region === state.srcRegion);
  const groups = [...new Set(srcs.map((s) => s.group))];
  tabs.innerHTML = '';
  const allBtn = el('button', 'sector-tab' + (state.srcGroup === null ? ' on' : ''), '全部');
  allBtn.addEventListener('click', () => { state.srcGroup = null; renderSourcesList(data); });
  tabs.appendChild(allBtn);
  for (const g of groups) {
    const b = el('button', 'sector-tab' + (state.srcGroup === g ? ' on' : ''), g);
    b.addEventListener('click', () => { state.srcGroup = state.srcGroup === g ? null : g; renderSourcesList(data); });
    tabs.appendChild(b);
  }
  renderSourcesList(data);
}

function renderSourcesList(data) {
  const list = $('srcList');
  list.innerHTML = '';
  const srcs = data.sources
    .filter((s) => s.region === state.srcRegion)
    .filter((s) => !state.srcGroup || s.group === state.srcGroup);
  if (!srcs.length) {
    list.appendChild(el('div', 'status', '<div class="s-icon">🗂️</div><div class="s-msg">该分类暂无来源</div>'));
    return;
  }
  for (const src of srcs) {
    const card = el('div', 'src-card');
    card.appendChild(el('div', 'src-name', `${esc(src.name)} <span class="src-group">${esc(src.group)}</span>`));
    for (const it of (src.items || []).slice(0, 5)) {
      const a = el('a', 'src-item', `
        <div class="a-title">${esc(it.title)}</div>
        <div class="a-tz"></div>
        <div class="a-meta">
          <span>${relTime(it.published)}</span>
          <span class="a-open">↗</span>
        </div>`);
      a.href = it.link;
      a.target = '_blank';
      a.rel = 'noopener';
      card.appendChild(a);
      fillTranslation(a, it);
    }
    list.appendChild(card);
  }
}

/* ---------------- 搜索 ---------------- */
function doSearch(text) {
  const q = text.toLowerCase();
  const res = { countries: [], cities: [] };
  if (!q) return res;
  for (const c of state.countries) {
    const hay = `${c.zh} ${c.name} ${c.iso2} ${c.iso3} ${c.capital || ''}`.toLowerCase();
    if (hay.includes(q)) res.countries.push(c);
    if (res.countries.length >= 8) break;
  }
  for (const c of state.cities) {
    const hay = `${state.lang === 'zh' ? c.z + ' ' : ''}${c.n} ${c.c || ''}`.toLowerCase();
    if (hay.includes(q)) res.cities.push(c);
    if (res.cities.length >= 8) break;
  }
  return res;
}

function renderSearchDropdown(text) {
  const box = $('searchResults');
  const q = (text || '').trim();
  if (!q) { box.classList.add('hidden'); box.innerHTML = ''; return; }
  const res = doSearch(q.toLowerCase());
  box.innerHTML = '';
  if (!res.countries.length && !res.cities.length) {
    box.appendChild(el('div', 'sr-item', '<span class="sr-sub">未找到匹配项</span>'));
  }
  if (res.countries.length) {
    box.appendChild(el('div', 'sr-head', '🏳️ 国家 / 地区'));
    for (const c of res.countries) {
      const item = el('div', 'sr-item', `<span class="sr-flag">${c.emoji || '🏳️'}</span>
        <span class="sr-name">${esc(zhName(c))}</span><span class="sr-sub">${esc(c.name)}</span>`);
      item.addEventListener('click', () => { box.classList.add('hidden'); selectCountry(c); });
      box.appendChild(item);
    }
  }
  if (res.cities.length) {
    box.appendChild(el('div', 'sr-head', '🏙️ 城市'));
    for (const c of res.cities) {
      const co = state.countryByIso2.get(c.c);
      const item = el('div', 'sr-item', `<span class="sr-flag">${co ? co.emoji : '📍'}</span>
        <span class="sr-name">${esc(c.z || c.n)}</span><span class="sr-sub">${esc(c.n)}</span>`);
      item.addEventListener('click', () => { box.classList.add('hidden'); selectCity(c); });
      box.appendChild(item);
    }
  }
  box.classList.remove('hidden');
}

/* ---------------- UI 绑定 ---------------- */
function setLang(l) {
  state.lang = l;
  localStorage.setItem('gn.lang', l);
  $('langBtn').textContent = l === 'zh' ? 'EN' : '中';
  document.documentElement.lang = l === 'zh' ? 'zh-CN' : 'en';
  renderList($('searchInput').value);
  applyLabelLang(); // 地图标签：中文=name:zh，英文=英文
  if (state.selected) {
    if (state.selected.type === 'country') {
      const c = state.countryByIso2.get(state.selected.iso2);
      if (c) selectCountry(c, { fly: false });
    } else {
      loadNews(state.selected);
    }
  }
}

function setView(v) {
  state.view = v;
  $('globeView').classList.toggle('hidden', v !== 'globe');
  $('listView').classList.toggle('hidden', v !== 'list');
  $('sectorsView').classList.toggle('hidden', v !== 'sectors');
  $('sourcesView').classList.toggle('hidden', v !== 'sources');
  for (const b of $('viewToggle').querySelectorAll('button')) b.classList.toggle('on', b.dataset.view === v);
  if (v === 'list') renderList($('searchInput').value);
  if (v === 'sectors') renderSectors();
  if (v === 'sources') renderSources();
  if (v === 'globe') {
    setTimeout(() => { if (state.map) state.map.resize(); if (state.globe) state.globe.resize(); }, 60);
  }
}

function bindUI() {
  $('langBtn').addEventListener('click', () => setLang(state.lang === 'zh' ? 'en' : 'zh'));

  for (const b of $('viewToggle').querySelectorAll('button')) {
    b.addEventListener('click', () => setView(b.dataset.view));
  }

  const input = $('searchInput');
  let timer = null;
  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      renderSearchDropdown(input.value);
      if (state.view === 'list') renderList(input.value);
    }, 120);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const res = doSearch(input.value.trim().toLowerCase());
      const first = res.countries[0] || res.cities[0];
      if (first) {
        if (res.countries[0]) selectCountry(res.countries[0]);
        else selectCity(res.cities[0]);
      }
      $('searchResults').classList.add('hidden');
      if (state.view === 'list') setView('globe');
    }
  });
  document.addEventListener('click', (e) => {
    if (!$('searchWrap').contains(e.target)) $('searchResults').classList.add('hidden');
  });

  $('homeBtn').addEventListener('click', () => {
    if (state.mapMode === 'vector' && state.map) {
      state.map.flyTo({ center: [18, 24], zoom: 1.05, duration: 1200, essential: true });
    } else if (state.globe) {
      state.globe.reset();
    }
  });
  $('nightBtn').addEventListener('click', () => toggleGlobeMode());
  $('sheetRefresh').addEventListener('click', () => { if (state.selected) loadNews(state.selected); });
  $('sheetClose').addEventListener('click', () => { clearCountrySelected(); closeSheet(); });
}

/* ---------------- 工具 ---------------- */
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => t.classList.remove('show'), 2800);
}
function toastOnce(msg) {
  if (state.toastSeen.has(msg)) return;
  state.toastSeen.add(msg);
  toast(msg);
}

function registerSW() {
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || ['localhost', '127.0.0.1'].includes(location.hostname))) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

/* ---------------- 启动 ---------------- */
(async function init() {
  bindUI();
  $('langBtn').textContent = state.lang === 'zh' ? 'EN' : '中';
  state.mode = await detectMode();
  console.log('[mode]', state.mode);
  try {
    await loadData();
    renderList('');
    initGlobe(); // 默认夜景地球（轮廓/圆点/渐进缩放 → 街道级自动切矢量）
    showMode('night');
  } catch (e) {
    console.error(e);
    toast('数据加载失败，请确认已运行 node scripts/setup-data.mjs');
  }
  // 调试/测试钩子
  window.__gn = { state, selectCountry, selectCity, selectPlace, getMap: () => state.map, getGlobe: () => state.globe, showMode };
  if (state.mode === 'static') getStaticIndex(); // 静态模式：后台预取小索引，点新闻即秒开
  registerSW();
})();
