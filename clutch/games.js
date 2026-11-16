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

// ───────────────────────── RÉFLEXE ─────────────────────────
GAMES.reflex = {
  icon: '🤠',
  desc: 'Dégaine au signal, pas avant',
  title: 'Duel au soleil',
  min: 2,
  rules: "Main sur le flingue. Au cri « FEU ! », ESPACE (ou tap) le plus vite possible. Méfie-toi des faux signaux (FEUILLE, FOU…) : dégainer avant le vrai = le shérif t'abat.",
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
  icon: '🛗',
  desc: 'Tape les flèches, le broyeur monte',
  title: 'Escalator',
  min: 2,
  rules: "Tu montes un escalator… avec un broyeur juste en dessous. Tape les flèches affichées (flèches / ZQSD) : bonne touche = tu montes, mauvaise = tu glisses vers les lames. Arrive en haut avant d'être haché.",
  create(room) {
    const n = room.n, TOP = 40, DT = 0.1;
    const seq = Array.from({ length: 80 }, () => pick(DIRS));
    const idx = new Array(n).fill(0), pos = new Array(n).fill(4);
    const alive = new Array(n).fill(true), deathT = new Array(n).fill(0);
    const race = new Race(room);
    let c = 0, t = 0;
    const scores = () => range(n).map((i) => (race.done[i] ? 3e6 - race.order.indexOf(i) : alive[i] ? 2e6 + pos[i] : deathT[i]));
    const end = () => room.finish(scores());
    const check = () => { if (room.survivalOver(range(n).map((i) => alive[i] && !race.done[i]))) end(); };
    const state = () => ({ t: 'g', k: 's', pos: pos.map((p) => +p.toFixed(2)), c: +c.toFixed(2), al: alive, idx });
    function step() {
      t += DT;
      c += (1.1 + t * 0.06) * DT;
      range(n).forEach((i) => {
        if (alive[i] && !race.done[i] && c >= pos[i]) { alive[i] = false; deathT[i] = t; room.eliminate(i); }
      });
      room.send(state());
      check();
    }
    return {
      start() {
        room.send({ t: 'g', k: 'esc', seq, top: TOP });
        room.every(step, DT * 1000);
        room.later(end, 60000);
      },
      input(i, m) {
        if (m.a !== 'key' || !alive[i] || race.done[i] || !DIRS.includes(m.key)) return;
        if (m.key === seq[idx[i] % seq.length]) { idx[i]++; pos[i] = Math.min(TOP, pos[i] + 1); }
        else pos[i] = Math.max(0, pos[i] - 2);
        if (pos[i] >= TOP) race.finish(i, end);
        room.send(state());
        check();
      },
    };
  },
};

// ───────────────────────── TRON ─────────────────────────
GAMES.tron = {
  icon: '🏍️',
  desc: "Coince les autres avec ton trait",
  title: 'Tron',
  min: 2,
  rules: 'Dirige ton trait (flèches ou ZQSD). Touche un bord ou un trait = éliminé. Coince les autres ! Ça continue jusqu\'au dernier survivant, même en équipe.',
  create(room) {
    const n = room.n;
    const W = n <= 2 ? 48 : 64, H = n <= 2 ? 32 : 42, TICK = 65;
    const D = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
    const OPP = { up: 'down', down: 'up', left: 'right', right: 'left' };
    const q4 = Math.floor(H / 4), q34 = Math.floor((3 * H) / 4), mid = H >> 1, cx = W >> 1;
    const spawns = n === 2
      ? [[6, mid, 'right'], [W - 7, mid, 'left']]
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
  icon: '🧠',
  desc: "Reproduis la séquence dans l'ordre",
  title: 'Mémoire',
  min: 2,
  rules: "Des cases s'allument une par une : reclique-les DANS LE MÊME ORDRE. Chaque niveau ajoute une case au bout de la séquence et accélère. Une erreur ou trop lent = une balle. Ça continue jusqu'au dernier survivant, même en équipe.",
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
  icon: '🪚',
  desc: 'Esquive les scies et les lasers',
  title: 'Lames',
  min: 2,
  rules: "Des scies circulaires ricochent partout, puis des lasers balaient la salle. Flèches / ZQSD pour bouger, ESPACE pour bousculer le joueur le plus proche. Les contours en pointillés ne coupent pas encore. Dernier entier gagne.",
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
  icon: '🏃',
  desc: "Course de haies au clavier",
  title: 'Course de haies',
  min: 2,
  rules: 'Alterne ← → (ou Q / D) le plus vite possible pour courir. Saute les haies avec ↑ / Z / Espace. Une haie prise = gros ralentissement.',
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
        pl.forEach((q, j) => { if (j !== i && q.alive) { const d = Math.hypot(q.x - p.x, q.y - p.y); if (d < bd) { bd = d; best = j; } } });
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
const FRAMES = [['🖼️', 'Portrait de famille'], ['🖼️', 'Photo de ton ex'], ['🖼️', 'Diplôme encadré'], ['🖼️', 'Portrait du patron'], ['🖼️', 'Selfie de mariage']];
const PARTS = [['🔩', 'Boulon'], ['⚙️', 'Engrenage'], ['🔧', 'Clé à molette'], ['🪛', 'Tournevis'], ['🔗', 'Chaîne'], ['🧲', 'Aimant']];
GAMES.filter = {
  icon: '🔥',
  desc: 'Trie à ton rythme : tableaux en caisse, ferraille au four',
  title: 'Le Filtre',
  min: 2,
  rules: "Ton tapis avance à TON rythme : chaque objet trié fait venir le suivant. ⬅ ou Q = 🔥 FOUR pour la FERRAILLE 🔩 · ➡ ou D = 📦 CAISSE pour les TABLEAUX 🖼️. Une erreur = tu es sonné 1,5 s. Premier à trier 25 objets gagne.",
  create(room) {
    const n = room.n, N = 25, STUN = 1500;
    const items = Array.from({ length: N }, () => {
      const frame = Math.random() < 0.5;
      const [e, name] = pick(frame ? FRAMES : PARTS);
      return { e, n: name, f: frame };
    });
    const pos = new Array(n).fill(0), stun = new Array(n).fill(0);
    const race = new Race(room);
    const end = () => room.finish(race.scores(pos.map((p) => p / N)));
    return {
      start() {
        room.send({ t: 'g', k: 'belt', items: items.map((x) => ({ e: x.e, n: x.n })), n: N, stun: STUN });
        room.later(end, 90000);
      },
      input(i, m) {
        if (m.a !== 'sort' || race.done[i] || (m.b !== 0 && m.b !== 1)) return;
        const now = Date.now();
        if (now < stun[i]) return;
        // 0 = four (ferraille), 1 = caisse (tableaux)
        const want = items[pos[i]].f ? 1 : 0;
        if (m.b === want) {
          pos[i]++;
          room.send({ t: 'g', k: 'prog', pos });
          if (pos[i] >= N) race.finish(i, end);
        } else {
          stun[i] = now + STUN;
          room.send({ t: 'g', k: 'stun', i, ms: STUN });
        }
      },
    };
  },
};

// ───────────────────────── SOL INSTABLE ─────────────────────────
const FLOOR_SYM = ['💀', '🔪', '🩸', '👁️'];
GAMES.floor = {
  icon: '🕳️',
  desc: 'Reste sur le bon symbole, pousse les autres',
  title: 'Sol instable',
  min: 2,
  rules: "Le symbole affiché est le seul sol qui tient. À la sirène, tout le reste s'effondre. Flèches / ZQSD pour bouger, ESPACE pour bousculer le joueur le plus proche (dans le vide, de préférence). Dernier debout gagne.",
  create(room) {
    const n = room.n, C = 8, R = 6, T = 80, W = C * T, H = R * T, DT = 1 / 30;
    const A = makeArena(room, { W, H, SP: 220, PR: 12, spawn: circleSpawn(W, H, 170, 110) });
    const removed = new Array(C * R).fill(false);
    let tiles = [], target = 0, holes = null, phase = 0, t = 0;
    const deathT = new Array(n).fill(Infinity);
    const tileAt = (p) => Math.min(R - 1, Math.floor(p.y / T)) * C + Math.min(C - 1, Math.floor(p.x / T));

    function newPhase() {
      phase++;
      if (phase > 1) for (let k = 0; k < 4; k++) { const free = range(C * R).filter((x) => !removed[x]); if (free.length > 8) removed[pick(free)] = true; }
      target = ri(0, 3);
      const frac = Math.max(0.07, 0.26 - phase * 0.03);
      const live = range(C * R).filter((x) => !removed[x]);
      const safe = new Set(shuffle([...live]).slice(0, Math.max(2, Math.round(live.length * frac))));
      tiles = range(C * R).map((x) => (removed[x] ? -1 : safe.has(x) ? target : pick([0, 1, 2, 3].filter((v) => v !== target))));
      holes = null;
      const warn = Math.max(1300, 3000 - phase * 220);
      room.send({ t: 'g', k: 'ph', tiles, target, ms: warn, phase });
      room.later(drop, warn);
    }
    function drop() {
      holes = tiles.map((v) => v !== target);
      room.send({ t: 'g', k: 'drop' });
      room.later(() => { holes = null; room.send({ t: 'g', k: 'restore' }); room.later(newPhase, 500); }, 1400);
    }
    function step() {
      t += DT;
      A.move(DT);
      const died = [];
      A.pl.forEach((p, i) => {
        if (!p.alive) return;
        const k = tileAt(p);
        if (removed[k] || (holes && holes[k])) died.push(i);
      });
      died.forEach((i) => { A.pl[i].alive = false; deathT[i] = t; });
      room.send({ t: 'g', k: 's', p: A.snap() });
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
  icon: '🚬',
  desc: 'Tire sur ta clope sans tousser',
  title: 'Pause clope',
  min: 2,
  rules: "Maintiens ESPACE pour tirer, relâche dans la zone verte = une taffe. Trop long = tu tousses (bloqué 1,5 s). Trop court = taffe gâchée. Ça va vite et chaque taffe a son propre rythme. 25 secondes : le pire fumeur se fait abattre.",
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
  icon: '🍽️',
  desc: 'Mange quand Tonton ne regarde pas',
  title: 'Bonnes manières',
  min: 2,
  rules: "Maintiens ESPACE pour bouffer. Quand Tonton Gérard baisse son journal, ARRÊTE-TOI ou il te flingue à table. Il froisse son journal juste avant. Premier à finir son assiette gagne.",
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
    function arm() { const a = aliveIdx(); holder = pick(a); prev = -1; fuse = first ? 17 + Math.random() * 5 : 8 + Math.random() * 6; first = false; grab = 1; room.send({ t: 'g', k: 'arm', i: holder }); }
    function step() {
      t += DT;
      A.move(DT, (i) => (i === holder ? 255 : 225));
      if (pause > 0) { pause -= DT; if (pause <= 0) arm(); }
      else if (holder >= 0) {
        fuse -= DT; grab -= DT;
        const h = A.pl[holder];
        if (grab <= 0) {
          const j = A.pl.findIndex((q, k) => k !== holder && k !== prev && q.alive && Math.hypot(q.x - h.x, q.y - h.y) < A.PR * 2 + 4);
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
  icon: '💥',
  desc: 'Traverse, la moissonneuse arrive',
  title: 'Champ de mines',
  min: 2,
  rules: "Traverse jusqu'à la sortie (à droite). Les mines sont invisibles : reste immobile 1 s pour les détecter autour de toi. Une moissonneuse te court après. ESPACE = bousculer un joueur (sur une mine, c'est cadeau).",
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
  icon: '🕵️',
  desc: "Trouve l'intrus (vocal conseillé)",
  title: 'Undercover',
  min: 2,
  intro: 7000,
  rules: (n) => (n === 2
    ? "Duel : chacun a un mot proche de celui de l'autre. À ton tour, donne UN SEUL mot d'indice, ou tente de deviner son mot (2 essais max). Attention, tes indices l'aident aussi à trouver le tien. Indice trop proche de ton mot = refusé."
    : "Tout le monde a le même mot… sauf l'undercover, qui a un mot proche (et ne sait pas qu'il est undercover !). À ton tour, donne UN SEUL mot d'indice (trop proche de ton mot = refusé), puis tout le monde vote pour éliminer l'intrus. Jouez en vocal, et cachez votre mot si vous êtes dans la même pièce."),
  create(room) {
    const n = room.n;
    if (n === 2) return undercoverDuel(room);
    const pair = shuffle([...pick(UC_PAIRS)]);
    const nu = n >= 6 ? 2 : 1;
    const uc = new Set(shuffle(range(n)).slice(0, nu));
    const word = (i) => (uc.has(i) ? pair[1] : pair[0]);
    const alive = new Array(n).fill(true);
    let phase = 'idle', order = [], turn = 0, cycle = 0, turnTimer = null, voteTimer = null;
    let votes = new Map();

    const aliveIdx = () => range(n).filter((i) => alive[i]);

    function cycleStart() {
      cycle++;
      const a = aliveIdx();
      const s = (cycle - 1) % a.length;
      order = [...a.slice(s), ...a.slice(0, s)];
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
      const role = uc.has(out) ? 'undercover' : 'civil';
      room.send({ t: 'g', k: 'out', i: out, role, word: word(out), tally, tie: cands.length > 1 });
      room.eliminate(out, { role });
      const ucAlive = aliveIdx().filter((i) => uc.has(i)).length;
      const civAlive = aliveIdx().length - ucAlive;
      if (ucAlive === 0) return room.later(() => end('civ'), 4000);
      if (ucAlive >= civAlive) return room.later(() => end('uc'), 4000);
      room.later(cycleStart, 5000);
    }
    function end(w) {
      const sc = range(n).map((i) => ((w === 'uc') === uc.has(i) ? 1 : 0));
      const names = [...uc].map((i) => room.name(i)).join(' & ');
      room.finish(sc, `${w === 'uc' ? 'Victoire des undercovers' : 'Victoire des civils'} ! Mot civil : « ${pair[0]} » · Mot undercover : « ${pair[1]} » (${names})`);
    }

    return {
      start() {
        range(n).forEach((i) => room.send({ t: 'g', k: 'word', word: word(i), nu }, i));
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
  const a = norm(text);
  if (a.length < 2) return 'Indice trop court.';
  const parts = [norm(word), ...word.split(/[\s'’-]+/).map(norm)].filter((w) => w.length >= 3);
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

module.exports = { GAMES, shuffle, ri };
