// 3D-робот слева от чата (Three.js). Он «носит» сообщения: забирает копию вопроса,
// идёт к стеллажу, листает бумаги, возвращается и отдаёт ответ в чат.
// Связь с app.js — только через события:
//   robot:search {from, text, accepted} — вопрос отправлен; робот ставит accepted = true,
//                                         если сам принесёт ответ;
//   robot:result {found, text, target, deliver} — ответ сервера готов; робот вызывает deliver(),
//                                         когда отдаёт карточку (app.js подстрахует таймером).
// Робот собран из простых фигур прямо в коде — файлов моделей нет.

const WIDE = window.matchMedia("(min-width: 1280px)");          // на узком экране и телефоне робота нет
const REDUCED = window.matchMedia("(prefers-reduced-motion: reduce)");
const stage = document.getElementById("robot-stage");
const canvas = document.getElementById("robot-canvas");

let robot = null;
let loading = false;

// Three.js (~700 КБ) грузим, только когда экран широкий.
async function start() {
  if (!stage || !canvas) return;
  robot?.setActive(WIDE.matches);
  if (robot || loading || !WIDE.matches) return;
  loading = true;
  try {
    const THREE = await import("three");
    const { RoundedBoxGeometry } = await import("/static/vendor/RoundedBoxGeometry.js");
    const { RoomEnvironment } = await import("/static/vendor/RoomEnvironment.js");
    robot = createRobotScene(THREE, RoundedBoxGeometry, RoomEnvironment);
    robot.setActive(WIDE.matches);
  } catch (err) {
    console.warn("Робот не загрузился, чат работает без него:", err);
    stage.hidden = true;
  } finally {
    loading = false;
  }
}

WIDE.addEventListener("change", start);
window.addEventListener("robot:search", (e) => robot?.search(e.detail));
window.addEventListener("robot:result", (e) => robot?.result(e.detail));
start();

function createRobotScene(THREE, RoundedBoxGeometry, RoomEnvironment) {
  // ---------- Рендер, камера, свет ----------
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.55;

  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 60);
  const LOOK = new THREE.Vector3(0, 0.82, -0.7);

  scene.add(new THREE.HemisphereLight(0xc4d4ff, 0x0b1020, 0.7));
  const key = new THREE.DirectionalLight(0xffffff, 1.7);
  key.position.set(2.4, 5, 3.6);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  Object.assign(key.shadow.camera, { left: -3, right: 3, top: 3, bottom: -3, near: 0.5, far: 16 });
  key.shadow.radius = 5;
  key.shadow.normalBias = 0.02;
  scene.add(key);
  // Цветная подсветка контура — в тон неоновой палитре сайта
  const rimCyan = new THREE.PointLight(0x00ffff, 7, 9, 2);
  rimCyan.position.set(-2.3, 2.3, -1.3);
  const rimPink = new THREE.PointLight(0xff77ff, 6, 9, 2);
  rimPink.position.set(2.3, 1.7, -0.4);
  scene.add(rimCyan, rimPink);

  // ---------- Материалы и текстуры ----------
  const M = {
    shell: new THREE.MeshPhysicalMaterial({
      color: 0xc6cee2, metalness: 0.25, roughness: 0.3, clearcoat: 0.7, clearcoatRoughness: 0.2,
    }),
    joint: new THREE.MeshStandardMaterial({ color: 0x232a42, metalness: 0.75, roughness: 0.32 }),
    visor: new THREE.MeshPhysicalMaterial({ color: 0x04060d, metalness: 0.3, roughness: 0.06, clearcoat: 1 }),
    eye: new THREE.MeshBasicMaterial({ color: 0x00ffff, toneMapped: false }),
    pink: new THREE.MeshBasicMaterial({ color: 0xff77ff, toneMapped: false }),
    // логотип на груди: текстура появится, когда загрузится logo.svg
    core: new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, toneMapped: false, depthWrite: false }),
    cabinet: new THREE.MeshStandardMaterial({ color: 0x1a2033, metalness: 0.35, roughness: 0.55 }),
    cabinetBack: new THREE.MeshStandardMaterial({ color: 0x111628, roughness: 0.9 }),
    handle: new THREE.MeshStandardMaterial({ color: 0x9aa3bd, metalness: 0.9, roughness: 0.25 }),
    folder: new THREE.MeshStandardMaterial({ color: 0x34477e, roughness: 0.5 }),
    page: new THREE.MeshStandardMaterial({ map: paperTexture(), roughness: 0.85, side: THREE.DoubleSide }),
  };

  function canvasTexture(c) {
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    return t;
  }

  function paperTexture() {
    const c = document.createElement("canvas");
    c.width = 256;
    c.height = 352;
    const g = c.getContext("2d");
    g.fillStyle = "#eef1f8";
    g.fillRect(0, 0, 256, 352);
    g.fillStyle = "#1d2338";
    g.fillRect(24, 26, 150, 13);
    g.fillStyle = "#9aa3bd";
    for (let i = 0; i < 11; i++) g.fillRect(24, 66 + i * 24, i % 4 === 3 ? 120 : 208 - ((i * 37) % 44), 7);
    return canvasTexture(c);
  }

  // logo.svg рисуем на холст (квадрат 512×512, логотип вписан по высоте) и делаем из него текстуру
  function loadLogo() {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement("canvas");
      c.width = c.height = 512;
      const g = c.getContext("2d");
      const h = 470;
      const w = (h * 920) / 1092;                // пропорции viewBox логотипа
      g.drawImage(img, (512 - w) / 2, (512 - h) / 2, w, h);
      M.core.map = canvasTexture(c);
      M.core.opacity = 1;
      M.core.needsUpdate = true;
    };
    img.src = "/static/img/logo.svg";
  }

  function radialTexture(stops) {
    const c = document.createElement("canvas");
    c.width = c.height = 256;
    const g = c.getContext("2d");
    const grad = g.createRadialGradient(128, 128, 0, 128, 128, 128);
    stops.forEach(([at, color]) => grad.addColorStop(at, color));
    g.fillStyle = grad;
    g.fillRect(0, 0, 256, 256);
    return canvasTexture(c);
  }

  // Карточка сообщения в руках робота: на ней настоящий текст вопроса или ответа.
  const cardCanvas = document.createElement("canvas");
  cardCanvas.width = 512;
  cardCanvas.height = 320;
  const cardTex = canvasTexture(cardCanvas);
  function drawCard(kind, text) {
    const g = cardCanvas.getContext("2d");
    const W = cardCanvas.width, H = cardCanvas.height;
    g.clearRect(0, 0, W, H);
    g.beginPath();
    g.roundRect(6, 6, W - 12, H - 12, 34);
    g.fillStyle = kind === "question" ? "#1d2338" : "#151a2b";
    g.fill();
    if (kind === "answer") {                 // найденный ответ — неоновая рамка, как у активных элементов
      const grad = g.createLinearGradient(0, 0, W, 0);
      grad.addColorStop(0, "#00ffff");
      grad.addColorStop(1, "#ff77ff");
      g.strokeStyle = grad;
      g.lineWidth = 10;
    } else {
      g.strokeStyle = "#3a4466";
      g.lineWidth = 6;
    }
    g.stroke();
    g.fillStyle = kind === "question" ? "#e6e9f2" : "#c9d0e3";
    g.font = "600 40px system-ui, 'Segoe UI', sans-serif";
    const words = String(text || "").replace(/\s+/g, " ").trim().split(" ");
    const lines = [];
    let line = "";
    for (const w of words) {
      const next = line ? `${line} ${w}` : w;
      if (g.measureText(next).width > W - 80 && line) {
        lines.push(line);
        line = w;
        if (lines.length === 4) break;
      } else line = next;
    }
    if (lines.length < 4 && line) lines.push(line);
    if (words.join(" ").length > lines.join(" ").length) lines[lines.length - 1] += "…";
    lines.forEach((l, i) => g.fillText(l, 40, 78 + i * 56));
    cardTex.needsUpdate = true;
  }

  // ---------- Помощники для сборки ----------
  const mesh = (geo, mat) => {
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = true;
    m.receiveShadow = true;
    return m;
  };
  const rbox = (w, h, d, r, mat) => mesh(new RoundedBoxGeometry(w, h, d, 4, r), mat);
  const box = (w, h, d, mat) => mesh(new THREE.BoxGeometry(w, h, d), mat);
  const capsule = (r, len, mat) => mesh(new THREE.CapsuleGeometry(r, len, 6, 18), mat);
  const sphere = (r, mat) => mesh(new THREE.SphereGeometry(r, 28, 18), mat);
  const cylinder = (r1, r2, h, mat) => mesh(new THREE.CylinderGeometry(r1, r2, h, 28), mat);
  const group = (parent, x = 0, y = 0, z = 0) => {
    const g = new THREE.Group();
    g.position.set(x, y, z);
    parent.add(g);
    return g;
  };
  const place = (obj, parent, x = 0, y = 0, z = 0) => {
    obj.position.set(x, y, z);
    parent.add(obj);
    return obj;
  };

  // ---------- Пол ----------
  const HOME = new THREE.Vector3(0, 0, 0.55);
  const CABINET = new THREE.Vector3(0.35, 0, -2.3);
  const CABINET_FRONT = new THREE.Vector3(0.3, 0, -1.55);

  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(2.6, 64),
    new THREE.MeshBasicMaterial({
      // мягкое пятно света на полу, к краям растворяется в фоне страницы
      map: radialTexture([[0, "rgba(34,41,66,0.75)"], [0.5, "rgba(21,26,43,0.4)"], [1, "rgba(11,16,32,0)"]]),
      transparent: true, depthWrite: false,
    }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.z = -0.8;
  scene.add(floor);
  const shadowCatcher = new THREE.Mesh(new THREE.PlaneGeometry(9, 9), new THREE.ShadowMaterial({ opacity: 0.4 }));
  shadowCatcher.rotation.x = -Math.PI / 2;
  shadowCatcher.position.y = 0.001;
  shadowCatcher.receiveShadow = true;
  scene.add(shadowCatcher);
  // «Место» робота — спокойное кольцо цвета рамок
  const spot = new THREE.Mesh(
    new THREE.RingGeometry(0.4, 0.43, 64),
    new THREE.MeshBasicMaterial({ color: 0x3a4466, transparent: true, opacity: 0.8 }),
  );
  spot.rotation.x = -Math.PI / 2;
  spot.position.set(HOME.x, 0.003, HOME.z);
  scene.add(spot);

  // ---------- Стеллаж с документами ----------
  const cabinet = group(scene, CABINET.x, 0, CABINET.z);
  const CW = 1.15, CH = 1.75, CD = 0.42;
  place(box(CW, CH, 0.03, M.cabinetBack), cabinet, 0, CH / 2, -CD / 2 + 0.015);
  for (const sx of [-1, 1]) place(rbox(0.05, CH, CD, 0.015, M.cabinet), cabinet, sx * (CW / 2 - 0.025), CH / 2, 0);
  place(rbox(CW, 0.05, CD + 0.02, 0.015, M.cabinet), cabinet, 0, CH - 0.025, 0);
  for (let i = 0; i < 2; i++) {                 // внизу — ящики с ручками
    const y = 0.17 + i * 0.3;
    place(rbox(CW - 0.12, 0.27, 0.04, 0.012, M.cabinet), cabinet, 0, y, CD / 2 - 0.02);
    place(rbox(0.22, 0.03, 0.03, 0.01, M.handle), cabinet, 0, y + 0.05, CD / 2 + 0.01);
  }
  const binderColors = [0x34406a, 0x4a3d6b, 0x2c5266, 0x5a6380, 0x3d4a5c, 0x2f3a5e];
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const labelMat = new THREE.MeshStandardMaterial({ color: 0xdfe4f0, roughness: 0.9 });
  [0.62, 1.0, 1.38].forEach((shelfY, row) => {   // полки с папками
    place(rbox(CW - 0.1, 0.035, CD - 0.03, 0.01, M.cabinet), cabinet, 0, shelfY, 0);
    let x = -CW / 2 + 0.09;
    const end = row === 1 ? 0.15 : CW / 2 - 0.09;
    while (x < end - 0.06) {
      const w = 0.05 + rand() * 0.035;
      const h = 0.25 + rand() * 0.07;
      const mat = new THREE.MeshStandardMaterial({ color: binderColors[Math.floor(rand() * binderColors.length)], roughness: 0.6 });
      const b = place(rbox(w, h, CD - 0.1, 0.008, mat), cabinet, x + w / 2, shelfY + 0.018 + h / 2, 0.01);
      b.rotation.z = rand() < 0.15 ? 0.12 : 0;
      place(box(w * 0.6, 0.05, 0.005, labelMat), b, 0, h * 0.25, (CD - 0.1) / 2 + 0.003);
      x += w + 0.008;
    }
    if (row === 1) {
      for (let k = 0; k < 6; k++) {               // стопка бумаг лёжа
        const p = place(box(0.3, 0.012, 0.24, labelMat), cabinet, 0.3 + (rand() - 0.5) * 0.02, shelfY + 0.025 + k * 0.013, 0);
        p.rotation.y = (rand() - 0.5) * 0.12;
      }
    }
  });

  // ---------- Робот ----------
  const bot = group(scene, HOME.x, 0, HOME.z);
  const hips = group(bot, 0, 0.66, 0);
  place(rbox(0.36, 0.14, 0.24, 0.05, M.joint), hips);

  const legs = [-1, 1].map((side) => {
    const hip = group(hips, side * 0.11, -0.04, 0);
    place(capsule(0.06, 0.18, M.shell), hip, 0, -0.15, 0);
    const knee = group(hip, 0, -0.3, 0);
    place(sphere(0.056, M.joint), knee);
    place(capsule(0.055, 0.16, M.shell), knee, 0, -0.13, 0);
    place(rbox(0.13, 0.07, 0.22, 0.03, M.joint), knee, 0, -0.285, 0.03);
    return { hip, knee };
  });

  const torso = group(hips, 0, 0.08, 0);
  place(cylinder(0.15, 0.17, 0.12, M.joint), torso, 0, 0.03, 0);
  place(rbox(0.5, 0.46, 0.32, 0.1, M.shell), torso, 0, 0.28, 0);
  // На груди — жетон с логотипом ГУИМЦ (тот же logo.svg, что в шапке сайта)
  place(new THREE.Mesh(new THREE.CircleGeometry(0.115, 56), M.visor), torso, 0, 0.29, 0.161);
  place(new THREE.Mesh(new THREE.TorusGeometry(0.117, 0.012, 12, 56), M.joint), torso, 0, 0.29, 0.162);
  place(new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.22), M.core), torso, 0, 0.29, 0.164);
  loadLogo();
  place(cylinder(0.06, 0.07, 0.08, M.joint), torso, 0, 0.54, 0);

  const head = group(torso, 0, 0.58, 0);
  place(rbox(0.44, 0.34, 0.36, 0.12, M.shell), head, 0, 0.17, 0);
  place(rbox(0.36, 0.17, 0.04, 0.018, M.visor), head, 0, 0.18, 0.165);
  const eyes = group(head, 0, 0.18, 0.188);
  const normalEyes = group(eyes);
  for (const sx of [-1, 1]) place(new THREE.Mesh(new RoundedBoxGeometry(0.075, 0.05, 0.012, 3, 0.005), M.eye), normalEyes, sx * 0.08, 0, 0);
  // глаза при смехе — довольные дуги ^ ^
  const happyEyes = group(eyes);
  happyEyes.visible = false;
  for (const sx of [-1, 1]) place(new THREE.Mesh(new THREE.TorusGeometry(0.03, 0.009, 8, 24, Math.PI), M.eye), happyEyes, sx * 0.08, -0.012, 0);
  for (const sx of [-1, 1]) {
    const ear = place(cylinder(0.065, 0.065, 0.05, M.joint), head, sx * 0.235, 0.17, 0);
    ear.rotation.z = Math.PI / 2;
    const rim = place(new THREE.Mesh(new THREE.TorusGeometry(0.045, 0.008, 10, 32), M.pink), head, sx * 0.262, 0.17, 0);
    rim.rotation.y = Math.PI / 2;
  }
  place(cylinder(0.012, 0.012, 0.14, M.joint), head, 0, 0.4, 0);
  const antennaTip = place(new THREE.Mesh(new THREE.SphereGeometry(0.032, 20, 14), M.pink), head, 0, 0.48, 0);

  // руки: [0] — правая (со стороны −x), [1] — левая
  const arms = [-1, 1].map((side) => {
    const shoulder = group(torso, side * 0.31, 0.43, 0);
    place(sphere(0.075, M.joint), shoulder);
    place(capsule(0.05, 0.14, M.shell), shoulder, 0, -0.13, 0);
    const elbow = group(shoulder, 0, -0.26, 0);
    place(sphere(0.05, M.joint), elbow);
    place(capsule(0.047, 0.13, M.shell), elbow, 0, -0.12, 0);
    const hand = group(elbow, 0, -0.25, 0);
    place(rbox(0.09, 0.1, 0.065, 0.025, M.joint), hand);
    return { shoulder, elbow, hand, side };
  });

  // Папка, которую робот листает
  const folder = group(torso, 0, 0.17, 0.36);
  folder.rotation.x = -0.75;
  folder.visible = false;
  place(box(0.36, 0.012, 0.44, M.folder), folder, 0, -0.008, 0);
  place(box(0.165, 0.014, 0.41, M.page), folder, -0.088, 0.006, 0);
  place(box(0.165, 0.022, 0.41, M.page), folder, 0.088, 0.01, 0);
  const pagePivot = group(folder, 0, 0.023, 0);
  const pageGeo = new THREE.PlaneGeometry(0.165, 0.41);
  pageGeo.rotateX(-Math.PI / 2);
  pageGeo.translate(0.0825, 0, 0);
  const flipPage = place(new THREE.Mesh(pageGeo, M.page), pagePivot);
  flipPage.castShadow = true;

  // Карточка сообщения — в правой руке; найденный ответ ещё и светится
  const cardHolder = group(arms[0].hand, 0, -0.06, 0.06);
  const card = group(cardHolder, 0.05, -0.06, 0);
  card.visible = false;
  const cardMat = new THREE.MeshStandardMaterial({
    map: cardTex, emissive: 0xffffff, emissiveMap: cardTex, emissiveIntensity: 0.55,
    roughness: 0.6, transparent: true, side: THREE.DoubleSide,
  });
  const cardMesh = place(new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.2125), cardMat), card);
  cardMesh.castShadow = true;
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({
    map: radialTexture([[0, "rgba(0,255,255,0.7)"], [0.45, "rgba(255,119,255,0.28)"], [1, "rgba(255,119,255,0)"]]),
    blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, toneMapped: false,
  }));
  glow.scale.set(0.8, 0.6, 1);
  place(glow, card, 0, 0, -0.02);
  let cardKind = "question";
  let flashLeft = 0;                          // короткая вспышка: «поймал» / «текст сменился»
  const FLASH = 0.5;
  const showCard = (kind, text) => {
    cardKind = kind;
    drawCard(kind, text);
    card.visible = true;
    flashLeft = FLASH;
  };
  // Пока робот листает папку, карточка лежит на её левой странице; потом снова в руке.
  function putCardOnFolder() {
    folder.add(card);
    card.position.set(-0.088, 0.034, 0.02);
    card.rotation.set(-Math.PI / 2, 0, Math.PI / 2);
    card.scale.setScalar(0.72);
  }
  function takeCardToHand() {
    cardHolder.add(card);
    card.position.set(0.05, -0.06, 0);
    card.rotation.set(0, 0, 0);
    card.scale.setScalar(1);
  }

  // ---------- Позы: суставы плавно тянутся к целевым углам ----------
  // sx/sz — плечо (вперёд-назад / в сторону), ex — локоть; 0 — правая рука, 1 — левая.
  // hp — наклон головы (+ вниз), hr — наклон набок, tl — наклон корпуса (+ вперёд).
  const POSES = {
    idle:    { sx0: 0.05, sx1: 0.05, sz0: -0.12, sz1: 0.12, ex0: -0.25, ex1: -0.25, hp: 0, hr: 0, tl: 0 },
    receive: { sx0: -0.95, sx1: -0.95, sz0: 0.2, sz1: -0.2, ex0: -0.65, ex1: -0.65, hp: 0.15, hr: 0, tl: 0.05 },
    nod:     { sx0: -0.95, sx1: -0.95, sz0: 0.2, sz1: -0.2, ex0: -0.65, ex1: -0.65, hp: 0.45, hr: 0, tl: 0.1 },
    carry:   { sx0: -0.4, sx1: 0.05, sz0: 0.1, sz1: 0.12, ex0: -1.05, ex1: -0.25, hp: 0.05, hr: 0, tl: 0.04 },
    reach:   { sx0: -1.45, sx1: -1.45, sz0: 0.1, sz1: -0.1, ex0: -0.15, ex1: -0.15, hp: -0.1, hr: 0, tl: 0.12 },
    hold:    { sx0: -0.5, sx1: -0.5, sz0: 0.32, sz1: -0.32, ex0: -1.2, ex1: -1.2, hp: 0.5, hr: 0, tl: 0.06 },
    give:    { sx0: -1.35, sx1: 0.05, sz0: 0.2, sz1: 0.12, ex0: -0.25, ex1: -0.25, hp: 0.05, hr: 0, tl: 0.08 },
    present: { sx0: -0.75, sx1: -0.75, sz0: -0.35, sz1: 0.35, ex0: -0.85, ex1: -0.85, hp: -0.08, hr: 0, tl: 0 },
    shrug:   { sx0: -0.2, sx1: -0.2, sz0: -0.6, sz1: 0.6, ex0: -1.4, ex1: -1.4, hp: 0.12, hr: 0.25, tl: 0 },
    laugh:   { sx0: -0.55, sx1: -0.55, sz0: 0.28, sz1: -0.28, ex0: -1.45, ex1: -1.45, hp: -0.35, hr: 0, tl: -0.08 },
  };
  const FREE_ARMS = { idle: [1, 1], carry: [0, 1], give: [0, 1] };
  const J = { ...POSES.idle };
  const T = { ...POSES.idle };
  let freeArms = [1, 1];
  const setPose = (name) => {
    Object.assign(T, POSES[name]);
    freeArms = FREE_ARMS[name] || [0, 0];
  };

  // ---------- Очередь действий ----------
  let queue = [];
  const run = (tasks) => { queue = tasks; };
  const pose = (name) => ({ start: () => setPose(name) });
  const call = (fn) => ({ start: fn });
  const wait = (sec) => { let t = 0; return { update: (dt) => (t += dt) >= sec }; };
  const until = (cond) => ({ update: () => cond() });
  const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
  const SPEED = 2.4;          // м/с — бодрым шагом
  const TURN_SPEED = 7.5;     // рад/с
  let moving = false;

  const turn = (angle) => ({
    update(dt) {
      const d = wrap(angle - bot.rotation.y);
      if (Math.abs(d) < 0.01) return true;
      bot.rotation.y += Math.sign(d) * Math.min(Math.abs(d), dt * TURN_SPEED);
      moving = true;
      return false;
    },
  });
  const walk = (target) => ({
    update(dt) {
      const dx = target.x - bot.position.x;
      const dz = target.z - bot.position.z;
      const dist = Math.hypot(dx, dz);
      if (dist < 0.02) return true;
      moving = true;
      const d = wrap(Math.atan2(dx, dz) - bot.rotation.y);
      if (Math.abs(d) > 0.15) {              // сначала развернуться к цели
        bot.rotation.y += Math.sign(d) * Math.min(Math.abs(d), dt * TURN_SPEED);
        return false;
      }
      bot.rotation.y += d * Math.min(1, dt * 10);
      const step = Math.min(dist, dt * SPEED);
      bot.position.x += (dx / dist) * step;
      bot.position.z += (dz / dist) * step;
      return false;
    },
  });

  function tick(dt) {
    while (queue.length) {
      const task = queue[0];
      if (!task.started) {
        task.started = true;
        task.start?.();
      }
      if (task.update && !task.update(dt)) break;
      queue.shift();
    }
  }

  // ---------- Полёт карточки между чатом и руками робота (обычный HTML поверх страницы) ----------
  const tmp = new THREE.Vector3();
  function screenPoint(obj) {
    obj.updateWorldMatrix(true, false);
    obj.getWorldPosition(tmp).project(camera);
    const r = canvas.getBoundingClientRect();
    return { x: r.left + ((tmp.x + 1) / 2) * r.width, y: r.top + ((1 - tmp.y) / 2) * r.height };
  }
  // Прямоугольник на экране, который занимает 3D-карточка в руке, — туда прилетает (и оттуда
  // вылетает) HTML-карточка, чтобы подмена 2D ↔ 3D была незаметной.
  function cardRect() {
    const c = screenPoint(card);
    card.updateWorldMatrix(true, false);
    const a = card.localToWorld(tmp.set(-0.17, 0, 0)).project(camera).clone();
    const b = card.localToWorld(tmp.set(0.17, 0, 0)).project(camera);
    const r = canvas.getBoundingClientRect();
    const width = Math.max(40, (Math.hypot(a.x - b.x, a.y - b.y) / 2) * r.width);
    return { left: c.x - width / 2, top: c.y - width * 0.31, width, height: width * 0.62 };
  }
  // from/to — прямоугольники {left, top, width, height}; карточка летит по дуге через верх.
  function fly(text, kind, from, to, duration) {
    const el = document.createElement("div");
    el.className = `robot-fly robot-fly-${kind}`;
    el.textContent = text;
    document.body.append(el);
    const w = Math.min(320, Math.max(from.width, to.width, 160));
    el.style.width = `${w}px`;
    const h = el.offsetHeight;
    const at = (rect, opacity = 1) => ({
      transform: `translate(${rect.left + rect.width / 2 - w / 2}px, ${rect.top + rect.height / 2 - h / 2}px) scale(${Math.min(1, rect.width / w)})`,
      opacity,
    });
    const mid = {
      left: (from.left + to.left) / 2, width: (from.width + to.width) / 2,
      top: Math.min(from.top, to.top) - 90, height: (from.height + to.height) / 2,
    };
    const anim = el.animate([at(from), at(mid), at(to)], { duration, easing: "cubic-bezier(.4,0,.2,1)" });
    return anim.finished.then(() => el.remove(), () => el.remove());
  }

  // ---------- Сценарий: забрать вопрос → найти → принести ответ ----------
  let active = false;
  let result = null;          // null — ждём ответ сервера; иначе {found, text, target, deliver}
  let flipping = false;
  let flipStart = 0;
  let now = 0;

  function search(detail) {
    if (result?.deliver) result.deliver();     // прошлый ответ не успели отдать — отдаём сразу
    if (!active || REDUCED.matches || !detail) return;
    detail.accepted = true;                    // ответ принесёт робот
    laughing = false;                          // вопрос важнее щекотки
    result = null;
    flipping = false;
    folder.visible = false;
    card.visible = false;
    takeCardToHand();

    let received = false;
    run([
      turn(0.85),                                               // повернулся к чату (он справа)
      pose("receive"), wait(0.35),                              // протянул руки
      call(() => {                                              // копия вопроса летит прямо в руки
        const from = detail.from?.isConnected ? detail.from.getBoundingClientRect() : null;
        if (!from) { received = true; return; }
        fly(detail.text, "question", from, cardRect(), 1000).then(() => { received = true; });
      }),
      until(() => received),
      call(() => showCard("question", detail.text)),            // поймал: карточка в руках, вспышка
      pose("nod"), wait(0.25), pose("receive"), wait(0.2),      // кивнул
      pose("carry"),
      walk(CABINET_FRONT),
      turn(Math.PI),                                            // лицом к стеллажу
      pose("reach"), wait(0.3),
      call(() => { folder.visible = true; putCardOnFolder(); }), // достал папку, карточку положил на неё
      pose("hold"),
      turn(0.55),                                               // вполоборота к зрителю
      call(() => { flipping = true; flipStart = now; }),
      until(() => result !== null && now - flipStart > 0.9),    // листает, пока нет ответа
      call(() => {                                              // нашёл: на той же карточке — ответ
        flipping = false;
        showCard(result.found ? "answer" : "empty", result.text);
      }),
      wait(0.45),
      call(() => {
        folder.visible = false;
        takeCardToHand();
        setPose("carry");
      }),
      walk(HOME),
      turn(0),
      pose("give"), wait(0.35),
      call(() => {                                              // отдаёт карточку — она летит в чат
        const r = result;
        const from = cardRect();
        card.visible = false;
        const target = r.target?.isConnected && !r.deliver.done ? r.target.getBoundingClientRect() : null;
        if (target) fly(r.text, r.found ? "answer" : "empty", from, target, 800).then(() => r.deliver());
        else r.deliver();
        setPose(r.found ? "present" : "shrug");                 // показывает обе руки
      }),
      wait(1.8),
      pose("idle"),
      call(() => { result = null; }),
    ]);
  }

  // ---------- Щекотка: щелчок по роботу, когда он стоит без дела ----------
  let laughing = false;
  let laughW = 0;
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  // можно щекотать: робот на экране, движение не отключено, нет поиска и смех закончился
  const canTickle = () => active && !REDUCED.matches && queue.length === 0 && result === null;
  const shown = (obj) => { for (let o = obj; o; o = o.parent) if (!o.visible) return false; return true; };
  function hitsRobot(e) {
    const r = canvas.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    camera.updateMatrixWorld();
    bot.updateMatrixWorld(true);              // положение робота — даже если кадр ещё не нарисован
    raycaster.setFromCamera(ndc, camera);
    return raycaster.intersectObject(bot, true).some((hit) => shown(hit.object));
  }
  function tickle() {
    run([
      pose("laugh"),
      call(() => { laughing = true; }),
      wait(1.5),
      call(() => { laughing = false; }),
      pose("idle"), wait(0.3),
    ]);
  }
  canvas.addEventListener("pointermove", (e) => {
    canvas.style.cursor = canTickle() && hitsRobot(e) ? "pointer" : "";
  });
  canvas.addEventListener("pointerleave", () => { canvas.style.cursor = ""; });
  canvas.addEventListener("click", (e) => {
    if (!canTickle() || !hitsRobot(e)) return;   // во время поиска и смеха щелчки не действуют
    canvas.style.cursor = "";
    tickle();
  });

  function showResult(detail) {
    if (!detail) return;
    result = detail;
    if (!active || queue.length === 0) detail.deliver?.();     // робот не занят этим вопросом
  }

  // ---------- Покадровая анимация ----------
  let walkPhase = 0;
  let walkAmt = 0;
  let lookYaw = 0, lookTarget = 0, lookTimer = 2;
  let blinkTimer = 3, blinkLeft = 0;
  const swing = [0, 0];

  function animate(dt) {
    const reduced = REDUCED.matches;
    const k = reduced ? 1 : 1 - Math.exp(-dt * 9);
    for (const key of Object.keys(J)) J[key] += (T[key] - J[key]) * k;
    for (let i = 0; i < 2; i++) swing[i] += (freeArms[i] - swing[i]) * k;

    // ходьба
    walkAmt += ((moving ? 1 : 0) - walkAmt) * (reduced ? 1 : 1 - Math.exp(-dt * 12));
    if (moving) walkPhase += dt * 15;
    const s = Math.sin(walkPhase) * walkAmt;
    legs[0].hip.rotation.x = s * 0.5;
    legs[1].hip.rotation.x = -s * 0.5;
    legs[0].knee.rotation.x = Math.max(0, -Math.sin(walkPhase)) * 0.8 * walkAmt;
    legs[1].knee.rotation.x = Math.max(0, Math.sin(walkPhase)) * 0.8 * walkAmt;
    const breathe = reduced ? 0 : Math.sin(now * 1.7) * 0.006;
    hips.position.y = 0.66 + Math.abs(Math.cos(walkPhase)) * 0.03 * walkAmt - 0.015 * walkAmt;
    torso.position.y = 0.08 + breathe;

    // перелистывание: страница переворачивается, левая рука помогает
    let flipArm = 0;
    if (flipping && !reduced) {
      const f = ((now - flipStart) % 0.55) / 0.55;
      const e = f < 0.8 ? f / 0.8 : 1;
      pagePivot.rotation.z = Math.PI * (e * e * (3 - 2 * e));
      flipPage.visible = f < 0.97;
      flipArm = Math.sin(Math.PI * Math.min(1, f / 0.8)) * 0.35;
    } else {
      pagePivot.rotation.z = 0;
      flipPage.visible = true;
    }

    arms.forEach((a, i) => {
      const armSwing = (i === 0 ? -s : s) * 0.4 * swing[i];
      a.shoulder.rotation.x = J[`sx${i}`] + armSwing - (i === 1 ? flipArm : 0);
      a.shoulder.rotation.z = J[`sz${i}`] - (i === 1 ? flipArm * 0.4 : 0);
      a.elbow.rotation.x = J[`ex${i}`] - (i === 1 ? flipArm * 0.5 : 0);
    });
    torso.rotation.x = J.tl;

    // смех: корпус и голова мелко трясутся, глаза — дуги
    laughW += ((laughing && !reduced ? 1 : 0) - laughW) * (1 - Math.exp(-dt * 10));
    const shake = Math.sin(now * 32) * laughW;
    torso.rotation.z = shake * 0.05;
    hips.position.y += Math.abs(shake) * 0.02;
    normalEyes.visible = !laughing;
    happyEyes.visible = laughing;

    // взгляд: в покое иногда оглядывается, при поиске смотрит в папку и «сканирует» глазами
    const idle = queue.length === 0 && !reduced;
    lookTimer -= dt;
    if (lookTimer <= 0) {
      lookTarget = idle ? (Math.random() - 0.5) * 0.7 : 0;
      lookTimer = 2 + Math.random() * 3;
    }
    if (!idle) lookTarget = 0;
    lookYaw += (lookTarget - lookYaw) * (1 - Math.exp(-dt * 3));
    head.rotation.set(J.hp + shake * 0.05, lookYaw, J.hr + Math.sin(now * 14) * 0.1 * laughW);
    eyes.position.x = flipping && !reduced ? Math.sin(now * 9) * 0.012 : 0;

    // моргание
    blinkTimer -= dt;
    if (blinkTimer <= 0 && !reduced) {
      blinkLeft = 0.13;
      blinkTimer = 2.5 + Math.random() * 3.5;
    }
    blinkLeft -= dt;
    eyes.scale.y = blinkLeft > 0 ? 0.12 : 1;

    // логотип на груди и антенна мягко пульсируют; при поиске логотип мигает быстрее
    const pulse = reduced ? 1 : 0.75 + 0.25 * Math.sin(now * (flipping || laughing ? 10 : 2.2));
    M.core.color.setScalar(pulse);
    antennaTip.scale.setScalar(reduced ? 1 : 1 + 0.12 * Math.sin(now * 2.2));

    // карточка всегда повёрнута лицом вперёд и мягко светится
    cardHolder.rotation.x = -(arms[0].shoulder.rotation.x + arms[0].elbow.rotation.x + J.tl);
    cardHolder.rotation.z = -arms[0].shoulder.rotation.z;
    // свечение: постоянно у найденного ответа, коротко — вспышка при «поймал» и смене текста
    flashLeft = Math.max(0, flashLeft - dt);
    const flash = flashLeft / FLASH;
    glow.visible = cardKind === "answer" || flash > 0;
    const base = cardKind === "answer" ? (reduced ? 0.8 : 0.7 + 0.3 * Math.sin(now * 3)) : 0;
    glow.material.opacity = Math.max(base, flash * 1.2);
    glow.scale.set(0.8 + flash * 0.5, 0.6 + flash * 0.4, 1);
    cardMat.emissiveIntensity = 0.55 + flash * 0.8;
  }

  // ---------- Размер и цикл отрисовки ----------
  function resize() {
    const w = stage.clientWidth;
    const h = stage.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    const tan = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const dist = Math.min(12, Math.max(5.2, 1.2 / (tan * camera.aspect)));
    camera.position.set(0, 1.25 + dist * 0.13, dist + 0.3);
    camera.lookAt(LOOK);
    camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(stage);
  resize();

  const clock = new THREE.Clock();
  function frame() {
    const dt = Math.min(clock.getDelta(), 0.05);
    now += dt;
    moving = false;
    tick(dt);
    animate(dt);
    renderer.render(scene, camera);
  }

  return {
    search,
    result: showResult,
    setActive(on) {
      active = on;
      clock.getDelta();
      renderer.setAnimationLoop(on ? frame : null);
      if (!on && result?.deliver) result.deliver();   // окно сузили — ответ не должен «застрять»
    },
  };
}
