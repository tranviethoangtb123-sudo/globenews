/* ============================================================
 * Night Earth 3D 夜景地球模块（Three.js，无框架，可直接嵌入）
 * 视觉：深色海洋/暗色大陆/极地淡蓝冰盖/NASA Black Marble 夜景灯光自发光
 * 交互：鼠标左键拖拽旋转、滚轮缩放（触屏：单指旋转/双指缩放）；不自动自转
 * 界面：顶部 UTC 时钟、亚洲蓝色定位标记（默认北京，可配置）
 * 依赖：<script> 引入 vendor/three/three.min.js + OrbitControls.js
 * 用法：new NightEarth(container, { ...opts })
 * ------------------------------------------------------------
 * 贴图资源（下载后放入 public/textures/，命名规范见下）：
 *   earth-day.jpg   —— 白天地表贴图（陆地/海洋）
 *       官方来源：NASA Visible Earth "Blue Marble" 系列
 *       https://visibleearth.nasa.gov/collection/1484/blue-marble
 *   earth-night.jpg —— 夜景灯光贴图（NASA Black Marble）
 *       官方来源：NASA Earth Observatory "Black Marble 2016"
 *       https://earthobservatory.nasa.gov/features/NightLights
 *       下载页：https://visibleearth.nasa.gov/images/144898/earth-at-night-black-marble-2016-color-maps
 *   （本项目已内置等价贴图于 public/textures/，可直接替换同名文件）
 * 命名规范：务必命名为 earth-day.jpg 与 earth-night.jpg（等距圆柱投影）。
 * 替换贴图：直接覆盖 public/textures/ 下同名文件即可，无需改代码。
 * ============================================================ */
(function (global) {
  'use strict';
  const D2R = Math.PI / 180;

  // 经纬度 → 球面坐标（THREE 约定）
  function latLonToVec3(lon, lat, r) {
    const phi = (90 - lat) * D2R;
    const theta = (lon + 180) * D2R;
    return new THREE.Vector3(
      -r * Math.sin(phi) * Math.cos(theta),
      r * Math.cos(phi),
      r * Math.sin(phi) * Math.sin(theta)
    );
  }

  // 生成柔光圆点贴图（canvas）
  function makeGlowTexture(inner, outer) {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, inner);
    g.addColorStop(0.35, inner.replace(/[\d.]+\)$/, '0.8)'));
    g.addColorStop(1, outer);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
    const t = new THREE.CanvasTexture(c);
    return t;
  }

  class NightEarth {
    constructor(container, opts) {
      this.container = container;
      this.opts = Object.assign({
        dayTex: 'textures/earth-day.jpg',
        nightTex: 'textures/earth-night.jpg',
        bordersUrl: 'data/countries.geo.json',
        citiesUrl: 'data/cities.json',
        markerLonLat: [116.4, 39.9],   // 蓝色定位标记（默认北京，改这里）
        markerLabel: '',
        radius: 1,
        maxDist: 6,
        minDist: 1.6,
        zoomSwitchDist: 1.55,          // 缩放到该距离时自动切矢量地图（看街道路名）
        lightIntensity: 1.0,           // 夜景灯光亮度（改这里调节）
        onZoomIn: null,
        onCityClick: null,
        onCountryClick: null,
        onMarkerClick: null,
        utcEl: null
      }, opts || {});
      this.data = null;      // { borders: GeoJSON, cities: [{n,z,c,lat,lng,pop,cap}] }
      this.clockTimer = null;
      this.init();
    }

    async init() {
      this.scene = new THREE.Scene();
      this.camera = new THREE.PerspectiveCamera(45, this.container.clientWidth / Math.max(1, this.container.clientHeight), 0.01, 100);
      this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      this.renderer.setPixelRatio(Math.min(global.devicePixelRatio || 1, 2));
      this.renderer.setClearColor(0x000000, 0); // 透明背景，露出 CSS 星空
      this.container.appendChild(this.renderer.domElement);

      this.controls = new THREE.OrbitControls(this.camera, this.renderer.domElement);
      this.controls.enableDamping = true;
      this.controls.dampingFactor = 0.08;
      this.controls.enablePan = false;
      this.controls.autoRotate = false;          // 关闭自动自转
      this.controls.rotateSpeed = 0.45;
      this.controls.minDistance = this.opts.minDist;
      this.controls.maxDistance = this.opts.maxDist;

      // 相机初始视角（亚洲朝向）
      this.camera.position.set(2.4, 1.0, 2.1);
      this.controls.target.set(0, 0, 0);
      this.controls.update();

      // 载入贴图
      // 先画球体（兜底材质，秒现），夜景灯光贴图加载完成后渐入
      this.buildGlobe(this.fallbackTex('rgba(10,18,32,1)'), this.fallbackTex('rgba(0,0,0,1)'));
      this.loadTex(this.opts.dayTex).then((t) => {
        if (t && this.globe) { this.globe.material.map = t; this.globe.material.needsUpdate = true; }
      });
      this.loadTex(this.opts.nightTex).then((t) => {
        if (t && this.globe) { this.globe.material.emissiveMap = t; this.globe.material.needsUpdate = true; }
      });

      // 数据：外部传入或自行拉取
      if (this.opts.data) {
        this.data = this.opts.data;
        this.buildOverlays();
      } else {
        try {
          const [borders, cities] = await Promise.all([
            fetch(this.opts.bordersUrl).then((r) => r.json()),
            fetch(this.opts.citiesUrl).then((r) => r.json())
          ]);
          this.data = { borders, cities };
          this.buildOverlays();
        } catch (e) { /* 数据缺失则不画叠加层 */ }
      }

      this.bindEvents();
      this.resize();
      this.animate();
      this.startClock();
    }

    loadTex(url) {
      return new Promise((resolve) => {
        new THREE.TextureLoader().load(url, resolve, undefined, () => resolve(null));
      });
    }

    // 兜底贴图（纯色），保证球体始终不透明
    fallbackTex(color) {
      const c = document.createElement('canvas');
      c.width = c.height = 64;
      const ctx = c.getContext('2d');
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, 64, 64);
      return new THREE.CanvasTexture(c);
    }

    // 标准材质：无自定义着色器（避免部分设备着色器编译失败导致球体透明），
    // 白天贴图压暗作底，夜景贴图作自发光（城市灯光），球体必然不透明、正常遮挡背面
    buildGlobe(dayTex, nightTex) {
      const geo = new THREE.SphereGeometry(this.opts.radius, 96, 64);
      const mat = new THREE.MeshPhongMaterial({
        map: dayTex,                       // 白天贴图，乘以深色 color 后极暗
        emissiveMap: nightTex,             // 夜景灯光自发光
        emissive: new THREE.Color(0xffffff),
        emissiveIntensity: this.opts.lightIntensity * 1.5,
        color: new THREE.Color(0x0d1524),  // 深蓝灰 → 海洋/陆地都压暗
        specular: new THREE.Color(0x000000),
        shininess: 0,
        transparent: false                 // 绝对不透明
      });
      this.globe = new THREE.Mesh(geo, mat);
      this.scene.add(this.globe);
    }

    buildOverlays() {
      this.buildBorders();
      this.buildCityDots();
      this.buildCountryLabels();
      this.buildMarker();
    }

    // 国家边界（细线）
    buildBorders() {
      const d = this.data.borders;
      if (!d || !d.features) return;
      const r = this.opts.radius * 1.0025;
      const pts = [];
      const countryIds = [];
      const lineCountry = []; // 每条线段 -> 国家索引
      d.features.forEach((f, ci) => {
        const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
        for (const ring of polys) {
          for (const seg of ring) {
            const a = latLonToVec3(seg[0][0], seg[0][1], r);
            const b = latLonToVec3(seg[seg.length - 1][0], seg[seg.length - 1][1], r);
            pts.push(a.x, a.y, a.z, b.x, b.y, b.z);
            countryIds.push(ci, ci);
            lineCountry.push(ci);
          }
        }
      });
      const bg = new THREE.BufferGeometry();
      bg.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
      const lm = new THREE.LineBasicMaterial({ color: 0x9db8d8, transparent: true, opacity: 0.32 });
      this.borderLines = new THREE.LineSegments(bg, lm);
      this.borderLines.userData = { countryIds, lineCountry };
      this.scene.add(this.borderLines);
    }

    // 城市光点（远景=首都/大城市，近景=全部城市，渐进显示）
    buildCityDots() {
      const cities = this.data.cities;
      if (!cities || !cities.length) return;
      const r = this.opts.radius * 1.006;
      const glow = makeGlowTexture('rgba(255,214,150,1)', 'rgba(255,180,90,0)');
      const all = [], major = [];
      this.cityIndex = [];
      cities.forEach((c, i) => {
        const v = latLonToVec3(c.lng, c.lat, r);
        const isMajor = c.cap === 1 || (c.r != null && c.r <= 2) || (c.pop >= 3000000);
        (isMajor ? major : all).push(v.x, v.y, v.z);
        this.cityIndex.push(i);
      });
      const mk = (arr, size, color) => {
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
        return new THREE.Points(g, new THREE.PointsMaterial({
          size, map: glow, transparent: true, depthWrite: false, sizeAttenuation: true, color
        }));
      };
      // 远景：主要城市圆点；近景：全部城市圆点
      this.cityPointsFar = mk(major, 0.02, 0xffd9a0);
      this.cityPointsAll = mk(all, 0.016, 0xffd9a0);
      this.cityPointsAll.visible = false;
      this.scene.add(this.cityPointsFar);
      this.scene.add(this.cityPointsAll);
    }

    // 国家名称标签（本国语言），中景显示
    buildCountryLabels() {
      const countries = this.data.countries;
      if (!countries || !countries.length) return;
      const r = this.opts.radius * 1.012;
      this.countryLabels = [];
      this.countryLabelGroup = new THREE.Group();
      for (const c of countries) {
        if (c.lat == null || c.lng == null) continue;
        const label = c.native || c.name;
        if (!label) continue;
        const tex = this.makeTextTexture(label);
        const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, depthTest: true, opacity: 0.95 }); // 深度测试：背面的标签被球体遮挡
        const spr = new THREE.Sprite(mat);
        const v = latLonToVec3(c.lng, c.lat, r);
        spr.position.copy(v);
        const s = Math.max(0.045, Math.min(0.11, 0.11 - Math.abs(c.lat) * 0.0004));
        spr.scale.set(s * 6, s, 1);
        this.countryLabelGroup.add(spr);
        this.countryLabels.push({ spr, lat: c.lat, lng: c.lng });
      }
      this.countryLabelGroup.visible = false;
      this.scene.add(this.countryLabelGroup);
    }

    makeTextTexture(text) {
      const c = document.createElement('canvas');
      c.width = 512; c.height = 64;
      const ctx = c.getContext('2d');
      ctx.clearRect(0, 0, 512, 64);
      ctx.font = '500 34px Inter, system-ui, "PingFang SC", "Microsoft YaHei", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineWidth = 6;
      ctx.strokeStyle = 'rgba(0,0,0,0.85)';
      ctx.strokeText(text, 256, 34);
      ctx.fillStyle = 'rgba(255,255,255,0.92)';
      ctx.fillText(text, 256, 34);
      return new THREE.CanvasTexture(c);
    }

    // 蓝色定位标记（默认亚洲/北京）
    buildMarker() {
      const [lon, lat] = this.opts.markerLonLat;
      const r = this.opts.radius * 1.012;
      this.markerPos = latLonToVec3(lon, lat, r);
      const tex = makeGlowTexture('rgba(96,165,250,1)', 'rgba(96,165,250,0)');
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute([this.markerPos.x, this.markerPos.y, this.markerPos.z], 3));
      this.marker = new THREE.Points(g, new THREE.PointsMaterial({
        size: 0.05, map: tex, transparent: true, depthWrite: false, sizeAttenuation: true, color: 0x60a5fa
      }));
      this.scene.add(this.marker);
      // 脉冲圆环
      const ringGeo = new THREE.BufferGeometry().setFromPoints(
        Array.from({ length: 48 }, (_, i) => {
          const a = (i / 48) * Math.PI * 2;
          return new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
        })
      );
      const ring = new THREE.LineLoop(ringGeo, new THREE.LineBasicMaterial({
        color: 0x60a5fa, transparent: true, opacity: 0.55, depthWrite: false
      }));
      ring.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), this.markerPos.clone().normalize());
      this.markerRing = ring;
      this.scene.add(ring);
    }

    bindEvents() {
      // 点击拾取：城市光点 > 定位标记 > 国家边界
      const raycaster = new THREE.Raycaster();
      const ndc = new THREE.Vector2();
      const onPointer = (e) => {
        const rect = this.renderer.domElement.getBoundingClientRect();
        ndc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        ndc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
        raycaster.setFromCamera(ndc, this.camera);
        raycaster.params.Points.threshold = 0.05;
        raycaster.params.Line.threshold = 0.012;
        const hits = raycaster.intersectObjects([this.cityPointsFar, this.cityPointsAll, this.marker, this.borderLines], false);
        for (const h of hits) {
          if (h.object === this.cityPointsFar || h.object === this.cityPointsAll) {
            const idx = this.cityIndex[h.index];
            if (this.opts.onCityClick && idx != null) this.opts.onCityClick(this.data.cities[idx]);
            return;
          }
          if (h.object === this.marker) {
            if (this.opts.onMarkerClick) this.opts.onMarkerClick();
            return;
          }
          if (h.object === this.borderLines) {
            const si = h.index != null ? h.index / 2 : -1;
            const ci = this.borderLines.userData.lineCountry[Math.floor(si)];
            if (this.opts.onCountryClick && ci != null && ci >= 0) {
              const f = this.data.borders.features[ci];
              const props = f.properties || {};
              this.opts.onCountryClick(props);
            }
            return;
          }
        }
      };
      this.pointerHandler = onPointer;
      this.renderer.domElement.addEventListener('click', onPointer);
    }

    // 飞往某地（lon/lat 目标距离 dist）
    flyTo(lon, lat, dist) {
      const r = this.opts.radius;
      const v = latLonToVec3(lon, lat, r).normalize().multiplyScalar(dist);
      const start = this.camera.position.clone();
      const t0 = performance.now();
      const dur = 1100;
      const step = () => {
        const k = Math.min(1, (performance.now() - t0) / dur);
        const e = 1 - Math.pow(1 - k, 3);
        this.camera.position.lerpVectors(start, v, e);
        this.controls.update();
        if (k < 1) requestAnimationFrame(step);
      };
      step();
    }

    reset() {
      this.flyTo(116.4, 20, 2.8);
    }

    startClock() {
      const el = this.opts.utcEl;
      if (!el) return;
      const tick = () => {
        const d = new Date();
        const p = (n) => String(n).padStart(2, '0');
        el.textContent = `UTC ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`;
      };
      tick();
      this.clockTimer = setInterval(tick, 1000);
    }

    animate() {
      let zoomed = false;
      const loop = () => {
        requestAnimationFrame(loop);
        this.controls.update();
        const dist = this.camera.position.length();
        // 渐进层次：远景=主要城市圆点+轮廓；中景=全部城市圆点+国家名（本国语言）；近景=清爽（交给矢量地图）
        if (this.cityPointsFar) this.cityPointsFar.visible = true;
        if (this.cityPointsAll) this.cityPointsAll.visible = dist > 2.2 && dist < 3.6;
        if (this.countryLabelGroup) {
          this.countryLabelGroup.visible = dist > 2.1 && dist < 3.1;
          if (this.countryLabelGroup.visible) {
            const s = THREE.MathUtils.clamp(0.7 + (3.1 - dist) * 0.7, 0.7, 1.5);
            this.countryLabelGroup.scale.setScalar(s);
          }
        }
        if (!zoomed && dist < this.opts.zoomSwitchDist) {
          zoomed = true;
          if (this.opts.onZoomIn) this.opts.onZoomIn();
        }
        if (zoomed && dist > this.opts.zoomSwitchDist + 0.35) zoomed = false;
        if (this.markerRing) {
          const t = performance.now() / 1000;
          const s = 0.035 + 0.012 * Math.sin(t * 2);
          this.markerRing.scale.set(s, s, s);
          this.markerRing.material.opacity = 0.5 - 0.25 * Math.sin(t * 2);
        }
        this.renderer.render(this.scene, this.camera);
      };
      loop();
    }

    // 当前缩放距离
    getDistance() { return this.camera.position.length(); }

    // 当前视角正对的地表经纬度
    getCenterLonLat() {
      const v = this.camera.position.clone().normalize();
      const lat = Math.asin(THREE.MathUtils.clamp(v.y, -1, 1)) * 180 / Math.PI;
      const lon = Math.atan2(v.z, -v.x) * 180 / Math.PI - 180;
      return [((lon % 360) + 360) % 360, lat];
    }

    // 设定视角（经纬度 + 距离）
    setView(lon, lat, dist) {
      const v = latLonToVec3(lon, lat, this.opts.radius).normalize().multiplyScalar(dist || 2.6);
      this.camera.position.copy(v);
      this.controls.update();
    }

    resize() {
      const w = this.container.clientWidth;
      const h = this.container.clientHeight;
      if (!w || !h) return;
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(w, h);
    }

    dispose() {
      if (this.clockTimer) clearInterval(this.clockTimer);
      if (this.pointerHandler) this.renderer.domElement.removeEventListener('click', this.pointerHandler);
      if (this.renderer) this.renderer.dispose();
    }
  }

  global.NightEarth = NightEarth;
})(typeof window !== 'undefined' ? window : globalThis);
