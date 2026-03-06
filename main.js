/* ============================================================
   eVTOL Flight Simulator - mobile/tablet compatible full main.js
   既存機能は維持しつつ、タッチ操作を追加
   ============================================================ */

const $ = (id) => document.getElementById(id);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const rng = (a, b) => a + Math.random() * (b - a);

/* ============================================================
   Simple helpers
   ============================================================ */
function toast(msg, ms = 2200) {
  const t = $("toast");
  if (!t) return;
  t.textContent = msg;
  t.style.display = "block";
  clearTimeout(toast._tm);
  toast._tm = setTimeout(() => {
    t.style.display = "none";
  }, ms);
}

let infoTimer = null;
function showInfo(title, body) {
  const bubble = $("infoBubble");
  const titleEl = $("infoTitle");
  const bodyEl = $("infoBody");
  if (!bubble || !titleEl || !bodyEl) return;

  titleEl.textContent = title;
  bodyEl.textContent = body;
  bubble.style.display = "block";
  clearTimeout(infoTimer);
  infoTimer = setTimeout(() => {
    bubble.style.display = "none";
  }, 3600);
}

function updateBatteryUI(battery) {
  const percent = Math.round(clamp(battery, 0, 100));

  if ($("batteryText")) $("batteryText").innerText = `${percent}%`;
  if ($("batteryHud")) $("batteryHud").innerText = `${percent} %`;
  if ($("batteryBar")) $("batteryBar").style.width = `${percent}%`;
}

/* ============================================================
   Geo helpers
   ============================================================ */
const R = 6378137;

function lonLatToMeters(lon, lat) {
  const x = R * (lon * Math.PI / 180);
  const y = R * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI / 180) / 2));
  return { x, y };
}

function metersToLonLat(x, y) {
  const lon = (x / R) * 180 / Math.PI;
  const lat = (2 * Math.atan(Math.exp(y / R)) - Math.PI / 2) * 180 / Math.PI;
  return { lon, lat };
}

function lonLatToLocalMeters(lon, lat, originLon, originLat) {
  const o = lonLatToMeters(originLon, originLat);
  const p = lonLatToMeters(lon, lat);
  return { dx: p.x - o.x, dz: p.y - o.y };
}

function localMetersToLonLat(dx, dz, originLon, originLat) {
  const o = lonLatToMeters(originLon, originLat);
  return metersToLonLat(o.x + dx, o.y + dz);
}

/* ============================================================
   Mini map
   ============================================================ */
let miniMap = null;
let miniFollow = true;
let miniHidden = false;
let playerMarker = null;

function rasterStyleOSM() {
  return {
    version: 8,
    sources: {
      osm: {
        type: "raster",
        tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
        tileSize: 256,
        attribution: "© OpenStreetMap contributors"
      }
    },
    layers: [{ id: "osm", type: "raster", source: "osm" }]
  };
}

function initMiniMap(centerLon, centerLat) {
  if (!$("miniMap") || typeof maplibregl === "undefined") return;

  if (miniMap) {
    miniMap.remove();
    miniMap = null;
  }

  miniMap = new maplibregl.Map({
    container: "miniMap",
    style: rasterStyleOSM(),
    center: [centerLon, centerLat],
    zoom: 15,
    pitch: 0,
    bearing: 0,
    antialias: true,
    interactive: true
  });

  miniMap.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
  miniMap.addControl(new maplibregl.AttributionControl({ compact: true }));

  const markerEl = document.createElement("div");
  markerEl.style.width = "12px";
  markerEl.style.height = "12px";
  markerEl.style.borderRadius = "50%";
  markerEl.style.background = "#00e8ff";
  markerEl.style.border = "2px solid #fff";
  markerEl.style.boxShadow = "0 0 10px rgba(0,232,255,0.9)";

  playerMarker = new maplibregl.Marker({ element: markerEl })
    .setLngLat([centerLon, centerLat])
    .addTo(miniMap);

  miniMap.on("click", (e) => {
    if ($("lat")) $("lat").value = e.lngLat.lat.toFixed(6);
    if ($("lon")) $("lon").value = e.lngLat.lng.toFixed(6);
  });
}

function updateMiniMapPlayer(lon, lat) {
  if (!miniMap || !playerMarker) return;
  playerMarker.setLngLat([lon, lat]);
  if (miniFollow) {
    miniMap.jumpTo({ center: [lon, lat] });
  }
}

/* ============================================================
   THREE.js scene
   ============================================================ */
const canvas = $("c");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.setClearColor(0x8db4cc, 1);

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0x97b4c8, 450, 2600);

const camera = new THREE.PerspectiveCamera(
  58,
  window.innerWidth / window.innerHeight,
  0.1,
  9000
);
camera.position.set(0, 20, 34);

/* light tuning */
scene.add(new THREE.HemisphereLight(0xeaf7ff, 0x778c64, 0.88));
scene.add(new THREE.AmbientLight(0xb8cce0, 0.38));

const sun = new THREE.DirectionalLight(0xffe3bf, 1.05);
sun.position.set(220, 340, 160);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -1200;
sun.shadow.camera.right = 1200;
sun.shadow.camera.top = 1200;
sun.shadow.camera.bottom = -1200;
sun.shadow.camera.far = 4200;
scene.add(sun);

const fill = new THREE.DirectionalLight(0xddeeff, 0.28);
fill.position.set(-220, 140, -180);
scene.add(fill);

/* ============================================================
   World groups
   ============================================================ */
const missionWorld = new THREE.Group();
const freeWorld = new THREE.Group();
scene.add(missionWorld);
scene.add(freeWorld);

function disposeObject(obj) {
  if (!obj) return;

  if (obj.geometry) obj.geometry.dispose();

  if (obj.material) {
    if (Array.isArray(obj.material)) {
      obj.material.forEach(m => m && m.dispose && m.dispose());
    } else if (obj.material.dispose) {
      obj.material.dispose();
    }
  }

  if (obj.children && obj.children.length) {
    obj.children.forEach(ch => disposeObject(ch));
  }
}

function clearGroup(g) {
  while (g.children.length) {
    const c = g.children.pop();
    disposeObject(c);
  }
}

/* ============================================================
   Ground plane for free flight
   ============================================================ */
const gTexCanvas = document.createElement("canvas");
gTexCanvas.width = 1024;
gTexCanvas.height = 1024;
const gtx = gTexCanvas.getContext("2d");

const groundTexture = new THREE.CanvasTexture(gTexCanvas);
groundTexture.anisotropy = 4;
groundTexture.wrapS = THREE.ClampToEdgeWrapping;
groundTexture.wrapT = THREE.ClampToEdgeWrapping;

const groundMat = new THREE.MeshLambertMaterial({ map: groundTexture });
const groundMesh = new THREE.Mesh(new THREE.PlaneGeometry(9000, 9000), groundMat);
groundMesh.rotation.x = -Math.PI / 2;
groundMesh.receiveShadow = true;
scene.add(groundMesh);

let groundStyle = "osm";
let groundOriginLon = 139.767125;
let groundOriginLat = 35.681236;
let groundZoom = 16;
const lastTileUpdateAt = new THREE.Vector2(1e9, 1e9);
let groundDrawBusy = false;

function tileURL(style, z, x, y) {
  if (style === "sat") {
    return `https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`;
  }
  return `https://tile.openstreetmap.org/${z}/${x}/${y}.png`;
}

function lonLatToTileXY(lon, lat, z) {
  const latRad = lat * Math.PI / 180;
  const n = Math.pow(2, z);
  const xt = Math.floor((lon + 180) / 360 * n);
  const yt = Math.floor((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * n);
  return { xt, yt };
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("image load failed"));
    img.src = url;
  });
}

async function redrawGroundTiles(centerLon, centerLat) {
  if (groundDrawBusy) return;
  groundDrawBusy = true;

  try {
    const { xt, yt } = lonLatToTileXY(centerLon, centerLat, groundZoom);
    const tiles = [];
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        tiles.push({ x: xt + dx, y: yt + dy, dx, dy });
      }
    }

    const imgs = await Promise.all(
      tiles.map(t => loadImage(tileURL(groundStyle, groundZoom, t.x, t.y)).catch(() => null))
    );

    gtx.fillStyle = groundStyle === "sat" ? "#5c5c5c" : "#3e5a3e";
    gtx.fillRect(0, 0, gTexCanvas.width, gTexCanvas.height);

    const cell = gTexCanvas.width / 3;
    imgs.forEach((img, i) => {
      if (!img) return;
      const t = tiles[i];
      gtx.drawImage(img, (t.dx + 1) * cell, (t.dy + 1) * cell, cell, cell);
    });

    gtx.globalAlpha = 0.10;
    gtx.strokeStyle = "#ffffff";
    gtx.lineWidth = 2;
    for (let i = 1; i <= 2; i++) {
      gtx.beginPath();
      gtx.moveTo(i * cell, 0);
      gtx.lineTo(i * cell, gTexCanvas.height);
      gtx.stroke();

      gtx.beginPath();
      gtx.moveTo(0, i * cell);
      gtx.lineTo(gTexCanvas.width, i * cell);
      gtx.stroke();
    }
    gtx.globalAlpha = 1;

    groundTexture.needsUpdate = true;
  } finally {
    groundDrawBusy = false;
  }
}

function updateGroundUnderAircraft(localX, localZ) {
  groundMesh.position.x = localX;
  groundMesh.position.z = localZ;

  const dx = localX - lastTileUpdateAt.x;
  const dz = localZ - lastTileUpdateAt.y;
  const dist = Math.sqrt(dx * dx + dz * dz);

  if (dist > 220) {
    lastTileUpdateAt.set(localX, localZ);
    const ll = localMetersToLonLat(localX, localZ, groundOriginLon, groundOriginLat);
    redrawGroundTiles(ll.lon, ll.lat);
  }
}

/* ============================================================
   Materials helpers
   ============================================================ */
function M(color, emissive = 0x000000, ei = 0) {
  return new THREE.MeshStandardMaterial({
    color,
    emissive,
    emissiveIntensity: ei,
    roughness: 0.62,
    metalness: 0.18
  });
}

function BX(g, mat, px, py, pz, sx, sy, sz, rx = 0, ry = 0, rz = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), mat);
  m.position.set(px, py, pz);
  m.rotation.set(rx, ry, rz);
  m.castShadow = true;
  m.receiveShadow = true;
  g.add(m);
  return m;
}

function CY(g, mat, px, py, pz, rt, rb, h, seg = 16, rx = 0, ry = 0, rz = 0) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat);
  m.position.set(px, py, pz);
  m.rotation.set(rx, ry, rz);
  m.castShadow = true;
  m.receiveShadow = true;
  g.add(m);
  return m;
}

function SP(g, mat, px, py, pz, r, sx = 1, sy = 1, sz = 1) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(r, 18, 14), mat);
  m.position.set(px, py, pz);
  m.scale.set(sx, sy, sz);
  m.castShadow = true;
  m.receiveShadow = true;
  g.add(m);
  return m;
}

/* ============================================================
   eVTOL model
   ============================================================ */
function createEVTOL(bodyColor = 0xf2f4f7, accentColor = 0x0077ee) {
  const g = new THREE.Group();

  const mBody = M(bodyColor);
  const mAccent = M(accentColor, accentColor, 0.12);
  const mDark = M(0x27323d);
  const mGlass = new THREE.MeshStandardMaterial({
    color: 0x9fdcff,
    emissive: 0x225577,
    emissiveIntensity: 0.18,
    roughness: 0.15,
    metalness: 0.25,
    transparent: true,
    opacity: 0.92
  });
  const mMetal = M(0x7d8b98);
  const mRotor = M(0xdde5ee);
  const mSkid = M(0x697684);

  CY(g, mBody, 0.0, 0.82, 0.0, 0.78, 1.05, 7.6, 24, 0, 0, Math.PI / 2);
  SP(g, mBody, 3.1, 0.82, 0.0, 0.8, 1.3, 0.95, 0.95);
  SP(g, mBody, -3.3, 0.82, 0.0, 0.56, 1.0, 0.72, 0.72);

  SP(g, mGlass, 1.7, 1.28, 0.0, 0.82, 1.55, 0.92, 0.94);

  BX(g, mDark, 0.3, 0.18, 0.0, 4.5, 0.20, 1.85);
  BX(g, mAccent, 0.3, 1.00, 0.0, 4.2, 0.05, 1.75);

  BX(g, mBody, 0.15, 0.92, 0.0, 0.42, 0.15, 8.6);
  BX(g, mAccent, 0.2, 1.02, 0.0, 0.08, 0.04, 8.55);

  BX(g, mMetal, 1.25, 0.88, 3.15, 2.2, 0.11, 0.12);
  BX(g, mMetal, 1.25, 0.88, -3.15, 2.2, 0.11, 0.12);
  BX(g, mMetal, -1.25, 0.88, 3.15, 2.2, 0.11, 0.12);
  BX(g, mMetal, -1.25, 0.88, -3.15, 2.2, 0.11, 0.12);
  BX(g, mMetal, -2.4, 0.90, 0.0, 1.9, 0.12, 0.20);

  BX(g, mBody, -3.7, 1.15, 0.0, 0.15, 1.45, 1.15);
  BX(g, mBody, -3.5, 1.05, 0.0, 0.95, 0.10, 2.4);

  BX(g, mSkid, 0.35, -0.52, 2.15, 4.8, 0.10, 0.10);
  BX(g, mSkid, 0.35, -0.52, -2.15, 4.8, 0.10, 0.10);
  BX(g, mSkid, 1.95, -0.20, 2.15, 0.10, 0.56, 0.10);
  BX(g, mSkid, 1.95, -0.20, -2.15, 0.10, 0.56, 0.10);
  BX(g, mSkid, -1.20, -0.20, 2.15, 0.10, 0.56, 0.10);
  BX(g, mSkid, -1.20, -0.20, -2.15, 0.10, 0.56, 0.10);

  BX(g, mDark, 2.6, -0.54, 2.15, 0.35, 0.06, 0.18);
  BX(g, mDark, 2.6, -0.54, -2.15, 0.35, 0.06, 0.18);
  BX(g, mDark, -1.9, -0.54, 2.15, 0.35, 0.06, 0.18);
  BX(g, mDark, -1.9, -0.54, -2.15, 0.35, 0.06, 0.18);

  const rotorDefs = [
    { x: 2.35, z: 3.25, dir: 1 },
    { x: 2.35, z: -3.25, dir: -1 },
    { x: -1.65, z: 3.25, dir: -1 },
    { x: -1.65, z: -3.25, dir: 1 }
  ];

  const rotors = [];
  rotorDefs.forEach(r => {
    CY(g, mDark, r.x, 1.20, r.z, 0.20, 0.20, 0.25, 14);

    const rg = new THREE.Group();
    rg.position.set(r.x, 1.38, r.z);

    for (let i = 0; i < 2; i++) {
      BX(rg, mRotor, 0, 0, 0, 2.55, 0.035, 0.18, 0, i * Math.PI / 2, 0);
    }

    const hub = new THREE.Mesh(
      new THREE.CylinderGeometry(0.08, 0.08, 0.08, 10),
      mDark
    );
    hub.rotation.z = Math.PI / 2;
    rg.add(hub);

    g.add(rg);
    rotors.push({ mesh: rg, dir: r.dir });
  });

  SP(g, M(0x00ff77, 0x00ff77, 0.7), 3.65, 0.98, 0.0, 0.08);
  SP(g, M(0xff4444, 0xff4444, 0.6), -3.55, 1.05, 0.0, 0.08);

  g.userData.rotors = rotors;
  return g;
}

const playerAircraft = createEVTOL(0xf2f4f7, 0x0077ee);
scene.add(playerAircraft);

/* ============================================================
   AI group
   ============================================================ */
const aiGroup = new THREE.Group();
scene.add(aiGroup);
const aiAircraft = [];

/* ============================================================
   State
   ============================================================ */
let MODE = "MENU";
let missionId = "m1";
let gameDone = false;

let score = 0;
let hits = 0;
let battery = 100;
const TOTAL_FLIGHT_TIME = 120;
let timeLeft = TOTAL_FLIGHT_TIME;

let wpDefs = [];
let currentWP = 0;
let wpPassed = 0;
let goalPos = new THREE.Vector3();
let chargePads = [];
let missionBuildingBoxes = [];
let freeBuildingCount = 0;

/* ============================================================
   Controls / flight
   ============================================================ */
const keys = {};
const mb = { L: false, R: false };
let dMX = 0;
let dMY = 0;

window.addEventListener("keydown", (e) => {
  keys[e.code] = true;
  if (e.code === "Space") e.preventDefault();
});

window.addEventListener("keyup", (e) => {
  keys[e.code] = false;
});

canvas.addEventListener("mousedown", (e) => {
  if (e.button === 0) mb.L = true;
  if (e.button === 2) mb.R = true;
});

window.addEventListener("mouseup", (e) => {
  if (e.button === 0) mb.L = false;
  if (e.button === 2) mb.R = false;
});

canvas.addEventListener("contextmenu", (e) => e.preventDefault());

window.addEventListener("mousemove", (e) => {
  dMX += (e.movementX || 0);
  dMY += (e.movementY || 0);
});

const vel = new THREE.Vector3();
let yaw = 0;
let cyclicPitch = 0;
let cyclicRoll = 0;
let desiredPitch = 0;
let desiredRoll = 0;
let thrustLvl = 0;
let camLift = 0;

window.addEventListener("keydown", (e) => {
  if (e.code === "KeyQ") camLift += 2;
  if (e.code === "KeyE") camLift -= 2;
  camLift = clamp(camLift, -20, 90);

  if (e.code === "KeyR") {
    if (MODE === "MISSION" || MODE === "FREE") {
      respawn();
    }
  }
});

const GRAVITY = 0.013;
const H_DRAG = 0.962;
const V_DRAG = 0.92;
const TILT_ACCEL = 0.078;
const THRUST_MAX = 0.024;
const CYCLIC_SMOOTH = 0.06;
const CYCLIC_MAX_P = 0.40;
const CYCLIC_MAX_R = 0.42;
const YAW_RATE = 0.018;
const PITCH_SENS = 0.0022;
const ROLL_SENS = 0.0022;

/* ============================================================
   Mobile controls
   ============================================================ */
const mobile = {
  enabled: false,
  ascend: false,
  descend: false,
  yawLeft: false,
  yawRight: false,
  brake: false,
  touchActive: false,
  touchX: 0,
  touchY: 0
};

function isMobileLike() {
  return window.matchMedia("(max-width: 1100px)").matches ||
    ("ontouchstart" in window) ||
    navigator.maxTouchPoints > 0;
}

function setBtnActive(el, active) {
  if (!el) return;
  el.classList.toggle("active", active);
}

function bindHoldButton(id, onChange) {
  const el = $(id);
  if (!el) return;

  const start = (e) => {
    e.preventDefault();
    onChange(true);
    setBtnActive(el, true);
  };

  const end = (e) => {
    e.preventDefault();
    onChange(false);
    setBtnActive(el, false);
  };

  el.addEventListener("touchstart", start, { passive: false });
  el.addEventListener("touchend", end, { passive: false });
  el.addEventListener("touchcancel", end, { passive: false });
  el.addEventListener("mousedown", start);
  el.addEventListener("mouseup", end);
  el.addEventListener("mouseleave", end);
}

function setupMobileButtons() {
  bindHoldButton("btnAscend", (v) => mobile.ascend = v);
  bindHoldButton("btnDescend", (v) => mobile.descend = v);
  bindHoldButton("btnYawLeft", (v) => mobile.yawLeft = v);
  bindHoldButton("btnYawRight", (v) => mobile.yawRight = v);
  bindHoldButton("btnBrake", (v) => mobile.brake = v);

  const resetBtn = $("btnReset");
  if (resetBtn) {
    const act = (e) => {
      e.preventDefault();
      if (MODE === "MISSION" || MODE === "FREE") respawn();
    };
    resetBtn.addEventListener("click", act);
    resetBtn.addEventListener("touchstart", act, { passive: false });
  }
}

function updateTouchDot(nx, ny) {
  const pad = $("touchPad");
  const dot = $("touchDot");
  if (!pad || !dot) return;

  const rect = pad.getBoundingClientRect();
  const px = ((nx + 1) * 0.5) * rect.width;
  const py = ((ny + 1) * 0.5) * rect.height;

  dot.style.left = `${px}px`;
  dot.style.top = `${py}px`;
}

function resetTouchPad() {
  mobile.touchActive = false;
  mobile.touchX = 0;
  mobile.touchY = 0;
  updateTouchDot(0, 0);
}

function setupTouchPad() {
  const pad = $("touchPad");
  if (!pad) return;

  const handlePoint = (clientX, clientY) => {
    const rect = pad.getBoundingClientRect();
    const x = ((clientX - rect.left) / rect.width) * 2 - 1;
    const y = ((clientY - rect.top) / rect.height) * 2 - 1;

    mobile.touchActive = true;
    mobile.touchX = clamp(x, -1, 1);
    mobile.touchY = clamp(y, -1, 1);
    updateTouchDot(mobile.touchX, mobile.touchY);
  };

  pad.addEventListener("touchstart", (e) => {
    e.preventDefault();
    const t = e.touches[0];
    if (!t) return;
    handlePoint(t.clientX, t.clientY);
  }, { passive: false });

  pad.addEventListener("touchmove", (e) => {
    e.preventDefault();
    const t = e.touches[0];
    if (!t) return;
    handlePoint(t.clientX, t.clientY);
  }, { passive: false });

  pad.addEventListener("touchend", (e) => {
    e.preventDefault();
    resetTouchPad();
  }, { passive: false });

  pad.addEventListener("touchcancel", (e) => {
    e.preventDefault();
    resetTouchPad();
  }, { passive: false });

  let mousePadDown = false;

  pad.addEventListener("mousedown", (e) => {
    e.preventDefault();
    mousePadDown = true;
    handlePoint(e.clientX, e.clientY);
  });

  window.addEventListener("mousemove", (e) => {
    if (!mousePadDown) return;
    handlePoint(e.clientX, e.clientY);
  });

  window.addEventListener("mouseup", () => {
    if (!mousePadDown) return;
    mousePadDown = false;
    resetTouchPad();
  });
}

function updateMobileVisibility() {
  mobile.enabled = isMobileLike();
  const ui = $("mobileUI");
  if (ui) {
    ui.style.display = mobile.enabled ? "flex" : "none";
  }
}

/* ============================================================
   Mission world
   ============================================================ */
function road(x1, z1, x2, z2, w = 6) {
  const dx = x2 - x1;
  const dz = z2 - z1;
  const len = Math.sqrt(dx * dx + dz * dz);
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(w, len),
    new THREE.MeshStandardMaterial({ color: 0x6f7276, roughness: 0.95 })
  );
  m.rotation.x = -Math.PI / 2;
  m.rotation.z = -Math.atan2(dz, dx) + Math.PI / 2;
  m.position.set((x1 + x2) / 2, 0.06, (z1 + z2) / 2);
  m.receiveShadow = true;
  missionWorld.add(m);
}

function buildPad(cx, cz, ringColor = 0xffffff) {
  const g = new THREE.Group();

  const base = new THREE.Mesh(
    new THREE.CylinderGeometry(12.5, 12.5, 0.45, 36),
    new THREE.MeshStandardMaterial({ color: 0x58697b, roughness: 0.85 })
  );
  base.position.set(0, 0.22, 0);
  base.receiveShadow = true;
  g.add(base);

  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(10.2, 0.42, 8, 40),
    new THREE.MeshStandardMaterial({
      color: ringColor,
      emissive: ringColor,
      emissiveIntensity: 0.22,
      roughness: 0.35
    })
  );
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.46;
  g.add(ring);

  g.position.set(cx, 0, cz);
  missionWorld.add(g);
  return g;
}

function buildMissionWorld(mId) {
  clearGroup(missionWorld);
  missionBuildingBoxes.length = 0;
  chargePads.length = 0;

  const grass = new THREE.Mesh(
    new THREE.PlaneGeometry(5200, 5200),
    new THREE.MeshStandardMaterial({ color: 0x79bf5a, roughness: 0.98 })
  );
  grass.rotation.x = -Math.PI / 2;
  grass.receiveShadow = true;
  missionWorld.add(grass);

  for (let i = -6; i <= 6; i++) {
    road(i * 26, -320, i * 26, 320, 5.5);
    road(-320, i * 26, 320, i * 26, 5.5);
  }
  road(-520, 0, 520, 0, 8);
  road(0, -520, 0, 520, 8);

  const startPad = { x: 0, z: 0 };
  const goalPad = (mId === "m2") ? { x: -240, z: 260 } : { x: 110, z: 310 };
  const chargePad = (mId === "m2") ? { x: -120, z: 120 } : { x: 90, z: 40 };

  buildPad(startPad.x, startPad.z, 0x00cfff);
  buildPad(goalPad.x, goalPad.z, 0xffd24a);
  buildPad(chargePad.x, chargePad.z, 0x44ff88);
  chargePads.push({ pos: new THREE.Vector3(chargePad.x, 0, chargePad.z), label: "充電パッド" });

  if (mId === "m1") {
    const shore = new THREE.Mesh(
      new THREE.CylinderGeometry(72, 72, 0.25, 40),
      new THREE.MeshStandardMaterial({ color: 0xd8bf89, roughness: 1.0 })
    );
    shore.position.set(goalPad.x, 0.12, goalPad.z);
    missionWorld.add(shore);

    const lake = new THREE.Mesh(
      new THREE.CylinderGeometry(62, 62, 0.5, 40),
      new THREE.MeshStandardMaterial({
        color: 0x49a9e6,
        transparent: true,
        opacity: 0.88,
        roughness: 0.16,
        metalness: 0.08
      })
    );
    lake.position.set(goalPad.x, 0.35, goalPad.z);
    missionWorld.add(lake);
  }

  const mountains = (mId === "m2")
    ? [[-120, 160, 80, 110, 0x6e8a62], [-40, 240, 60, 92, 0x7b956d], [-220, 240, 70, 100, 0x5d7553]]
    : [[230, 210, 60, 88, 0x6e8a62], [275, 165, 45, 68, 0x7b956d], [195, 268, 50, 74, 0x5d7553]];

  mountains.forEach(([x, z, r, h, c]) => {
    const m = new THREE.Mesh(
      new THREE.ConeGeometry(r, h, 10),
      new THREE.MeshStandardMaterial({ color: c, roughness: 0.98 })
    );
    m.position.set(x, h / 2, z);
    m.castShadow = true;
    m.receiveShadow = true;
    missionWorld.add(m);
  });

  function mkTree(x, z, s = 1) {
    const trunk = new THREE.Mesh(
      new THREE.CylinderGeometry(0.22 * s, 0.34 * s, 2.7 * s, 7),
      new THREE.MeshStandardMaterial({ color: 0x825d34, roughness: 1.0 })
    );
    trunk.position.set(x, 1.35 * s, z);
    trunk.castShadow = true;
    missionWorld.add(trunk);

    const crown = new THREE.Mesh(
      new THREE.ConeGeometry(1.7 * s, 4.0 * s, 8),
      new THREE.MeshStandardMaterial({ color: 0x2f8f36, roughness: 0.95 })
    );
    crown.position.set(x, 5.1 * s, z);
    crown.castShadow = true;
    missionWorld.add(crown);
  }

  for (let i = 0; i < 220; i++) {
    const x = rng(-560, 560);
    const z = rng(-560, 560);
    if (Math.sqrt(x * x + z * z) < 120) continue;
    mkTree(x, z, rng(0.85, 1.6));
  }

  const cityPal = [0xe0d0c0, 0xd3c0aa, 0xeedfcf, 0xc7d5e3, 0xbfcfdd, 0xd8d7bf];
  function mkBuilding(x, z, w, d, h, col) {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(w, h, d),
      new THREE.MeshStandardMaterial({ color: col, roughness: 0.9, metalness: 0.03 })
    );
    mesh.position.set(x, h / 2, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    missionWorld.add(mesh);

    missionBuildingBoxes.push(new THREE.Box3(
      new THREE.Vector3(x - w / 2, 0, z - d / 2),
      new THREE.Vector3(x + w / 2, h + 1, z + d / 2)
    ));
  }

  for (let i = 0; i < 180; i++) {
    const x = rng(-260, 360);
    const z = rng(-260, 420);
    const rad = Math.sqrt(x * x + z * z);
    if (rad < 140) continue;
    const inCore = rad < 240;
    mkBuilding(
      x, z,
      inCore ? rng(8, 19) : rng(5, 12),
      inCore ? rng(8, 19) : rng(5, 12),
      inCore ? rng(15, 64) : rng(6, 20),
      cityPal[(Math.random() * cityPal.length) | 0]
    );
  }

  return { startPad, goalPad, chargePad };
}

/* ============================================================
   WP visuals
   ============================================================ */
const wpMeshes = [];

function clearWPMeshes() {
  wpMeshes.forEach(m => {
    if (m.torus) missionWorld.remove(m.torus);
    if (m.dot) missionWorld.remove(m.dot);
  });
  wpMeshes.length = 0;
}

function createWPRing(pos, color) {
  const torus = new THREE.Mesh(
    new THREE.TorusGeometry(7, 0.72, 12, 36),
    new THREE.MeshStandardMaterial({
      color,
      emissive: color,
      emissiveIntensity: 0.35,
      transparent: true,
      opacity: 0.92
    })
  );
  torus.rotation.x = Math.PI / 2;
  torus.position.copy(pos);
  missionWorld.add(torus);

  const dot = new THREE.Mesh(
    new THREE.SphereGeometry(1.2, 10, 8),
    new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.55 })
  );
  dot.position.set(pos.x, pos.y + 11, pos.z);
  missionWorld.add(dot);

  return { torus, dot };
}

/* ============================================================
   Setup mission / free
   ============================================================ */
function setupMission(mId) {
  MODE = "MISSION";
  missionId = mId;
  gameDone = false;

  if ($("titleScr")) $("titleScr").classList.add("hide");

  missionWorld.visible = true;
  freeWorld.visible = false;
  groundMesh.visible = false;

  const { startPad, goalPad, chargePad } = buildMissionWorld(mId);
  clearWPMeshes();

  wpDefs = (mId === "m2")
    ? [
        {
          pos: new THREE.Vector3(-30, 36, -90),
          label: "WP1",
          info: ["⚡ eVTOLって？", "電気で飛ぶ乗りもの。"]
        },
        {
          pos: new THREE.Vector3(-120, 28, 120),
          label: "CHARGE",
          info: ["🔋 充電", "充電パッドに着陸しよう。"],
          isCharge: true,
          padPos: new THREE.Vector3(chargePad.x, 0, chargePad.z)
        },
        {
          pos: new THREE.Vector3(-240, 60, 210),
          label: "WP2",
          info: ["🌬 山の風", "山の近くは風が変わりやすい。"]
        },
        {
          pos: new THREE.Vector3(goalPad.x, 25, goalPad.z),
          label: "GOAL",
          info: ["🏁 ゴール", "やさしく着陸しよう。"]
        }
      ]
    : [
        {
          pos: new THREE.Vector3(0, 40, -110),
          label: "WP1",
          info: ["⚡ eVTOLって？", "電気モーターで飛ぶ。"]
        },
        {
          pos: new THREE.Vector3(90, 28, 40),
          label: "CHARGE",
          info: ["🔋 充電", "途中充電が大事。"],
          isCharge: true,
          padPos: new THREE.Vector3(chargePad.x, 0, chargePad.z)
        },
        {
          pos: new THREE.Vector3(178, 40, 125),
          label: "WP2",
          info: ["🛤 ルート", "安全な飛行経路を考える。"]
        },
        {
          pos: new THREE.Vector3(goalPad.x, 25, goalPad.z),
          label: "GOAL",
          info: ["🏁 ゴール", "速度を落として着陸。"]
        }
      ];

  wpDefs.forEach((wp, i) => {
    const col = wp.isCharge ? 0x44ff88 : (i === wpDefs.length - 1 ? 0xffd24a : 0x00d5ff);
    wpMeshes.push(createWPRing(wp.pos, col));
  });

  currentWP = 0;
  wpPassed = 0;
  goalPos.set(goalPad.x, 0, goalPad.z);

  score = 0;
  hits = 0;
  battery = 100;
  timeLeft = TOTAL_FLIGHT_TIME;

  respawn(startPad.x, startPad.z, 8);
  setupAIForMission();
}

let freeOriginLon = 139.767125;
let freeOriginLat = 35.681236;

function setupFreeFlight(lon, lat) {
  MODE = "FREE";
  gameDone = false;

  if ($("titleScr")) $("titleScr").classList.add("hide");

  missionWorld.visible = false;
  freeWorld.visible = true;
  groundMesh.visible = true;

  groundStyle = $("groundStyle") ? $("groundStyle").value : "osm";
  groundOriginLon = lon;
  groundOriginLat = lat;
  freeOriginLon = lon;
  freeOriginLat = lat;

  lastTileUpdateAt.set(1e9, 1e9);
  redrawGroundTiles(lon, lat);

  clearBuildings();
  freeBuildingCount = 0;

  score = 0;
  hits = 0;
  battery = 100;
  timeLeft = TOTAL_FLIGHT_TIME;

  respawn(0, 0, 12);
  setupAIForFree();
}

/* ============================================================
   Free flight buildings
   ============================================================ */
const freeBuildings = new THREE.Group();
freeWorld.add(freeBuildings);

function clearBuildings() {
  clearGroup(freeBuildings);
}

function parseHeight(tags) {
  let h = 0;
  if (tags.height) {
    const v = String(tags.height).replace("m", "").trim();
    const n = Number(v);
    if (Number.isFinite(n)) h = n;
  }
  if (!h && tags["building:levels"]) {
    const lv = Number(tags["building:levels"]);
    if (Number.isFinite(lv)) h = lv * 3.2;
  }
  if (!h) h = 8 + Math.random() * 14;
  return clamp(h, 4, 120);
}

function buildExtrudedPolygon(pointsLocal, height, color) {
  if (pointsLocal.length < 3) return;

  const shape = new THREE.Shape();
  shape.moveTo(pointsLocal[0].x, pointsLocal[0].z);
  for (let i = 1; i < pointsLocal.length; i++) {
    shape.lineTo(pointsLocal[i].x, pointsLocal[i].z);
  }
  shape.lineTo(pointsLocal[0].x, pointsLocal[0].z);

  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: height,
    bevelEnabled: false
  });
  geo.rotateX(-Math.PI / 2);

  const mat = new THREE.MeshStandardMaterial({
    color,
    transparent: true,
    opacity: 0.95,
    roughness: 0.88,
    metalness: 0.04
  });

  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  freeBuildings.add(mesh);
}

async function geocodePlace(q) {
  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(q)}`;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error("geocode failed");
  const js = await res.json();
  if (!js || !js.length) return null;
  return {
    lat: Number(js[0].lat),
    lon: Number(js[0].lon),
    display: js[0].display_name
  };
}

async function fetchBuildingsOverpass(centerLon, centerLat, radiusM) {
  radiusM = clamp(radiusM, 200, 3000);
  const q = `
  [out:json][timeout:25];
  (
    way["building"](around:${Math.round(radiusM)},${centerLat},${centerLon});
    relation["building"](around:${Math.round(radiusM)},${centerLat},${centerLon});
  );
  out body;
  >;
  out skel qt;`;

  const url = "https://overpass-api.de/api/interpreter";
  const res = await fetch(url, {
    method: "POST",
    body: q,
    headers: { "Content-Type": "text/plain;charset=UTF-8" }
  });
  if (!res.ok) throw new Error("overpass error");
  return await res.json();
}

function overpassToMeshes(data, centerLon, centerLat) {
  const nodes = new Map();
  for (const el of data.elements) {
    if (el.type === "node") nodes.set(el.id, { lon: el.lon, lat: el.lat });
  }

  let count = 0;
  const pal = [0xe7ddc8, 0xd8d0c0, 0xcfd8df, 0xe6d4b8, 0xd4c8a0];

  for (const el of data.elements) {
    if (el.type === "way" && el.nodes && el.tags && el.tags.building) {
      const pts = [];
      for (const nid of el.nodes) {
        const n = nodes.get(nid);
        if (!n) continue;
        const { dx, dz } = lonLatToLocalMeters(n.lon, n.lat, centerLon, centerLat);
        pts.push({ x: dx, z: dz });
      }

      if (pts.length >= 3) {
        const h = parseHeight(el.tags);
        buildExtrudedPolygon(pts, h, pal[count % pal.length]);
        count++;
      }
      if (count > 900) break;
    }
  }
  return count;
}

/* ============================================================
   AI aircraft
   ============================================================ */
function clearAI() {
  aiAircraft.length = 0;
  clearGroup(aiGroup);
}

function setupAIForMission() {
  clearAI();
  for (let i = 0; i < 4; i++) {
    const ai = createEVTOL(0xe7ebf0, 0xff5555);
    ai.position.set(rng(-180, 220), 20 + rng(0, 20), rng(-180, 260));
    ai.userData = {
      speed: rng(0.25, 0.55),
      yaw: rng(0, Math.PI * 2),
      t: rng(0, 100),
      rotors: ai.userData.rotors
    };
    aiGroup.add(ai);
    aiAircraft.push(ai);
  }
}

function setupAIForFree() {
  clearAI();
  for (let i = 0; i < 4; i++) {
    const ai = createEVTOL(0xe7ebf0, 0xff5555);
    ai.position.set(rng(-250, 250), 30 + rng(0, 30), rng(-250, 250));
    ai.userData = {
      speed: rng(0.28, 0.65),
      yaw: rng(0, Math.PI * 2),
      t: rng(0, 100),
      rotors: ai.userData.rotors
    };
    aiGroup.add(ai);
    aiAircraft.push(ai);
  }
}

function updateAI(dt) {
  for (const ai of aiAircraft) {
    ai.userData.t += dt;
    const turn = 0.35 * Math.sin(ai.userData.t * 0.7);
    ai.userData.yaw += turn * dt;

    const dirX = Math.cos(ai.userData.yaw);
    const dirZ = Math.sin(ai.userData.yaw);

    ai.position.x += dirX * ai.userData.speed * dt * 60;
    ai.position.z += dirZ * ai.userData.speed * dt * 60;
    ai.position.y = clamp(ai.position.y + 0.25 * Math.sin(ai.userData.t * 1.6) * dt, 18, 72);

    ai.rotation.order = "YXZ";
    ai.rotation.y = -ai.userData.yaw + Math.PI;

    ai.userData.rotors?.forEach(r => {
      r.mesh.rotation.y += r.dir * 0.26;
    });
  }
}

/* ============================================================
   Battery
   ============================================================ */
function updateBattery(dt) {
  const hs = Math.sqrt(vel.x * vel.x + vel.z * vel.z);

  let consumption = 0.0;
  const isHover = hs < 0.10 && playerAircraft.position.y > 1.2;
  const isFast = hs > 0.85;

  if (isHover) consumption = 0.78;
  else if (isFast) consumption = 0.78;
  else if (hs > 0.35) consumption = 0.62;
  else consumption = 0.48;

  if (keys["Space"] || mobile.ascend) consumption += 0.18;

  let charging = false;
  if (MODE === "MISSION") {
    for (const p of chargePads) {
      const dx = playerAircraft.position.x - p.pos.x;
      const dz = playerAircraft.position.z - p.pos.z;
      const dd = Math.sqrt(dx * dx + dz * dz);
      if (dd < 13 && playerAircraft.position.y < 4.2) {
        charging = true;
        battery += 22 * dt;
        battery = clamp(battery, 0, 100);
        break;
      }
    }
  }

  if (!charging) {
    battery -= consumption * dt;
    battery = clamp(battery, 0, 100);
  }

  updateBatteryUI(battery);

  if (battery <= 0) {
    battery = 0;
    thrustLvl = Math.min(thrustLvl, 0.22);
  }
}

/* ============================================================
   HUD
   ============================================================ */
function updateHUD() {
  const hs = Math.sqrt(vel.x * vel.x + vel.z * vel.z);

  if ($("alt")) $("alt").textContent = `${Math.max(0, Math.round(playerAircraft.position.y - 0.7))} m`;
  if ($("spd")) $("spd").textContent = `${Math.round(hs * 250)} km/h`;

  const elapsed = TOTAL_FLIGHT_TIME - timeLeft;
  const em = Math.floor(elapsed / 60);
  const es = Math.floor(elapsed % 60);
  if ($("timeText")) $("timeText").textContent = `${em}:${es < 10 ? "0" : ""}${es}`;

  if ($("wpText")) {
    if (MODE === "MISSION") $("wpText").textContent = `${wpPassed}/${wpDefs.length}`;
    else $("wpText").textContent = "-/-";
  }

  updateBatteryUI(battery);
}

/* ============================================================
   Nav arrow
   ============================================================ */
function updateNavArrow() {
  if (!$("navArrow") || !$("navLabel")) return;

  let targetPos = null;
  let label = "NEXT";

  if (MODE === "MISSION") {
    if (battery < 20 && chargePads.length) {
      let nearest = null;
      let minD = 1e9;
      for (const p of chargePads) {
        const d = playerAircraft.position.distanceTo(p.pos);
        if (d < minD) {
          minD = d;
          nearest = p;
        }
      }
      if (nearest) {
        targetPos = nearest.pos;
        label = "CHARGE";
      }
    } else if (currentWP < wpDefs.length) {
      targetPos = wpDefs[currentWP].pos;
      label = wpDefs[currentWP].label;
    } else {
      targetPos = goalPos;
      label = "GOAL";
    }
  } else if (MODE === "FREE") {
    $("navLabel").textContent = "FREE";
    $("navArrow").style.transform = `rotate(0deg)`;
    return;
  } else {
    return;
  }

  if (!targetPos) return;

  const dx = targetPos.x - playerAircraft.position.x;
  const dz = targetPos.z - playerAircraft.position.z;
  const targetAngle = Math.atan2(dx, dz);
  const rel = targetAngle - yaw;

  $("navArrow").style.transform = `rotate(${rel * 180 / Math.PI}deg)`;
  $("navLabel").textContent = label;
}

/* ============================================================
   Respawn
   ============================================================ */
function respawn(x = 0, z = 0, y = 8) {
  playerAircraft.position.set(x, y, z);
  playerAircraft.rotation.set(0, 0, 0);
  vel.set(0, 0, 0);
  yaw = 0;
  cyclicPitch = 0;
  cyclicRoll = 0;
  desiredPitch = 0;
  desiredRoll = 0;
  thrustLvl = 0;
  resetTouchPad();
}

/* ============================================================
   UI events
   ============================================================ */
if ($("startMissionBtn")) {
  $("startMissionBtn").addEventListener("click", () => {
    setupMission("m1");
  });
}

if ($("startFreeBtn")) {
  $("startFreeBtn").addEventListener("click", () => {
    const lat = Number($("lat")?.value) || 35.681236;
    const lon = Number($("lon")?.value) || 139.767125;
    setupFreeFlight(lon, lat);
  });
}

if ($("searchBtn")) {
  $("searchBtn").addEventListener("click", async () => {
    const q = $("place")?.value?.trim();
    if (!q) return;
    try {
      const r = await geocodePlace(q);
      if (!r) return;
      if ($("lat")) $("lat").value = r.lat.toFixed(6);
      if ($("lon")) $("lon").value = r.lon.toFixed(6);
      if (miniMap) miniMap.jumpTo({ center: [r.lon, r.lat], zoom: 15 });
    } catch (err) {
      console.error(err);
    }
  });
}

if ($("loadFreeBtn")) {
  $("loadFreeBtn").addEventListener("click", async () => {
    const lat = Number($("lat")?.value);
    const lon = Number($("lon")?.value);
    const radius = Number($("radius")?.value || 900);

    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;

    setupFreeFlight(lon, lat);

    try {
      const data = await fetchBuildingsOverpass(lon, lat, radius);
      freeBuildingCount = overpassToMeshes(data, lon, lat);
    } catch (err) {
      console.error(err);
      freeBuildingCount = 0;
    }
  });
}

/* ============================================================
   Main animation
   ============================================================ */
let lastTS = performance.now();

function animate() {
  requestAnimationFrame(animate);

  const now = performance.now();
  const dt = Math.min((now - lastTS) / 1000, 0.05);
  lastTS = now;

  playerAircraft.userData.rotors.forEach(r => {
    r.mesh.rotation.y += r.dir * 0.30;
  });

  renderer.render(scene, camera);

  if (MODE === "MENU") {
    updateHUD();
    return;
  }

  timeLeft = Math.max(0, timeLeft - dt);

  updateAI(dt);
  updateBattery(dt);

  /* PC mouse control */
  desiredPitch += dMY * PITCH_SENS;
  desiredRoll += dMX * ROLL_SENS;
  dMX = 0;
  dMY = 0;

  /* Mobile touch pad control */
  if (mobile.enabled) {
    desiredPitch += mobile.touchY * 0.012;
    desiredRoll += mobile.touchX * 0.012;
  }

  desiredPitch = clamp(desiredPitch, -CYCLIC_MAX_P, CYCLIC_MAX_P);
  desiredRoll = clamp(desiredRoll, -CYCLIC_MAX_R, CYCLIC_MAX_R);

  cyclicPitch += (desiredPitch - cyclicPitch) * CYCLIC_SMOOTH;
  cyclicRoll += (desiredRoll - cyclicRoll) * CYCLIC_SMOOTH;

  if (mb.L || mobile.yawLeft) yaw += YAW_RATE * dt * 60;
  if (mb.R || mobile.yawRight) yaw -= YAW_RATE * dt * 60;

  if (keys["Space"] || mobile.ascend) {
    thrustLvl = Math.min(1, thrustLvl + 0.055);
  } else if (keys["ShiftLeft"] || keys["ShiftRight"] || mobile.descend) {
    thrustLvl = Math.max(0, thrustLvl - 0.075);
  } else {
    thrustLvl = Math.max(0, thrustLvl - 0.028);
  }

  const sinY = Math.sin(yaw);
  const cosY = Math.cos(yaw);

  vel.x += (-sinY) * (-cyclicPitch) * TILT_ACCEL + (cosY) * cyclicRoll * TILT_ACCEL;
  vel.z += (-cosY) * (-cyclicPitch) * TILT_ACCEL + (-sinY) * cyclicRoll * TILT_ACCEL;

  const hs = Math.sqrt(vel.x * vel.x + vel.z * vel.z);
  const tiltMag = Math.sqrt(cyclicPitch * cyclicPitch + cyclicRoll * cyclicRoll);
  const highSpeedSink = hs > 1.0 ? (hs - 1.0) * 0.012 : 0;

  vel.y += thrustLvl * THRUST_MAX * Math.cos(tiltMag) - GRAVITY - highSpeedSink;

  vel.x *= H_DRAG;
  vel.z *= H_DRAG;
  vel.y *= V_DRAG;

  if (mobile.brake) {
    vel.x *= 0.92;
    vel.z *= 0.92;
    desiredPitch *= 0.94;
    desiredRoll *= 0.94;
  }

  const maxHs = 1.65;
  const horiz = Math.sqrt(vel.x * vel.x + vel.z * vel.z);
  if (horiz > maxHs) {
    vel.x = vel.x / horiz * maxHs;
    vel.z = vel.z / horiz * maxHs;
  }

  playerAircraft.position.x += vel.x;
  playerAircraft.position.y += vel.y;
  playerAircraft.position.z += vel.z;

  if (playerAircraft.position.y < 0.9) {
    playerAircraft.position.y = 0.9;
    if (vel.y < 0) vel.y = 0;
  }

  playerAircraft.rotation.order = "YXZ";
  playerAircraft.rotation.y = yaw + Math.PI / 2;
  playerAircraft.rotation.x = cyclicPitch * 0.72;
  playerAircraft.rotation.z = -cyclicRoll * 0.86;

  if (MODE === "MISSION") {
    if (currentWP < wpDefs.length) {
      const wp = wpDefs[currentWP];
      const dist = playerAircraft.position.distanceTo(wp.pos);

      if (wp.isCharge) {
        const pdx = playerAircraft.position.x - wp.padPos.x;
        const pdz = playerAircraft.position.z - wp.padPos.z;
        const pdist = Math.sqrt(pdx * pdx + pdz * pdz);

        if (pdist < 13 && playerAircraft.position.y < 4.2 && battery > 55) {
          wpPassed++;
          currentWP++;
          showInfo(wp.info[0], wp.info[1]);
        }
      } else {
        if (dist < 9) {
          wpPassed++;
          currentWP++;
          showInfo(wp.info[0], wp.info[1]);
        }
      }
    } else {
      const dx = playerAircraft.position.x - goalPos.x;
      const dz = playerAircraft.position.z - goalPos.z;
      const landDist = Math.sqrt(dx * dx + dz * dz);

      if (landDist < 13 && playerAircraft.position.y < 4.5) {
        MODE = "MENU";
        if ($("titleScr")) $("titleScr").classList.remove("hide");
      }
    }
  }

  if (MODE === "FREE") {
    updateGroundUnderAircraft(playerAircraft.position.x, playerAircraft.position.z);
    const ll = localMetersToLonLat(
      playerAircraft.position.x,
      playerAircraft.position.z,
      freeOriginLon,
      freeOriginLat
    );
    updateMiniMapPlayer(ll.lon, ll.lat);
  } else {
    const ll = localMetersToLonLat(
      playerAircraft.position.x,
      playerAircraft.position.z,
      139.767125,
      35.681236
    );
    updateMiniMapPlayer(ll.lon, ll.lat);
  }

  const followDist = 24;
  const tcx = playerAircraft.position.x + Math.sin(yaw) * followDist;
  const tcy = playerAircraft.position.y + 9 + camLift;
  const tcz = playerAircraft.position.z + Math.cos(yaw) * followDist;

  camera.position.x += (tcx - camera.position.x) * 0.07;
  camera.position.y += (tcy - camera.position.y) * 0.07;
  camera.position.z += (tcz - camera.position.z) * 0.07;
  camera.lookAt(
    playerAircraft.position.x,
    playerAircraft.position.y + 1.25,
    playerAircraft.position.z
  );

  updateNavArrow();
  updateHUD();
}

window.addEventListener("resize", () => {
  renderer.setSize(window.innerWidth, window.innerHeight);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  updateMobileVisibility();
});

/* iOSなどでスクロール抑止 */
document.addEventListener("touchmove", (e) => {
  const allow = e.target.closest("#miniWrap, #miniMap, input, select, button, #touchPad");
  if (!allow) e.preventDefault();
}, { passive: false });

/* ============================================================
   Boot
   ============================================================ */
function boot() {
  if ($("lat")) $("lat").value = "35.681236";
  if ($("lon")) $("lon").value = "139.767125";

  initMiniMap(139.767125, 35.681236);

  MODE = "MENU";
  missionWorld.visible = false;
  freeWorld.visible = false;
  groundMesh.visible = false;

  clearAI();
  respawn(0, 0, 8);
  updateBatteryUI(100);

  setupMobileButtons();
  setupTouchPad();
  updateMobileVisibility();

  animate();
}

boot();