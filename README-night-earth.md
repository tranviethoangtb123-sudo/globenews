# 🌙 Night Earth 3D 夜景地球模块

纯 Three.js 的夜景地球（无 Vue/React 等框架），深色海洋、暗色大陆、极地淡蓝冰盖、NASA Black Marble 夜景灯光自发光；**不自动自转**，鼠标左键拖拽旋转、滚轮/双指缩放；顶部 UTC 时钟、亚洲蓝色定位标记（默认北京）。

**在线演示**：https://tranviethoangtb123-sudo.github.io/globenews/night-earth-demo.html
**源码**：`web/public/night-earth.js`（模块本体，约 300 行，注释齐全）

---

## ① 贴图资源下载链接 + 文件命名规则

| 文件（必须同名） | 用途 | 官方下载地址 |
|---|---|---|
| `earth-day.jpg` | 白天地表（陆地/海洋），等距圆柱投影 | NASA Visible Earth「Blue Marble」系列：https://visibleearth.nasa.gov/collection/1484/blue-marble |
| `earth-night.jpg` | 夜景灯光（NASA Black Marble 2016） | NASA Earth Observatory「NightLights」：https://earthobservatory.nasa.gov/features/NightLights ；直接下载页：https://visibleearth.nasa.gov/images/144898/earth-at-night-black-marble-2016-color-maps |

**命名规则**：下载后必须命名为 **`earth-day.jpg`** 与 **`earth-night.jpg`**，放到 `public/textures/` 目录（等距圆柱投影，宽高比 2:1，如 4096×2048）。

> 本项目已内置等价贴图（来自 three-globe 示例资源，共 ~940KB），开箱即用；想换 NASA 官方高清图，直接覆盖同名文件即可。

---

## ② 完整代码

- 模块：`web/public/night-earth.js`（可直接复制到任何项目）
- 独立演示页：`web/public/night-earth-demo.html`（保存即本地预览，双击打开即可，需同目录下有 `vendor/three/`、`textures/`、`data/`）
- 依赖（已本地化到 `public/vendor/three/`，无需联网）：
  - `three.min.js`（Three.js r128 UMD）
  - `OrbitControls.js`（拖拽/缩放控制器）

HTML 引入方式（经典 `<script>`，无打包器）：

```html
<div id="earth" style="width:100%;height:100vh"></div>
<script src="vendor/three/three.min.js"></script>
<script src="vendor/three/OrbitControls.js"></script>
<script src="night-earth.js"></script>
<script>
  new NightEarth(document.getElementById('earth'), {
    dayTex: 'textures/earth-day.jpg',
    nightTex: 'textures/earth-night.jpg',
    markerLonLat: [116.4, 39.9],   // 蓝色定位标记位置（北京）
    utcEl: document.getElementById('utc'),  // 传入后自动显示 UTC 时钟
    onCityClick: (city) => { /* 点击城市光点回调 */ },
    onCountryClick: (props) => { /* 点击国家边界回调（props.iso2/name/zh）*/ },
    onMarkerClick: () => { /* 点击定位标记回调 */ }
  });
</script>
```

---

## ③ 简易部署教程

### 放进现有网站
1. 把 `night-earth.js`、`vendor/three/`、`textures/` 复制到你的站点目录；
2. 在页面放一个容器 `<div id="earth"></div>` 并给宽高；
3. 按上面代码引入脚本并 `new NightEarth(...)`；
4. 可选传入 `data: { borders, cities }`（GeoJSON + 城市数组），否则模块会自动从 `bordersUrl`/`citiesUrl` 拉取。

### 替换贴图
直接覆盖 `textures/earth-day.jpg` / `earth-night.jpg`（保持文件名）。

### 调整参数（在 `night-earth.js` 顶部 `opts` 中）
- **定位点位置**：`markerLonLat: [经度, 纬度]`（当前 `[116.4, 39.9]` = 北京）
- **夜景灯光亮度**：`lightIntensity`（默认 `1.0`，0.5 变暗、2 更亮；shader 里 `uNightScale`）
- 拖拽速度 `rotateSpeed`、缩放范围 `minDist/maxDist`、陆地隐约可见度（shader `day * 0.07`）、冰盖纬度阈值（shader `smoothstep(0.88, 0.985, ...)`）
- 初始相机视角：`camera.position`（构造器内 `set(2.4, 1.0, 2.1)`）
- 关闭自动自转已内置：`autoRotate = false`

### 常见问题
- 地球全黑：贴图路径不对或贴图未加载成功，检查 `textures/` 下两个 jpg 是否存在。
- 城市光点不显示：`citiesUrl` 数据格式需含 `{ n, z, lat, lng, cap }` 字段。
- 想开自动自转：把 `controls.autoRotate = false` 改为 `true` 并在动画循环里 `controls.update()`。
