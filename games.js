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
// emojis anciens uniquement : les récents (🪛…) ne s'affichent pas partout (Windows 10)
const PARTS = [['🔩', 'Boulon'], ['⚙️', 'Engrenage'], ['🔧', 'Clé à molette'], ['🔨', 'Marteau'], ['🔗', 'Chaîne'], ['🧲', 'Aimant']];
GAMES.filter = {
  icon: '🔥',
  desc: 'Trie le plus vite possible en 40 s',
  title: 'Le Filtre',
  min: 2,
  rules: "Ton tapis avance à TON rythme et ne s'arrête jamais : chaque objet trié fait venir le suivant. ⬅ ou Q = 🔥 FOUR pour la FERRAILLE 🔩 · ➡ ou D = 📦 CAISSE pour les TABLEAUX 🖼️. Une erreur = tu es sonné 1,5 s. 40 secondes : celui qui en a trié le plus gagne.",
  create(room) {
    const n = room.n, N = 400, STUN = 1500, DUR = 40000;
    const items = Array.from({ length: N }, () => {
      const frame = Math.random() < 0.5;
      const [e, name] = pick(frame ? FRAMES : PARTS);
      return { e, n: name, f: frame };
    });
    const pos = new Array(n).fill(0), stun = new Array(n).fill(0);
    const end = () => {
      const best = Math.max(...pos);
      room.finish([...pos], range(n).sort((a, b) => pos[b] - pos[a]).map((i) => `${room.name(i)} ${pos[i]}`).join(' · ') + (best ? '' : ' — personne n\'a rien trié'));
    };
    return {
      start() {
        room.send({ t: 'g', k: 'belt', items: items.map((x) => ({ e: x.e, n: x.n })), n: N, stun: STUN, ms: DUR });
        room.later(end, DUR);
      },
      input(i, m) {
        if (m.a !== 'sort' || pos[i] >= N || (m.b !== 0 && m.b !== 1)) return;
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

// ───────────────────────── TANK ─────────────────────────
GAMES.tank = {
  icon: '🪖',
  desc: 'ZQSD pour rouler, flèches pour viser, 2 vies',
  title: 'Tank',
  min: 2,
  rules: "ZQSD pour rouler, FLÈCHES pour orienter le canon, ESPACE pour tirer. Les obus rebondissent une fois sur les murs. Les caisses en bois cassent en 3 tirs, les blocs en métal jamais. 2 vies chacun, pas de tir ami en équipe. Dernier camp debout gagne.",
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
  icon: '🧨',
  desc: 'Un mot avec ces lettres, vite !',
  title: 'Syllabes',
  min: 2,
  rules: "Chacun son tour, une syllabe s'affiche (ex. « TRA »). Tape un mot français qui la contient (« ex-TRA-ordinaire ») puis Entrée, avant que la mèche brûle. Accents facultatifs, pas deux fois le même mot. Trop lent = tu perds une vie (2 vies). Dernier en vie gagne.",
  create(room) {
    const n = room.n, LIVES = 2;
    const D = dict();
    const lives = new Array(n).fill(LIVES);
    const used = new Set();
    const deathT = new Array(n).fill(0);
    let cur = -1, syl = '', turns = 0, phase = 'idle', timer = null, t0 = Date.now();
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
      const ms = Math.round(Math.max(6000, 12000 - turns * 150));
      phase = 'turn';
      room.send({ t: 'g', k: 'turn', i: cur, syl, ms, lives });
      timer = room.later(() => boom(cur), ms);
    }
    function boom(i) {
      if (phase !== 'turn' || cur !== i) return;
      phase = 'gap';
      lives[i]--;
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
  add(0, 40, 0, 0, 0);
  while (segs.length < 1550) {
    const L = pick([25, 40, 50]), dir = pick([-1, 1]);
    switch (ri(0, 5)) {
      case 0: add(10, L, 10, 0, 0); boost(); break;                                  // ligne droite + boost
      case 1: add(L / 2, L, L / 2, dir * ri(2, 4), pick([0, 0, 20, -20])); break;    // virage large
      case 2: add(L / 2, L / 2, L / 2, dir * ri(5, 6), 0); break;                     // épingle
      case 3: add(20, 20, 20, dir * 3, 0); add(20, 20, 20, -dir * 3, 0); break;       // S
      case 4: add(L, 0, L, 0, pick([30, -30, 50])); add(L, 0, L, 0, pick([-30, 30, -50])); break; // bosses
      default: add(20, 30, 20, dir * ri(2, 4), pick([40, -40])); boost(); break;
    }
  }
  add(0, 60, 0, 0, 0);
  return segs;
}

GAMES.circuit = {
  icon: '🏎️',
  desc: 'Course en vue pilote, au chrono',
  title: 'Circuit',
  min: 2,
  rules: "Vue pilote ! ⬆ / Z = accélérer, ⬇ / S = freiner, ⬅ ➡ / Q D = tourner. Dans les virages la voiture part vers l'extérieur : braque avant. L'herbe te ralentit énormément. Les flèches jaunes au sol = TURBO. Les autres voitures sont des fantômes (pas de collision). Premier à la ligne d'arrivée gagne.",
  create(room) {
    const n = room.n, DT = 1 / 30;
    const track = buildTrack(), LEN = track.length * RSEG - RSEG * 30;
    const pl = range(n).map((i) => ({ z: 0, x: n === 1 ? 0 : -0.6 + (1.2 * i) / Math.max(1, n - 1), sp: 0, th: 0, br: 0, st: 0, boost: 0 }));
    const race = new Race(room);
    let t = 0;
    const end = () => room.finish(race.scores(pl.map((p) => p.z / LEN)), race.order.map((i, k) => `${k + 1}. ${room.name(i)} ${pl[i].time.toFixed(2)} s`).join(' · ') || 'Personne n\'a franchi la ligne.');
    function step() {
      t += DT;
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
        p.z += p.sp * DT;
        if (p.z >= LEN) { p.time = t; room.send({ t: 'g', k: 'fin', i, tm: +t.toFixed(2) }); race.finish(i, end); }
      });
      room.send({ t: 'g', k: 's', tm: +t.toFixed(2), p: pl.map((p, i) => [Math.round(p.z), Math.round(p.x * 100), Math.round(p.sp), race.done[i] ? 1 : 0, p.boost > 0 ? 1 : 0]) });
    }
    return {
      start() {
        room.send({ t: 'g', k: 'track', seg: RSEG, max: RMAX, len: LEN, s: track.map((s) => [+s.c.toFixed(2), Math.round(s.y), s.b]) });
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
  icon: '🔐',
  desc: 'Casse le code couleur en premier',
  title: 'Code secret',
  min: 2,
  rules: "Un code secret de 4 couleurs (parmi 6, une couleur peut revenir), le même pour tout le monde. Propose une combinaison : ⚫ = bonne couleur bien placée, ⚪ = bonne couleur mal placée. 10 essais max. Le premier qui casse le code gagne, sinon le plus proche.",
  create(room) {
    const n = room.n, LEN = 4, COLS = 6, MAXT = 10;
    const code = range(LEN).map(() => ri(0, COLS - 1));
    const tries = new Array(n).fill(0), best = new Array(n).fill(0);
    const race = new Race(room);
    // classement des non-résolus : meilleure réponse (⚫ vaut plus que ⚪), puis moins d'essais
    const end = () => room.finish(race.scores(best.map((b, i) => b - tries[i] / 100)), `Le code était : ${code.map((c) => ['rouge', 'jaune', 'vert', 'bleu', 'violet', 'orange'][c]).join(' · ')}`);
    const prog = () => room.send({ t: 'g', k: 'prog', tries, done: race.done });
    return {
      start() { room.send({ t: 'g', k: 'code', len: LEN, cols: COLS, max: MAXT, ms: 150000 }); room.later(end, 150000); },
      input(i, m) {
        if (m.a !== 'guess' || race.done[i] || tries[i] >= MAXT || !Array.isArray(m.g) || m.g.length !== LEN) return;
        const g = m.g.map((v) => v | 0);
        if (g.some((v) => v < 0 || v >= COLS)) return;
        tries[i]++;
        let b = 0, w = 0;
        const rc = new Array(COLS).fill(0), rg = new Array(COLS).fill(0);
        g.forEach((v, k) => { if (v === code[k]) b++; else { rc[code[k]]++; rg[v]++; } });
        for (let c = 0; c < COLS; c++) w += Math.min(rc[c], rg[c]);
        best[i] = Math.max(best[i], b * 10 + w);
        room.send({ t: 'g', k: 'fb', g, b, w, n: tries[i] }, i);
        if (b === LEN) race.finish(i, end);
        else if (range(n).every((j) => race.done[j] || tries[j] >= MAXT)) room.later(end, 300);
        prog();
      },
    };
  },
};

// ───────────────────────── SERPENTS ─────────────────────────
GAMES.snake = {
  icon: '🐍',
  desc: 'Mange, grandis, ne te mords pas',
  title: 'Serpents',
  min: 2,
  rules: "Flèches ou ZQSD. Mange les fruits pour grandir. Toucher un mur, ton corps ou un autre serpent = mort (deux têtes qui se cognent : les deux meurent). Un serpent mort se transforme en fruits. Dernier en vie gagne, sinon le plus long au bout de 90 s.",
  create(room) {
    const n = room.n;
    const W = n <= 2 ? 32 : 40, H = n <= 2 ? 22 : 28, TICK = 115;
    const D = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
    const OPP = { up: 'down', down: 'up', left: 'right', right: 'left' };
    const q4 = Math.floor(H / 4), q34 = Math.floor((3 * H) / 4), mid = H >> 1, cx = W >> 1;
    const spawns = n === 2
      ? [[5, mid, 'right'], [W - 6, mid, 'left']]
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
  icon: '🪶',
  desc: 'Un seul bouton : battre des ailes',
  title: 'Envol',
  min: 2,
  rules: "Un seul bouton : ESPACE, clic ou tap pour battre des ailes. Passe dans les trous entre les cheminées sans les toucher ni tomber. Ça accélère. Tout le monde a les mêmes cheminées. Dernier en vol gagne.",
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
    let d = 0, t = 0;
    function step() {
      t += DT;
      const speed = 200 + t * 5;
      d += speed * DT;
      const died = [];
      pl.forEach((p, i) => {
        if (!p.alive) return;
        if (t < 1.2) return; // petit vol stationnaire au départ
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
      input(i, m) { const p = pl[i]; if (m.a === 'flap' && p.alive) p.vy = -440; },
    };
  },
};

// ───────────────────────── DÉMINAGE ─────────────────────────
GAMES.mines2 = {
  icon: '🚩',
  desc: 'Démine la même grille plus vite que les autres',
  title: 'Déminage',
  min: 2,
  rules: "Tout le monde a la même grille de 32 mines. Clic = ouvrir une case, clic droit (ou appui long) = drapeau, double-clic sur un chiffre = ouvrir autour quand les drapeaux y sont. Le chiffre = nombre de mines autour. Une mine = tu es sonné 4 s. Premier à tout ouvrir gagne, sinon le plus avancé au bout de 2 min 30.",
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
          if (rev[i].size >= SAFE) race.finish(i, end);
        }
        room.send({ t: 'g', k: 'prog', p: pct(), b: booms });
      },
    };
  },
};

if (!hasDict) delete GAMES.words;

module.exports = { GAMES, shuffle, ri };
