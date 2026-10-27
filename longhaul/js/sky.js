// Long Haul – day/night cycle: sun, moon, stars, sky and fog colours
import * as THREE from "three";

export const DAY_SECONDS = 1200; // one in-game day = 20 real minutes

const KEYS = [
  // [time of day, sky, sun light colour]
  [0.0, 0x070a18, 0x000000],
  [0.2, 0x0d1230, 0x000000],
  [0.25, 0xe2875a, 0xff9a5c],
  [0.32, 0x9cc8e6, 0xffe2b8],
  [0.5, 0x86bfe8, 0xfff4e0],
  [0.68, 0x9cc8e6, 0xffe2b8],
  [0.75, 0xd9744c, 0xff8a4a],
  [0.8, 0x141a3a, 0x000000],
  [1.0, 0x070a18, 0x000000],
];
const ca = new THREE.Color(), cb = new THREE.Color();
function sample(t, slot, out) {
  for (let i = 0; i < KEYS.length - 1; i++) {
    const a = KEYS[i], b = KEYS[i + 1];
    if (t >= a[0] && t <= b[0]) {
      const f = (t - a[0]) / (b[0] - a[0]);
      return out.copy(ca.setHex(a[slot])).lerp(cb.setHex(b[slot]), f);
    }
  }
  return out.setHex(KEYS[0][slot]);
}

export class Sky {
  constructor(scene) {
    this.scene = scene;
    this.time = 0.3; // 07:12
    this.color = new THREE.Color();
    scene.background = this.color;
    scene.fog = new THREE.Fog(this.color, 60, 450);

    this.hemi = new THREE.HemisphereLight(0xbfd8ff, 0xc9a06a, 0.9);
    scene.add(this.hemi);

    this.sun = new THREE.DirectionalLight(0xffffff, 2);
    this.sun.shadow.mapSize.set(1024, 1024);
    const sc = this.sun.shadow.camera;
    sc.left = -45; sc.right = 45; sc.top = 45; sc.bottom = -45; sc.near = 1; sc.far = 300;
    this.sun.shadow.bias = -0.0008;
    scene.add(this.sun, this.sun.target);

    const disc = (r, c) => new THREE.Mesh(new THREE.CircleGeometry(r, 24), new THREE.MeshBasicMaterial({ color: c, fog: false }));
    this.sunDisc = disc(26, 0xfff1c4);
    this.moonDisc = disc(14, 0xdfe6f2);
    scene.add(this.sunDisc, this.moonDisc);

    const starPos = new Float32Array(900 * 3);
    for (let i = 0; i < 900; i++) {
      const u = Math.random() * 2 - 1, a = Math.random() * Math.PI * 2, s = Math.sqrt(1 - u * u);
      starPos.set([Math.cos(a) * s * 900, Math.abs(u) * 900, Math.sin(a) * s * 900], i * 3);
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute("position", new THREE.BufferAttribute(starPos, 3));
    this.starMat = new THREE.PointsMaterial({ color: 0xffffff, size: 1.6, sizeAttenuation: false, transparent: true, fog: false, depthWrite: false });
    this.stars = new THREE.Points(sg, this.starMat);
    scene.add(this.stars);
    this.sunDir = new THREE.Vector3();
  }

  get night() { return this.sunDir.y < 0.08; }

  clock() {
    const mins = Math.floor(this.time * 1440);
    return String(Math.floor(mins / 60)).padStart(2, "0") + ":" + String(mins % 60).padStart(2, "0");
  }

  setLite(lite, fogFar) {
    this.sun.castShadow = !lite;
    this.scene.fog.far = fogFar;
    this.scene.fog.near = fogFar * 0.15;
  }

  update(dt, camera, focus) {
    this.time = (this.time + dt / DAY_SECONDS) % 1;
    const ang = (this.time - 0.25) * Math.PI * 2;      // sunrise at 06:00
    this.sunDir.set(Math.cos(ang) * 0.75, Math.sin(ang), Math.cos(ang) * 0.35 + 0.25).normalize();
    const elev = this.sunDir.y;

    sample(this.time, 1, this.color);
    this.scene.fog.color.copy(this.color);

    sample(this.time, 2, this.sun.color);
    this.sun.intensity = 2.4 * Math.sqrt(Math.max(0, elev));
    this.sun.position.copy(focus).addScaledVector(this.sunDir, 150);
    this.sun.target.position.copy(focus);

    const day = Math.min(1, Math.max(0, (elev + 0.1) / 0.4));
    this.hemi.intensity = 0.22 + 0.75 * day;
    this.hemi.color.setHex(day > 0.5 ? 0xbfd8ff : 0x6d7fb8);

    this.sunDisc.position.copy(camera.position).addScaledVector(this.sunDir, 800);
    this.sunDisc.lookAt(camera.position);
    this.moonDisc.position.copy(camera.position).addScaledVector(this.sunDir, -800);
    this.moonDisc.lookAt(camera.position);
    this.stars.position.copy(camera.position);
    this.starMat.opacity = Math.max(0, Math.min(1, (-elev + 0.05) / 0.2));
    this.stars.visible = this.starMat.opacity > 0.01;
  }
}
