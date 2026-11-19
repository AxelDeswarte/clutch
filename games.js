// CLUTCH — mini-jeux (logique serveur, autoritaire)
//
// Chaque jeu : { title, rules, min, intro?, create(room) -> { start(), input(i, msg) } }
// API dispo sur `room` :
//   room.n                     nombre de joueurs (indices 0..n-1)
//   room.name(i)               pseudo
//   room.send(msg, [i])        envoie à tous ou au joueur i
//   room.later(fn, ms)         timeout auto-nettoyé en fin de manche (renvoie un id)
//   room.every(fn, ms)         interval auto-nettoyé
//   room.cancel(id)            annule un timer
//   room.eliminate(i, extra)   déclenche l'animation d'élimination chez tout le monde
//   room.survivalOver(alive)   true si tous les survivants sont du même camp (ou personne)
//   room.finish(scores, why)   termine la manche ; scores[i] plus haut = mieux classé

const GunPhys = require('./public/gunphys');
const ri = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const shuffle = (arr) => {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
};
const range = (n) => [...Array(n).keys()];
const DIRS = ['up', 'down', 'left', 'right'];

// Suivi d'une course : ordre d'arrivée + règle de fin commune
class Race {
  constructor(room) {
    this.room = room;
    this.order = [];
    this.done = new Array(room.n).fill(false);
    this.graceSet = false;
  }
  finish(i, end) {
    if (this.done[i]) return;
    this.done[i] = true;
    this.order.push(i);
    const n = this.room.n, f = this.order.length;
    // 1v1 / équipes : le premier arrivé fait gagner son camp → fin immédiate
    // Chacun pour soi : on attend le podium (ou n-1 arrivés), avec 10 s de grâce max après le 1er
    if (f === n || this.room.twoSides || f >= Math.min(3, n - 1)) return end();
    if (!this.graceSet) { this.graceSet = true; this.room.later(end, 10000); }
  }
  scores(progress) {
    return progress.map((p, i) => (this.done[i] ? 1e6 - this.order.indexOf(i) : p));
  }
}

const GAMES = {};

// Grilles (Tron, Serpents) au-delà de 6 joueurs : départs répartis sur les 4 bords, tournés vers l'intérieur.
// Le joueur i part du bord i % 4 ; les gauche / droite sont décalés pour ne pas se foncer dessus,
// et on reste entre 20 % et 80 % du bord pour que les coins restent libres (sinon un départ croise un corps).
function edgeSpawns(n, W, H, m) {
  const per = [0, 0, 0, 0];
  for (let i = 0; i < n; i++) per[i % 4]++;
  const at = (s, k) => {
    const c = per[s], f = 0.2 + (0.6 * (k + (s === 1 || s === 3 ? 0.75 : 0.25))) / c;
    if (s === 0) return [m, Math.round(f * (H - 1)), 'right'];
    if (s === 1) return [W - 1 - m, Math.round(f * (H - 1)), 'left'];
    if (s === 2) return [Math.round(f * (W - 1)), m, 'down'];
    return [Math.round(f * (W - 1)), H - 1 - m, 'up'];
  };
  return range(n).map((i) => at(i % 4, Math.floor(i / 4)));
}

// ───────────────────────── RÉFLEXE ─────────────────────────
GAMES.reflex = {
  keys: [[[['Espace'], ['Clic']], 'dégainer au cri « FEU ! » (pas avant !)']],
  touch: 'tape sur le cowboy',
  icon: '🤠',
  desc: 'Dégaine au signal, pas avant',
  title: 'Duel au soleil',
  min: 2,
  rules: "Main sur le flingue. Au cri « FEU ! », dégaine le plus vite possible. Méfie-toi des faux signaux (FEUILLE, FOU…) : dégainer avant le vrai = le shérif t'abat.",
  create(room) {
    const n = room.n;
    const t = new Array(n).fill(null);
    const fs = new Array(n).fill(false);
    let phase = 'idle';

    const end = () => {
      if (phase === 'done') return;
      phase = 'done';
      const sc = t.map((v, i) => (fs[i] ? -1e9 : v == null ? -1e8 : -v));
      const ord = range(n).filter((i) => t[i] != null).sort((a, b) => t[a] - t[b]);
      room.finish(sc, ord.map((i) => `${room.name(i)} ${t[i]} ms`).join(' · ') || "Personne n'a eu le temps d'appuyer.");
    };
    const check = () => {
      const pending = range(n).filter((i) => !fs[i] && t[i] == null);
      if (pending.length === 0 || room.survivalOver(fs.map((f) => !f))) end();
    };

    return {
      start() {
        phase = 'wait';
        room.send({ t: 'g', k: 'wait' });
        const delay = 2000 + Math.random() * 5000;
        const FAKES = ['FEUILLE !', 'FOU !', 'FÊTE !', 'FEUTRE !', 'FEU… rouge', "FEUX d'artifice", 'FESSE !'];
        const nf = ri(0, 2);
        for (let k = 0; k < nf; k++) {
          const at = 900 + Math.random() * (delay - 1500);
          room.later(() => { if (phase === 'wait') room.send({ t: 'g', k: 'fake', txt: pick(FAKES) }); }, at);
        }
        room.later(() => {
          phase = 'go';
          room.send({ t: 'g', k: 'go' });
          room.later(end, 3000);
        }, delay);
      },
      input(i, m) {
        if (m.a !== 'press' || phase === 'idle' || phase === 'done' || fs[i] || t[i] != null) return;
        const ms = Number(m.ms);
        if (phase === 'wait' || !Number.isFinite(ms) || ms < 80) {
          fs[i] = true;
          room.eliminate(i);
          room.send({ t: 'g', k: 'fs', i });
        } else {
          t[i] = Math.round(ms);
          room.send({ t: 'g', k: 't', i, ms: t[i] });
        }
        check();
      },
    };
  },
};

// ───────────────────────── ESCALATOR ─────────────────────────
GAMES.seq = {
  keys: [[[['Z', 'Q', 'S', 'D']], 'taper la lettre affichée en grand'], [[['⬆', '⬇', '⬅', '➡']], 'marche aussi (⬆ = Z, ⬅ = Q, ⬇ = S, ➡ = D)']],
  touch: 'flèches sous le jeu',
  icon: '🛗',
  desc: 'Tape Z Q S D, le broyeur monte',
  title: 'Escalator',
  min: 2,
  rules: "Tu montes un escalator sans fin… avec un broyeur juste en dessous qui accélère. Bonne lettre = tu montes d'une marche, mauvaise = tu glisses de 2 vers les lames. Dernier survivant gagne.",
  create(room) {
    const n = room.n, WIN = 26, DT = 0.1; // WIN = nombre de marches visibles à l'écran
    const seq = Array.from({ length: 400 }, () => pick(DIRS));
    const idx = new Array(n).fill(0), pos = new Array(n).fill(4);
    const alive = new Array(n).fill(true), deathT = new Array(n).fill(0);
    let c = 0, t = 0;
    const scores = () => range(n).map((i) => (alive[i] ? 1e9 + pos[i] : deathT[i]));
    const end = () => room.finish(scores(), `Plus haut : ${Math.floor(Math.max(...pos))} marches`);
    const check = () => { if (room.survivalOver(alive)) end(); };
    const state = () => ({ t: 'g', k: 's', pos: pos.map((p) => +p.toFixed(2)), c: +c.toFixed(2), al: alive, idx });
    function step() {
      t += DT;
      c += (1.2 + t * 0.08) * DT;
      range(n).forEach((i) => {
        if (alive[i] && c >= pos[i]) { alive[i] = false; deathT[i] = t; room.eliminate(i); }
      });
      room.send(state());
      check();
    }
    return {
      start() {
        room.send({ t: 'g', k: 'esc', seq, top: WIN });
        room.every(step, DT * 1000);
        room.later(end, 120000);
      },
      input(i, m) {
        if (m.a !== 'key' || !alive[i] || !DIRS.includes(m.key)) return;
        if (m.key === seq[idx[i] % seq.length]) { idx[i]++; pos[i] += 1; }
        else pos[i] = Math.max(0, pos[i] - 2);
        room.send(state());
        check();
      },
    };
  },
};

// ───────────────────────── TRON ─────────────────────────
GAMES.tron = {
  team: { rule: "En équipe : coincez les adversaires ensemble. La dernière équipe avec un trait en vie gagne." },
  keys: [[[['⬆', '⬇', '⬅', '➡'], ['Z', 'Q', 'S', 'D']], 'tourner (on ne peut pas faire demi-tour)']],
  touch: 'flèches sous le jeu',
  icon: '🏍️',
  desc: "Coince les autres avec ton trait",
  title: 'Tron',
  min: 2,
  rules: "Ton trait avance tout seul et laisse un mur derrière lui. Touche un bord ou un trait = éliminé. Coince les autres ! Ça continue jusqu'au dernier survivant, même en équipe.",
  create(room) {
    const n = room.n;
    const W = n <= 2 ? 48 : 64, H = n <= 2 ? 32 : 42, TICK = 65;
    const D = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
    const OPP = { up: 'down', down: 'up', left: 'right', right: 'left' };
    const q4 = Math.floor(H / 4), q34 = Math.floor((3 * H) / 4), mid = H >> 1, cx = W >> 1;
    const spawns = n === 2
      ? [[6, mid, 'right'], [W - 7, mid, 'left']]
      : n > 6 ? edgeSpawns(n, W, H, 4)
        : [[6, q4, 'right'], [W - 7, q34, 'left'], [cx, 3, 'down'], [cx - 1, H - 4, 'up'], [6, q34, 'right'], [W - 7, q4, 'left']];
    const grid = new Uint8Array(W * H);
    const p = range(n).map((i) => ({ x: spawns[i][0], y: spawns[i][1], d: spawns[i][2], q: [], alive: true }));
    const deathTick = new Array(n).fill(Infinity);
    let tick = 0;
    p.forEach((pl, i) => { grid[pl.y * W + pl.x] = i + 1; });

    function step() {
      tick++;
      const next = p.map((pl) => {
        if (!pl.alive) return null;
        if (pl.q.length) pl.d = pl.q.shift();
        const [dx, dy] = D[pl.d];
        return [pl.x + dx, pl.y + dy];
      });
      const count = new Map();
      next.forEach((c) => { if (c) count.set(c[0] + ',' + c[1], (count.get(c[0] + ',' + c[1]) || 0) + 1); });
      const died = [];
      next.forEach((c, i) => {
        if (!c) return;
        const [x, y] = c;
        if (x < 0 || y < 0 || x >= W || y >= H || grid[y * W + x] !== 0 || count.get(x + ',' + y) > 1) died.push(i);
      });
      next.forEach((c, i) => {
        if (!c) return;
        p[i].x = c[0]; p[i].y = c[1];
        if (!died.includes(i)) grid[c[1] * W + c[0]] = i + 1;
      });
      died.forEach((i) => { p[i].alive = false; deathTick[i] = tick; });
      room.send({ t: 'g', k: 'tick', h: next, d: died });
      died.forEach((i) => room.eliminate(i));
      if (p.filter((a) => a.alive).length <= 1) room.finish(deathTick);
    }

    return {
      start() {
        room.send({ t: 'g', k: 'tron', w: W, h: H, heads: p.map((a) => [a.x, a.y]) });
        room.later(() => room.every(step, TICK), 2000);
        room.later(() => room.finish(deathTick, 'Temps écoulé.'), 120000);
      },
      input(i, m) {
        if (m.a !== 'dir' || !D[m.d] || !p[i].alive) return;
        const pl = p[i];
        const last = pl.q.length ? pl.q[pl.q.length - 1] : pl.d;
        if (m.d === last || m.d === OPP[last] || pl.q.length >= 3) return;
        pl.q.push(m.d);
      },
    };
  },
};

// ───────────────────────── MÉMOIRE ─────────────────────────
GAMES.memory = {
  keys: [[[['Clic']], 'cliquer les cases dans l\'ordre où elles se sont allumées']],
  icon: '🧠',
  desc: "Reproduis la séquence dans l'ordre",
  title: 'Mémoire',
  min: 2,
  rules: "Des cases s'allument une par une : reclique-les DANS LE MÊME ORDRE. Chaque niveau ajoute une case et accélère. Une erreur ou trop lent = éliminé. Dernier survivant gagne, même en équipe.",
  create(room) {
    const G = 5, n = room.n;
    const alive = new Array(n).fill(true);
    const score = new Array(n).fill(0);
    const seq = [ri(0, G * G - 1)];
    let level = 0, prog = [], done = [], phase = 'idle';
    const aliveCount = () => alive.filter(Boolean).length;
    const addCell = () => { let c; do { c = ri(0, G * G - 1); } while (c === seq[seq.length - 1]); seq.push(c); };

    function next() {
      level++;
      addCell();
      if (level === 1) addCell();
      prog = new Array(n).fill(0);
      done = new Array(n).fill(false);
      phase = 'show';
      const on = Math.max(230, 480 - level * 22), off = Math.max(70, 150 - level * 7);
      room.send({ t: 'g', k: 'show', level, seq, on, off, alive });
      room.later(() => {
        phase = 'input';
        const ms = 2000 + seq.length * 550;
        room.send({ t: 'g', k: 'input', level, ms, len: seq.length });
        room.later(timeout, ms);
      }, seq.length * (on + off) + 350);
    }
    function kill(i) { alive[i] = false; room.eliminate(i); }
    function timeout() {
      if (phase !== 'input') return;
      range(n).forEach((i) => { if (alive[i] && !done[i]) kill(i); });
      levelEnd();
    }
    function levelEnd() {
      if (phase !== 'input') return;
      phase = 'between';
      room.send({ t: 'g', k: 'st', alive, done });
      if (aliveCount() <= 1 || level >= 40) {
        return room.finish(score.map((s, i) => (alive[i] ? 1e9 + s : s)), `Séquence atteinte : ${seq.length} cases`);
      }
      room.later(next, 1200);
    }

    return {
      start() { next(); },
      input(i, m) {
        if (m.a !== 'tap' || phase !== 'input' || !alive[i] || done[i]) return;
        const c = m.c | 0;
        if (c === seq[prog[i]]) {
          prog[i]++;
          score[i] = level * 100 + prog[i];
          room.send({ t: 'g', k: 'ok', c, p: prog[i] }, i);
          if (prog[i] === seq.length) { done[i] = true; score[i] = level * 100 + 99; }
        } else {
          room.send({ t: 'g', k: 'bad', c }, i);
          kill(i);
        }
        room.send({ t: 'g', k: 'st', alive, done });
        if (aliveCount() <= 1 || alive.every((a, j) => !a || done[j])) levelEnd();
      },
    };
  },
};

// ───────────────────────── ESQUIVE ─────────────────────────
GAMES.dodge = {
  team: { rule: "En équipe : tu ne peux bousculer que les adversaires. Dernière équipe entière gagne." },
  keys: [[[['⬆', '⬇', '⬅', '➡'], ['Z', 'Q', 'S', 'D']], 'se déplacer'], [[['Espace']], 'bousculer le joueur le plus proche']],
  touch: 'flèches + bouton 💥 sous le jeu',
  icon: '🪚',
  desc: 'Esquive les scies et les lasers',
  title: 'Lames',
  min: 2,
  rules: "Des scies circulaires ricochent partout, puis des lasers balaient la salle. Les contours en pointillés ne coupent pas encore. Dernier entier gagne.",
  create(room) {
    const n = room.n, W = 800, H = 500, PR = 11, DT = 1 / 30;
    const A = makeArena(room, { W, H, SP: 240, PR, spawn: circleSpawn(W, H, 170, 120) });
    const pl = A.pl;
    const deathT = new Array(n).fill(Infinity);
    const balls = [], lasers = [];
    let t = 0, nextSpawn = 1.2;

    function spawn() {
      const r = 12 + Math.random() * 16;
      const sp = (175 + t * 6.5) * (0.8 + Math.random() * 0.4);
      const e = ri(0, 3);
      const x = e === 0 ? r : e === 1 ? W - r : r + Math.random() * (W - 2 * r);
      const y = e === 2 ? r : e === 3 ? H - r : r + Math.random() * (H - 2 * r);
      const tx = W * (0.25 + Math.random() * 0.5), ty = H * (0.25 + Math.random() * 0.5);
      const len = Math.hypot(tx - x, ty - y) || 1;
      balls.push({ x, y, vx: ((tx - x) / len) * sp, vy: ((ty - y) / len) * sp, r, g: 0.8 });
    }
    function segDist(px, py, x1, y1, x2, y2) {
      const dx = x2 - x1, dy = y2 - y1;
      const k = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy)));
      return Math.hypot(px - (x1 + k * dx), py - (y1 + k * dy));
    }
    function step() {
      t += DT;
      if (t >= nextSpawn && balls.length < 34) { spawn(); nextSpawn = t + Math.max(0.6, 2.0 - t * 0.05); }
      if (t > 6 && lasers.length === 0) lasers.push({ a: Math.random() * 6.28, w: 0.8, born: t });
      if (t > 18 && lasers.length === 1) lasers.push({ a: lasers[0].a + Math.PI / 2, w: -1.05, born: t });
      lasers.forEach((L) => { L.a += L.w * DT * (1 + t / 60); });
      balls.forEach((b) => {
        b.x += b.vx * DT; b.y += b.vy * DT; if (b.g > 0) b.g -= DT;
        if (b.x < b.r) { b.x = b.r; b.vx = Math.abs(b.vx); }
        if (b.x > W - b.r) { b.x = W - b.r; b.vx = -Math.abs(b.vx); }
        if (b.y < b.r) { b.y = b.r; b.vy = Math.abs(b.vy); }
        if (b.y > H - b.r) { b.y = H - b.r; b.vy = -Math.abs(b.vy); }
      });
      const died = [];
      A.move(DT);
      pl.forEach((p, i) => {
        if (!p.alive) return;
        let hit = balls.some((b) => b.g <= 0 && Math.hypot(p.x - b.x, p.y - b.y) < PR + b.r - 3);
        lasers.forEach((L) => {
          if (t - L.born < 1.5) return;
          const ex = W / 2 + Math.cos(L.a) * 900, ey = H / 2 + Math.sin(L.a) * 900;
          if (segDist(p.x, p.y, W / 2, H / 2, ex, ey) < PR + 2) hit = true;
        });
        if (hit) died.push(i);
      });
      died.forEach((i) => { pl[i].alive = false; deathT[i] = t; });
      room.send({
        t: 'g', k: 's', tm: +t.toFixed(1),
        p: pl.map((p) => [Math.round(p.x), Math.round(p.y), p.alive ? 1 : 0]),
        b: balls.map((b) => [Math.round(b.x), Math.round(b.y), Math.round(b.r), b.g > 0 ? 1 : 0]),
        l: lasers.map((L) => [+L.a.toFixed(3), t - L.born >= 1.5 ? 1 : 0]),
      });
      died.forEach((i) => room.eliminate(i));
      if (room.survivalOver(pl.map((p) => p.alive)) || t > 100) room.finish(deathT, `Survie max : ${t.toFixed(1)} s`);
    }

    return {
      start() {
        room.send({ t: 'g', k: 'dodge', w: W, h: H, pr: PR });
        room.every(step, 1000 / 30);
      },
      input(i, m) { A.input(i, m); },
    };
  },
};

// ───────────────────────── COURSE DE HAIES ─────────────────────────
GAMES.race = {
  team: { rule: "En équipe : les places s'additionnent (1er = le plus de points). Un coéquipier dernier fait perdre l'équipe !", sum: true },
  keys: [[[['⬅', '➡'], ['Q', 'D']], 'alterner vite pour courir'], [[['⬆'], ['Z'], ['Espace']], 'sauter une haie']],
  touch: 'boutons ⬅ ⬆ ➡ sous le jeu',
  icon: '🏃',
  desc: "Course de haies au clavier",
  title: 'Course de haies',
  min: 2,
  rules: "Course de haies : alterne gauche / droite le plus vite possible pour courir, et saute les haies. Une haie prise = gros ralentissement.",
  create(room) {
    const n = room.n, L = 4200, DT = 1 / 30;
    const hurdles = [];
    for (let x = 500; x < L - 250; x += 235 + Math.random() * 200) hurdles.push(Math.round(x));
    const r = range(n).map(() => ({ x: 0, v: 0, y: 0, vy: 0, last: null, st: 0, hit: new Set() }));
    const race = new Race(room);
    const end = () => room.finish(race.scores(r.map((p) => Math.min(p.x / L, 0.999))));

    function step() {
      r.forEach((p, i) => {
        if (p.st > 0) p.st -= DT;
        p.v -= p.v * 0.9 * DT;
        if (p.y > 0 || p.vy > 0) {
          p.vy -= 1900 * DT; p.y += p.vy * DT;
          if (p.y <= 0) { p.y = 0; p.vy = 0; }
        }
        const ox = p.x;
        p.x += p.v * DT;
        if (race.done[i]) return;
        for (const h of hurdles) {
          if (ox < h && p.x >= h && p.y < 36 && !p.hit.has(h)) { p.hit.add(h); p.v = Math.min(p.v, 40); p.st = 0.65; }
        }
        if (p.x >= L) race.finish(i, end);
      });
      room.send({ t: 'g', k: 's', r: r.map((p) => [Math.round(p.x), Math.round(p.y), p.st > 0 ? 1 : 0]) });
    }

    return {
      start() {
        room.send({ t: 'g', k: 'race', L, hurdles });
        room.every(step, 1000 / 30);
        room.later(end, 50000);
      },
      input(i, m) {
        const p = r[i];
        if (race.done[i]) return;
        if (m.a === 'run' && (m.k === 'l' || m.k === 'r')) {
          if (p.st > 0 || p.last === m.k) return;
          p.last = m.k;
          p.v = Math.min(p.v + 34, 430);
        } else if (m.a === 'jump' && p.y === 0 && p.vy === 0) {
          p.vy = 560;
        }
      },
    };
  },
};


// ═════════════════ Arène commune (déplacement + bousculade) ═════════════════
function makeArena(room, { W, H, SP = 230, PR = 12, spawn, rects = [], SHOVE = 360 }) {
  const n = room.n;
  const pl = range(n).map((i) => { const [x, y] = spawn(i, n); return { x, y, dx: 0, dy: 0, vx: 0, vy: 0, alive: true, cd: 0, still: 0 }; });
  const A = {
    pl, W, H, PR, rects,
    input(i, m) {
      const p = pl[i]; if (!p || !p.alive) return false;
      if (m.a === 'mv') {
        const c = (v) => Math.max(-1, Math.min(1, Math.round(Number(v) || 0)));
        p.dx = c(m.x); p.dy = c(m.y); return true;
      }
      if (m.a === 'shove' && p.cd <= 0) {
        let best = -1, bd = PR * 2 + 26;
        pl.forEach((q, j) => { if (j !== i && q.alive && room.sideOf[j] !== room.sideOf[i]) { const d = Math.hypot(q.x - p.x, q.y - p.y); if (d < bd) { bd = d; best = j; } } });
        p.cd = 1.3;
        if (best >= 0) {
          const q = pl[best];
          let dx = q.x - p.x, dy = q.y - p.y, d = Math.hypot(dx, dy);
          if (d < 0.01) { const a = Math.random() * 6.28; dx = Math.cos(a); dy = Math.sin(a); d = 1; }
          // seule la cible est projetée (~55 px), le pousseur ne bouge pas
          q.vx = (dx / d) * SHOVE; q.vy = (dy / d) * SHOVE;
          p.vx = 0; p.vy = 0;
          room.send({ t: 'g', k: 'shove', i, j: best });
        }
        return true;
      }
      return false;
    },
    move(DT, speedOf) {
      A.collide();
      pl.forEach((p, i) => {
        if (!p.alive) return;
        if (p.cd > 0) p.cd -= DT;
        const len = Math.hypot(p.dx, p.dy) || 1;
        const sp = speedOf ? speedOf(i) : SP;
        p.x += ((p.dx / len) * sp + p.vx) * DT;
        p.y += ((p.dy / len) * sp + p.vy) * DT;
        p.vx *= Math.pow(0.0015, DT); p.vy *= Math.pow(0.0015, DT);
        p.still = p.dx === 0 && p.dy === 0 && Math.hypot(p.vx, p.vy) < 20 ? p.still + DT : 0;
        p.x = Math.max(PR, Math.min(W - PR, p.x)); p.y = Math.max(PR, Math.min(H - PR, p.y));
        rects.forEach(([rx, ry, rw, rh]) => {
          const cx = Math.max(rx, Math.min(rx + rw, p.x)), cy = Math.max(ry, Math.min(ry + rh, p.y));
          const dx = p.x - cx, dy = p.y - cy, d = Math.hypot(dx, dy);
          if (d < PR) {
            if (d > 0) { p.x = cx + (dx / d) * PR; p.y = cy + (dy / d) * PR; }
            else { p.y = ry - PR; }
          }
        });
      });
    },
    snap() { return pl.map((p) => [Math.round(p.x), Math.round(p.y), p.alive ? 1 : 0]); },
    collide() {
      // les joueurs ne se traversent plus : on sépare les cercles qui se chevauchent
      for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) {
        const p = pl[a], q = pl[b];
        if (!p.alive || !q.alive) continue;
        const dx = q.x - p.x, dy = q.y - p.y, d = Math.hypot(dx, dy), min = PR * 2;
        if (d > 0 && d < min) { const k = (min - d) / 2 / d; p.x -= dx * k; p.y -= dy * k; q.x += dx * k; q.y += dy * k; }
      }
    },
  };
  return A;
}
const circleSpawn = (W, H, rx, ry) => (i, n) => { const a = (i / n) * Math.PI * 2 + Math.PI; return [W / 2 + Math.cos(a) * rx, H / 2 + Math.sin(a) * ry]; };

// ───────────────────────── LE FILTRE ─────────────────────────
// objets de valeur → caisse (emojis anciens : ils s'affichent partout)
const FRAMES = [['🖼️', 'Portrait de famille'], ['🖼️', 'Photo de ton ex'], ['🏺', 'Vase de mamie'], ['📚', 'Livres rares'], ['🎸', 'Guitare'], ['🎁', 'Cadeau'], ['👑', 'Couronne'], ['⌚', 'Montre'], ['🎻', 'Violon']];
// emojis anciens uniquement : les récents (🪛…) ne s'affichent pas partout (Windows 10)
const PARTS = [['🔩', 'Boulon'], ['⚙️', 'Engrenage'], ['🔧', 'Clé à molette'], ['🔨', 'Marteau'], ['🔗', 'Chaîne'], ['🧲', 'Aimant']];
GAMES.filter = {
  keys: [[[['⬅'], ['Q']], '🔥 four : la ferraille 🔩 ⚙️ 🔧 🔨 🔗 🧲'], [[['➡'], ['D']], '📦 caisse : les objets de valeur 🖼️ 🏺 📚 🎸 🎁 👑 ⌚ 🎻']],
  touch: 'gros boutons au-dessus du tapis',
  icon: '🔥',
  desc: 'Trie le plus vite possible en 30 s',
  title: 'Le Filtre',
  min: 2,
  rules: "Ton tapis avance à TON rythme : chaque objet trié fait venir le suivant. La ferraille va au four, les objets de valeur en caisse. Tu as 3 vies ❤️ : une erreur = une vie en moins (et sonné 1,5 s), à 0 tu es viré de l'usine. 30 secondes : celui qui en a trié le plus gagne — même s'il s'est fait virer avant la fin, ses objets triés comptent.",
  create(room) {
    const n = room.n, N = 400, STUN = 1500, DUR = 30000;
    const items = Array.from({ length: N }, () => {
      const frame = Math.random() < 0.5;
      const [e, name] = pick(frame ? FRAMES : PARTS);
      return { e, n: name, f: frame };
    });
    const pos = new Array(n).fill(0), stun = new Array(n).fill(0), lives = new Array(n).fill(3);
    // les points d'abord : un viré qui a trié plus passe devant ; à égalité, les vies restantes départagent
    const score = (i) => pos[i] * 10 + lives[i];
    const end = () => {
      const best = Math.max(...pos);
      room.finish(range(n).map(score), range(n).sort((a, b) => score(b) - score(a)).map((i) => `${room.name(i)} ${pos[i]}${lives[i] ? '' : ' 💀'}`).join(' · ') + (best ? '' : ' — personne n\'a rien trié'));
    };
    return {
      start() {
        room.send({ t: 'g', k: 'belt', items: items.map((x) => ({ e: x.e, n: x.n, f: x.f ? 1 : 0 })), n: N, stun: STUN, ms: DUR, lives: 3 });
        room.later(end, DUR);
      },
      input(i, m) {
        if (m.a !== 'sort' || pos[i] >= N || lives[i] <= 0 || (m.b !== 0 && m.b !== 1)) return;
        // le client prédit son tapis : s'il est décalé (tri refusé pendant qu'il était sonné), on le recale
        if (Number.isInteger(m.p) && m.p !== pos[i]) return room.send({ t: 'g', k: 'sync', p: pos[i] }, i);
        const now = Date.now();
        if (now < stun[i]) return room.send({ t: 'g', k: 'sync', p: pos[i] }, i);
        // 0 = four (ferraille), 1 = caisse (tableaux)
        const want = items[pos[i]].f ? 1 : 0;
        if (m.b === want) {
          pos[i]++;
          room.send({ t: 'g', k: 'prog', pos });
        } else {
          // un peu de marge pour la latence : le client compte son étourdissement à partir de son clic
          stun[i] = now + STUN - 250;
          lives[i]--;
          room.send({ t: 'g', k: 'stun', i, ms: STUN, lives });
          if (lives[i] <= 0) {
            room.eliminate(i);
            if (lives.every((l) => l <= 0)) room.later(end, 1500);
          }
        }
      },
    };
  },
};

// ───────────────────────── SOL INSTABLE ─────────────────────────
const FLOOR_SYM = ['💀', '🔪', '🩸', '👁️'];
GAMES.floor = {
  team: { rule: "En équipe : tu ne peux bousculer que les adversaires. Dernière équipe debout gagne." },
  keys: [[[['⬆', '⬇', '⬅', '➡'], ['Z', 'Q', 'S', 'D']], 'se déplacer'], [[['Espace']], 'bousculer le joueur le plus proche']],
  touch: 'flèches + bouton 💥 sous le jeu',
  icon: '🕳️',
  desc: 'Reste sur le bon symbole, pousse les autres',
  title: 'Sol instable',
  min: 2,
  rules: "Un symbole s'affiche : seules les dalles avec CE symbole tiennent. Quand la barre est vide, tout le reste s'effondre pendant 1,5 s : tu tombes si ton personnage est au-dessus du vide. Les dalles fissurées ⚠️ tombent pour de bon. Pousse les autres dans le vide ! Dernier debout gagne.",
  create(room) {
    const n = room.n, C = 8, R = 6, T = 80, W = C * T, H = R * T, DT = 1 / 30;
    const A = makeArena(room, { W, H, SP: 220, PR: 12, spawn: circleSpawn(W, H, 170, 110) });
    const removed = new Array(C * R).fill(false);
    let tiles = [], target = 0, holes = null, phase = 0, t = 0, crack = [];
    const deathT = new Array(n).fill(Infinity);
    const tileAt = (x, y) => Math.max(0, Math.min(R - 1, Math.floor(y / T))) * C + Math.max(0, Math.min(C - 1, Math.floor(x / T)));
    const hole = (x, y) => { const k = tileAt(x, y); return removed[k] || (holes && holes[k]); };
    // on tombe quand le CENTRE du perso est au-dessus du vide (6 px de tolérance) : c'est ce que le joueur voit
    const G = 6;
    const falls = (p) => hole(p.x, p.y) && hole(p.x - G, p.y) && hole(p.x + G, p.y) && hole(p.x, p.y - G) && hole(p.x, p.y + G);

    function newPhase() {
      phase++;
      target = ri(0, 3);
      const live = range(C * R).filter((x) => !removed[x]);
      // dès la 2e vague, 4 dalles fissurées (annoncées pendant l'alerte) tombent pour de bon avec l'effondrement
      crack = phase > 1 && live.length > 12 ? shuffle([...live]).slice(0, 4) : [];
      const cand = live.filter((x) => !crack.includes(x));
      const frac = Math.max(0.07, 0.26 - phase * 0.03);
      const safe = new Set(shuffle([...cand]).slice(0, Math.max(2, Math.round(cand.length * frac))));
      tiles = range(C * R).map((x) => (removed[x] ? -1 : safe.has(x) ? target : pick([0, 1, 2, 3].filter((v) => v !== target))));
      holes = null;
      const warn = Math.max(1500, 3200 - phase * 220);
      room.send({ t: 'g', k: 'ph', tiles, target, ms: warn, phase, crack });
      room.later(drop, warn);
    }
    function drop() {
      holes = tiles.map((v, k) => v !== target || crack.includes(k));
      crack.forEach((k) => { removed[k] = true; });
      room.send({ t: 'g', k: 'drop', crack });
      room.later(() => { holes = null; crack = []; room.send({ t: 'g', k: 'restore' }); room.later(newPhase, 700); }, 1400);
    }
    function step() {
      t += DT;
      A.move(DT);
      const died = [];
      A.pl.forEach((p, i) => { if (p.alive && falls(p)) died.push(i); });
      died.forEach((i) => { A.pl[i].alive = false; deathT[i] = t; });
      room.send({ t: 'g', k: 's', p: A.snap() });
      died.forEach((i) => room.send({ t: 'g', k: 'fall', i, x: Math.round(A.pl[i].x), y: Math.round(A.pl[i].y) }));
      died.forEach((i) => room.eliminate(i));
      if (room.survivalOver(A.pl.map((p) => p.alive)) || t > 120) room.finish(deathT);
    }
    return {
      start() {
        room.send({ t: 'g', k: 'floor', w: W, h: H, c: C, r: R, tile: T, sym: FLOOR_SYM, pr: A.PR });
        room.every(step, 1000 / 30);
        room.later(newPhase, 800);
      },
      input(i, m) { A.input(i, m); },
    };
  },
};

// ───────────────────────── PAUSE CLOPE ─────────────────────────
GAMES.smoke = {
  keys: [[[['Espace']], 'MAINTENIR pour tirer, RELÂCHER dans la zone verte']],
  touch: 'maintiens le gros bouton',
  icon: '🚬',
  desc: 'Tire sur ta clope sans tousser',
  title: 'Pause clope',
  min: 2,
  rules: "Tire sur ta clope et relâche pile dans la zone verte = une taffe. Trop long = tu tousses (bloqué 1,5 s). Trop court = taffe gâchée. Chaque taffe a son propre rythme. 25 secondes : le pire fumeur se fait abattre.",
  create(room) {
    const n = room.n, LO = 75, HI = 93;
    const st = range(n).map(() => ({ s: 'idle', t: 0, fill: 1400, tm: null }));
    const puffs = new Array(n).fill(0);
    const newFill = () => ri(380, 1100);
    let live = false;
    function setIdle(i) { st[i].s = 'idle'; st[i].fill = newFill(); room.send({ t: 'g', k: 'next', fill: st[i].fill }, i); }
    function cough(i) {
      room.cancel(st[i].tm);
      st[i].s = 'cough';
      room.send({ t: 'g', k: 'cough', i });
      st[i].tm = room.later(() => setIdle(i), 1500);
    }
    return {
      start() {
        live = true;
        range(n).forEach((i) => { st[i].fill = newFill(); room.send({ t: 'g', k: 'smoke', fill: st[i].fill, ms: 25000, lo: LO, hi: HI }, i); });
        room.later(() => { live = false; room.finish([...puffs], 'Taffes : ' + range(n).map((i) => `${room.name(i)} ${puffs[i]}`).join(' · ')); }, 25000);
      },
      input(i, m) {
        if (!live) return;
        const S = st[i];
        if (m.a === 'in') {
          if (S.s === 'out') return cough(i);
          if (S.s !== 'idle') return;
          S.s = 'in'; S.t = Date.now();
          S.tm = room.later(() => { if (S.s === 'in') cough(i); }, S.fill);
        } else if (m.a === 'out') {
          if (S.s !== 'in') return;
          room.cancel(S.tm);
          const lung = ((Date.now() - S.t) / S.fill) * 100;
          const ok = lung >= LO && lung <= HI;
          if (ok) puffs[i]++;
          room.send({ t: 'g', k: 'puff', i, ok, lung: Math.round(lung), puffs });
          S.s = 'out';
          S.tm = room.later(() => setIdle(i), 350);
        }
      },
    };
  },
};

// ───────────────────────── BONNES MANIÈRES ─────────────────────────
GAMES.manners = {
  keys: [[[['Espace']], 'MAINTENIR pour manger, RELÂCHER quand Tonton regarde']],
  touch: 'maintiens le gros bouton',
  icon: '🍽️',
  desc: 'Mange quand Tonton ne regarde pas',
  title: 'Bonnes manières',
  min: 2,
  rules: "Mange ton assiette… mais quand Tonton Gérard baisse son journal, ARRÊTE-TOI ou il te flingue à table. Il froisse son journal juste avant. Premier à finir son assiette gagne.",
  create(room) {
    const n = room.n, DT = 0.05, RATE = 11;
    const pr = new Array(n).fill(0), eat = new Array(n).fill(false), alive = new Array(n).fill(true), deathT = new Array(n).fill(0);
    const race = new Race(room);
    let ph = 'read', lookAt = 0, t = 0;
    const scores = () => range(n).map((i) => (race.done[i] ? 3e6 - race.order.indexOf(i) : alive[i] ? 2e6 + pr[i] : deathT[i]));
    const end = () => room.finish(scores());
    const check = () => { if (room.survivalOver(range(n).map((i) => alive[i] && !race.done[i]))) end(); };
    const shoot = (i) => { alive[i] = false; eat[i] = false; deathT[i] = t; room.send({ t: 'g', k: 'bang', i }); room.eliminate(i); };
    function cycle() {
      ph = 'read'; room.send({ t: 'g', k: 'ph', ph });
      room.later(() => {
        ph = 'rustle'; room.send({ t: 'g', k: 'ph', ph });
        room.later(() => {
          ph = 'look'; lookAt = Date.now(); room.send({ t: 'g', k: 'ph', ph });
          room.later(cycle, 1200 + Math.random() * 1600);
        }, 300 + Math.random() * 350);
      }, 1200 + Math.random() * 2600);
    }
    function step() {
      t += DT;
      range(n).forEach((i) => {
        if (!alive[i] || race.done[i] || !eat[i]) return;
        if (ph === 'look') { if (Date.now() - lookAt > 180) shoot(i); return; }
        pr[i] = Math.min(100, pr[i] + RATE * DT);
        if (pr[i] >= 100) { eat[i] = false; race.finish(i, end); }
      });
      room.send({ t: 'g', k: 's', pr: pr.map(Math.round), e: eat, al: alive });
      check();
    }
    return {
      start() { room.send({ t: 'g', k: 'table' }); cycle(); room.every(step, DT * 1000); room.later(end, 60000); },
      input(i, m) {
        if (!alive[i] || race.done[i]) return;
        if (m.a === 'eat') { eat[i] = true; if (ph === 'look' && Date.now() - lookAt > 180) { shoot(i); check(); } }
        if (m.a === 'stop') eat[i] = false;
      },
    };
  },
};

// ───────────────────────── L'ARAIGNÉE ─────────────────────────
GAMES.bomb = {
  team: { rule: "En équipe : impossible de refiler l'araignée à un coéquipier, seulement aux adversaires." },
  keys: [[[['⬆', '⬇', '⬅', '➡'], ['Z', 'Q', 'S', 'D']], 'se déplacer']],
  touch: 'flèches sous le jeu',
  icon: '🕷️',
  desc: "Refile l'araignée-bombe avant qu'elle pète",
  title: "L'Araignée",
  min: 2,
  rules: "Une araignée-bombe s'accroche à quelqu'un. Touche un autre joueur pour la lui refiler (pas de retour immédiat). Quand le compteur arrive à zéro, son porteur explose. Les piliers bloquent. Dernier vivant gagne.",
  create(room) {
    const n = room.n, W = 800, H = 500, DT = 1 / 30;
    const rects = [[180, 120, 60, 60], [560, 120, 60, 60], [180, 320, 60, 60], [560, 320, 60, 60], [370, 220, 60, 60]];
    const A = makeArena(room, { W, H, SP: 225, PR: 13, rects, spawn: circleSpawn(W, H, 330, 200) });
    const deathT = new Array(n).fill(Infinity);
    let holder = -1, prev = -1, fuse = 0, grab = 0, t = 0, pause = 2.2, first = true;
    const aliveIdx = () => range(n).filter((i) => A.pl[i].alive);
    function arm() { const a = aliveIdx(); const fresh = first && a.length > 1 ? a.filter((i) => i !== room.bombFirst) : a; holder = pick(fresh); if (first) room.bombFirst = holder; prev = -1; fuse = first ? 17 + Math.random() * 5 : 8 + Math.random() * 6; first = false; grab = 1; room.send({ t: 'g', k: 'arm', i: holder }); }
    function step() {
      t += DT;
      A.move(DT, (i) => (i === holder ? 255 : 225));
      if (pause > 0) { pause -= DT; if (pause <= 0) arm(); }
      else if (holder >= 0) {
        fuse -= DT; grab -= DT;
        const h = A.pl[holder];
        if (grab <= 0) {
          const j = A.pl.findIndex((q, k) => k !== holder && k !== prev && q.alive && room.sideOf[k] !== room.sideOf[holder] && Math.hypot(q.x - h.x, q.y - h.y) < A.PR * 2 + 4);
          if (j >= 0) { prev = holder; holder = j; grab = 0.6; room.send({ t: 'g', k: 'pass', i: j }); }
        }
        if (prev >= 0 && grab < -0.4) prev = -1;
        if (fuse <= 0) {
          const v = holder;
          A.pl[v].alive = false; deathT[v] = t;
          room.send({ t: 'g', k: 'boom', i: v, x: Math.round(h.x), y: Math.round(h.y) });
          room.eliminate(v);
          holder = -1; pause = 1.6;
        }
      }
      room.send({ t: 'g', k: 's', p: A.snap(), h: holder, f: holder >= 0 ? Math.max(0, Math.ceil(fuse)) : null });
      if (room.survivalOver(A.pl.map((p) => p.alive)) || t > 150) room.finish(deathT);
    }
    return {
      start() { room.send({ t: 'g', k: 'bomb', w: W, h: H, rects, pr: A.PR }); room.every(step, 1000 / 30); },
      input(i, m) { if (m.a === 'mv') A.input(i, m); },
    };
  },
};

// ───────────────────────── CHAMP DE MINES ─────────────────────────
GAMES.mines = {
  team: { rule: "En équipe : tu ne peux bousculer que les adversaires. Les places de chaque équipe s'additionnent.", sum: true },
  keys: [[[['⬆', '⬇', '⬅', '➡'], ['Z', 'Q', 'S', 'D']], 'se déplacer'], [[['Espace']], 'bousculer un joueur (sur une mine, c\'est cadeau)'], [[['Immobile 1 s']], 'sonar : révèle les mines proches']],
  touch: 'flèches + bouton 💥 sous le jeu',
  icon: '💥',
  desc: 'Traverse, la moissonneuse arrive',
  title: 'Champ de mines',
  min: 2,
  rules: "Traverse jusqu'à la sortie (à droite) avant la moissonneuse. Les mines sont invisibles : reste IMMOBILE 1 s pour les détecter autour de toi.",
  create(room) {
    const n = room.n, L = 2600, H = 420, DT = 1 / 30, MR = 16, BLAST = 38;
    const A = makeArena(room, { W: L, H, SP: 190, PR: 12, spawn: (i, nn) => [60, H * (i + 1) / (nn + 1)] });
    const mines = [];
    while (mines.length < 105) {
      const x = 220 + Math.random() * (L - 340), y = 20 + Math.random() * (H - 40);
      if (mines.every((m) => Math.hypot(m.x - x, m.y - y) > 50)) mines.push({ x, y, on: true });
    }
    const known = range(n).map(() => new Set());
    const deathT = new Array(n).fill(0);
    const race = new Race(room);
    let hv = -260, t = 0;
    const scores = () => range(n).map((i) => (race.done[i] ? 3e6 - race.order.indexOf(i) : A.pl[i].alive ? 2e6 + A.pl[i].x : deathT[i]));
    const end = () => room.finish(scores());
    function kill(i) { const p = A.pl[i]; if (!p.alive) return; p.alive = false; deathT[i] = t; room.eliminate(i); }
    function step() {
      t += DT;
      hv += (65 + t * 3) * DT;
      A.move(DT);
      A.pl.forEach((p, i) => {
        if (!p.alive || race.done[i]) return;
        if (p.x < hv + 34) kill(i);
        mines.forEach((m, k) => {
          if (!m.on || Math.hypot(p.x - m.x, p.y - m.y) > MR) return;
          m.on = false;
          room.send({ t: 'g', k: 'boom', x: Math.round(m.x), y: Math.round(m.y), m: k });
          A.pl.forEach((q, j) => { if (q.alive && !race.done[j] && Math.hypot(q.x - m.x, q.y - m.y) < BLAST) kill(j); });
        });
        if (p.alive && p.still >= 0.9) {
          const fresh = [];
          mines.forEach((m, k) => { if (m.on && !known[i].has(k) && Math.hypot(p.x - m.x, p.y - m.y) < 150) { known[i].add(k); fresh.push([k, Math.round(m.x), Math.round(m.y)]); } });
          if (fresh.length) room.send({ t: 'g', k: 'rev', m: fresh }, i);
        }
        if (p.alive && p.x >= L - 30) { p.dx = p.dy = 0; race.finish(i, end); }
      });
      room.send({ t: 'g', k: 's', p: A.snap(), hv: Math.round(hv), st: A.pl.map((p) => (p.still >= 0.9 ? 1 : 0)) });
      if (room.survivalOver(range(n).map((i) => A.pl[i].alive && !race.done[i])) && !race.order.length) end();
      else if (range(n).every((i) => !A.pl[i].alive || race.done[i])) end();
    }
    return {
      start() { room.send({ t: 'g', k: 'mines', l: L, h: H, pr: A.PR }); room.every(step, 1000 / 30); room.later(end, 80000); },
      input(i, m) { if (!race.done[i]) A.input(i, m); },
    };
  },
};

// ───────────────────────── UNDERCOVER ─────────────────────────
const UC_PAIRS = [
  ['Pizza', 'Tarte flambée'], ['Chat', 'Chien'], ['Plage', 'Piscine'], ['Bière', 'Cidre'], ['Netflix', 'YouTube'],
  ['Douche', 'Bain'], ['Kebab', 'Tacos'], ['Slip', 'Caleçon'], ['Pet', 'Rot'], ['McDo', 'Burger King'],
  ['Tinder', 'Meetic'], ['Vodka', 'Tequila'], ['Camping', 'Festival'], ['Prof', 'Surveillant'], ['Raclette', 'Fondue'],
  ['Licorne', 'Pégase'], ['Moustache', 'Barbe'], ['Sauna', 'Hammam'], ['Tracteur', 'Moissonneuse'], ['Mamie', 'Belle-mère'],
  ['Aubergine', 'Courgette'], ['PQ', 'Sopalin'], ['Gueule de bois', 'Mal de mer'], ['Strip-tease', 'Pole dance'],
  ['Ex', 'Crush'], ['Pigeon', 'Mouette'], ['Crêpe', 'Galette'], ['String', 'Tanga'], ['Vomi', 'Diarrhée'],
  ['Enterrement de vie de garçon', 'Mariage'], ['Pompier', 'Policier'], ['Taiwan', 'Japon'], ['Tétine', 'Biberon'],
  ['Menottes', 'Bracelet'], ['Fromage qui pue', 'Pieds qui puent'], ['Kinder Bueno', 'Twix'], ['Chauve', 'Rasé'],
];
const norm = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');

GAMES.undercover = {
  keys: [[[['Clavier'], ['Entrée']], 'écrire UN mot d\'indice et l\'envoyer'], [[['Clic']], 'voter contre un joueur (ou 🎯 deviner en duel)']],
  icon: '🕵️',
  desc: "Trouve l'intrus (vocal conseillé)",
  title: 'Undercover',
  min: 2,
  noBots: true, // jeu de bluff à l'oral : pas jouable avec des bots
  intro: 7000,
  rules: (n) => (n === 2
    ? "Duel : chacun a un mot proche de celui de l'autre. À ton tour, donne UN SEUL mot d'indice, ou tente de deviner son mot (2 essais max). Attention, tes indices l'aident aussi à trouver le tien. Indice trop proche de ton mot = refusé."
    : "Tout le monde a le même mot… sauf l'undercover, qui a un mot proche (et ne sait pas qu'il est undercover !). À partir de 6 joueurs, il y a aussi un Mr White 🎩 qui n'a AUCUN mot et doit bluffer ; s'il est éliminé, il a une chance de deviner le mot des civils pour gagner seul. À ton tour, donne UN SEUL mot d'indice, puis tout le monde vote pour éliminer un intrus. Les intrus gagnent s'ils sont aussi nombreux que les civils. Jouez en vocal !"),
  create(room) {
    const n = room.n;
    if (n === 2) return undercoverDuel(room);
    const pair = shuffle([...pick(UC_PAIRS)]);
    // répartition : ≤ 5 → 1 undercover · 6-7 → 1 undercover + Mr White · 8+ → 2 undercovers + Mr White
    const nu = n >= 8 ? 2 : 1, nw = n >= 6 ? 1 : 0;
    const roles = shuffle(range(n));
    const uc = new Set(roles.slice(0, nu)), mw = new Set(roles.slice(nu, nu + nw));
    const intrus = (i) => uc.has(i) || mw.has(i);
    const word = (i) => (mw.has(i) ? '' : uc.has(i) ? pair[1] : pair[0]);
    const roleOf = (i) => (mw.has(i) ? 'mrwhite' : uc.has(i) ? 'undercover' : 'civil');
    let mwTimer = null;
    const alive = new Array(n).fill(true);
    let phase = 'idle', order = [], turn = 0, cycle = 0, turnTimer = null, voteTimer = null;
    let votes = new Map();

    const aliveIdx = () => range(n).filter((i) => alive[i]);

    function cycleStart() {
      cycle++;
      const a = aliveIdx();
      const s = (cycle - 1) % a.length;
      order = [...a.slice(s), ...a.slice(0, s)];
      // Mr White ne parle jamais en premier (il n'a aucun indice pour s'inspirer)
      if (order.length > 1 && mw.has(order[0])) order.push(order.shift());
      turn = 0;
      room.send({ t: 'g', k: 'cycle', cycle });
      nextTurn();
    }
    function nextTurn() {
      if (turn >= order.length) return voteStart();
      const i = order[turn];
      phase = 'clue';
      room.send({ t: 'g', k: 'turn', i, ms: 30000 });
      turnTimer = room.later(() => giveClue(i, '… (rien)'), 30000);
    }
    function giveClue(i, text) {
      if (phase !== 'clue' || order[turn] !== i) return;
      room.cancel(turnTimer);
      phase = 'gap';
      room.send({ t: 'g', k: 'clue', i, text, cycle });
      turn++;
      room.later(nextTurn, 700);
    }
    function voteStart() {
      phase = 'vote';
      votes = new Map();
      room.send({ t: 'g', k: 'vote', ms: 45000 });
      voteTimer = room.later(voteEnd, 45000);
    }
    function voteEnd() {
      if (phase !== 'vote') return;
      phase = 'reveal';
      room.cancel(voteTimer);
      const tally = new Array(n).fill(0);
      votes.forEach((target) => { tally[target]++; });
      const max = Math.max(...tally);
      const cands = max === 0 ? aliveIdx() : range(n).filter((i) => tally[i] === max);
      const out = pick(cands);
      alive[out] = false;
      const role = roleOf(out);
      room.send({ t: 'g', k: 'out', i: out, role, tally, tie: cands.length > 1 }); // le mot n'est révélé qu'à la fin
      room.eliminate(out, { role });
      // Mr White éliminé : une seule tentative pour deviner le mot des civils (30 s)
      if (role === 'mrwhite') {
        phase = 'mwguess';
        room.later(() => {
          room.send({ t: 'g', k: 'mwguess', i: out, ms: 30000 });
          mwTimer = room.later(() => mwGuess(out, ''), 30000);
        }, 2500);
        return;
      }
      afterOut();
    }
    function afterOut() {
      const inAlive = aliveIdx().filter(intrus).length;
      const civAlive = aliveIdx().length - inAlive;
      if (inAlive === 0) return room.later(() => end('civ'), 4000);
      if (inAlive >= civAlive) return room.later(() => end('uc'), 4000);
      room.later(cycleStart, 5000);
    }
    function mwGuess(i, text) {
      if (phase !== 'mwguess') return;
      room.cancel(mwTimer);
      phase = 'reveal';
      const ok = !!text && sameWord(text, pair[0]);
      room.send({ t: 'g', k: 'mwres', i, text: text || '… (rien)', ok });
      if (ok) return room.later(() => end('mw'), 3000);
      room.later(afterOut, 2500);
    }
    function end(w) {
      // civ : les civils gagnent · uc : tous les intrus (undercovers + Mr White) · mw : Mr White seul
      const sc = range(n).map((i) => (w === 'civ' ? !intrus(i) : w === 'uc' ? intrus(i) : mw.has(i)) ? 1 : 0);
      const names = (set) => [...set].map((i) => room.name(i)).join(' & ');
      const head = w === 'mw' ? `🎩 Mr White (${names(mw)}) a deviné le mot et gagne seul` : w === 'uc' ? 'Victoire des intrus' : 'Victoire des civils';
      room.finish(sc, `${head} ! Mot civil : « ${pair[0]} » · Mot undercover : « ${pair[1]} » (${names(uc)})${nw ? ` · Mr White : ${names(mw)}` : ''}`);
    }

    return {
      start() {
        range(n).forEach((i) => room.send({ t: 'g', k: 'word', word: word(i), nu, nw, mw: mw.has(i) }, i));
        room.later(cycleStart, 5000);
      },
      input(i, m) {
        if (m.a === 'clue') {
          if (phase !== 'clue' || order[turn] !== i) return;
          const text = String(m.text || '').trim().slice(0, 20);
          if (!text) return;
          const bad = clueProblem(text, word(i));
          if (bad) return room.send({ t: 'g', k: 'nope', msg: bad }, i);
          giveClue(i, text);
        } else if (m.a === 'mwguess') {
          if (phase === 'mwguess' && mw.has(i)) mwGuess(i, String(m.text || '').trim().slice(0, 30));
        } else if (m.a === 'vote') {
          const target = m.target | 0;
          if (phase !== 'vote' || !alive[i] || !alive[target] || target === i) return;
          votes.set(i, target);
          room.send({ t: 'g', k: 'voted', who: [...votes.keys()] });
          if (votes.size === aliveIdx().length) voteEnd();
        }
      },
    };
  },
};

// Variante 1v1 : chacun a un mot différent de la même paire.
// À ton tour : donne un indice OU tente de deviner le mot de l'autre. 2 erreurs = perdu.
function lev(a, b) {
  const d = range(b.length + 1);
  for (let i = 1; i <= a.length; i++) {
    let prev = d[0]; d[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = d[j];
      d[j] = Math.min(d[j] + 1, d[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return d[b.length];
}
// Anti-triche : un seul mot, et rien qui ressemble à son propre mot (morceau, même racine, faute de frappe…)
function clueProblem(text, word) {
  if (/\s/.test(text.trim())) return 'Un seul mot ! (pas d\'espace)';
  // lettres seulement (accents, tiret et apostrophe tolérés) : pas de « mot_mot_mot » pour tricher
  if (!/^[\p{L}][\p{L}'’-]*$/u.test(text.trim())) return 'Des lettres seulement !';
  if (text.trim().length > 16) return 'Mot trop long (16 lettres max).';
  const a = norm(text);
  if (a.length < 2) return 'Indice trop court.';
  const parts = word ? [norm(word), ...word.split(/[\s'’-]+/).map(norm)].filter((w) => w.length >= 3) : []; // Mr White n'a pas de mot
  for (const w of parts) {
    if (a.includes(w) || w.includes(a)) return 'Interdit : ça contient ton mot (ou l\'inverse) !';
    let pre = 0; while (pre < a.length && pre < w.length && a[pre] === w[pre]) pre++;
    if (pre >= 4 || (pre >= 3 && Math.min(a.length, w.length) <= 5)) return 'Trop proche de ton mot (même début) !';
    if (lev(a, w) / Math.max(a.length, w.length) <= 0.4) return 'Trop proche de ton mot !';
  }
  return null;
}
const sameWord = (a, b) => { const x = norm(a), y = norm(b); return x === y || (y.length > 4 && lev(x, y) <= 1); };

function undercoverDuel(room) {
  const pair = shuffle([...pick(UC_PAIRS)]);
  const lives = [2, 2], MAXT = 12;
  let turn = ri(0, 1), count = 0, phase = 'idle', tt = null;
  const reveal = () => `${room.name(0)} avait « ${pair[0]} », ${room.name(1)} avait « ${pair[1]} »`;

  function nextTurn() {
    if (count >= MAXT) return room.finish([0, 0], `Personne n'a trouvé ! ${reveal()}`);
    phase = 'turn';
    room.send({ t: 'g', k: 'turn', i: turn, ms: 35000, left: MAXT - count });
    tt = room.later(() => clue(turn, '… (rien)'), 35000);
  }
  function advance() { phase = 'gap'; count++; turn = 1 - turn; room.later(nextTurn, 700); }
  function clue(i, text) {
    if (phase !== 'turn' || i !== turn) return;
    room.cancel(tt);
    room.send({ t: 'g', k: 'clue', i, text });
    advance();
  }
  return {
    start() {
      [0, 1].forEach((i) => room.send({ t: 'g', k: 'word', word: pair[i], duel: true, lives }, i));
      room.later(nextTurn, 4000);
    },
    input(i, m) {
      if (phase !== 'turn' || i !== turn) return;
      const text = String(m.text || '').trim().slice(0, 24);
      if (!text) return;
      if (m.a === 'clue') {
        const bad = clueProblem(text.slice(0, 20), pair[i]);
        if (bad) return room.send({ t: 'g', k: 'nope', msg: bad }, i);
        clue(i, text.slice(0, 20));
      } else if (m.a === 'guess') {
        room.cancel(tt);
        if (sameWord(text, pair[1 - i])) {
          phase = 'done';
          room.send({ t: 'g', k: 'guess', i, text, ok: true, lives });
          room.later(() => room.finish(i === 0 ? [1, 0] : [0, 1], `${room.name(i)} a trouvé ! ${reveal()}`), 1800);
        } else {
          lives[i]--;
          room.send({ t: 'g', k: 'guess', i, text, ok: false, lives });
          if (lives[i] <= 0) {
            phase = 'done';
            room.eliminate(i);
            room.later(() => room.finish(i === 0 ? [0, 1] : [1, 0], `${room.name(i)} a grillé ses 2 essais. ${reveal()}`), 2500);
          } else advance();
        }
      }
    },
  };
}

// ───────────────────────── TANK ─────────────────────────
GAMES.tank = {
  team: { rule: "En équipe : pas de tir ami. La dernière équipe avec un tank debout gagne." },
  keys: [[[['Z', 'Q', 'S', 'D']], 'rouler'], [[['⬆', '⬇', '⬅', '➡']], 'orienter le canon'], [[['Espace']], 'tirer (maintenir = rafale)']],
  touch: 'le pad roule ET vise, bouton 💥 pour tirer',
  icon: '🪖',
  desc: 'ZQSD pour rouler, flèches pour viser, 2 vies',
  title: 'Tank',
  min: 2,
  rules: "Les obus rebondissent une fois sur les murs. Les caisses en bois cassent en 3 tirs, les blocs en métal jamais. 2 vies chacun, pas de tir ami en équipe. Dernier camp debout gagne.",
  create(room) {
    const n = room.n, W = 800, H = 500, DT = 1 / 30, PR = 15;
    const BS = 430, BR = 5, CD = 0.45, LIVES = 2, INV = 1.5;
    const spawn = circleSpawn(W, H, 330, 195);
    const spawns = range(n).map((i) => spawn(i, n));
    // obstacles : on en place la moitié puis on les reflète par rapport au centre (carte équitable)
    const boxes = [];
    const free = (x, y, w, h) => x > 20 && y > 20 && x + w < W - 20 && y + h < H - 20
      && spawns.every(([sx, sy]) => Math.max(Math.abs(sx - (x + w / 2)) - w / 2, Math.abs(sy - (y + h / 2)) - h / 2) > 55)
      && boxes.every((b) => x > b.x + b.w + 34 || x + w < b.x - 34 || y > b.y + b.h + 34 || y + h < b.y - 34);
    for (let tries = 0; boxes.length < 14 && tries < 400; tries++) {
      const w = pick([40, 40, 50, 80]), h = w === 80 ? 40 : pick([40, 50, 80]);
      const x = ri(30, W - 30 - w), y = ri(30, H - 30 - h);
      const mx = W - x - w, my = H - y - h;
      if (!free(x, y, w, h)) continue;
      const metal = Math.random() < 0.3;
      boxes.push({ x, y, w, h, hp: 3, metal });
      if (Math.abs(mx - x) > w + 34 || Math.abs(my - y) > h + 34) {
        if (free(mx, my, w, h)) boxes.push({ x: mx, y: my, w, h, hp: 3, metal });
        else boxes.pop();
      }
    }
    boxes.forEach((b, k) => { b.id = k; });
    const rects = [];
    const syncRects = () => { rects.length = 0; boxes.forEach((b) => { if (b.hp > 0) rects.push([b.x, b.y, b.w, b.h]); }); };
    syncRects();
    const A = makeArena(room, { W, H, SP: 165, PR, rects, spawn });
    const pl = A.pl;
    pl.forEach((p) => { p.aim = Math.atan2(H / 2 - p.y, W / 2 - p.x); p.lives = LIVES; p.inv = 0; p.cd = 0; });
    const deathT = new Array(n).fill(0);
    let bullets = [], t = 0;

    const inBox = (x, y) => boxes.find((b) => b.hp > 0 && x > b.x - BR && x < b.x + b.w + BR && y > b.y - BR && y < b.y + b.h + BR);
    function hit(i, by) {
      const p = pl[i];
      p.lives--; p.inv = INV;
      room.send({ t: 'g', k: 'hit', i, by, l: p.lives });
      if (p.lives <= 0) { p.alive = false; deathT[i] = t; room.eliminate(i); }
    }
    const scores = () => range(n).map((i) => (pl[i].alive ? 1e6 + pl[i].lives : deathT[i]));
    function step() {
      t += DT;
      A.move(DT); // décrémente aussi p.cd, qui sert ici de recharge du canon
      pl.forEach((p) => { if (p.inv > 0) p.inv -= DT; });
      bullets.forEach((b) => {
        b.x += b.vx * DT; b.y += b.vy * DT; b.life -= DT;
        if (b.x < BR || b.x > W - BR) { if (b.bounce--) { b.vx = -b.vx; b.x = Math.max(BR, Math.min(W - BR, b.x)); } else b.life = 0; }
        if (b.y < BR || b.y > H - BR) { if (b.bounce--) { b.vy = -b.vy; b.y = Math.max(BR, Math.min(H - BR, b.y)); } else b.life = 0; }
        if (b.life <= 0) return;
        const box = inBox(b.x, b.y);
        if (box) {
          b.life = 0;
          if (!box.metal) {
            box.hp--;
            if (box.hp <= 0) syncRects();
          }
          room.send({ t: 'g', k: 'box', id: box.id, hp: box.hp, x: Math.round(b.x), y: Math.round(b.y) });
          return;
        }
        for (let i = 0; i < n; i++) {
          const p = pl[i];
          if (!p.alive || p.inv > 0) continue;
          if (i === b.o && b.age < 0.25) continue;
          if (i !== b.o && room.sideOf[i] === room.sideOf[b.o]) continue; // pas de tir ami
          if (Math.hypot(p.x - b.x, p.y - b.y) < PR + BR) { b.life = 0; hit(i, b.o); break; }
        }
        b.age += DT;
      });
      bullets = bullets.filter((b) => b.life > 0);
      room.send({
        t: 'g', k: 's',
        p: pl.map((p) => [Math.round(p.x), Math.round(p.y), p.alive ? 1 : 0, Math.round(p.aim * 100), p.lives, p.inv > 0 ? 1 : 0]),
        b: bullets.map((b) => [Math.round(b.x), Math.round(b.y), b.o]),
      });
      if (room.survivalOver(pl.map((p) => p.alive))) room.finish(scores());
    }

    return {
      start() {
        room.send({ t: 'g', k: 'tank', w: W, h: H, pr: PR, br: BR, boxes: boxes.map((b) => [b.x, b.y, b.w, b.h, b.metal ? 1 : 0, b.hp]) });
        room.every(step, 1000 / 30);
        room.later(() => room.finish(scores(), 'Temps écoulé : classement aux vies restantes.'), 120000);
      },
      input(i, m) {
        const p = pl[i]; if (!p || !p.alive) return;
        if (m.a === 'mv') return A.input(i, m);
        if (m.a === 'aim') {
          const x = Math.sign(Number(m.x) || 0), y = Math.sign(Number(m.y) || 0);
          if (x || y) p.aim = Math.atan2(y, x);
          return;
        }
        if (m.a === 'fire' && p.cd <= 0 && bullets.filter((b) => b.o === i).length < 3) {
          p.cd = CD;
          const cx = Math.cos(p.aim), cy = Math.sin(p.aim);
          const x = p.x + cx * (PR + 8), y = p.y + cy * (PR + 8);
          bullets.push({ x, y, vx: cx * BS, vy: cy * BS, o: i, life: 2.6, bounce: 1, age: 0 });
          room.send({ t: 'g', k: 'fire', i });
        }
      },
    };
  },
};

// ───────────────────────── GÂCHETTE (duel de plateformes, balles soumises à la gravité) ─────────────────────────
// Vue de côté. Physique serveur à 60 Hz (2 sous-pas par image réseau) :
//  - course avec accélération / freinage, saut à hauteur variable, « coyote time », saut mémorisé,
//    glissade et saut sur les murs, plateformes traversables par en dessous (et par le haut avec ⬇)
//  - balles balistiques (gravité), recul du tireur, projection de la cible
//  - 2 vies, chacune avec 100 PV ; chargeur de 3 balles qui se recharge
const GUN_MAPS = [
  { name: 'Arène', pit: null, rects: [
    [0, 440, 800, 40, 0], [70, 330, 170, 14, 1], [560, 330, 170, 14, 1], [345, 255, 110, 30, 0],
    [150, 175, 150, 14, 1], [500, 175, 150, 14, 1], [372, 110, 56, 14, 1],
  ] },
  { name: 'Les tours', pit: null, rects: [
    [0, 440, 800, 40, 0], [175, 290, 44, 150, 0], [581, 290, 44, 150, 0], [90, 290, 85, 14, 1], [625, 290, 85, 14, 1],
    [320, 195, 160, 14, 1], [372, 395, 56, 45, 0], [40, 180, 110, 14, 1], [650, 180, 110, 14, 1],
  ] },
  // gouffre de 160 px : franchissable d'un saut en pleine course, mais une projection au mauvais moment est fatale
  { name: 'Le gouffre', pit: [320, 480], rects: [
    [0, 440, 320, 40, 0], [480, 440, 320, 40, 0], [330, 330, 140, 14, 1], [60, 230, 160, 14, 1], [580, 230, 160, 14, 1],
    [360, 150, 80, 26, 0], [260, 380, 60, 60, 0], [480, 380, 60, 60, 0],
  ] },
];
GAMES.gun = {
  team: { rule: 'En équipe : pas de tir ami. La dernière équipe debout gagne.' },
  keys: [[[['Q', 'D'], ['⬅', '➡']], 'courir'], [[['Z'], ['Espace']], 'sauter (maintenir = plus haut, contre un mur = saut mural)'], [[['S']], 'traverser une planche vers le bas'], [[['Souris'], ['⬆', '⬇']], 'viser'], [[['Clic'], ['Entrée']], 'tirer']],
  touch: 'boutons pour courir et sauter, touche l\'écran de jeu pour viser et tirer',
  icon: '🔫',
  desc: 'Duel de plateformes, balles qui tombent, 2 vies',
  title: 'Gâchette',
  min: 2,
  rules: "Duel de plateformes. Tes balles tombent avec la gravité : vise un peu au-dessus de loin. Chaque tir te repousse et projette la cible. 2 vies de 100 PV, 3 balles par chargeur. Tomber dans le vide coûte une vie. Dernier camp debout gagne.",
  create(room) {
    const n = room.n, W = 800, H = 480, NET = 1 / 30, DT = 1 / 60;
    const { PW, PH, BUFFER } = GunPhys.K; // demi-largeur / demi-hauteur du joueur, saut mémorisé
    const BSP = 860, BG = 950, BR = 4, DMG = 34, CD = 0.26, MAG = 3, RELOAD = 1.3, RECOIL = 210, KNOCK = 330;
    const LIVES = 2, HP = 100, RESPAWN = 1.2, INV = 1.1;
    const map = pick(GUN_MAPS);
    const rects = map.rects.map(([x, y, w, h, one]) => ({ x, y, w, h, one: !!one }));
    // points d'apparition : au-dessus des plateformes, répartis de gauche à droite (camps opposés en équipe)
    const tops = [];
    rects.forEach((r) => { for (let x = r.x + 24; x <= r.x + r.w - 24; x += 46) tops.push([x, r.y - PH - 1]); });
    tops.sort((a, b) => a[0] - b[0]);
    const order = room.twoSides && room.sides.length === 2
      ? range(n).sort((a, b) => room.sideOf[a] - room.sideOf[b] || a - b)
      : shuffle(range(n));
    const spawnAt = (slot) => {
      const k = Math.round((slot + 0.5) * (tops.length / n) - 0.5);
      return tops[Math.max(0, Math.min(tops.length - 1, k))];
    };
    const spawnOf = new Array(n);
    order.forEach((i, slot) => { spawnOf[i] = spawnAt(slot); });

    const pl = range(n).map((i) => {
      const [x, y] = spawnOf[i];
      return {
        x, y, vx: 0, vy: 0, ground: false, wall: 0, coyote: 0, buf: 0, jumpHeld: false, mx: 0, down: false,
        aim: x < W / 2 ? -0.35 : Math.PI + 0.35, cd: 0, ammo: MAG, reload: 0, lives: LIVES, hp: HP,
        alive: true, out: 0, inv: INV,
      };
    });
    const deathT = new Array(n).fill(0);
    let bullets = [], t = 0;

    const world = { W, rects };
    const solidHit = (x, y, w, h) => GunPhys.solidHit(rects, x, y, w, h);
    // physique partagée avec le navigateur (public/gunphys.js) : la prédiction locale suit exactement le serveur
    function physics(p) {
      const ev = GunPhys.step(p, world);
      if (ev) room.send({ t: 'g', k: 'jump', i: pl.indexOf(p), w: ev === 'wall' ? 1 : 0 });
    }

    function damage(i, by, dmg, kx, ky) {
      const p = pl[i];
      p.hp -= dmg; p.vx += kx; p.vy += ky;
      room.send({ t: 'g', k: 'hit', i, by, hp: Math.max(0, p.hp), l: p.lives, x: Math.round(p.x), y: Math.round(p.y), kx: Math.round(kx), ky: Math.round(ky) });
      if (p.hp <= 0) loseLife(i, by);
    }
    function loseLife(i, by, fell) {
      const p = pl[i];
      p.lives--; p.hp = 0;
      room.send({ t: 'g', k: 'ko', i, by, l: p.lives, fell: fell ? 1 : 0, x: Math.round(p.x), y: Math.round(Math.min(H, p.y)) });
      if (p.lives <= 0) { p.alive = false; p.out = 0; deathT[i] = t; room.eliminate(i); return; }
      p.out = RESPAWN; // réapparition après un court instant
    }
    function respawn(i) {
      const p = pl[i], [x, y] = spawnOf[i];
      Object.assign(p, { x, y, vx: 0, vy: 0, hp: HP, inv: INV, ammo: MAG, reload: 0, out: 0 });
    }

    const scores = () => range(n).map((i) => (pl[i].alive ? 1e6 + pl[i].lives * 1000 + Math.max(0, pl[i].hp) : deathT[i]));
    function step() {
      t += NET;
      for (let s = 0; s < 2; s++) {
        pl.forEach((p, i) => {
          if (!p.alive) return;
          if (p.out > 0) { p.out -= DT; if (p.out <= 0) respawn(i); return; }
          physics(p);
          if (p.inv > 0) p.inv -= DT;
          if (p.cd > 0) p.cd -= DT;
          if (p.reload > 0) { p.reload -= DT; if (p.reload <= 0) p.ammo = MAG; }
          if (p.y - PH > H + 40) loseLife(i, -1, true); // le vide
        });
        bullets.forEach((b) => {
          b.vy += BG * DT;
          const ox = b.x, oy = b.y;
          b.x += b.vx * DT; b.y += b.vy * DT; b.age += DT;
          if (b.x < -20 || b.x > W + 20 || b.y > H + 40 || b.age > 3) { b.dead = true; return; }
          // les planches laissent passer les balles ; les blocs les arrêtent
          if (solidHit(b.x, b.y, BR, BR)) { b.dead = true; room.send({ t: 'g', k: 'spark', x: Math.round(ox), y: Math.round(oy) }); return; }
          for (let i = 0; i < n; i++) {
            const p = pl[i];
            if (!p.alive || p.out > 0 || p.inv > 0) continue;
            if (i === b.o && b.age < 0.2) continue;
            if (i !== b.o && room.sideOf[i] === room.sideOf[b.o]) continue; // pas de tir ami
            if (Math.abs(b.x - p.x) < PW + BR && Math.abs(b.y - p.y) < PH + BR) {
              b.dead = true;
              const sp = Math.hypot(b.vx, b.vy) || 1;
              damage(i, b.o, DMG, (b.vx / sp) * KNOCK, (b.vy / sp) * KNOCK * 0.5 - 170);
              break;
            }
          }
        });
        bullets = bullets.filter((b) => !b.dead);
      }
      room.send({
        t: 'g', k: 's',
        p: pl.map((p) => [Math.round(p.x), Math.round(p.y), !p.alive ? 0 : p.out > 0 ? 2 : 1, Math.round(p.aim * 100), p.lives, Math.max(0, Math.round(p.hp)),
          Math.round(p.vx / 10), Math.round(p.vy / 10), p.inv > 0 ? 1 : 0, p.ammo, p.reload > 0 ? Math.round((1 - p.reload / RELOAD) * 100) : 100, p.ground ? 1 : 0, p.wall]),
        b: bullets.map((b) => [Math.round(b.x), Math.round(b.y), b.o, Math.round(b.vx / 10), Math.round(b.vy / 10)]),
      });
      if (room.survivalOver(pl.map((p) => p.alive))) room.finish(scores());
    }

    return {
      start() {
        room.send({ t: 'g', k: 'gun', w: W, h: H, pw: PW, ph: PH, br: BR, bs: BSP, bg: BG, rc: RECOIL, cd: CD, map: map.name, pit: map.pit, rects: rects.map((r) => [r.x, r.y, r.w, r.h, r.one ? 1 : 0]) });
        room.every(step, 1000 / 30);
        room.later(() => room.finish(scores(), 'Temps écoulé : classement aux vies et aux PV restants.'), 120000);
      },
      input(i, m) {
        const p = pl[i]; if (!p || !p.alive) return;
        if (m.a === 'mv') { p.mx = Math.sign(Number(m.x) || 0); p.down = !!m.down; return; }
        if (m.a === 'jump') { p.jumpHeld = !!m.on; if (m.on) p.buf = BUFFER; return; }
        if (m.a === 'aim') { const a = Number(m.v) / 1000; if (Number.isFinite(a)) p.aim = Math.atan2(Math.sin(a), Math.cos(a)); return; }
        if (m.a === 'fire') {
          if (p.out > 0 || p.cd > 0 || p.reload > 0 || p.ammo <= 0) return;
          p.cd = CD; p.ammo--;
          if (p.ammo <= 0) p.reload = RELOAD;
          const cx = Math.cos(p.aim), cy = Math.sin(p.aim);
          const x = p.x + cx * (PW + 12), y = p.y - 2 + cy * (PW + 12);
          bullets.push({ x, y, vx: cx * BSP + p.vx * 0.3, vy: cy * BSP + p.vy * 0.15, o: i, age: 0 });
          // recul : plus fort en l'air (on peut s'en servir pour se propulser)
          p.vx -= cx * RECOIL * (p.ground ? 0.5 : 1);
          p.vy -= cy * RECOIL * (p.ground ? 0.2 : 0.8);
          room.send({ t: 'g', k: 'fire', i, x: Math.round(x), y: Math.round(y), a: Math.round(p.aim * 100) });
        }
        if (m.a === 'reload' && p.ammo < MAG && p.reload <= 0) p.reload = RELOAD;
      },
    };
  },
};

// ───────────────────────── SYLLABES ─────────────────────────
// Dictionnaire chargé une seule fois (≈ 336 000 mots, formes conjuguées comprises).
let DICT = null;
function dict() {
  if (DICT) return DICT;
  const words = new Set();
  const count = new Map();
  for (const w of require('an-array-of-french-words')) {
    const a = norm(w);
    if (a.length < 2 || words.has(a)) continue;
    words.add(a);
    // fréquence de chaque morceau de 2 ou 3 lettres (une fois par mot)
    const seen = new Set();
    for (let L = 2; L <= 3; L++) for (let k = 0; k + L <= a.length; k++) seen.add(a.slice(k, k + L));
    seen.forEach((s) => count.set(s, (count.get(s) || 0) + 1));
  }
  // syllabes jouables, de la plus facile (présente dans le plus de mots) à la plus dure
  const pool = [...count].filter(([s, c]) => c >= 400 && /^[a-z]+$/.test(s)).sort((x, y) => y[1] - x[1]).map(([s]) => s);
  DICT = { words, pool };
  return DICT;
}
let hasDict = true;
try { require.resolve('an-array-of-french-words'); } catch { hasDict = false; console.warn('⚠️  an-array-of-french-words manquant (npm install) : Syllabes désactivé.'); }
if (hasDict) setImmediate(dict);

GAMES.words = {
  keys: [[[['Clavier']], 'taper un mot qui contient la syllabe'], [[['Entrée']], 'valider']],
  icon: '🧨',
  desc: 'Un mot avec ces lettres, vite !',
  title: 'Syllabes',
  min: 2,
  rules: "Chacun son tour, une syllabe s'affiche (ex. « TRA »). Trouve un mot français qui la contient (« ex-TRA-ordinaire ») avant que la mèche brûle. La mèche raccourcit à chaque mot trouvé (10 s → 3 s) et repart à 10 s quand quelqu'un explose. Accents facultatifs, pas deux fois le même mot. 2 vies. Dernier en vie gagne.",
  create(room) {
    const n = room.n, LIVES = 2;
    const D = dict();
    const lives = new Array(n).fill(LIVES);
    const used = new Set();
    const deathT = new Array(n).fill(0);
    let cur = -1, syl = '', turns = 0, streak = 0, phase = 'idle', timer = null, t0 = Date.now();
    const alive = () => range(n).filter((i) => lives[i] > 0);
    const scores = () => range(n).map((i) => (lives[i] > 0 ? 1e9 + lives[i] : deathT[i]));

    function newSyl() {
      const span = Math.min(D.pool.length, 40 + turns * 12);
      let s;
      do { s = D.pool[ri(0, span - 1)]; } while (s === syl && span > 1);
      syl = s;
    }
    function nextPlayer() {
      const a = alive();
      let j = cur;
      do { j = (j + 1) % n; } while (!a.includes(j));
      return j;
    }
    function turn() {
      if (room.survivalOver(lives.map((l) => l > 0))) return room.finish(scores(), `${used.size} mots trouvés`);
      cur = nextPlayer();
      newSyl();
      turns++;
      const ms = Math.round(Math.max(3000, 10000 - streak * 700));
      phase = 'turn';
      room.send({ t: 'g', k: 'turn', i: cur, syl, ms, lives });
      timer = room.later(() => boom(cur), ms);
    }
    function boom(i) {
      if (phase !== 'turn' || cur !== i) return;
      phase = 'gap';
      lives[i]--;
      streak = 0; // explosion : la mèche repart à 10 s
      if (lives[i] <= 0) { deathT[i] = Date.now() - t0; room.eliminate(i); }
      room.send({ t: 'g', k: 'boom', i, lives, syl });
      room.later(turn, 1600);
    }

    return {
      start() {
        room.send({ t: 'g', k: 'words', lives });
        room.later(turn, 1200);
      },
      input(i, m) {
        if (phase !== 'turn' || i !== cur) return;
        const text = String(m.text || '').slice(0, 30);
        if (m.a === 'type') return room.send({ t: 'g', k: 'type', i, text });
        if (m.a !== 'word') return;
        const w = norm(text);
        let bad = null;
        if (!w.includes(syl)) bad = `Il manque « ${syl.toUpperCase()} » !`;
        else if (used.has(w)) bad = 'Déjà utilisé !';
        else if (!D.words.has(w)) bad = 'Mot inconnu…';
        if (bad) return room.send({ t: 'g', k: 'nope', i, text, msg: bad });
        room.cancel(timer);
        used.add(w);
        streak++;
        phase = 'gap';
        room.send({ t: 'g', k: 'ok', i, text });
        room.later(turn, 500);
      },
    };
  },
};

// ───────────────────────── CIRCUIT (course en vue pilote) ─────────────────────────
// Route pseudo-3D : une suite de segments avec un virage (c), une hauteur (y) et parfois un boost (b : 1 = moitié gauche, 2 = droite).
const RSEG = 200, RMAX = 12000;
function buildTrack() {
  const segs = [];
  const lastY = () => (segs.length ? segs[segs.length - 1].y : 0);
  const easeIn = (a, b, p) => a + (b - a) * p * p;
  const easeInOut = (a, b, p) => a + (b - a) * (-Math.cos(p * Math.PI) / 2 + 0.5);
  const add = (enter, hold, leave, curve, hill) => {
    const y0 = lastY(), y1 = y0 + hill * RSEG, tot = enter + hold + leave;
    for (let k = 0; k < enter; k++) segs.push({ c: easeIn(0, curve, k / enter), y: easeInOut(y0, y1, k / tot), b: 0 });
    for (let k = 0; k < hold; k++) segs.push({ c: curve, y: easeInOut(y0, y1, (enter + k) / tot), b: 0 });
    for (let k = 0; k < leave; k++) segs.push({ c: easeInOut(curve, 0, k / leave), y: easeInOut(y0, y1, (enter + hold + k) / tot), b: 0 });
  };
  const boost = () => { const side = ri(1, 2), at = segs.length - ri(8, 20); for (let k = at; k < at + 4; k++) if (segs[k]) segs[k].b = side; };
  // obstacles (cônes) : x = position sur la largeur de la route (-1 bord gauche, 1 bord droit)
  const obs = [];
  // obstacle = [segment, x, type, phase] · type 0 = cône fixe, 1 = gosse qui traverse (x varie avec le temps)
  const cone = (k, x) => { if (segs[k] && !segs[k].b) obs.push([k, x, 0, 0]); };
  const kid = (k) => { if (segs[k] && !segs[k].b) obs.push([k, 0, 1, +(Math.random() * 6.28).toFixed(2)]); };
  const slalom = (from, len) => { let side = pick([-1, 1]); for (let k = from; k < from + len; k += 14) { cone(k, side * 0.5); side = -side; } };
  const wall = (k) => { const side = pick([-1, 1]); [0.2, 0.5, 0.8].forEach((x) => cone(k, side * x)); }; // bloque une moitié
  add(0, 40, 0, 0, 0);
  while (segs.length < 1550) {
    const L = pick([25, 40, 50]), dir = pick([-1, 1]), at = segs.length;
    switch (ri(0, 9)) {
      case 0: add(10, L, 10, 0, 0); boost(); slalom(at + 6, L - 10); break;                 // ligne droite : turbo + slalom
      case 9: add(10, L, 10, 0, 0); kid(at + 10 + ri(0, L - 10)); break;                    // ligne droite : un gosse traverse
      case 1: add(L / 2, L, L / 2, dir * ri(3, 5), pick([0, 0, 20, -20])); cone(at + L, -dir * 0.6); break; // virage + cône à l'extérieur
      case 2: add(L / 2, L / 2, L / 2, dir * ri(5, 6), 0); break;                            // épingle
      case 3: add(15, 15, 15, dir * 4, 0); add(15, 15, 15, -dir * 4, 0); break;              // S serré
      case 4: add(10, 8, 10, dir * 5, 0); add(10, 8, 10, -dir * 5, 0); add(10, 8, 10, dir * 5, 0); break; // chicane
      case 5: add(L, 0, L, 0, pick([30, -30, 50])); wall(at + L); add(L, 0, L, 0, pick([-30, 30, -50])); break; // bosse + mur caché derrière
      case 6: add(L / 2, L / 2, L / 2, dir * 6, 0); add(L / 2, L / 2, L / 2, dir * 5, 0); break; // double épingle (demi-tour)
      case 7: add(10, 30, 10, 0, 0); wall(at + 15); wall(at + 35); kid(at + 45); break;      // deux murs en quinconce + un gosse
      default: add(20, 30, 20, dir * ri(2, 4), pick([40, -40])); boost(); break;
    }
  }
  add(0, 60, 0, 0, 0);
  // pas d'obstacle au départ ni dans la dernière ligne droite
  return { segs, obs: obs.filter(([k]) => k > 50 && k < segs.length - 70).sort((a, b) => a[0] - b[0]) };
}

// position d'un gosse sur la largeur de la route : il traverse d'un trottoir à l'autre (même formule côté client)
const kidX = (time, ph) => 0.9 * Math.sin(time * 1.3 + ph);

GAMES.circuit = {
  team: { rule: "En équipe : les places s'additionnent (1er = le plus de points). Un coéquipier dernier fait perdre l'équipe !", sum: true },
  keys: [[[['⬆'], ['Z']], 'accélérer'], [[['⬇'], ['S']], 'freiner'], [[['⬅', '➡'], ['Q', 'D']], 'tourner']],
  touch: 'boutons ⬅ ➡ 🛑 GAZ sous la route',
  icon: '🏎️',
  desc: 'Course en vue pilote, au chrono',
  title: 'Circuit',
  min: 2,
  rules: "Course en vue pilote. Dans les virages la voiture part vers l'extérieur : braque AVANT. L'herbe te ralentit énormément, les cônes 🚧 te freinent et les gosses 🧒 qui traversent t'arrêtent net (et c'est pas joli). Les flèches jaunes au sol = TURBO. Les autres voitures sont des fantômes. Premier à la ligne d'arrivée gagne.",
  create(room) {
    const n = room.n, DT = 1 / 30;
    const { segs: track, obs } = buildTrack(), LEN = track.length * RSEG - RSEG * 30;
    const pl = range(n).map((i) => ({ z: 0, x: n === 1 ? 0 : -0.6 + (1.2 * i) / Math.max(1, n - 1), sp: 0, th: 0, br: 0, st: 0, boost: 0 }));
    const race = new Race(room);
    const GO = 3; // feux de départ : 3, 2, 1, GO
    let t = 0;
    const end = () => room.finish(race.scores(pl.map((p) => p.z / LEN)), race.order.map((i, k) => `${k + 1}. ${room.name(i)} ${pl[i].time.toFixed(2)} s`).join(' · ') || 'Personne n\'a franchi la ligne.');
    function step() {
      t += DT;
      if (t < GO) return room.send({ t: 'g', k: 's', go: +(GO - t).toFixed(2), tm: 0, p: pl.map((p) => [0, Math.round(p.x * 100), 0, 0, 0]) });
      pl.forEach((p, i) => {
        if (race.done[i]) { p.sp = Math.max(0, p.sp - RMAX * DT); p.z += p.sp * DT; return; }
        const seg = track[Math.floor(p.z / RSEG) % track.length];
        const r = p.sp / RMAX, dx = DT * 2 * r;
        p.x += p.st * dx;
        p.x -= dx * r * seg.c * 0.3; // force centrifuge
        const max = p.boost > 0 ? RMAX * 1.35 : RMAX;
        if (p.th) p.sp += (RMAX / 5) * DT;
        else if (p.br) p.sp -= RMAX * DT;
        else p.sp -= (RMAX / 5) * DT;
        if (Math.abs(p.x) > 1 && p.sp > RMAX / 4) p.sp -= (RMAX / 1.5) * DT;
        if (seg.b && (seg.b === 1 ? p.x < 0.05 && p.x > -1 : p.x > -0.05 && p.x < 1)) {
          if (p.boost <= 0) room.send({ t: 'g', k: 'boost', i });
          p.boost = 1.2;
          p.sp = Math.max(p.sp, RMAX * 1.25);
        }
        if (p.boost > 0) p.boost -= DT;
        p.x = Math.max(-2.5, Math.min(2.5, p.x));
        p.sp = Math.max(0, Math.min(max, p.sp));
        const z0 = p.z;
        p.z += p.sp * DT;
        // obstacle franchi pendant ce pas et assez proche sur la largeur = choc
        for (const [k, ox, type, ph] of obs) {
          const oz = k * RSEG + RSEG / 2;
          if (oz > p.z) break;
          if (oz <= z0) continue;
          const x = type === 1 ? kidX(t - GO, ph) : ox;
          if (Math.abs(p.x - x) >= (type === 1 ? 0.25 : 0.3)) continue;
          if (type === 1) { p.sp = 0; p.boost = 0; room.send({ t: 'g', k: 'splat', i }); } // le gosse : arrêt net
          else { p.sp *= 0.2; p.boost = 0; room.send({ t: 'g', k: 'crash', i }); }
        }
        if (p.z >= LEN) { p.time = t - GO; room.send({ t: 'g', k: 'fin', i, tm: +p.time.toFixed(2) }); race.finish(i, end); }
      });
      room.send({ t: 'g', k: 's', tm: +(t - GO).toFixed(2), p: pl.map((p, i) => [Math.round(p.z), Math.round(p.x * 100), Math.round(p.sp), race.done[i] ? 1 : 0, p.boost > 0 ? 1 : 0]) });
    }
    return {
      start() {
        room.send({ t: 'g', k: 'track', seg: RSEG, max: RMAX, len: LEN, s: track.map((s) => [+s.c.toFixed(2), Math.round(s.y), s.b]), o: obs });
        room.every(step, 1000 / 30);
        room.later(end, 120000);
      },
      input(i, m) {
        if (m.a !== 'drive' || race.done[i]) return;
        const p = pl[i];
        p.th = m.g ? 1 : 0; p.br = m.b ? 1 : 0;
        p.st = Math.max(-1, Math.min(1, Math.round(Number(m.s) || 0)));
      },
    };
  },
};

// ───────────────────────── CODE SECRET (logique) ─────────────────────────
GAMES.code = {
  team: { rule: "En équipe : vous cherchez le même code avec les mêmes essais partagés. Discutez avant de proposer !" },
  keys: [[[['Clic'], ['1', '…', '6']], 'ajouter une couleur'], [[['⌫']], 'effacer la dernière'], [[['Entrée']], 'proposer la combinaison']],
  icon: '🔐',
  desc: 'Casse le code couleur en premier',
  title: 'Code secret',
  min: 2,
  rules: "Un code secret de 4 couleurs (parmi 6, une couleur peut revenir), le même pour tout le monde. Après chaque essai, chaque boule reçoit une marque : ⚫ = bonne couleur à la bonne place, ⚪ = cette couleur est dans le code mais ailleurs, rien = pas (ou plus) dans le code. 8 essais. Le premier qui casse le code gagne, sinon le plus proche.",
  create(room) {
    const n = room.n, LEN = 4, COLS = 6, MAXT = 8;
    const code = range(LEN).map(() => ri(0, COLS - 1));
    // tout est compté par camp : en chacun pour soi un camp = un joueur, en équipe les essais sont partagés
    const S = room.sides.length, side = (i) => room.sideOf[i];
    const tries = new Array(S).fill(0), best = new Array(S).fill(0), solved = new Array(S).fill(false);
    const race = new Race(room);
    // classement des non-résolus : meilleure réponse (⚫ vaut plus que ⚪), puis moins d'essais
    const end = () => room.finish(race.scores(range(n).map((i) => best[side(i)] - tries[side(i)] / 100)), `Le code était : ${code.map((c) => ['rouge', 'jaune', 'vert', 'bleu', 'violet', 'orange'][c]).join(' · ')}`);
    const prog = () => room.send({ t: 'g', k: 'prog', tries: range(n).map((i) => tries[side(i)]), done: range(n).map((i) => solved[side(i)]) });
    // marque de chaque boule : 'b' bien placée, 'w' présente ailleurs (dans la limite du nombre restant), '' sinon
    function marks(g) {
      const out = g.map((v, k) => (v === code[k] ? 'b' : ''));
      const left = new Array(COLS).fill(0);
      code.forEach((c, k) => { if (out[k] !== 'b') left[c]++; });
      g.forEach((v, k) => { if (out[k] !== 'b' && left[v] > 0) { out[k] = 'w'; left[v]--; } });
      return out;
    }
    return {
      start() { room.send({ t: 'g', k: 'code', len: LEN, cols: COLS, max: MAXT, ms: 150000 }); room.later(end, 150000); },
      input(i, m) {
        const sd = side(i);
        if (m.a !== 'guess' || solved[sd] || tries[sd] >= MAXT || !Array.isArray(m.g) || m.g.length !== LEN) return;
        const g = m.g.map((v) => v | 0);
        if (g.some((v) => v < 0 || v >= COLS)) return;
        tries[sd]++;
        const mk = marks(g), b = mk.filter((x) => x === 'b').length, w = mk.filter((x) => x === 'w').length;
        best[sd] = Math.max(best[sd], b * 10 + w);
        room.sides[sd].forEach((j) => room.send({ t: 'g', k: 'fb', g, mk, b, w, n: tries[sd], who: i }, j));
        if (b === LEN) { solved[sd] = true; room.sides[sd].forEach((j) => race.finish(j, end)); }
        else if (range(S).every((x) => solved[x] || tries[x] >= MAXT)) room.later(end, 300);
        prog();
      },
    };
  },
};

// ───────────────────────── SERPENTS ─────────────────────────
GAMES.snake = {
  team: { rule: "En équipe : la dernière équipe avec un serpent en vie gagne. Les serpents d'une même équipe se tuent aussi entre eux, attention !" },
  keys: [[[['⬆', '⬇', '⬅', '➡'], ['Z', 'Q', 'S', 'D']], 'tourner']],
  touch: 'flèches sous le jeu',
  icon: '🐍',
  desc: 'Mange, grandis, ne te mords pas',
  title: 'Serpents',
  min: 2,
  rules: "Mange les fruits pour grandir. Toucher un mur, ton corps ou un autre serpent = mort (deux têtes qui se cognent : les deux meurent). Un serpent mort se transforme en fruits. Dernier en vie gagne, sinon le plus long au bout de 90 s.",
  create(room) {
    const n = room.n;
    const W = n <= 2 ? 32 : n <= 6 ? 40 : 48, H = n <= 2 ? 22 : n <= 6 ? 28 : 32, TICK = 115;
    const D = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
    const OPP = { up: 'down', down: 'up', left: 'right', right: 'left' };
    const q4 = Math.floor(H / 4), q34 = Math.floor((3 * H) / 4), mid = H >> 1, cx = W >> 1;
    const spawns = n === 2
      ? [[5, mid, 'right'], [W - 6, mid, 'left']]
      : n > 6 ? edgeSpawns(n, W, H, 4)
        : [[5, q4, 'right'], [W - 6, q34, 'left'], [cx, 4, 'down'], [cx - 1, H - 5, 'up'], [5, q34, 'right'], [W - 6, q4, 'left']];
    const sn = range(n).map((i) => {
      const [x, y, d] = spawns[i], [dx, dy] = D[d];
      return { body: range(4).map((k) => (y - dy * k) * W + (x - dx * k)), d, q: [], alive: true, grow: 0 };
    });
    const fruits = new Set();
    const deathTick = new Array(n).fill(0);
    let tick = 0;
    const occupied = () => { const s = new Set(); sn.forEach((p) => { if (p.alive) p.body.forEach((c) => s.add(c)); }); return s; };
    function addFruit() {
      const occ = occupied();
      for (let k = 0; k < 200; k++) { const c = ri(0, W * H - 1); if (!occ.has(c) && !fruits.has(c)) { fruits.add(c); return; } }
    }
    for (let k = 0; k < n + 3; k++) addFruit();
    const scores = () => range(n).map((i) => (sn[i].alive ? 1e9 + sn[i].body.length : deathTick[i] * 1000 + sn[i].body.length));

    function step() {
      tick++;
      const heads = sn.map((p) => {
        if (!p.alive) return null;
        if (p.q.length) p.d = p.q.shift();
        const h = p.body[0], x = (h % W) + D[p.d][0], y = Math.floor(h / W) + D[p.d][1];
        return x < 0 || y < 0 || x >= W || y >= H ? -1 : y * W + x;
      });
      // les queues avancent d'abord (sauf si le serpent grandit), puis on teste les collisions
      sn.forEach((p, i) => {
        if (!p.alive) return;
        if (fruits.has(heads[i])) { fruits.delete(heads[i]); p.grow += 1; }
        if (p.grow > 0) p.grow--; else p.body.pop();
      });
      const occ = occupied();
      const died = [];
      heads.forEach((h, i) => {
        if (h === null) return;
        if (h < 0 || occ.has(h) || heads.some((o, j) => j !== i && o === h)) died.push(i);
      });
      heads.forEach((h, i) => { if (h !== null && h >= 0) sn[i].body.unshift(h); });
      died.forEach((i) => {
        const p = sn[i];
        p.alive = false; deathTick[i] = tick;
        p.body.slice(1).forEach((c, k) => { if (k % 2 === 0) fruits.add(c); });
      });
      while (fruits.size < n + 3) addFruit();
      room.send({ t: 'g', k: 's', b: sn.map((p) => (p.alive ? p.body : [])), f: [...fruits], d: died });
      died.forEach((i) => room.eliminate(i));
      if (room.survivalOver(sn.map((p) => p.alive))) room.finish(scores(), sn.map((p, i) => `${room.name(i)} ${p.body.length}`).join(' · '));
    }
    return {
      start() {
        room.send({ t: 'g', k: 'snake', w: W, h: H, b: sn.map((p) => p.body), f: [...fruits], dir: sn.map((p) => p.d) });
        room.later(() => room.every(step, TICK), 1500);
        room.later(() => room.finish(scores(), 'Temps écoulé : le plus long gagne.'), 91500);
      },
      input(i, m) {
        const p = sn[i];
        if (m.a !== 'dir' || !D[m.d] || !p.alive) return;
        const last = p.q.length ? p.q[p.q.length - 1] : p.d;
        if (m.d === last || m.d === OPP[last] || p.q.length >= 3) return;
        p.q.push(m.d);
      },
    };
  },
};

// ───────────────────────── ENVOL ─────────────────────────
GAMES.flap = {
  keys: [[[['Espace'], ['⬆'], ['Clic']], 'battre des ailes (un coup = un saut)']],
  touch: 'tape sur le jeu',
  icon: '🪶',
  desc: 'Un seul bouton : battre des ailes',
  title: 'Envol',
  min: 2,
  rules: "Passe dans les trous entre les cheminées sans les toucher ni tomber. Ça accélère. Tout le monde a les mêmes cheminées. Dernier en vol gagne.",
  create(room) {
    const n = room.n, W = 800, H = 500, DT = 1 / 30, BX = 200, BR = 13, PW = 64;
    const gates = [];
    let gx = 650, gy = H / 2;
    for (let k = 0; k < 400; k++) {
      const gap = Math.max(118, 165 - k * 1.2);
      gy = Math.max(gap / 2 + 50, Math.min(H - gap / 2 - 80, gy + ri(-170, 170)));
      gates.push([Math.round(gx), Math.round(gy), Math.round(gap)]);
      gx += Math.max(230, 290 - k * 1.5);
    }
    const pl = range(n).map(() => ({ y: H / 2, vy: 0, alive: true }));
    const deathT = new Array(n).fill(0);
    const GO = 3; // 3, 2, 1, GO : rien ne bouge avant
    let d = 0, t = 0;
    function step() {
      t += DT;
      if (t < GO) return room.send({ t: 'g', k: 's', go: +(GO - t).toFixed(2), d: 0, p: pl.map((p) => [Math.round(p.y), 1, 0]) });
      const speed = 200 + (t - GO) * 5;
      d += speed * DT;
      const died = [];
      pl.forEach((p, i) => {
        if (!p.alive) return;
        p.vy = Math.min(700, p.vy + 1500 * DT);
        p.y += p.vy * DT;
        if (p.y < BR) { p.y = BR; p.vy = 0; }
        let hit = p.y > H - 28 - BR;
        for (const [x, y, gap] of gates) {
          const sx = x - d; if (sx > BX + 60) break;
          if (sx + PW < BX - 60) continue;
          if (BX + BR > sx && BX - BR < sx + PW && (p.y - BR < y - gap / 2 || p.y + BR > y + gap / 2)) hit = true;
        }
        if (hit) died.push(i);
      });
      died.forEach((i) => { pl[i].alive = false; deathT[i] = t; room.eliminate(i); });
      room.send({ t: 'g', k: 's', d: Math.round(d), p: pl.map((p) => [Math.round(p.y), p.alive ? 1 : 0, p.vy < -100 ? 1 : 0]) });
      const passed = gates.filter(([x]) => x + PW < BX + d).length;
      if (room.survivalOver(pl.map((p) => p.alive))) room.finish(range(n).map((i) => (pl[i].alive ? 1e9 : deathT[i])), `${passed} cheminées passées`);
    }
    return {
      start() {
        room.send({ t: 'g', k: 'flap', w: W, h: H, bx: BX, br: BR, pw: PW, gates });
        room.every(step, 1000 / 30);
        room.later(() => room.finish(range(n).map((i) => (pl[i].alive ? 1e9 : deathT[i])), 'Temps écoulé.'), 120000);
      },
      input(i, m) { const p = pl[i]; if (m.a === 'flap' && p.alive && t >= GO) p.vy = -440; },
    };
  },
};

// ───────────────────────── DÉMINAGE ─────────────────────────
GAMES.mines2 = {
  keys: [[[['Clic']], 'ouvrir une case'], [[['Clic droit']], 'poser / enlever un drapeau 🚩'], [[['Double-clic']], 'sur un chiffre : ouvrir les cases autour']],
  touch: 'appui long = drapeau',
  icon: '🚩',
  desc: 'Démine la même grille plus vite que les autres',
  title: 'Déminage',
  min: 2,
  rules: "Tout le monde a la même grille de 32 mines. Le chiffre d'une case = nombre de mines autour d'elle. Une mine = tu es sonné 4 s. Le premier qui a tout ouvert termine la manche et gagne ; sinon le plus avancé au bout de 2 min 30.",
  create(room) {
    const n = room.n, W = 16, H = 12, NM = 32, STUN = 4000;
    const nb = (c) => { const x = c % W, y = Math.floor(c / W), o = []; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const X = x + dx, Y = y + dy; if ((dx || dy) && X >= 0 && Y >= 0 && X < W && Y < H) o.push(Y * W + X); } return o; };
    // départ commun : une zone vide au centre, déjà ouverte pour tout le monde
    const start = Math.floor(H / 2) * W + Math.floor(W / 2);
    const safe = new Set([start, ...nb(start)]);
    const mine = new Uint8Array(W * H);
    const cand = shuffle(range(W * H).filter((c) => !safe.has(c)));
    cand.slice(0, NM).forEach((c) => { mine[c] = 1; });
    const num = range(W * H).map((c) => nb(c).filter((o) => mine[o]).length);
    const SAFE = W * H - NM;
    const rev = range(n).map(() => new Set()), stun = new Array(n).fill(0), booms = new Array(n).fill(0);
    const race = new Race(room);
    function flood(i, c, out) {
      const stack = [c];
      while (stack.length) {
        const k = stack.pop();
        if (rev[i].has(k) || mine[k]) continue;
        rev[i].add(k); out.push([k, num[k]]);
        if (num[k] === 0) nb(k).forEach((o) => stack.push(o));
      }
    }
    const firstOpen = [];
    flood(0, start, firstOpen);
    for (let i = 1; i < n; i++) flood(i, start, []);
    const pct = () => rev.map((s) => s.size / SAFE);
    const end = () => room.finish(race.scores(pct().map((p, i) => p - booms[i] / 1000)), rev.map((s, i) => `${room.name(i)} ${Math.floor((s.size / SAFE) * 100)} %`).join(' · '));
    return {
      start() {
        room.send({ t: 'g', k: 'grid', w: W, h: H, nm: NM, open: firstOpen, ms: 150000 });
        room.send({ t: 'g', k: 'prog', p: pct(), b: booms });
        room.later(end, 150000);
      },
      input(i, m) {
        if (m.a !== 'open' || race.done[i]) return;
        const c = m.c | 0;
        if (c < 0 || c >= W * H || rev[i].has(c)) return;
        const now = Date.now();
        if (now < stun[i]) return;
        if (mine[c]) {
          stun[i] = now + STUN - 200; booms[i]++;
          room.send({ t: 'g', k: 'boom', c, ms: STUN }, i);
        } else {
          const out = [];
          flood(i, c, out);
          room.send({ t: 'g', k: 'open', cells: out }, i);
          if (rev[i].size >= SAFE) { race.finish(i, end); end(); } // premier à finir = fin de la manche pour tous
        }
        room.send({ t: 'g', k: 'prog', p: pct(), b: booms });
      },
    };
  },
};

if (!hasDict) delete GAMES.words;

module.exports = { GAMES, shuffle, ri, pick, range, dict, norm, kidX };
