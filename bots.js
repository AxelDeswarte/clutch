// CLUTCH — bots (joueurs gérés par le serveur)
//
// Un bot reçoit exactement les mêmes messages de jeu qu'un joueur et répond avec les mêmes entrées.
// Chaque cerveau : BRAINS[clé du jeu](ctx) -> (msg) => void
// ctx : { i, n, sideOf, act(msg, ms), later(fn, ms), cancel(id) }
//   act   envoie une entrée au jeu après `ms` (par défaut le temps de réaction du bot)
//   later minuteur auto-annulé en fin de manche
// Les bots jouent bien mais pas parfaitement : temps de réaction, erreurs aléatoires, prudence.
const { pick, range, dict, norm, kidX } = require('./games');

const rand = (a, b) => a + Math.random() * (b - a);
const gauss = () => (Math.random() + Math.random() + Math.random() - 1.5) * 2; // ≈ N(0, 1)
const DIRS = ['up', 'down', 'left', 'right'];
const DV = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
const OPP = { up: 'down', down: 'up', left: 'right', right: 'left' };

const BOT_NAMES = ['Gégé', 'Josiane', 'Kevin', 'Brigitte', 'Jean-Mi', 'Nadine', 'Titouan', 'Ginette', 'Bernard', 'Pépito', 'Mamie Lou', 'Raymond', 'Jessica', 'Dédé'];

// ── aides pour les jeux d'arène (déplacement libre) ──
// envoie la direction seulement quand elle change
function mover(ctx) {
  let last = '';
  return (dx, dy) => { const k = dx + ',' + dy; if (k !== last) { last = k; ctx.act({ a: 'mv', x: dx, y: dy }); } };
}
// essaie les 9 directions (dont rester sur place) et garde celle dont la position d'arrivée a le meilleur score
function bestDir(x, y, sp, ahead, score) {
  let best = [0, 0], bs = -Infinity;
  for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
    const l = Math.hypot(dx, dy) || 1;
    const s = score(x + (dx / l) * sp * ahead, y + (dy / l) * sp * ahead, dx, dy);
    if (s > bs) { bs = s; best = [dx, dy]; }
  }
  return best;
}
const inRect = (x, y, [rx, ry, rw, rh], m) => x > rx - m && x < rx + rw + m && y > ry - m && y < ry + rh + m;
// distance à une demi-droite (laser partant du centre)
function rayDist(px, py, cx, cy, a) {
  const ux = Math.cos(a), uy = Math.sin(a), k = Math.max(0, (px - cx) * ux + (py - cy) * uy);
  return Math.hypot(px - (cx + ux * k), py - (cy + uy * k));
}
// remplissage d'une grille (Tron, Serpents) : nombre de cases libres atteignables, plafonné
function flood(free, W, H, x0, y0, cap) {
  const seen = new Set([y0 * W + x0]), st = [[x0, y0]];
  while (st.length && seen.size < cap) {
    const [x, y] = st.pop();
    for (const d of DIRS) {
      const nx = x + DV[d][0], ny = y + DV[d][1], c = ny * W + nx;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H || seen.has(c) || !free(nx, ny)) continue;
      seen.add(c); st.push([nx, ny]);
    }
  }
  return seen.size;
}

const BRAINS = {};

// ── Duel au soleil ──
BRAINS.reflex = (ctx) => (m) => {
  if (m.k === 'fake' && Math.random() < 0.05) ctx.act({ a: 'press', ms: 300 }, rand(150, 300)); // se fait avoir
  if (m.k === 'go') { const d = rand(240, 480); ctx.act({ a: 'press', ms: Math.round(d) }, d); }
};

// ── Escalator ──
BRAINS.seq = (ctx) => {
  let seq = null, k = 0, alive = true;
  const rate = rand(3.3, 4.8); // lettres par seconde
  function tap() {
    if (!alive) return;
    const want = seq[k % seq.length];
    if (Math.random() < 0.05) ctx.act({ a: 'key', key: pick(DIRS.filter((d) => d !== want)) }, 1);
    else { ctx.act({ a: 'key', key: want }, 1); k++; }
    ctx.later(tap, (1000 / rate) * rand(0.7, 1.3));
  }
  return (m) => {
    if (m.k === 'esc') { seq = m.seq; ctx.later(tap, rand(400, 800)); }
    if (m.k === 's') { k = Math.max(k, m.idx[ctx.i]); alive = m.al[ctx.i]; }
  };
};

// ── Tron ──
BRAINS.tron = (ctx) => {
  let W, H, grid, heads, dir = null, alive = true;
  const free = (x, y) => x >= 0 && y >= 0 && x < W && y < H && !grid[y * W + x];
  function decide() {
    const [x, y] = heads[ctx.i];
    const careless = Math.random() < 0.06; // de temps en temps, ne regarde que la case suivante
    let best = null, bs = -Infinity;
    for (const d of DIRS) {
      if (d === OPP[dir]) continue;
      const nx = x + DV[d][0], ny = y + DV[d][1];
      if (!free(nx, ny)) continue;
      let s = careless ? 10 : flood(free, W, H, nx, ny, 500);
      if (heads.some((h, j) => h && j !== ctx.i && Math.abs(h[0] - nx) + Math.abs(h[1] - ny) === 1)) s -= 60; // tête adverse à côté
      if (d === dir) s += 3;
      s += Math.random() * 4;
      if (s > bs) { bs = s; best = d; }
    }
    if (best && best !== dir) { ctx.act({ a: 'dir', d: best }, 5); dir = best; }
  }
  return (m) => {
    if (m.k === 'tron') {
      W = m.w; H = m.h; grid = new Uint8Array(W * H); heads = m.heads.map((h) => h.slice());
      heads.forEach(([x, y]) => { grid[y * W + x] = 1; });
      const [x, y] = heads[ctx.i];
      dir = x < W / 4 ? 'right' : x > (3 * W) / 4 ? 'left' : y < H / 2 ? 'down' : 'up';
    }
    if (m.k === 'tick' && grid) {
      m.h.forEach((c, j) => {
        if (!c) return;
        if (j === ctx.i && heads[j]) { const dx = c[0] - heads[j][0], dy = c[1] - heads[j][1]; dir = DIRS.find((d) => DV[d][0] === dx && DV[d][1] === dy) || dir; }
        heads[j] = c;
        if (!m.d.includes(j) && c[0] >= 0 && c[1] >= 0 && c[0] < W && c[1] < H) grid[c[1] * W + c[0]] = 1;
      });
      m.d.forEach((j) => { heads[j] = null; if (j === ctx.i) alive = false; });
      if (alive && heads[ctx.i]) decide();
    }
  };
};

// ── Mémoire ──
BRAINS.memory = (ctx) => {
  let seq = null, alive = true;
  return (m) => {
    if (m.k === 'show') { seq = m.seq.slice(); alive = m.alive[ctx.i]; }
    if (m.k === 'st') alive = m.alive[ctx.i];
    if (m.k === 'input' && alive && seq) {
      const err = Math.max(0.004, (seq.length - 5) * 0.009); // plus la séquence est longue, plus il se trompe
      let t = rand(500, 900);
      for (let k = 0; k < seq.length; k++) {
        if (Math.random() < err) { ctx.act({ a: 'tap', c: (seq[k] + 1 + Math.floor(Math.random() * 23)) % 25 }, t); return; }
        ctx.act({ a: 'tap', c: seq[k] }, t);
        t += rand(330, 560);
      }
    }
  };
};

// ── Lames (scies + lasers) ──
BRAINS.dodge = (ctx) => {
  let W, H, PR, prev = null, tick = 0;
  const mv = mover(ctx), DT = 1 / 30;
  const skill = rand(0.8, 1);
  return (m) => {
    if (m.k === 'dodge') { W = m.w; H = m.h; PR = m.pr; }
    if (m.k !== 's' || !W) return;
    const before = prev; prev = m;
    const me = m.p[ctx.i];
    if (!me[2] || !before || tick++ % 3) return; // décide 10 fois par seconde
    const balls = m.b.map(([x, y, r], k) => { const o = before.b[k] || [x, y]; return { x, y, r, vx: (x - o[0]) / DT, vy: (y - o[1]) / DT }; });
    const lasers = m.l.map(([a, on], k) => ({ a, on, w: before.l[k] ? (a - before.l[k][0]) / DT : 0 }));
    const danger = (x, y, tau) => {
      let d = 0;
      balls.forEach((b) => {
        const bx = b.x + b.vx * tau, by = b.y + b.vy * tau;
        const gap = Math.hypot(x - bx, y - by) - PR - b.r;
        if (gap < 70) d += Math.exp(-gap / 18) * 3;
      });
      lasers.forEach((L) => {
        const gap = rayDist(x, y, W / 2, H / 2, L.a + L.w * (tau + 0.1)) - PR;
        if (gap < 60) d += Math.exp(-gap / 12) * (L.on ? 4 : 1.5);
      });
      const wall = Math.min(x, W - x, y, H - y) - PR;
      d += Math.exp(-wall / 25) * 0.6;
      return d;
    };
    const [dx, dy] = bestDir(me[0], me[1], 240, 0, (x0, y0, dx, dy) => {
      let s = 0;
      for (const tau of [0.12, 0.25, 0.4]) {
        const l = Math.hypot(dx, dy) || 1;
        s -= danger(x0 + (dx / l) * 240 * tau, y0 + (dy / l) * 240 * tau, tau);
      }
      return s + Math.random() * (1 - skill) * 2;
    });
    mv(dx, dy);
  };
};

// ── Course de haies ──
BRAINS.race = (ctx) => {
  let hurdles = null, L = 0, x = 0, v = 0, done = false, side = 'l';
  const rate = rand(7.5, 10), jumped = new Set();
  function run() {
    if (done) return;
    side = side === 'l' ? 'r' : 'l';
    ctx.act({ a: 'run', k: side }, 1);
    ctx.later(run, (1000 / rate) * rand(0.8, 1.2));
  }
  return (m) => {
    if (m.k === 'race') { hurdles = m.hurdles; L = m.L; ctx.later(run, rand(150, 400)); }
    if (m.k !== 's' || !hurdles) return;
    const [nx, y] = m.r[ctx.i];
    v = v * 0.7 + (nx - x) * 30 * 0.3; x = nx;
    if (x >= L) done = true;
    const h = hurdles.find((hx) => hx > x);
    if (h === undefined || y > 0 || jumped.has(h)) return;
    if (h - x < Math.max(25, v * 0.2)) { jumped.add(h); if (Math.random() > 0.07) ctx.act({ a: 'jump' }, rand(10, 60)); }
  };
};

// ── Le Filtre ──
BRAINS.filter = (ctx) => {
  let items = null, pos = 0, lives = 3, stunMs = 1500;
  const speed = rand(380, 560); // ms par objet
  function go() {
    if (!items || lives <= 0 || pos >= items.length) return;
    const want = items[pos].f ? 1 : 0;
    if (Math.random() < 0.03) { ctx.act({ a: 'sort', b: 1 - want, p: pos }, 1); ctx.later(go, stunMs + rand(250, 600)); return; }
    ctx.act({ a: 'sort', b: want, p: pos }, 1);
    pos++;
    ctx.later(go, speed * rand(0.75, 1.3));
  }
  return (m) => {
    if (m.k === 'belt') { items = m.items; stunMs = m.stun; ctx.later(go, rand(500, 900)); }
    if (m.k === 'sync') pos = m.p;
    if (m.k === 'stun' && m.lives) lives = m.lives[ctx.i];
  };
};

// ── Sol instable ──
BRAINS.floor = (ctx) => {
  let C, R, T, tiles = null, target = -1, crack = new Set(), holes = false, react = 0, goal = -1, tick = 0;
  const mv = mover(ctx);
  const safe = (k) => tiles[k] === target && !crack.has(k);
  const passable = (k) => tiles[k] !== -1 && (!holes || safe(k));
  const nbrs = (k) => { const x = k % C, y = Math.floor(k / C), o = []; if (x > 0) o.push(k - 1); if (x < C - 1) o.push(k + 1); if (y > 0) o.push(k - C); if (y < R - 1) o.push(k + C); return o; };
  return (m) => {
    if (m.k === 'floor') { C = m.c; R = m.r; T = m.tile; }
    if (m.k === 'ph') { tiles = m.tiles.slice(); target = m.target; crack = new Set(m.crack || []); holes = false; goal = -1; react = Date.now() + rand(250, 650); }
    if (m.k === 'drop') holes = true;
    if (m.k === 'restore') { holes = false; crack.forEach((k) => { tiles[k] = -1; }); crack.clear(); }
    if (m.k !== 's' || !tiles || tick++ % 3) return;
    const me = m.p[ctx.i];
    if (!me[2]) return;
    if (Date.now() < react) return;
    const here = Math.min(R - 1, Math.floor(me[1] / T)) * C + Math.min(C - 1, Math.floor(me[0] / T));
    // chemin le plus court (en dalles) vers une dalle sûre, en évitant les dalles déjà occupées ; on garde son objectif s'il tient toujours
    const busy = (k) => m.p.filter((q, j) => j !== ctx.i && q[2] && Math.floor(q[1] / T) * C + Math.floor(q[0] / T) === k).length;
    const from = new Map([[here, -1]]), depth = new Map([[here, 0]]), q = [here];
    let bestK = -1, bestS = Infinity;
    for (let h = 0; h < q.length; h++) {
      const k = q[h];
      if (safe(k)) { const s = depth.get(k) + busy(k) * 2 - (k === goal ? 1.5 : 0); if (s < bestS) { bestS = s; bestK = k; } }
      nbrs(k).forEach((o) => { if (!from.has(o) && passable(o)) { from.set(o, k); depth.set(o, depth.get(k) + 1); q.push(o); } });
    }
    goal = bestK;
    if (goal < 0) return mv(0, 0);
    // prochaine dalle du chemin
    let nxt = goal;
    while (from.get(nxt) !== here && from.get(nxt) !== -1) nxt = from.get(nxt);
    const tx = (nxt % C) * T + T / 2, ty = Math.floor(nxt / C) * T + T / 2;
    const ex = tx - me[0], ey = ty - me[1];
    if (nxt === here && Math.abs(ex) < 10 && Math.abs(ey) < 10) {
      mv(0, 0);
      // bien placé : bouscule un adversaire collé à lui de temps en temps
      if (m.p.some((q, j) => j !== ctx.i && q[2] && ctx.sideOf[j] !== ctx.sideOf[ctx.i] && Math.hypot(q[0] - me[0], q[1] - me[1]) < 38) && Math.random() < 0.15) ctx.act({ a: 'shove' });
      return;
    }
    mv(Math.abs(ex) > 6 ? Math.sign(ex) : 0, Math.abs(ey) > 6 ? Math.sign(ey) : 0);
  };
};

// ── Pause clope ──
BRAINS.smoke = (ctx) => {
  let fill = 1000, lo = 75, hi = 93;
  function puff(delay) {
    const aim = (lo + hi) / 2 + gauss() * 5.5;
    ctx.act({ a: 'in' }, delay);
    ctx.act({ a: 'out' }, delay + (fill * aim) / 100);
  }
  return (m) => {
    if (m.k === 'smoke') { fill = m.fill; lo = m.lo; hi = m.hi; puff(rand(300, 700)); }
    if (m.k === 'next') { fill = m.fill; puff(rand(200, 450)); }
  };
};

// ── Bonnes manières ──
BRAINS.manners = (ctx) => (m) => {
  if (m.k !== 'ph') return;
  if (m.ph === 'read') ctx.act({ a: 'eat' }, rand(150, 450));
  if (m.ph === 'rustle' && Math.random() > 0.12) ctx.act({ a: 'stop' }, rand(140, 380)); // parfois trop gourmand…
  if (m.ph === 'look') ctx.act({ a: 'stop' }, rand(150, 350));
};

// ── L'Araignée ──
BRAINS.bomb = (ctx) => {
  let W, H, PR, rects = [], tick = 0;
  const mv = mover(ctx);
  const blocked = (x, y) => x < PR || y < PR || x > W - PR || y > H - PR || rects.some((r) => inRect(x, y, r, PR + 2));
  return (m) => {
    if (m.k === 'bomb') { W = m.w; H = m.h; PR = m.pr; rects = m.rects; }
    if (m.k !== 's' || !W || tick++ % 3) return;
    const me = m.p[ctx.i];
    if (!me[2]) return;
    const h = m.h;
    if (h === ctx.i) {
      // porteur : fonce sur l'adversaire le plus proche
      const foes = m.p.map((q, j) => [q, j]).filter(([q, j]) => j !== ctx.i && q[2] && ctx.sideOf[j] !== ctx.sideOf[ctx.i]);
      if (!foes.length) return mv(0, 0);
      const [tq] = foes.sort((a, b) => Math.hypot(a[0][0] - me[0], a[0][1] - me[1]) - Math.hypot(b[0][0] - me[0], b[0][1] - me[1]))[0];
      const [dx, dy] = bestDir(me[0], me[1], 255, 0.25, (x, y) => (blocked(x, y) ? -1e6 : -Math.hypot(tq[0] - x, tq[1] - y)) + Math.random() * 4);
      mv(dx, dy);
    } else if (h >= 0) {
      // fuit le porteur sans se coincer dans un angle
      const hq = m.p[h];
      const [dx, dy] = bestDir(me[0], me[1], 225, 0.3, (x, y) => {
        if (blocked(x, y)) return -1e6;
        const wall = Math.min(x, W - x, y, H - y);
        return Math.min(Math.hypot(hq[0] - x, hq[1] - y), 380) + Math.min(wall, 120) * 0.45 + Math.random() * 6;
      });
      mv(dx, dy);
    } else mv(0, 0);
  };
};

// ── Champ de mines ──
BRAINS.mines = (ctx) => {
  let L, H, PR = 12, mode = 'scan', goalX = 0, tick = 0;
  const known = new Map(), mv = mover(ctx);
  return (m) => {
    if (m.k === 'mines') { L = m.l; H = m.h; PR = m.pr; }
    if (m.k === 'rev') m.m.forEach(([k, x, y]) => known.set(k, [x, y]));
    if (m.k === 'boom') known.delete(m.m);
    if (m.k !== 's' || !L || tick++ % 2) return;
    const me = m.p[ctx.i];
    if (!me[2] || me[0] >= L - 30) return;
    const chased = me[0] - m.hv < 200; // la moissonneuse arrive : plus le temps de sonder
    if (mode === 'scan') {
      mv(0, 0);
      // le sonar porte à 150 px : on avance un peu moins (une mine pas encore repérée reste possible)
      if (m.st[ctx.i] || chased) { mode = 'go'; goalX = me[0] + rand(100, 125); }
      return;
    }
    if (me[0] >= goalX && !chased) { mode = 'scan'; return mv(0, 0); }
    // vers la droite, en gardant ses distances avec les mines repérées (elles sautent à 16 px)
    const [dx, dy] = bestDir(me[0], me[1], 190, 0.2, (x, y) => {
      if (y < 20 || y > H - 20) return -1e6;
      let s = x;
      known.forEach(([mx, my]) => { const d = Math.hypot(x - mx, y - my); if (d < 32) s -= 2000 + (32 - d) * 60; else if (d < 60) s -= (60 - d) * 2; });
      return s + Math.random();
    });
    mv(dx, dy);
  };
};

// ── Tank ──
BRAINS.tank = (ctx) => {
  let W, H, PR, BR, boxes = [], prevB = [], tick = 0, lastAim = '', spot = [0, 0], still = 0, wander = 0, wdir = [0, 0];
  const mv = mover(ctx);
  const solid = () => boxes.filter((b) => b.hp > 0);
  const blocked = (x, y) => x < PR || y < PR || x > W - PR || y > H - PR || solid().some((b) => inRect(x, y, [b.x, b.y, b.w, b.h], PR + 2));
  const clearLine = (x1, y1, x2, y2) => {
    const steps = Math.ceil(Math.hypot(x2 - x1, y2 - y1) / 12);
    for (let k = 1; k < steps; k++) { const x = x1 + ((x2 - x1) * k) / steps, y = y1 + ((y2 - y1) * k) / steps; if (solid().some((b) => inRect(x, y, [b.x, b.y, b.w, b.h], BR))) return false; }
    return true;
  };
  const oct = (a) => Math.round(a / (Math.PI / 4)) * (Math.PI / 4);
  return (m) => {
    if (m.k === 'tank') { W = m.w; H = m.h; PR = m.pr; BR = m.br; boxes = m.boxes.map(([x, y, w, h, metal, hp]) => ({ x, y, w, h, hp: metal ? 99 : hp })); }
    if (m.k === 'box' && boxes[m.id] && boxes[m.id].hp < 99) boxes[m.id].hp = m.hp;
    if (m.k !== 's' || !W) return;
    const before = prevB; prevB = m.b;
    if (tick++ % 3) return;
    const me = m.p[ctx.i];
    if (!me[2]) return;
    const foes = m.p.map((q, j) => [q, j]).filter(([q, j]) => j !== ctx.i && q[2] && ctx.sideOf[j] !== ctx.sideOf[ctx.i]);
    if (!foes.length) return mv(0, 0);
    const [tq] = foes.sort((a, b) => Math.hypot(a[0][0] - me[0], a[0][1] - me[1]) - Math.hypot(b[0][0] - me[0], b[0][1] - me[1]))[0];
    // obus dangereux : vitesse estimée d'après l'image précédente (même tireur, position la plus proche)
    const shells = m.b.map(([x, y, o]) => {
      const p = before.filter((b) => b[2] === o).sort((a, b) => Math.hypot(a[0] - x, a[1] - y) - Math.hypot(b[0] - x, b[1] - y))[0];
      return p && Math.hypot(p[0] - x, p[1] - y) < 30 ? { x, y, vx: (x - p[0]) * 30, vy: (y - p[1]) * 30, o } : null;
    }).filter((b) => b && (b.o !== ctx.i) && ctx.sideOf[b.o] !== ctx.sideOf[ctx.i]);
    // coincé derrière une caisse depuis un moment : petit détour au hasard
    if (Math.hypot(me[0] - spot[0], me[1] - spot[1]) > 25) { spot = [me[0], me[1]]; still = 0; } else still++;
    if (still > 15 && !clearLine(me[0], me[1], tq[0], tq[1])) { wander = 6; still = 0; wdir = [pick([-1, 0, 1]), pick([-1, 1])]; }
    let dx, dy;
    if (wander > 0) { wander--; [dx, dy] = wdir; } else {
      [dx, dy] = bestDir(me[0], me[1], 165, 0.3, (x, y) => {
        if (blocked(x, y)) return -1e6;
        const d = Math.hypot(tq[0] - x, tq[1] - y), a = Math.atan2(tq[1] - y, tq[0] - x);
        let s = -Math.abs(d - 240) * 0.15 - d * Math.abs(Math.sin(a - oct(a))) * 0.5; // à bonne distance, aligné sur un des 8 axes du canon
        if (!clearLine(x, y, tq[0], tq[1])) s -= 80; // une caisse entre les deux : inutile de rester là
        if (Math.random() < 0.65) shells.forEach((b) => { // ne voit pas toujours l'obus arriver
          for (let tau = 0; tau <= 0.6; tau += 0.1) if (Math.hypot(b.x + b.vx * tau - x, b.y + b.vy * tau - y) < PR + BR + 14) { s -= 400; break; }
        });
        return s + Math.random() * 5;
      });
    }
    mv(dx, dy);
    // vise l'axe le plus proche de la cible et tire si elle est dans l'axe et à découvert
    const a = Math.atan2(tq[1] - me[1], tq[0] - me[0]), o = oct(a), d = Math.hypot(tq[0] - me[0], tq[1] - me[1]);
    const ax = Math.round(Math.cos(o)), ay = Math.round(Math.sin(o));
    if (ax + ',' + ay !== lastAim) { lastAim = ax + ',' + ay; ctx.act({ a: 'aim', x: ax, y: ay }); }
    if (d * Math.abs(Math.sin(a - o)) < PR * 0.9 && clearLine(me[0], me[1], tq[0], tq[1]) && Math.random() < 0.8) ctx.act({ a: 'fire' }, 140);
  };
};

// ── Gâchette ──
// Vise avec la vraie balistique (angle bas qui atteint la cible malgré la gravité, en anticipant son
// déplacement), garde une distance de duel, esquive en sautant, évite le vide, saute vers les ennemis perchés.
BRAINS.gun = (ctx) => {
  let G = null, tick = 0, mvKey = '', jumpOn = false, lastAim = 1e9, strafe = 1, strafeT = 0, prevB = [], blocked = 0;
  const solid = (x, y) => G.rects.some(([rx, ry, rw, rh, one]) => !one && x > rx && x < rx + rw && y > ry && y < ry + rh);
  const setMv = (x, down) => { const k = x + ',' + !!down; if (k !== mvKey) { mvKey = k; ctx.act({ a: 'mv', x, down: !!down }); } };
  const jump = (hold = 260) => {
    if (jumpOn) return;
    jumpOn = true; ctx.act({ a: 'jump', on: true });
    ctx.later(() => { jumpOn = false; ctx.act({ a: 'jump', on: false }, 1); }, hold);
  };
  // angle (repère écran) pour toucher (dx, dy) à la vitesse v, gravité g ; trajectoire tendue si possible
  // high = tir en cloche (par-dessus un obstacle) plutôt que tendu
  function ballistic(dx, dy, v, g, high) {
    const x = Math.abs(dx), y = -dy, v2 = v * v, disc = v2 * v2 - g * (g * x * x + 2 * y * v2);
    const up = disc < 0 ? Math.PI / 4 : Math.atan((v2 + (high ? 1 : -1) * Math.sqrt(disc)) / (g * Math.max(1, x)));
    return { a: dx >= 0 ? -up : Math.PI + up, t: x / Math.max(1, v * Math.cos(up)) };
  }
  // la balle passe-t-elle sans heurter de bloc avant d'arriver à la cible ?
  function clear(x, y, a, tx) {
    let vx = Math.cos(a) * G.bs, vy = Math.sin(a) * G.bs;
    for (let k = 0; k < 90; k++) {
      vy += G.bg / 60; x += vx / 60; y += vy / 60;
      if ((vx > 0 && x >= tx) || (vx < 0 && x <= tx)) return true;
      if (solid(x, y) || y > G.h) return false;
    }
    return false;
  }
  return (m) => {
    if (m.k === 'gun') { G = { w: m.w, h: m.h, pw: m.pw, ph: m.ph, bs: m.bs, bg: m.bg, pit: m.pit, rects: m.rects }; return; }
    if (m.k !== 's' || !G) return;
    const before = prevB; prevB = m.b;
    if (tick++ % 2) return;
    const me = m.p[ctx.i];
    if (!me || me[2] !== 1) { setMv(0); return; }
    const [x, y] = me, onGround = me[11], wall = me[12];
    const foes = m.p.map((q, j) => [q, j]).filter(([q, j]) => j !== ctx.i && q[2] === 1 && ctx.sideOf[j] !== ctx.sideOf[ctx.i]);
    if (!foes.length) { setMv(0); return; }
    const [tq] = foes.sort((a, b) => Math.hypot(a[0][0] - x, a[0][1] - y) - Math.hypot(b[0][0] - x, b[0][1] - y))[0];
    const dx = tq[0] - x, dy = tq[1] - y, side = Math.sign(dx) || 1;

    // déplacement : distance de duel 180–320 px, petits pas de côté pour ne pas être une cible fixe
    if (--strafeT <= 0) { strafe = pick([-1, 1, 1]); strafeT = 8 + Math.floor(Math.random() * 12); }
    let mx = 0;
    const ad = Math.abs(dx);
    if (ad > 320) mx = side; else if (ad < 170) mx = -side; else mx = strafe * (Math.random() < 0.5 ? side : -side);
    // le vide : ses bords sont des murs pour un bot au sol ; projeté au-dessus, il se rattrape vers le bord le plus proche
    if (G.pit) {
      const [p0, p1] = G.pit, mid = (p0 + p1) / 2, low = y > 330;
      if (low && x < p0 && x + mx * 70 > p0 - 12) mx = x > p0 - 40 ? -1 : 0;
      if (low && x > p1 && x + mx * 70 < p1 + 12) mx = x < p1 + 40 ? 1 : 0;
      if (x >= p0 - 4 && x <= p1 + 4 && me[7] >= 0 && y > 300) mx = x < mid ? -1 : 1;
    }
    // ennemi perché : sauter ; ennemi en contrebas sur une planche : descendre
    let down = false;
    if (dy < -70 && onGround && Math.random() < 0.35) jump(300);
    if (dy > 70 && onGround && Math.random() < 0.5) down = true;
    if (wall && mx === wall) jump(260); // contre un mur : saut mural
    // esquive : une balle ennemie va passer sur moi dans le prochain demi-second
    if (Math.random() < 0.7) for (const b of m.b) {
      if (b[2] === ctx.i || ctx.sideOf[b[2]] === ctx.sideOf[ctx.i]) continue;
      let bx = b[0], by = b[1], bvx = b[3] * 10, bvy = b[4] * 10, hit = false;
      for (let k = 0; k < 30 && !hit; k++) { bvy += G.bg / 60; bx += bvx / 60; by += bvy / 60; if (Math.abs(bx - x) < 22 && Math.abs(by - y) < 24) hit = true; }
      if (hit) { if (onGround) jump(200 + Math.random() * 150); else mx = -Math.sign(bvx) || mx; break; }
    }
    if (before.length && Math.random() < 0.02) jump(); // un saut de temps en temps : moins prévisible
    setMv(mx, down);

    // visée balistique avec anticipation du déplacement de la cible, et une petite erreur humaine ;
    // si le tir tendu est bouché, on essaie le tir en cloche
    const mx0 = x, my0 = y - 2;
    const aimFor = (high) => {
      let sol = ballistic(dx, dy, G.bs, G.bg, high);
      const lead = Math.min(high ? 1.2 : 0.6, sol.t);
      sol = ballistic(dx + tq[6] * 10 * lead * 0.8, dy + Math.min(0, tq[7] * 10 * lead * 0.3), G.bs, G.bg, high);
      return sol.a + gauss() * (high ? 0.025 : 0.035);
    };
    const open = (a) => clear(mx0 + Math.cos(a) * (G.pw + 12), my0 + Math.sin(a) * (G.pw + 12), a, tq[0]);
    let a = aimFor(false), shot = open(a);
    if (!shot) { const h = aimFor(true); if (open(h)) { a = h; shot = true; } }
    if (Math.abs(a - lastAim) > 0.015) { lastAim = a; ctx.act({ a: 'aim', v: Math.round(a * 1000) }, 1); }
    const ready = me[9] > 0 && me[10] >= 100;
    if (ready && shot && Math.random() < 0.6) ctx.act({ a: 'fire' }, 90);
    // pas de ligne de tir depuis un moment : on va chercher l'ennemi (en sautant pour monter sur les plateformes)
    blocked = shot ? 0 : blocked + 1;
    if (blocked > 12) { setMv(side, false); if (onGround && Math.random() < 0.4) jump(320); }
  };
};

// ── Syllabes ──
let WORDS = null; // tous les mots du dictionnaire, en tableau pour piocher au hasard
BRAINS.words = (ctx) => {
  const used = new Set();
  function find(syl) {
    if (!WORDS) WORDS = [...dict().words];
    const found = [];
    for (let k = 0, at = Math.floor(Math.random() * WORDS.length); k < WORDS.length && found.length < 25; k++) {
      const w = WORDS[(at + k) % WORDS.length];
      if (w.length >= 4 && w.length <= 10 && w.includes(syl) && !used.has(w)) found.push(w);
    }
    found.sort((a, b) => a.length - b.length);
    return found[Math.floor(Math.random() * Math.min(found.length, 8))];
  }
  return (m) => {
    if (m.k === 'ok') used.add(norm(m.text));
    if (m.k !== 'turn' || m.i !== ctx.i) return;
    const w = find(m.syl);
    if (!w || Math.random() < 0.1) return; // sèche…
    // réfléchit, puis tape lettre par lettre (les autres voient le mot s'écrire)
    let t = rand(1300, 4000);
    const per = rand(70, 140);
    for (let k = 1; k <= w.length; k++) { ctx.act({ a: 'type', text: w.slice(0, k) }, t); t += per; }
    ctx.act({ a: 'word', text: w }, t + 120);
  };
};

// ── Circuit ──
BRAINS.circuit = (ctx) => {
  let segs = null, obs = [], SEG = 200, MAX = 12000, sent = '', lane = 0;
  const caution = rand(0.86, 0.97); // les bots prennent les virages un peu en dessous de la limite
  // vitesse max qu'on peut tenir dans un virage de courbure c (le volant compense au plus 1)
  const vmax = (c) => MAX * Math.min(1.35, (0.95 * caution) / Math.max(0.01, 0.3 * Math.abs(c)));
  return (m) => {
    if (m.k === 'track') { segs = m.s; obs = m.o; SEG = m.seg; MAX = m.max; }
    if (m.k !== 's' || !segs) return;
    const me = m.p[ctx.i];
    if (m.go !== undefined) { if (sent !== '1,0,0') { sent = '1,0,0'; ctx.act({ a: 'drive', g: 1, b: 0, s: 0 }); } return; }
    if (me[3]) return;
    const z = me[0], x = me[1] / 100, sp = me[2], r = sp / MAX, k0 = Math.floor(z / SEG);
    // freinage : pour chaque segment à venir, peut-on encore ralentir à temps ?
    let brake = false, coast = false;
    for (let j = 0; j < 45; j++) {
      const s = segs[k0 + j]; if (!s) break;
      const v = vmax(s[0]); if (sp <= v) continue;
      const dist = (sp * sp - v * v) / (2 * MAX), dz = (k0 + j) * SEG - z;
      if (dist + 300 >= dz) brake = true; else if (dist + 1400 >= dz) coast = true;
    }
    // trajectoire : la voie la plus proche qui évite cônes et gosses à venir
    const horizon = z + Math.max(sp, 3000) * 1.1;
    let bestL = lane, bestC = Infinity;
    for (let l = -0.75; l <= 0.751; l += 0.15) {
      let cost = Math.abs(l - x) * 0.6 + Math.abs(l) * 0.2 + (Math.abs(l - lane) > 0.01 ? 0.15 : 0);
      for (const [k, ox, type, ph] of obs) {
        const oz = k * SEG + SEG / 2;
        if (oz < z) continue;
        if (oz > horizon) break;
        if (type === 0) { if (Math.abs(l - ox) < 0.42) cost += 50; continue; }
        const at = m.tm + (oz - z) / Math.max(sp, 2500);
        for (const dt of [-0.3, 0, 0.3]) if (Math.abs(l - kidX(at + dt, ph)) < 0.38) { cost += 50; break; }
      }
      if (cost < bestC) { bestC = cost; bestL = l; }
    }
    lane = bestL;
    const c = (segs[k0] || [0])[0];
    const want = r * c * 0.3 + Math.max(-1, Math.min(1, (lane - x) * 5));
    const st = want > 0.35 ? 1 : want < -0.35 ? -1 : 0;
    const g = brake || coast ? 0 : 1, b = brake ? 1 : 0;
    const key = `${g},${b},${st}`;
    if (key !== sent) { sent = key; ctx.act({ a: 'drive', g, b, s: st }); }
  };
};

// ── Code secret : garde les codes encore possibles et en propose un ──
BRAINS.code = (ctx) => {
  let len = 4, cols = 6, max = 8, cand = null, timer = null;
  const all = (L, C) => { let out = [[]]; for (let k = 0; k < L; k++) out = out.flatMap((p) => range(C).map((c) => [...p, c])); return out; };
  const score = (g, code) => {
    let b = 0; const lg = new Array(cols).fill(0), lc = new Array(cols).fill(0);
    g.forEach((v, k) => { if (v === code[k]) b++; else { lg[v]++; lc[code[k]]++; } });
    return [b, lg.reduce((s, v, c) => s + Math.min(v, lc[c]), 0)];
  };
  const plan = (ms) => { ctx.cancel(timer); timer = ctx.later(() => ctx.act({ a: 'guess', g: pick(cand) }, 1), ms); };
  return (m) => {
    if (m.k === 'code') { len = m.len; cols = m.cols; max = m.max; cand = all(len, cols); plan(rand(6000, 11000)); }
    if (m.k === 'fb' && cand) {
      cand = cand.filter((c) => { const [b, w] = score(m.g, c); return b === m.b && w === m.w; });
      if (m.b < len && m.n < max && cand.length) plan(rand(9000, 16000));
      else ctx.cancel(timer);
    }
  };
};

// ── Serpents ──
BRAINS.snake = (ctx) => {
  let W, H, dir = null;
  return (m) => {
    if (m.k === 'snake') { W = m.w; H = m.h; dir = m.dir[ctx.i]; }
    if (m.k !== 's' || !W) return;
    const body = m.b[ctx.i];
    if (!body || !body.length) return;
    if (body.length > 1) {
      const dx = (body[0] % W) - (body[1] % W), dy = Math.floor(body[0] / W) - Math.floor(body[1] / W);
      dir = DIRS.find((d) => DV[d][0] === dx && DV[d][1] === dy) || dir;
    }
    const occ = new Set();
    m.b.forEach((b) => b.forEach((c, k) => { if (k < b.length - 1) occ.add(c); })); // les queues avancent
    const near = new Set();
    m.b.forEach((b, j) => { if (j !== ctx.i && b.length) DIRS.forEach((d) => { const x = (b[0] % W) + DV[d][0], y = Math.floor(b[0] / W) + DV[d][1]; near.add(y * W + x); }); });
    const free = (x, y) => x >= 0 && y >= 0 && x < W && y < H && !occ.has(y * W + x);
    const hx = body[0] % W, hy = Math.floor(body[0] / W);
    // distance (BFS) jusqu'au fruit le plus proche depuis chaque case de départ possible
    const fruits = new Set(m.f);
    const toFruit = (x0, y0) => {
      const seen = new Set([y0 * W + x0]); let q = [[x0, y0]];
      for (let d = 0; q.length && d < 60; d++) {
        const nq = [];
        for (const [x, y] of q) {
          if (fruits.has(y * W + x)) return d;
          for (const k of DIRS) { const nx = x + DV[k][0], ny = y + DV[k][1], c = ny * W + nx; if (!seen.has(c) && free(nx, ny)) { seen.add(c); nq.push([nx, ny]); } }
        }
        q = nq;
      }
      return 99;
    };
    let best = null, bs = -Infinity;
    for (const d of DIRS) {
      if (d === OPP[dir]) continue;
      const nx = hx + DV[d][0], ny = hy + DV[d][1];
      if (!free(nx, ny)) continue;
      const room = flood(free, W, H, nx, ny, body.length * 2 + 10);
      let s = -toFruit(nx, ny) * 2 + (room > body.length + 3 ? 100 : room);
      if (near.has(ny * W + nx)) s -= 70;
      if (d === dir) s += 0.5;
      s += Math.random();
      if (Math.random() < 0.04) s = Math.random() * 200; // moment d'inattention
      if (s > bs) { bs = s; best = d; }
    }
    if (best && best !== dir) { ctx.act({ a: 'dir', d: best }, 5); dir = best; }
  };
};

// ── Envol ──
BRAINS.flap = (ctx) => {
  let gates = null, BX = 200, BR = 13, PW = 64, y = 0, vy = 0, last = 0, cur = -1, off = 0;
  return (m) => {
    if (m.k === 'flap') { gates = m.gates; BX = m.bx; BR = m.br; PW = m.pw; }
    if (m.k !== 's' || !gates) return;
    const me = m.p[ctx.i];
    vy = (me[0] - y) * 30; y = me[0];
    if (m.go !== undefined || !me[1]) return;
    const g = gates.findIndex(([x]) => x - m.d + PW > BX - BR);
    if (g < 0) return;
    const [, gy, gap] = gates[g];
    if (g !== cur) { cur = g; off = gauss() * gap * (Math.random() < 0.05 ? 0.35 : 0.1); } // chaque cheminée : un peu d'imprécision
    const target = gy + gap * 0.12 + off;
    const top = gy - gap / 2 + BR + 6;
    const now = Date.now();
    // bat des ailes s'il passe sous sa cible en tombant, sauf si le saut (≈ 65 px) le cognerait en haut
    if (y > target && vy > -80 && now - last > 160 && (y - 66 > top || y > gy + gap / 2 - BR - 12)) { last = now; ctx.act({ a: 'flap' }, rand(20, 70)); }
  };
};

// ── Déminage : déductions simples, sinon la case la moins risquée ──
BRAINS.mines2 = (ctx) => {
  let W, H, NM, num = new Map(), mine = new Set(), stunned = 0, done = false;
  const nb = (c) => { const x = c % W, y = Math.floor(c / W), o = []; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const X = x + dx, Y = y + dy; if ((dx || dy) && X >= 0 && Y >= 0 && X < W && Y < H) o.push(Y * W + X); } return o; };
  const unknown = (c) => !num.has(c) && !mine.has(c);
  function deduce() {
    const safe = new Set();
    let changed = true;
    while (changed) {
      changed = false;
      const cons = [];
      num.forEach((v, c) => {
        if (!v) return;
        const U = nb(c).filter(unknown), F = nb(c).filter((o) => mine.has(o)).length;
        if (!U.length) return;
        if (F === v) U.forEach((o) => safe.add(o));
        else if (F + U.length === v) { U.forEach((o) => mine.add(o)); changed = true; }
        else cons.push([new Set(U), v - F]);
      });
      // règle des sous-ensembles : si A ⊂ B, les cases de B \ A contiennent (B − A) mines
      if (!changed && !safe.size) {
        for (const [A, a] of cons) for (const [B, b] of cons) {
          if (A === B || A.size >= B.size || ![...A].every((o) => B.has(o))) continue;
          const rest = [...B].filter((o) => !A.has(o));
          if (b - a === 0) rest.forEach((o) => safe.add(o));
          else if (b - a === rest.length) { rest.forEach((o) => mine.add(o)); changed = true; }
        }
      }
    }
    return [...safe].filter(unknown);
  }
  function guess() {
    // probabilité grossière : max des contraintes voisines, sinon densité restante
    const left = range(W * H).filter(unknown);
    if (!left.length) return -1;
    const dens = Math.max(0, NM - mine.size) / left.length;
    let best = left[0], bp = Infinity;
    left.forEach((c) => {
      let p = dens;
      nb(c).forEach((o) => { const v = num.get(o); if (v) { const U = nb(o).filter(unknown), F = nb(o).filter((x) => mine.has(x)).length; p = Math.max(p, (v - F) / U.length); } });
      p += Math.random() * 0.02;
      if (p < bp) { bp = p; best = c; }
    });
    return best;
  }
  function play() {
    if (done) return;
    if (Date.now() < stunned) return ctx.later(play, stunned - Date.now() + 200);
    const safe = deduce();
    const c = safe.length ? pick(safe) : guess();
    if (c < 0) { done = true; return; }
    ctx.act({ a: 'open', c }, 1);
    ctx.later(play, rand(500, 1000) * (safe.length ? 1 : 1.6));
  }
  return (m) => {
    if (m.k === 'grid') { W = m.w; H = m.h; NM = m.nm; m.open.forEach(([c, v]) => num.set(c, v)); ctx.later(play, rand(800, 1500)); }
    if (m.k === 'open') m.cells.forEach(([c, v]) => num.set(c, v));
    if (m.k === 'boom') { mine.add(m.c); stunned = Date.now() + m.ms; }
  };
};

function makeBrain(key, ctx) {
  const f = BRAINS[key];
  return f ? f(ctx) : null;
}

module.exports = { makeBrain, BOT_NAMES, BRAINS };
