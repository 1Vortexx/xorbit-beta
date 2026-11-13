// Long Haul – day/night: sun and moon light with a shadow frustum that follows the focus, gradient sky dome with
// sun disc, moon, stars and thin cloud, hemisphere fill, fog colour and scene.environment (small PMREM of the dome).
// All objects live under `root` (worldRoot) and are positioned with absolute coordinates.
import * as THREE from "three";

export const DAY_SECONDS = 1200; // one in-game day = 20 real minutes

// Keyed by sun elevation (sin of altitude). Linear colours, tuned for ACES + sRGB output.
const K = [
  // elev,  zenith,              horizon,             sun light,          sun I, hemi I, ground bounce
  [-0.35, [0.006, 0.010, 0.030], [0.020, 0.030, 0.060], [0.45, 0.55, 1.0], 0.0, 0.34, [0.05, 0.05, 0.07]],
  [-0.10, [0.014, 0.022, 0.070], [0.090, 0.075, 0.110], [0.45, 0.55, 1.0], 0.0, 0.36, [0.06, 0.055, 0.07]],
  [-0.02, [0.060, 0.090, 0.240], [0.620, 0.300, 0.160], [1.0, 0.42, 0.16], 0.0, 0.45, [0.16, 0.11, 0.09]],
  [0.06, [0.110, 0.200, 0.480], [0.950, 0.520, 0.250], [1.0, 0.50, 0.22], 1.5, 0.62, [0.30, 0.20, 0.13]],
  [0.20, [0.130, 0.290, 0.680], [0.780, 0.700, 0.620], [1.0, 0.78, 0.55], 2.6, 0.85, [0.42, 0.32, 0.22]],
  [0.50, [0.120, 0.300, 0.780], [0.560, 0.720, 0.900], [1.0, 0.93, 0.82], 3.3, 1.0, [0.50, 0.40, 0.28]],
  [1.00, [0.100, 0.270, 0.780], [0.520, 0.700, 0.920], [1.0, 0.96, 0.90], 3.6, 1.05, [0.52, 0.42, 0.30]],
];
const lerp = (a, b, t) => a + (b - a) * t;
function key(e, out) {
  let i = 0;
  while (i < K.length - 2 && e > K[i + 1][0]) i++;
  const a = K[i], b = K[i + 1], t = Math.min(1, Math.max(0, (e - a[0]) / (b[0] - a[0])));
  for (const [slot, name] of [[1, "zen"], [2, "hor"], [3, "sun"], [6, "gnd"]]) out[name].setRGB(lerp(a[slot][0], b[slot][0], t), lerp(a[slot][1], b[slot][1], t), lerp(a[slot][2], b[slot][2], t));
  out.sunI = lerp(a[4], b[4], t); out.hemiI = lerp(a[5], b[5], t);
  return out;
}

const VERT = `
varying vec3 vDir;
void main() {
  vDir = position;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
}`;
const FRAG = `
uniform vec3 uZen, uHor, uGnd, uSunDir, uMoonDir, uSunCol, uCloudCol;
uniform float uStars, uCloud, uDisc, uTime, uFlash, uHaze, uEnv;
varying vec3 vDir;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y); }
float fbm(vec2 p) { float a = 0.0, w = 0.5; for (int i = 0; i < 4; i++) { a += w * noise(p); p = p * 2.03 + 17.0; w *= 0.5; } return a; }
void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
  vec3 col = mix(uHor, uZen, pow(clamp(h, 0.0, 1.0), 0.42));
  col = mix(col, uGnd, smoothstep(-0.06, -0.3, h));
  float sd = max(dot(d, uSunDir), 0.0);
  // warm scatter around a low sun, glow, disc
  float low = 1.0 - smoothstep(0.0, 0.45, uSunDir.y);
  col += uSunCol * (pow(sd, 6.0) * 0.22 * low * (1.0 - clamp(h, 0.0, 1.0)) + pow(sd, 64.0) * 0.25 + pow(sd, 700.0) * 1.2) * uDisc * step(-0.06, uSunDir.y + 0.06);
  col += uSunCol * smoothstep(0.99955, 0.9997, sd) * 30.0 * uDisc * step(-0.02, h);
  // moon
  float md = max(dot(d, uMoonDir), 0.0);
  col += vec3(0.75, 0.82, 1.0) * (smoothstep(0.9994, 0.9996, md) * 2.2 + pow(md, 300.0) * 0.12) * uStars * uDisc * step(0.0, h);
  // stars
  if (uStars > 0.01 && h > 0.0) {
    vec2 uv = d.xz / (d.y + 0.35) * 90.0; vec2 c = floor(uv), f = fract(uv) - 0.5;
    float r = hash(c), tw = 0.75 + 0.25 * sin(uTime * (1.0 + r * 3.0) + r * 40.0);
    vec2 o = (vec2(hash(c + 3.1), hash(c + 7.7)) - 0.5) * 0.7;
    float s = smoothstep(0.09, 0.0, length(f - o)) * step(0.86, r) * tw;
    col += vec3(0.9, 0.93, 1.0) * s * uStars * (0.4 + 1.6 * hash(c + 1.3)) * smoothstep(0.0, 0.2, h) * uDisc;
  }
  // clouds: wisps when clear, a lid when overcast
  if (h > -0.02) {
    vec2 p = d.xz / (max(h, 0.0) + 0.18) * 1.4 + vec2(uTime * 0.004, uTime * 0.0015);
    float n = fbm(p), cover = mix(0.62, 0.18, uCloud);
    float c = smoothstep(cover, cover + 0.3, n) * mix(0.55, 1.0, uCloud) * smoothstep(-0.02, 0.1, h);
    vec3 cc = mix(uCloudCol * 1.25 + uSunCol * 0.1 * pow(sd, 3.0), uCloudCol * 0.6, uCloud * smoothstep(0.4, 0.9, n));
    col = mix(col, cc, c);
  }
  col = mix(col, uCloudCol, uHaze);
  col += vec3(0.7, 0.75, 1.0) * uFlash;
  // environment capture: pull the saturated zenith towards grey so shade is not deep blue
  float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col = mix(col, vec3(lum), 0.55 * uEnv);
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export class Sky {
  constructor(root, scene) {
    this.root = root; this.scene = scene || root;
    this.time = 0.3;
    this.color = new THREE.Color(0.6, 0.7, 0.9);         // fog / horizon colour (weather may tint it)
    this.sunDir = new THREE.Vector3(0, 1, 0); this.moonDir = new THREE.Vector3(0, -1, 0);
    this.lite = false; this.shadowRange = 70; this.envStep = 0.006;
    this.wx = { cloud: 0, sand: 0, light: 1, flash: 0, tint: new THREE.Color(0.5, 0.5, 0.5), haze: 0 };   // written by Weather
    this.k = { zen: new THREE.Color(), hor: new THREE.Color(), sun: new THREE.Color(), gnd: new THREE.Color(), sunI: 0, hemiI: 0 };
    if (this.scene.isScene) {
      this.scene.background = this.color;
      if (!this.scene.fog) this.scene.fog = new THREE.Fog(this.color.clone(), 150, 3600);
    }
    this.fogFar = this.scene.fog ? this.scene.fog.far : 3600;

    this.hemi = new THREE.HemisphereLight(0xbfd8ff, 0xc9a06a, 0.9);
    root.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xffffff, 2);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0003; this.sun.shadow.normalBias = 0.06;
    this._frustum();
    root.add(this.sun, this.sun.target);

    this.uniforms = {
      uZen: { value: this.k.zen }, uHor: { value: new THREE.Color() }, uGnd: { value: new THREE.Color() }, uSunDir: { value: this.sunDir }, uMoonDir: { value: this.moonDir },
      uSunCol: { value: this.k.sun }, uCloudCol: { value: new THREE.Color(0.8, 0.8, 0.8) }, uStars: { value: 0 }, uCloud: { value: 0 }, uDisc: { value: 1 },
      uTime: { value: 0 }, uFlash: { value: 0 }, uHaze: { value: 0 }, uEnv: { value: 0 },
    };
    this.domeMat = new THREE.ShaderMaterial({ uniforms: this.uniforms, vertexShader: VERT, fragmentShader: FRAG, side: THREE.BackSide, depthTest: false, depthWrite: false, fog: false });
    const geo = new THREE.SphereGeometry(1, 32, 20);
    this.dome = new THREE.Mesh(geo, this.domeMat);
    this.dome.scale.setScalar(900); this.dome.renderOrder = -1000; this.dome.frustumCulled = false;
    this.dome.onBeforeRender = (renderer) => { if (!this.renderer && renderer.isWebGLRenderer) this.renderer = renderer; };
    root.add(this.dome);
    // environment capture rig (separate tiny scene sharing the dome material)
    this.envScene = new THREE.Scene();
    this.envDome = new THREE.Mesh(geo, this.domeMat); this.envDome.scale.setScalar(50); this.envDome.frustumCulled = false;
    this.envScene.add(this.envDome);
    this.envTime = -1; this.envCloud = -1; this.envRT = null; this.pmrem = null; this.t = 0;
    this._tmp = new THREE.Vector3();
  }
  _frustum() {
    const c = this.sun.shadow.camera, r = this.shadowRange;
    c.left = -r; c.right = r; c.top = r; c.bottom = -r; c.near = 20; c.far = 420;
    c.updateProjectionMatrix();
  }

  get night() { return this.sunDir.y < 0.08; }
  clock() {
    const mins = Math.floor(this.time * 1440);
    return String(Math.floor(mins / 60)).padStart(2, "0") + ":" + String(mins % 60).padStart(2, "0");
  }
  // { lite, shadowSize, fogFar, shadows }
  setQuality(q = {}) {
    if (q.lite !== undefined) this.lite = !!q.lite;
    this.sun.castShadow = q.shadows !== undefined ? !!q.shadows : !this.lite;
    const size = q.shadowSize || (this.lite ? 1024 : 2048);
    if (this.sun.shadow.mapSize.x !== size) { this.sun.shadow.mapSize.set(size, size); if (this.sun.shadow.map) { this.sun.shadow.map.dispose(); this.sun.shadow.map = null; } }
    this.shadowRange = this.lite ? 45 : 70; this._frustum();
    this.envStep = this.lite ? 0.02 : 0.006;
    if (q.fogFar) this.setFog(q.fogFar);
  }
  setLite(lite, fogFar) { this.setQuality({ lite, fogFar }); }
  setFog(far) { this.fogFar = far; if (this.scene.fog) { this.scene.fog.far = far; this.scene.fog.near = Math.min(far * 0.1, 150); } }

  update(dt, camera, focus) {
    this.time = (((this.time + dt / DAY_SECONDS) % 1) + 1) % 1;
    this.t += dt;
    const ang = (this.time - 0.25) * Math.PI * 2;      // sunrise at 06:00
    this.sunDir.set(Math.cos(ang) * 0.75, Math.sin(ang), Math.cos(ang) * 0.35 + 0.25).normalize();
    this.moonDir.set(-this.sunDir.x, -this.sunDir.y * 0.9 + 0.12, -this.sunDir.z + 0.3).normalize();
    const e = this.sunDir.y, k = key(e, this.k), wx = this.wx, u = this.uniforms;

    // weather: clouds grey the sky, dust tints it
    const dayL = Math.min(1, Math.max(0.05, (e + 0.12) / 0.4));
    const cc = u.uCloudCol.value.copy(wx.tint).multiplyScalar(0.12 + dayL * 0.75);
    const over = Math.min(1, wx.cloud * 0.9 + wx.sand);
    u.uHor.value.copy(k.hor).lerp(cc, over * 0.85);
    u.uGnd.value.copy(k.gnd).lerp(cc, over * 0.6);
    u.uCloud.value = wx.cloud; u.uHaze.value = Math.min(0.92, wx.sand * 0.9 + wx.haze);
    u.uStars.value = Math.min(1, Math.max(0, (-e + 0.02) / 0.18)) * (1 - over);
    u.uDisc.value = 1 - Math.min(1, wx.cloud * 1.15 + wx.sand * 1.4);
    u.uTime.value = this.t; u.uFlash.value = wx.flash * 0.5;
    this.color.copy(u.uHor.value).lerp(cc, u.uHaze.value);
    if (this.scene.fog) this.scene.fog.color.copy(this.color).multiplyScalar(1 + wx.flash * 0.6);

    // light: the sun by day, a dim blue moon at night (never pitch black)
    const moonUp = Math.max(0, this.moonDir.y), moonI = 0.5 * Math.min(1, Math.max(0, (-e - 0.02) / 0.1)) * Math.min(1, moonUp * 4);
    const useMoon = moonI > k.sunI;
    const dir = useMoon ? this.moonDir : this.sunDir;
    this.sun.color.copy(useMoon ? this._c || (this._c = new THREE.Color(0.55, 0.66, 1.0)) : k.sun);
    this.sun.intensity = (useMoon ? moonI : k.sunI) * (useMoon ? 1 - over * 0.7 : wx.light);
    // snap the shadow centre to a coarse grid so the map does not swim
    const fx = Math.round(focus.x / 2) * 2, fz = Math.round(focus.z / 2) * 2;
    this.sun.target.position.set(fx, focus.y, fz);
    this.sun.position.set(fx, focus.y, fz).addScaledVector(dir, 200);
    this.hemi.color.copy(k.zen).lerp(u.uHor.value, 0.55).lerp(cc, over * 0.5);
    const m = Math.max(this.hemi.color.r, this.hemi.color.g, this.hemi.color.b) || 1;
    this.hemi.color.multiplyScalar(1 / m).lerp(this._w || (this._w = new THREE.Color(1, 1, 1)), 0.6);
    this.hemi.groundColor.copy(k.gnd).multiplyScalar(1 / Math.max(k.gnd.r, 0.01)).multiplyScalar(0.55);
    this.hemi.intensity = k.hemiI * (this.envRT ? 0.62 : 1) * (0.55 + 0.45 * wx.light) + wx.flash * 2.5;
    this.hemi.position.copy(focus);

    this.dome.position.copy(camera.position);
    this._env(over);
  }
  // Regenerate scene.environment when the light has changed noticeably
  _env(over) {
    if (!this.renderer || !this.scene.isScene) return;
    let dtm = Math.abs(this.time - this.envTime); if (dtm > 0.5) dtm = 1 - dtm;
    // dawn and dusk change fast: refresh more often there
    const fast = Math.abs(this.sunDir.y) < 0.25 ? 0.5 : 1;
    if (this.envRT && dtm < this.envStep * fast && Math.abs(over - this.envCloud) < 0.08) return;
    if (!this.pmrem) this.pmrem = new THREE.PMREMGenerator(this.renderer);
    const u = this.uniforms, disc = u.uDisc.value, flash = u.uFlash.value;
    u.uDisc.value = disc * 0.25; u.uFlash.value = 0; u.uEnv.value = 1;      // keep the sun from blowing out speculars
    const rt = this.pmrem.fromScene(this.envScene, 0, 1, 200);
    u.uDisc.value = disc; u.uFlash.value = flash; u.uEnv.value = 0;
    this.scene.environment = rt.texture;
    this.scene.environmentIntensity = 0.55;
    if (this.envRT) this.envRT.dispose();
    this.envRT = rt; this.envTime = this.time; this.envCloud = over;
  }
  dispose() {
    this.root.remove(this.hemi, this.sun, this.sun.target, this.dome);
    this.dome.geometry.dispose(); this.domeMat.dispose();
    if (this.envRT) this.envRT.dispose();
    if (this.pmrem) this.pmrem.dispose();
    if (this.scene.isScene && this.scene.environment === (this.envRT && this.envRT.texture)) this.scene.environment = null;
  }
}
