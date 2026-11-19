// CLUTCH — Gâchette : physique d'un joueur, partagée par le serveur (autoritaire) et le navigateur
// (prédiction locale de son propre personnage). Même code des deux côtés = même trajectoire.
(function (root) {
  'use strict';
  const K = {
    DT: 1 / 60, PW: 13, PH: 15,
    G: 1600, RUN: 270, ACC_G: 3000, ACC_A: 1700, FRIC: 2600, JUMP: 610, CUT: 0.45, VMAX: 1100,
    COYOTE: 0.1, BUFFER: 0.13, WALL_SLIDE: 150, WALL_JX: 360, WALL_JY: 560,
  };

  const solidHit = (rects, x, y, w, h) => rects.find((r) => !r.one && x + w > r.x && x - w < r.x + r.w && y + h > r.y && y - h < r.y + r.h);

  /**
   * Un pas de 1/60 s. p : { x, y, vx, vy, ground, wall, coyote, buf, jumpHeld, mx, down }
   * world : { W, rects: [{ x, y, w, h, one }] }. Renvoie 'jump', 'wall' ou null.
   */
  function step(p, world) {
    const { DT, PW, PH } = K;
    let ev = null;
    // course : accélère vers la vitesse voulue, freine fort au sol quand on lâche
    const target = p.mx * K.RUN, acc = p.ground ? K.ACC_G : K.ACC_A;
    if (p.mx) p.vx += Math.sign(target - p.vx) * Math.min(Math.abs(target - p.vx), acc * DT);
    else if (p.ground) p.vx -= Math.sign(p.vx) * Math.min(Math.abs(p.vx), K.FRIC * DT);
    else p.vx *= Math.pow(0.6, DT); // résistance de l'air (garde la projection lisible)
    // gravité, glissade contre un mur
    p.vy += K.G * DT;
    if (p.wall && !p.ground && p.vy > K.WALL_SLIDE && p.mx === p.wall) p.vy = K.WALL_SLIDE;
    if (p.vy > K.VMAX) p.vy = K.VMAX;
    // saut : mémorisé un court instant, permis juste après avoir quitté le bord, ou contre un mur
    p.coyote = p.ground ? K.COYOTE : p.coyote - DT;
    p.buf -= DT;
    if (p.buf > 0) {
      if (p.coyote > 0) { p.vy = -K.JUMP; p.buf = 0; p.coyote = 0; p.ground = false; ev = 'jump'; }
      else if (p.wall) { p.vy = -K.WALL_JY; p.vx = -p.wall * K.WALL_JX; p.buf = 0; ev = 'wall'; }
    }
    if (!p.jumpHeld && p.vy < 0) p.vy *= Math.pow(K.CUT, DT * 20); // relâcher = saut plus court

    // déplacement axe par axe avec résolution des collisions
    p.x += p.vx * DT;
    p.wall = 0;
    if (p.x < PW) { p.x = PW; p.vx = 0; p.wall = -1; }
    if (p.x > world.W - PW) { p.x = world.W - PW; p.vx = 0; p.wall = 1; }
    // collision latérale : on ignore les 4 px du haut et du bas (frôler un sol ou un plafond n'est pas
    // heurter un mur), et on sort par le côté où l'on dépasse le moins
    const r = solidHit(world.rects, p.x, p.y, PW, PH - 4);
    if (r) {
      const penL = p.x + PW - r.x, penR = r.x + r.w - (p.x - PW);
      if (penL < penR) { p.x = r.x - PW; p.wall = 1; } else { p.x = r.x + r.w + PW; p.wall = -1; }
      p.vx = 0;
    }
    const prevBottom = p.y + PH;
    p.y += p.vy * DT;
    p.ground = false;
    for (const q of world.rects) {
      if (p.x + PW <= q.x || p.x - PW >= q.x + q.w) continue;
      if (q.one) {
        // planche : on n'atterrit que par le dessus, en descendant, et pas si on appuie sur ⬇
        if (p.vy >= 0 && !p.down && prevBottom <= q.y + 1 && p.y + PH >= q.y) { p.y = q.y - PH; p.vy = 0; p.ground = true; }
        continue;
      }
      if (p.y + PH > q.y && p.y - PH < q.y + q.h) {
        if (p.vy >= 0 && prevBottom <= q.y + 2) { p.y = q.y - PH; p.vy = 0; p.ground = true; }
        else if (p.vy < 0) { p.y = q.y + q.h + PH; p.vy = 0; }
      }
    }
    if (p.ground) p.wall = 0;
    if (p.y < -200) p.y = -200;
    return ev;
  }

  const api = { K, step, solidHit };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.GunPhys = api;
})(typeof window !== 'undefined' ? window : globalThis);
