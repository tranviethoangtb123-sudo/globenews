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
  terrainOn: false,
  projection: 'globe',
  selected: null,
  selectedGeoId: null,
  newsReqId: 0,
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
const HOT_CITIES = ['beijing', 'shanghai', 'tokyo', 'seoul', 'singapore', 'bangkok', 'dubai', 'new york', 'london', 'paris', 'moscow', 'sydney'];

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
    if (k === 'text-color') p[k] = isLabel ? '#cddaf0' : adjust(v, 0.85, 0.7);
    else if (k === 'text-halo-color') p[k] = '#0a101e';
    else if (l.type === 'background') p[k] = '#060a14';
    else if (isWater) p[k] = (id === 'water') ? '#0b1830' : adjust(v, 0.5, 0.5);
    else if (isRoad) p[k] = adjust(v, 0.42, 0.35);
    else if (isBoundary) p[k] = '#7c8fb3';
    else if (isBuilding) p[k] = '#1c2842';
    else if (isLand) p[k] = adjust(v, 0.4, 0.5);
    else if (isAero) p[k] = adjust(v, 0.45, 0.4);
    else if (isPoi) p[k] = '#c9d6ec';
    else p[k] = adjust(v, 0.45, 0.7);
  }
  if (isBoundary) {
    const lo = p['line-opacity'];
    if (typeof lo === 'number') p['line-opacity'] = lo * 0.8;
    else if (lo == null) p['line-opacity'] = 0.5;
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
      'line-color': '#27406b', 'line-width': 0.5,
      'line-opacity': ['interpolate', ['linear'], ['zoom'], 0, 0.55, 2, 0.4, 5, 0.16, 8, 0.04]
    }
  };
  const graticuleMajor = {
    id: 'graticule-major', type: 'line', source: 'graticule',
    filter: ['all', ['==', ['geometry-type'], 'LineString'], ['==', ['get', 'major'], 1]],
    paint: { 'line-color': '#3d5a8c', 'line-width': 0.8, 'line-opacity': ['interpolate', ['linear'], ['zoom'], 0, 0.7, 2, 0.5, 6, 0.12] }
  };
  const graticuleLabel = {
    id: 'graticule-label', type: 'symbol', source: 'graticule',
    filter: ['==', ['geometry-type'], 'Point'],
    layout: { 'text-field': ['get', 't'], 'text-size': 9, 'text-allow-overlap': false, 'text-font': font },
    paint: {
      'text-color': '#5b7399', 'text-halo-color': '#060a14', 'text-halo-width': 1,
      'text-opacity': ['interpolate', ['linear'], ['zoom'], 0, 0.9, 3, 0.55, 6, 0]
    }
  };
  const countriesFill = {
    id: 'countries', type: 'fill', source: 'countries',
    paint: {
      'fill-color': [
        'case',
        ['boolean', ['feature-state', 'selected'], false], 'rgba(251,191,36,0.30)',
        ['boolean', ['feature-state', 'hover'], false], 'rgba(56,189,248,0.20)',
        'rgba(0,0,0,0)'
      ],
      'fill-opacity': 1
    }
  };
  const countriesOutline = {
    id: 'countries-outline', type: 'line', source: 'countries',
    paint: {
      'line-color': ['case', ['boolean', ['feature-state', 'selected'], false], '#fbbf24', '#4a5f85'],
      'line-width': 1, 'line-opacity': 0.85
    }
  };
  const cityDots = {
    id: 'city-dots', type: 'circle', source: 'cities',
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 0.5, 1.3, 2, 2.2, 5, 3.4],
      'circle-color': ['case', ['==', ['get', 'cap'], 1], '#fbbf24', '#38bdf8'],
      'circle-opacity': ['interpolate', ['linear'], ['zoom'], 0.5, 0.92, 5, 0.98],
      'circle-stroke-color': '#0a1220',
      'circle-stroke-width': 0.6
    }
  };
  const cityDotsHit = {
    id: 'city-dots-hit', type: 'circle', source: 'cities',
    paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 0.5, 7, 5, 11], 'circle-opacity': 0 }
  };
  const cityLabels = {
    id: 'city-labels', type: 'symbol', source: 'cities', minzoom: 2.2,
    filter: ['any', ['==', ['get', 'cap'], 1], ['<=', ['get', 'r'], 2]],
    layout: {
      'text-field': ['get', 'n'],
      'text-size': 10.5, 'text-anchor': 'top', 'text-offset': [0, 0.7],
      'text-allow-overlap': false, 'text-font': font
    },
    paint: { 'text-color': '#cfe0f5', 'text-halo-color': '#060a14', 'text-halo-width': 1.2 }
  };

  s.layers.push(graticule, graticuleMajor, graticuleLabel, countriesFill, countriesOutline, cityDots, cityDotsHit, cityLabels);
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
    tryTerrain(false);
    $('projBtn').textContent = '3D';
    $('projBtn').classList.add('on');
    $('projBtn').title = '切换为 2D 平面地图';
  });
  state.map.on('error', (e) => {
    window.__mapErrors = window.__mapErrors || [];
    window.__mapErrors.push((e && e.error && e.error.message) || String(e && e.error) || 'unknown');
    const msg = (e && e.error && e.error.message) || '';
    if (/tile|fetch|network|style/i.test(msg)) toastOnce('地图数据加载异常，可切换「列表」模式使用');
  });
}

function tryTerrain(on) {
  if (!state.map || !state.map.isStyleLoaded()) return;
  try {
    if (on) state.map.setTerrain({ source: 'terrain-dem', exaggeration: 1.3 });
    else state.map.setTerrain(null);
    state.terrainOn = on;
    $('terrainBtn').classList.toggle('on', on);
  } catch (e) {
    toast('当前设备不支持 3D 地貌');
    $('terrainBtn').classList.remove('on');
  }
}

// 2D 平面 / 3D 地球仪切换（两种模式都支持手指转动、双指缩放）
function setProjection(t) {
  if (!state.map) return;
  state.projection = t;
  try {
    state.map.setProjection(t);
    if (t === 'mercator') state.map.setPitch(0);
  } catch (e) {
    toast('投影切换失败');
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

function flyTo(coords, zoom) {
  if (!state.map || !coords) return;
  state.map.flyTo({ center: coords, zoom, duration: 1800, essential: true });
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
  if (state.map) {
    const feat = state.geo.features.find((f) => f.properties.iso2 === c.iso2);
    if (feat && feat.id != null) {
      state.selectedGeoId = feat.id;
      try { state.map.setFeatureState({ source: 'countries', id: feat.id }, { selected: true }); } catch (e) { /* ignore */ }
    }
    if (opts.fly !== false && state.selected.coords) flyTo(state.selected.coords, zoomForCountry(c));
  }
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
  if (state.map) flyTo(state.selected.coords, 6.5);
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
  if (state.map && pl.coords) flyTo(pl.coords, 7);
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

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20000); // 客户端超时（服务器最多 25s 兜底）
  try {
    const r = await fetch(`api/news?q=${encodeURIComponent(sel.q)}&lang=${state.lang}`, { signal: ctrl.signal });
    const j = await r.json();
    if (reqId !== state.newsReqId) return;
    if (!r.ok) throw new Error(j.error || '加载失败');
    renderNews(j);
  } catch (e) {
    if (reqId !== state.newsReqId) return;
    // 服务器模式失败时退回静态快照
    const snap = await newsFromStatic(sel);
    if (snap && snap.items.length) { renderNews({ ...snap, fallback: 'static' }); return; }
    const msg = (e.name === 'AbortError') ? '加载超时，请检查网络后重试' : (e.message || '加载失败');
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

/* ---- 静态新闻快照（data/news-hot.json，由云端定时抓取生成）---- */
let staticIndexPromise = null;
function getStaticNewsIndex() {
  if (!staticIndexPromise) {
    staticIndexPromise = fetch('data/news-hot.json')
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null);
  }
  return staticIndexPromise;
}

async function newsFromStatic(sel) {
  const idx = await getStaticNewsIndex();
  if (!idx || !idx.entries) return null;
  const lang = state.lang;
  const tries = [];
  const push = (k) => { const e = idx.entries[k]; if (e && e.items && e.items.length) tries.push(e); };
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
  if (tries.length) return { ...tries[0], fetchedAt: idx.generatedAt };
  // 兜底：标题全文匹配
  const ql = sel.q.toLowerCase();
  if (ql && idx.all && idx.all.length) {
    const hits = idx.all.filter((it) => (it.t || '').toLowerCase().includes(ql)).slice(0, 20);
    if (hits.length) {
      return {
        window: 'scan', label: '全文匹配',
        items: hits.map((h) => ({ title: h.t, link: h.l, source: h.s || '', published: h.p || '', snippet: h.sn || '' })),
        fetchedAt: idx.generatedAt
      };
    }
  }
  return null;
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
  const today = new Date().toDateString();
  for (const it of data.items) {
    const isNew = new Date(it.published).toDateString() === today;
    const a = el('a', 'article', `
      <div class="a-title">${esc(it.title)}</div>
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

/* ---------------- 热点城市 ---------------- */
function renderHotChips() {
  const wrap = $('hotChips');
  wrap.innerHTML = '';
  for (const key of HOT_CITIES) {
    const rec = state.cities.find((x) => x.n.toLowerCase() === key) || state.cities.find((x) => x.z && x.n.toLowerCase().includes(key));
    if (!rec) continue;
    const chip = el('button', 'hot-chip', `${rec.z || rec.n}`);
    chip.addEventListener('click', () => selectCity(rec));
    wrap.appendChild(chip);
  }
  wrap.classList.remove('hidden');
}

/* ---------------- UI 绑定 ---------------- */
function setLang(l) {
  state.lang = l;
  localStorage.setItem('gn.lang', l);
  $('langBtn').textContent = l === 'zh' ? 'EN' : '中';
  document.documentElement.lang = l === 'zh' ? 'zh-CN' : 'en';
  renderList($('searchInput').value);
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
  for (const b of $('viewToggle').querySelectorAll('button')) b.classList.toggle('on', b.dataset.view === v);
  if (v === 'list') renderList($('searchInput').value);
  if (v === 'globe' && state.map) {
    setTimeout(() => state.map.resize(), 60);
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
    if (state.map) state.map.flyTo({ center: [18, 24], zoom: 1.05, duration: 1200, essential: true });
  });
  $('terrainBtn').addEventListener('click', () => tryTerrain(!state.terrainOn));
  $('projBtn').addEventListener('click', () => setProjection(state.projection === 'globe' ? 'mercator' : 'globe'));
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
    renderHotChips();
    renderList('');
  } catch (e) {
    console.error(e);
    toast('数据加载失败，请确认已运行 node scripts/setup-data.mjs');
  }
  if (typeof maplibregl !== 'undefined') {
    try {
      initMap();
    } catch (e) {
      console.error(e);
      toast('地图初始化失败，已切换到列表模式');
      setView('list');
    }
  } else {
    toast('地图组件加载失败（网络原因），已切换到列表模式');
    setView('list');
  }
  // 调试/测试钩子
  window.__gn = { state, selectCountry, selectCity, selectPlace, getMap: () => state.map };
  registerSW();
})();
