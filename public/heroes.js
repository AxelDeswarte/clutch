// CLUTCH — les personnages jouables : un seul rendu partagé par tous les jeux (canvas)
// Un personnage = un jeton cartoon à la couleur du joueur (volume, reflet, contour d'encre),
// son avatar emoji au centre, son cadre cosmétique, et un peu de vie : respiration, étirement dans
// le sens du mouvement, petit écrasement à l'arrêt, halo « c'est toi ».
'use strict';

const Hero = (() => {
  const EMOJI = '"Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif';
  const INK = '#1b1440';
  const TAU = Math.PI * 2;

  // ── couleurs : éclaircir / assombrir une teinte du joueur ──
  const shadeCache = new Map();
  function shade(hex, k) {
    const key = hex + k;
    if (shadeCache.has(key)) return shadeCache.get(key);
    const n = parseInt(String(hex).replace('#', '').padEnd(6, '0').slice(0, 6), 16);
    let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    if (k > 0) { r += (255 - r) * k; g += (255 - g) * k; b += (255 - b) * k; } else { r *= 1 + k; g *= 1 + k; b *= 1 + k; }
    const out = `rgb(${r | 0},${g | 0},${b | 0})`;
    shadeCache.set(key, out);
    return out;
  }

  // ── emoji pré-rendus : dessiner un emoji à chaque image coûte cher, on le met en cache par taille ──
  const glyphs = new Map();
  function glyph(ch, px) {
    px = Math.max(8, Math.round(px));
    const key = ch + '|' + px;
    let g = glyphs.get(key);
    if (g) return g;
    const pad = Math.ceil(px * 0.25), S = px + pad * 2;
    g = document.createElement('canvas');
    const dpr = Math.min(devicePixelRatio || 1, 2);
    g.width = g.height = Math.ceil(S * dpr);
    const c = g.getContext('2d');
    c.scale(dpr, dpr);
    c.font = `${px}px ${EMOJI}`; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText(ch, S / 2, S / 2 + px * 0.06);
    g.size = S;
    if (glyphs.size > 600) glyphs.clear();
    glyphs.set(key, g);
    return g;
  }
  // un emoji centré en (x, y), taille en px
  function emoji(c, ch, x, y, px, alpha = 1) {
    const g = glyph(ch, px);
    const a = c.globalAlpha; c.globalAlpha = a * alpha;
    c.drawImage(g, x - g.size / 2, y - g.size / 2, g.size, g.size);
    c.globalAlpha = a;
  }

  // ── cadres cosmétiques : le skin du compte se voit aussi en jeu ──
  function frameRing(c, frame, r, color, t) {
    c.lineWidth = Math.max(2, r * 0.16);
    switch (frame) {
      case 'neon':
        c.shadowColor = color; c.shadowBlur = r * 0.9; c.strokeStyle = '#fff';
        c.beginPath(); c.arc(0, 0, r * 1.08, 0, TAU); c.stroke(); c.shadowBlur = 0; break;
      case 'gold':
        c.strokeStyle = '#ffd700'; c.shadowColor = '#ffd700'; c.shadowBlur = r * 0.5;
        c.beginPath(); c.arc(0, 0, r * 1.08, 0, TAU); c.stroke(); c.shadowBlur = 0; break;
      case 'diamond':
        c.strokeStyle = '#b9f2ff'; c.shadowColor = '#7de3ff'; c.shadowBlur = r * 0.6;
        c.beginPath(); c.arc(0, 0, r * 1.08, 0, TAU); c.stroke(); c.shadowBlur = 0; break;
      case 'fire': {
        const k = 0.5 + 0.5 * Math.sin(t * 9);
        c.shadowColor = k > 0.5 ? '#ff4d6d' : '#ff9f1c'; c.shadowBlur = r * (0.6 + k * 0.6); c.strokeStyle = '#ff9f1c';
        c.beginPath(); c.arc(0, 0, r * 1.08, 0, TAU); c.stroke(); c.shadowBlur = 0; break;
      }
      case 'rainbow': {
        const g = c.createConicGradient ? c.createConicGradient(t * 2, 0, 0) : null;
        if (g) { ['#ff4d6d', '#ffd23f', '#2ee59d', '#3dd6ff', '#b388ff', '#ff4d6d'].forEach((col, i) => g.addColorStop(i / 5, col)); c.strokeStyle = g; }
        else c.strokeStyle = `hsl(${(t * 120) % 360},90%,60%)`;
        c.beginPath(); c.arc(0, 0, r * 1.1, 0, TAU); c.stroke(); break;
      }
      case 'void':
        c.strokeStyle = '#b388ff'; c.shadowColor = '#b388ff'; c.shadowBlur = r * 0.8;
        c.beginPath(); c.arc(0, 0, r * 1.08, 0, TAU); c.stroke(); c.shadowBlur = 0; break;
      case 'stripes':
        c.strokeStyle = '#fff'; c.setLineDash([r * 0.3, r * 0.22]); c.lineDashOffset = -t * r;
        c.beginPath(); c.arc(0, 0, r * 1.08, 0, TAU); c.stroke(); c.setLineDash([]); break;
      case 'glitch': {
        const j = Math.sin(t * 23) > 0.6 ? r * 0.08 : 0;
        c.lineWidth = Math.max(1.5, r * 0.1);
        c.strokeStyle = '#ff004c'; c.beginPath(); c.arc(j, 0, r * 1.08, 0, TAU); c.stroke();
        c.strokeStyle = '#00e5ff'; c.beginPath(); c.arc(-j, 0, r * 1.08, 0, TAU); c.stroke(); break;
      }
      case 'blood':
        c.strokeStyle = '#a3001b'; c.beginPath(); c.arc(0, 0, r * 1.08, 0, TAU); c.stroke(); break;
      default: break; // classic : le contour d'encre suffit
    }
  }

  /**
   * Dessine un personnage.
   * o = { x, y, r, color, avatar, frame, me, dead, vx, vy, t, name, label, shadow, bob, alpha, flip }
   *  - r : rayon du jeton ; vx/vy : vitesse (px/image) pour l'étirement ; t : temps en s
   */
  function draw(c, o) {
    const { x, y, r } = o;
    const t = o.t != null ? o.t : performance.now() / 1000;
    const col = o.color || '#ffd23f';
    c.save();
    if (o.alpha != null) c.globalAlpha *= o.alpha;

    // ombre portée au sol
    if (o.shadow !== false) {
      c.fillStyle = 'rgba(27,20,64,.28)';
      c.beginPath(); c.ellipse(x, y + r * 0.95, r * 0.85, r * 0.26, 0, 0, TAU); c.fill();
    }

    // mort : un petit fantôme pâle qui s'envole
    if (o.dead) {
      const fy = y - Math.sin(t * 3) * r * 0.15;
      c.globalAlpha *= 0.75;
      c.fillStyle = '#eef0ff'; c.strokeStyle = INK; c.lineWidth = Math.max(2, r * 0.12);
      c.beginPath();
      c.arc(x, fy - r * 0.15, r * 0.82, Math.PI, 0);
      const w = r * 0.82, base = fy + r * 0.7;
      c.lineTo(x + w, base);
      for (let k = 0; k < 4; k++) { const x0 = x + w - (k + 0.5) * (w / 2), x1 = x + w - (k + 1) * (w / 2); c.quadraticCurveTo(x0, base - r * 0.25 * (k % 2 ? -1 : 1), x1, base); }
      c.closePath(); c.fill(); c.stroke();
      c.fillStyle = INK;
      c.beginPath(); c.ellipse(x - r * 0.28, fy - r * 0.2, r * 0.1, r * 0.16, 0, 0, TAU); c.ellipse(x + r * 0.28, fy - r * 0.2, r * 0.1, r * 0.16, 0, 0, TAU); c.fill();
      emoji(c, o.avatar || '🙂', x + r * 0.62, fy - r * 0.75, r * 0.6, 0.9);
      c.restore();
      if (o.name) nameTag(c, o.name, x, y - r * 1.75, col, r, false, o.label);
      return;
    }

    // vie : respiration à l'arrêt, étirement dans le sens du mouvement
    const sp = Math.hypot(o.vx || 0, o.vy || 0);
    const stretch = Math.min(0.22, sp * 0.035);
    const breathe = sp < 0.2 ? Math.sin(t * 3.2 + (o.bob || 0)) * 0.035 : 0;
    const ang = sp > 0.2 ? Math.atan2(o.vy, o.vx) : 0;

    c.translate(x, y);
    c.rotate(ang);
    c.scale(1 + stretch - breathe * 0.5, 1 - stretch * 0.7 + breathe);
    c.rotate(-ang);

    // halo « c'est toi » : un anneau blanc qui pulse doucement
    if (o.me) {
      const p = 0.5 + 0.5 * Math.sin(t * 4);
      c.strokeStyle = `rgba(255,255,255,${0.35 + p * 0.4})`; c.lineWidth = Math.max(2, r * 0.18);
      c.beginPath(); c.arc(0, 0, r * (1.28 + p * 0.1), 0, TAU); c.stroke();
    }

    // le jeton : volume (dégradé), contour d'encre, reflet
    const g = c.createRadialGradient(-r * 0.35, -r * 0.45, r * 0.1, 0, 0, r * 1.05);
    g.addColorStop(0, shade(col, 0.55)); g.addColorStop(0.55, col); g.addColorStop(1, shade(col, -0.32));
    c.fillStyle = g;
    c.beginPath(); c.arc(0, 0, r, 0, TAU); c.fill();
    c.lineWidth = Math.max(2, r * 0.14); c.strokeStyle = INK; c.stroke();
    frameRing(c, o.frame, r, col, t);
    // assiette claire derrière l'emoji pour qu'il reste lisible sur toutes les couleurs
    c.fillStyle = 'rgba(255,255,255,.55)';
    c.beginPath(); c.arc(0, r * 0.04, r * 0.7, 0, TAU); c.fill();
    if (o.avatar) {
      if (o.flip) c.scale(-1, 1);
      emoji(c, o.avatar, 0, r * 0.04, r * 1.18);
      if (o.flip) c.scale(-1, 1);
    }
    // reflet brillant en haut à gauche
    c.fillStyle = 'rgba(255,255,255,.55)';
    c.beginPath(); c.ellipse(-r * 0.42, -r * 0.52, r * 0.22, r * 0.12, -0.6, 0, TAU); c.fill();
    c.restore();

    if (o.name) nameTag(c, o.name, x, y - r * 1.55, col, r, o.me, o.label);
  }

  // étiquette de nom : une pastille à la couleur du joueur, flèche vers le bas, « TOI » mis en avant
  function nameTag(c, name, x, y, col, r, me, label) {
    const txt = label || name;
    const fs = Math.max(10, Math.min(14, r * 0.62));
    c.save();
    c.font = `800 ${fs}px Nunito, system-ui, sans-serif`;
    const w = Math.min(120, c.measureText(txt).width) + fs * 0.9, h = fs + 7;
    c.fillStyle = me ? '#fff' : col; c.strokeStyle = INK; c.lineWidth = 2;
    roundRect(c, x - w / 2, y - h, w, h, h / 2); c.fill(); c.stroke();
    c.beginPath(); c.moveTo(x - 4, y - 0.5); c.lineTo(x, y + 4); c.lineTo(x + 4, y - 0.5); c.closePath(); c.fill(); c.stroke();
    c.fillStyle = INK; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText(txt, x, y - h / 2 + 0.5, 116);
    c.restore();
  }
  function roundRect(c, x, y, w, h, r) {
    c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath();
  }

  return { draw, emoji, nameTag, shade, EMOJI };
})();
