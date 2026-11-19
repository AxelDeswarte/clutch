// CLUTCH — « Courants de salon » : fond génératif à graine (voir docs/philosophie-visuelle.md)
// Chaque joueur est un courant de couleur ; la graine d'un salon est son code.
'use strict';

const FX = (() => {
  const TAU = Math.PI * 2;
  const reducedMQ = matchMedia('(prefers-reduced-motion: reduce)');

  // ── hasard reproductible ──
  function mulberry32(a) {
    return () => {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const hash = (s) => { let h = 2166136261; for (const ch of String(s)) { h ^= ch.codePointAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };

  // ── bruit de gradient 2D (type Perlin), permutation tirée de la graine ──
  function makeNoise(rand) {
    const perm = Array.from({ length: 256 }, (_, i) => i);
    for (let i = 255; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [perm[i], perm[j]] = [perm[j], perm[i]]; }
    const p = new Uint8Array(512);
    for (let i = 0; i < 512; i++) p[i] = perm[i & 255];
    const GX = [1, -1, 1, -1, 1, -1, 0, 0], GY = [1, 1, -1, -1, 0, 0, 1, -1];
    const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
    return (x, y) => {
      const X = Math.floor(x), Y = Math.floor(y);
      x -= X; y -= Y;
      const xi = X & 255, yi = Y & 255;
      const g = (i, j, dx, dy) => { const k = p[p[i] + j] & 7; return GX[k] * dx + GY[k] * dy; };
      const u = fade(x), v = fade(y);
      const a = g(xi, yi, x, y), b = g(xi + 1, yi, x - 1, y), c = g(xi, yi + 1, x, y - 1), d = g(xi + 1, yi + 1, x - 1, y - 1);
      const top = a + u * (b - a), bot = c + u * (d - c);
      return top + v * (bot - top); // ≈ [-0.7, 0.7]
    };
  }

  // ── humeurs : chaque paramètre est interpolé vers sa cible, jamais par à-coups ──
  const MOODS = {
    calm: { speed: 1.0, fade: 0.03, alpha: 0.62, density: 1.0, swirl: 0.0, fps: 60, opacity: 1 },
    play: { speed: 0.45, fade: 0.08, alpha: 0.35, density: 0.45, swirl: 0.0, fps: 30, opacity: 0.45 },
    celebrate: { speed: 2.3, fade: 0.04, alpha: 0.85, density: 1.4, swirl: 1.0, fps: 60, opacity: 1 },
  };
  const BASE = ['#ffd23f', '#3dd6ff', '#ff5fa2', '#2ee59d'];

  let cv, ctx, W = 0, H = 0, dpr = 1;
  let noise = null, rand = Math.random, seedKey = '';
  let attractors = [], parts = [];
  let mood = 'calm', back = 'calm', backTimer = null;
  const cur = { ...MOODS.calm };
  let t = 0, raf = null, last = 0;

  function setupCanvas() {
    cv = document.getElementById('bgfx');
    if (!cv) return false;
    ctx = cv.getContext('2d');
    resize();
    addEventListener('resize', () => { clearTimeout(resize.t); resize.t = setTimeout(() => { resize(); if (reducedMQ.matches) still(); }, 150); });
    document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); else start(); });
    reducedMQ.addEventListener?.('change', () => { if (reducedMQ.matches) { stop(); still(); } else start(); });
    return true;
  }
  function resize() {
    dpr = Math.min(devicePixelRatio || 1, 1.5);
    W = innerWidth; H = innerHeight;
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.lineCap = 'round';
  }

  // nombre de particules selon la surface (le téléphone en reçoit moins)
  const targetCount = () => Math.round(Math.min(320, (W * H) / 6500) * cur.density);

  function spawn(p, anywhere) {
    const a = attractors[Math.floor(rand() * attractors.length)];
    if (anywhere || rand() < 0.35) { p.x = rand() * W; p.y = rand() * H; }
    else { const ang = rand() * TAU, r = 40 + rand() * Math.min(W, H) * 0.32; p.x = a.x + Math.cos(ang) * r; p.y = a.y + Math.sin(ang) * r; }
    p.a = a; p.col = a.col;
    p.life = 0; p.max = 90 + rand() * 260;
    p.w = 0.8 + rand() * rand() * 2.6; // beaucoup de fins, quelques épais
    p.px = p.x; p.py = p.y;
    return p;
  }

  // une scène = une graine + les couleurs des joueurs
  let sceneSeed = '', sceneCols = BASE;
  function scene(seed, colors) {
    const cols = (colors && colors.length ? colors : BASE).slice(0, 10);
    const key = `${seed}|${cols.join(',')}`;
    if (key === seedKey) return;
    seedKey = key; sceneSeed = seed; sceneCols = cols;
    build();
    if (ctx) ctx.clearRect(0, 0, W, H);
    if (reducedMQ.matches) still();
  }
  // tout l'état découle de la graine : même graine + même humeur = même image, exactement
  function build() {
    const seed = sceneSeed, cols = sceneCols;
    t = 0;
    rand = mulberry32(hash(seed));
    noise = makeNoise(rand);
    const n = cols.length;
    attractors = cols.map((col, i) => ({
      col,
      ang: (i / n) * TAU + rand() * 0.6,          // répartis autour du centre…
      rad: 0.18 + rand() * 0.22,                  // …à distance variable
      spin: (rand() < 0.5 ? -1 : 1) * (0.00025 + rand() * 0.0004), // orbite lente
      x: 0, y: 0,
    }));
    placeAttractors();
    parts = [];
    for (let i = 0; i < targetCount(); i++) parts.push(spawn({}, true));
  }
  function placeAttractors() {
    const R = Math.min(W, H);
    attractors.forEach((a) => { a.x = W / 2 + Math.cos(a.ang) * a.rad * R * 1.25; a.y = H / 2 + Math.sin(a.ang) * a.rad * R; });
  }

  // un pas de simulation : champ de bruit (houle + frisson) + fil vers son joueur + tourbillon de victoire
  function step(dt) {
    t += dt * cur.speed;
    attractors.forEach((a) => { a.ang += a.spin * dt * 16 * cur.speed; });
    placeAttractors();
    const sc = 0.0021, cx = W / 2, cy = H / 2, tz = t * 0.0011;
    const want = targetCount();
    while (parts.length < want) parts.push(spawn({}, false));
    if (parts.length > want) parts.length = want;

    ctx.globalCompositeOperation = 'destination-out';
    ctx.fillStyle = `rgba(0,0,0,${cur.fade})`;
    ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = cur.alpha;

    const v = 1.35 * cur.speed * dt;
    for (const p of parts) {
      const n1 = noise(p.x * sc, p.y * sc + tz), n2 = noise(p.x * sc * 2.7 + 37, p.y * sc * 2.7 - tz * 1.7);
      let ang = (n1 * 1.6 + n2 * 0.45) * TAU;
      let vx = Math.cos(ang), vy = Math.sin(ang);
      // fil invisible vers son joueur (faible : il infléchit, ne dirige pas)
      const dx = p.a.x - p.x, dy = p.a.y - p.y, d = Math.hypot(dx, dy) + 1;
      vx += (dx / d) * 0.22; vy += (dy / d) * 0.22;
      // victoire : tout converge en spirale vers le centre
      if (cur.swirl > 0.01) {
        const ex = cx - p.x, ey = cy - p.y, e = Math.hypot(ex, ey) + 1;
        vx += (-ey / e * 1.4 + ex / e * 0.55) * cur.swirl;
        vy += (ex / e * 1.4 + ey / e * 0.55) * cur.swirl;
      }
      const m = Math.hypot(vx, vy) || 1;
      p.px = p.x; p.py = p.y;
      p.x += (vx / m) * v; p.y += (vy / m) * v;
      p.life += dt;
      // la traînée s'allume puis s'éteint sur sa vie
      const k = p.life / p.max, fadeInOut = Math.min(1, k * 6) * Math.min(1, (1 - k) * 4);
      if (fadeInOut > 0.02) {
        ctx.globalAlpha = cur.alpha * fadeInOut;
        ctx.strokeStyle = p.col;
        ctx.lineWidth = p.w;
        ctx.beginPath(); ctx.moveTo(p.px, p.py); ctx.lineTo(p.x, p.y); ctx.stroke();
      }
      if (p.life > p.max || p.x < -20 || p.x > W + 20 || p.y < -20 || p.y > H + 20) spawn(p, false);
    }
    // quelques étincelles blanches qui s'éteignent avec les traînées
    if (rand() < 0.12 * cur.density) {
      ctx.globalAlpha = 0.5 + rand() * 0.4; ctx.fillStyle = '#fff';
      const x = rand() * W, y = rand() * H, s = 0.8 + rand() * 1.6;
      ctx.beginPath(); ctx.arc(x, y, s, 0, TAU); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function ease() {
    const goal = MOODS[mood];
    for (const k of ['speed', 'fade', 'alpha', 'density', 'swirl']) cur[k] += (goal[k] - cur[k]) * 0.04;
    cur.fps = goal.fps;
    cv.style.opacity = String(goal.opacity);
  }

  function loop(now) {
    raf = requestAnimationFrame(loop);
    const minGap = 1000 / cur.fps - 2;
    if (now - last < minGap) return;
    const dt = Math.min(3, (now - last) / 16.67 || 1);
    last = now;
    ease();
    step(dt);
  }
  function start() {
    if (raf || !cv || reducedMQ.matches || document.hidden || !noise) return;
    last = performance.now();
    raf = requestAnimationFrame(loop);
  }
  function stop() { if (raf) cancelAnimationFrame(raf); raf = null; }

  // animations réduites : le dessin est calculé hors champ et livré figé
  function still() {
    if (!ctx || !noise) return;
    stop();
    Object.assign(cur, MOODS.calm, { fade: 0.012 });
    build();
    ctx.clearRect(0, 0, W, H);
    for (let i = 0; i < 240; i++) step(1);
    cv.style.opacity = '1';
  }

  function setMood(m) {
    if (!MOODS[m]) return;
    clearTimeout(backTimer);
    mood = m; back = m === 'celebrate' ? back : m;
    if (reducedMQ.matches) return;
    start();
  }

  return {
    init(seed, colors) { if (!setupCanvas()) return; seedKey = ''; scene(seed, colors); start(); },
    scene,
    mood: setMood,
    // tourbillon de victoire puis retour à l'humeur précédente
    celebrate(colors, ms = 4500) {
      if (colors && colors.length) {
        // les courants prennent la couleur du/des vainqueur(s), le temps de la fête
        parts.forEach((p, i) => { p.col = colors[i % colors.length]; });
      }
      const prev = back;
      setMood('celebrate');
      backTimer = setTimeout(() => { mood = prev; start(); }, ms);
    },
    // impulsion légère (manche gagnée) : une vague de traînées à une couleur
    pulse(color) {
      if (reducedMQ.matches || !parts.length) return;
      for (let i = 0; i < parts.length; i += 3) { parts[i].col = color; parts[i].life = 0; }
    },
    // image figée calculée d'un coup (animations réduites, et aperçu pour régler l'algorithme)
    still,
    hash,
    mulberry32,
  };
})();
