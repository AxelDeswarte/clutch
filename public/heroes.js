// CLUTCH — les personnages jouables, dessinés en vectoriel (plus d'emoji collé sur un rond)
// Chaque avatar devient une petite créature : un corps rond de son espèce (renard, panda, robot,
// citrouille…), un t-shirt à la couleur du joueur (on reconnaît son camp d'un coup d'œil), de grands
// yeux qui regardent là où il vise, des pieds qui courent, et les attributs de l'espèce
// (oreilles, cornes, crête, coquille, flammes…). Le même rendu sert en jeu (canvas) et dans les menus (portraits).
'use strict';

const Hero = (() => {
  const EMOJI = '"Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif';
  const INK = '#1b1440';
  const TAU = Math.PI * 2;

  // ── couleurs ──
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

  // ── emoji pré-rendus (pour le décor des jeux : 🍷, 🕷️, 💫…) ──
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
  function emoji(c, ch, x, y, px, alpha = 1) {
    const g = glyph(ch, px);
    const a = c.globalAlpha; c.globalAlpha = a * alpha;
    c.drawImage(g, x - g.size / 2, y - g.size / 2, g.size, g.size);
    c.globalAlpha = a;
  }

  // ── les espèces : une fiche par avatar ──
  // c corps · ears [type, couleur, intérieur] · horn · top (dessus de la tête) · face (museau, bec…)
  // eyes (style des yeux) · mouth · feet · back (dos : queue, coquille, ailes…) · patch (motif) · belly
  const SP = {
    '🦊': { c: '#ff8a3d', ears: ['pointy', '#ff8a3d', '#fff3e0'], face: 'muzzle', facec: '#fff3e0', back: 'tail' },
    '🐸': { c: '#5fd35f', eyes: 'frog', mouth: 'wide', belly: '#c9f5b5' },
    '🐼': { c: '#ffffff', ears: ['round', '#2a2350'], patch: 'panda' },
    '🐙': { c: '#ff6fa8', feet: 'tentacles', patch: 'spots', spotc: '#ffb3d0' },
    '🦄': { c: '#ffffff', ears: ['pointy', '#ffffff', '#ffc6e0'], horn: 'uni', top: 'mane', topc: '#b388ff' },
    '🐷': { c: '#ffb3c7', ears: ['small', '#ff9ab5'], face: 'snout', patch: 'blush' },
    '🐵': { c: '#9b6a43', ears: ['round', '#9b6a43', '#f1c9a0'], face: 'plate', facec: '#f1c9a0' },
    '🦖': { c: '#59c96b', back: 'spikes', backc: '#2f8a45', mouth: 'teeth', belly: '#c6f0a8' },
    '👽': { c: '#9be86d', eyes: 'alien', top: 'antenna2', mouth: 'line' },
    '🤖': { c: '#b9c0d6', eyes: 'robot', top: 'antenna1', mouth: 'grill' },
    '🤡': { c: '#ffffff', face: 'clown', top: 'afro', mouth: 'bigsmile' },
    '👻': { c: '#f2f2ff', feet: 'ghost', eyes: 'hollow', mouth: 'o' },
    '🍆': { c: '#7b3fa0', top: 'leafcap', tall: 1.12, patch: 'shine' },
    '🍑': { c: '#ffaa7a', top: 'leaf', patch: 'blush' },
    '🌮': { c: '#f4c04e', top: 'fringe' },
    '🧀': { c: '#ffd23f', patch: 'holes' },
    '🦆': { c: '#ffe36b', face: 'beak', feet: 'webbed' },
    '🐔': { c: '#ffffff', top: 'comb', face: 'beak', feet: 'webbed' },
    '🦍': { c: '#4a4a5a', face: 'plate', facec: '#8c8ca0', eyes: 'angry', ears: ['small', '#4a4a5a'] },
    '🐌': { c: '#d8c08a', eyes: 'stalks', back: 'shell', feet: 'slug' },
    '🍄': { c: '#fff0dc', top: 'mushcap' },
    '🎃': { c: '#ff9f1c', top: 'stem', eyes: 'jack', mouth: 'jack', patch: 'ridges' },
    '🥑': { c: '#8fd16a', patch: 'pit', rim: '#3f6b2a' },
    '🐀': { c: '#9a9aa8', ears: ['round', '#9a9aa8', '#ffb3c7'], face: 'whiskers', back: 'ratTail' },
    '🐉': { c: '#3fb37f', horn: 'two', hornc: '#ffd23f', back: 'wings', mouth: 'fangs', belly: '#bdf2c9' },
    '🦂': { c: '#c76a2e', back: 'stinger', eyes: 'angry', patch: 'bands' },
    '🦁': { c: '#f2b33d', top: 'mane', topc: '#a8692f', ears: ['round', '#f2b33d', '#ffe0a3'], face: 'muzzle', facec: '#ffe9c2' },
    '🧛': { c: '#e8e3f5', top: 'peak', mouth: 'fangs', eyes: 'angry', back: 'cape' },
    '🦈': { c: '#7fa6c9', top: 'fin', mouth: 'teeth', belly: '#eef4fb' },
    '💀': { c: '#f4f1e8', eyes: 'sockets', mouth: 'teeth' },
    '🐺': { c: '#8a8fa6', ears: ['pointy', '#8a8fa6', '#d6d9e6'], face: 'muzzle', facec: '#d6d9e6', eyes: 'angry', back: 'tail' },
    '👹': { c: '#e0473c', horn: 'two', hornc: '#fff3c4', mouth: 'fangs', eyes: 'angry' },
    '🦅': { c: '#6b4a2f', top: 'whitehead', face: 'hook', eyes: 'angry', back: 'wings' },
    '👑': { c: '#ffd8b0', top: 'crown', patch: 'blush' },
    '😈': { c: '#9b4dff', horn: 'devil', eyes: 'angry', mouth: 'grin', back: 'devilTail' },
    '🔥': { c: '#ff6a2a', top: 'flames', belly: '#ffd23f' },
    '☠️': { c: '#f4f1e8', eyes: 'sockets', mouth: 'teeth', top: 'bandana' },
    '🧠': { c: '#ff9fb6', top: 'brain' },
    '👁️': { c: '#ffffff', eyes: 'cyclops' },
    '🦾': { c: '#c8ccd8', eyes: 'visor', top: 'antenna1', patch: 'bolts' },
  };
  const DEFAULT_COLS = ['#ff8a3d', '#5fd35f', '#7fa6c9', '#ff6fa8', '#ffd23f', '#b388ff'];
  function spec(av) {
    if (SP[av]) return SP[av];
    let h = 0; for (const ch of String(av || '?')) h = (h * 31 + ch.codePointAt(0)) >>> 0;
    return { c: DEFAULT_COLS[h % DEFAULT_COLS.length], ears: h % 2 ? ['round', DEFAULT_COLS[h % DEFAULT_COLS.length]] : null };
  }

  // ── formes ──
  const E = (c, x, y, rx, ry, rot = 0) => { c.beginPath(); c.ellipse(x, y, Math.max(0.1, rx), Math.max(0.1, ry), rot, 0, TAU); };
  const fillStroke = (c, fill, lw) => { c.fillStyle = fill; c.fill(); c.lineWidth = lw; c.strokeStyle = INK; c.stroke(); };
  function bodyPath(c, r, tall) {
    const top = -r * 1.0 * tall, bot = r * 0.78, w = r * 0.9;
    c.beginPath();
    c.moveTo(0, top);
    c.bezierCurveTo(w * 1.05, top, w * 1.12, bot * 0.55, w * 0.78, bot);
    c.quadraticCurveTo(0, bot + r * 0.12, -w * 0.78, bot);
    c.bezierCurveTo(-w * 1.12, bot * 0.55, -w * 1.05, top, 0, top);
    c.closePath();
  }

  // ce qui dépasse derrière le corps : oreilles, cornes, queue, ailes, coquille…
  function drawBack(c, s, r, lw, t, run) {
    const col = s.c;
    const wag = Math.sin(t * 6 + run * 0.02) * 0.25;
    switch (s.back) {
      case 'tail': // queue touffue de renard / loup, bout clair
        c.save(); c.translate(-r * 0.75, r * 0.35); c.rotate(-0.9 + wag);
        E(c, -r * 0.45, 0, r * 0.55, r * 0.26); fillStroke(c, col, lw);
        E(c, -r * 0.85, 0, r * 0.18, r * 0.16); fillStroke(c, '#fff3e0', lw * 0.8);
        c.restore(); break;
      case 'ratTail':
        c.strokeStyle = INK; c.lineWidth = lw * 1.6; c.beginPath(); c.moveTo(-r * 0.7, r * 0.5); c.quadraticCurveTo(-r * 1.4, r * 0.3 + wag * r, -r * 1.3, -r * 0.2); c.stroke();
        c.strokeStyle = '#ffb3c7'; c.lineWidth = lw * 0.8; c.stroke(); break;
      case 'devilTail':
        c.strokeStyle = INK; c.lineWidth = lw * 1.6; c.beginPath(); c.moveTo(-r * 0.7, r * 0.45); c.quadraticCurveTo(-r * 1.4, r * 0.6 + wag * r, -r * 1.25, -r * 0.1); c.stroke();
        c.strokeStyle = col; c.lineWidth = lw * 0.8; c.stroke();
        c.beginPath(); c.moveTo(-r * 1.25, -r * 0.35); c.lineTo(-r * 1.42, -r * 0.02); c.lineTo(-r * 1.08, -r * 0.05); c.closePath(); fillStroke(c, col, lw * 0.8); break;
      case 'spikes': // crête dorsale de dino
        for (let k = 0; k < 4; k++) {
          const a = -2.3 + k * 0.42, px = Math.cos(a) * r * 0.92, py = Math.sin(a) * r * 0.95 - r * 0.05;
          c.save(); c.translate(px, py); c.rotate(a + Math.PI / 2);
          c.beginPath(); c.moveTo(-r * 0.15, 0); c.lineTo(0, -r * 0.32); c.lineTo(r * 0.15, 0); c.closePath(); fillStroke(c, s.backc || shade(col, -0.3), lw * 0.8);
          c.restore();
        }
        break;
      case 'wings': {
        const fl = Math.sin(t * 9) * 0.25;
        [-1, 1].forEach((d) => {
          c.save(); c.translate(d * r * 0.7, -r * 0.1); c.rotate(d * (0.5 + fl)); c.scale(d, 1);
          c.beginPath(); c.moveTo(0, 0); c.quadraticCurveTo(r * 0.9, -r * 0.9, r * 1.05, -r * 0.2); c.quadraticCurveTo(r * 0.7, -r * 0.1, r * 0.75, r * 0.2); c.quadraticCurveTo(r * 0.4, 0, 0, r * 0.25); c.closePath();
          fillStroke(c, shade(col, -0.18), lw * 0.8); c.restore();
        });
        break;
      }
      case 'shell': // coquille d'escargot en spirale sur le dos
        E(c, -r * 0.3, -r * 0.15, r * 0.72, r * 0.68); fillStroke(c, '#c98b4a', lw);
        c.strokeStyle = INK; c.lineWidth = lw * 0.8; c.beginPath();
        for (let k = 0; k < 40; k++) { const a = k * 0.3, rr = r * 0.6 * (1 - k / 44); const px = -r * 0.3 + Math.cos(a) * rr, py = -r * 0.15 + Math.sin(a) * rr; k ? c.lineTo(px, py) : c.moveTo(px, py); }
        c.stroke(); break;
      case 'stinger': // queue de scorpion recourbée au-dessus de la tête
        c.strokeStyle = INK; c.lineWidth = r * 0.3; c.lineCap = 'round';
        c.beginPath(); c.moveTo(-r * 0.6, r * 0.3); c.bezierCurveTo(-r * 1.4, -r * 0.2, -r * 1.0, -r * 1.5, -r * 0.1, -r * 1.35); c.stroke();
        c.strokeStyle = col; c.lineWidth = r * 0.18; c.stroke();
        c.beginPath(); c.moveTo(-r * 0.15, -r * 1.55); c.lineTo(r * 0.25, -r * 1.3); c.lineTo(-r * 0.1, -r * 1.15); c.closePath(); fillStroke(c, '#2a2350', lw * 0.7);
        c.lineCap = 'butt'; break;
      case 'cape':
        c.beginPath(); c.moveTo(-r * 0.75, -r * 0.2); c.quadraticCurveTo(-r * 1.25, r * 0.5 + Math.sin(t * 4) * r * 0.1, -r * 0.95, r * 0.95); c.lineTo(r * 0.95, r * 0.95); c.quadraticCurveTo(r * 1.25, r * 0.5, r * 0.75, -r * 0.2); c.closePath();
        fillStroke(c, '#2a1840', lw); break;
      default: break;
    }
    // oreilles
    if (s.ears) {
      const [type, ec, ic] = s.ears;
      [-1, 1].forEach((d) => {
        c.save(); c.translate(d * r * 0.5, -r * 0.82);
        if (type === 'pointy') { c.rotate(d * 0.28); c.beginPath(); c.moveTo(-r * 0.24, r * 0.12); c.lineTo(0, -r * 0.45); c.lineTo(r * 0.24, r * 0.12); c.closePath(); fillStroke(c, ec, lw); if (ic) { c.beginPath(); c.moveTo(-r * 0.11, r * 0.06); c.lineTo(0, -r * 0.26); c.lineTo(r * 0.11, r * 0.06); c.closePath(); c.fillStyle = ic; c.fill(); } }
        else if (type === 'round') { E(c, 0, -r * 0.05, r * 0.26, r * 0.26); fillStroke(c, ec, lw); if (ic) { E(c, 0, -r * 0.05, r * 0.13, r * 0.13); c.fillStyle = ic; c.fill(); } }
        else { c.rotate(d * 0.5); E(c, 0, -r * 0.05, r * 0.15, r * 0.2); fillStroke(c, ec, lw); }
        c.restore();
      });
    }
    // cornes
    const hc = s.hornc || '#fff3c4';
    if (s.horn === 'uni') {
      c.beginPath(); c.moveTo(-r * 0.13, -r * 0.92); c.lineTo(0, -r * 1.6); c.lineTo(r * 0.13, -r * 0.92); c.closePath(); fillStroke(c, '#ffd23f', lw * 0.8);
      c.strokeStyle = INK; c.lineWidth = lw * 0.5; c.beginPath(); c.moveTo(-r * 0.09, -r * 1.1); c.lineTo(r * 0.08, -r * 1.18); c.moveTo(-r * 0.06, -r * 1.3); c.lineTo(r * 0.05, -r * 1.36); c.stroke();
    } else if (s.horn === 'two' || s.horn === 'devil') {
      [-1, 1].forEach((d) => {
        c.beginPath(); c.moveTo(d * r * 0.25, -r * 0.88); c.quadraticCurveTo(d * r * 0.45, -r * 1.45, d * r * 0.62, -r * 1.42); c.quadraticCurveTo(d * r * 0.55, -r * 1.05, d * r * 0.55, -r * 0.75); c.closePath();
        fillStroke(c, s.horn === 'devil' ? '#2a2350' : hc, lw * 0.8);
      });
    }
  }

  // ce qui se pose sur le haut de la tête (devant le corps)
  function drawTop(c, s, r, lw, t, tall) {
    const top = -r * tall;
    switch (s.top) {
      case 'antenna1': case 'antenna2': {
        const xs = s.top === 'antenna1' ? [0] : [-r * 0.3, r * 0.3];
        xs.forEach((x0, k) => {
          const sw = Math.sin(t * 5 + k) * r * 0.08;
          c.strokeStyle = INK; c.lineWidth = lw; c.beginPath(); c.moveTo(x0, top + r * 0.05); c.quadraticCurveTo(x0 + sw, top - r * 0.3, x0 + sw * 1.5, top - r * 0.48); c.stroke();
          E(c, x0 + sw * 1.5, top - r * 0.52, r * 0.11, r * 0.11); fillStroke(c, s.top === 'antenna1' ? '#ff4d6d' : '#ffd23f', lw * 0.7);
        });
        break;
      }
      case 'comb':
        [-0.18, 0.02, 0.22].forEach((x, k) => { E(c, x * r, top - r * 0.08 - (k === 1 ? r * 0.06 : 0), r * 0.14, r * 0.17); fillStroke(c, '#ff4d6d', lw * 0.8); });
        break;
      case 'leaf':
        c.save(); c.translate(r * 0.05, top + r * 0.02); c.rotate(-0.5);
        E(c, r * 0.25, -r * 0.05, r * 0.3, r * 0.13); fillStroke(c, '#2ee59d', lw * 0.8); c.restore();
        c.strokeStyle = INK; c.lineWidth = lw; c.beginPath(); c.moveTo(0, top + r * 0.05); c.lineTo(-r * 0.05, top - r * 0.18); c.stroke();
        break;
      case 'leafcap':
        for (let k = -2; k <= 2; k++) { c.beginPath(); c.moveTo(k * r * 0.17, top + r * 0.22); c.quadraticCurveTo(k * r * 0.3, top - r * 0.05, k * r * 0.12, top - r * 0.12); c.quadraticCurveTo(k * r * 0.05, top + r * 0.1, k * r * 0.17, top + r * 0.22); fillStroke(c, '#2fb36a', lw * 0.7); }
        c.strokeStyle = INK; c.lineWidth = lw * 1.4; c.beginPath(); c.moveTo(0, top); c.lineTo(r * 0.05, top - r * 0.3); c.stroke();
        break;
      case 'stem':
        c.beginPath(); c.moveTo(-r * 0.1, top + r * 0.1); c.quadraticCurveTo(-r * 0.05, top - r * 0.3, r * 0.15, top - r * 0.32); c.lineTo(r * 0.12, top + r * 0.12); c.closePath(); fillStroke(c, '#3f8a3a', lw * 0.8);
        break;
      case 'mushcap': // chapeau de champignon rouge à pois
        c.beginPath(); c.moveTo(-r * 1.15, top + r * 0.62); c.bezierCurveTo(-r * 1.1, top - r * 0.5, r * 1.1, top - r * 0.5, r * 1.15, top + r * 0.62); c.quadraticCurveTo(0, top + r * 0.4, -r * 1.15, top + r * 0.62); c.closePath();
        fillStroke(c, '#ff4d6d', lw);
        [[-0.55, 0.05, 0.16], [0.1, -0.15, 0.2], [0.65, 0.12, 0.13], [-0.15, 0.3, 0.1]].forEach(([x, y, rr]) => { E(c, x * r, top + y * r, rr * r, rr * r * 0.85); c.fillStyle = '#fff'; c.fill(); });
        break;
      case 'crown':
        c.beginPath(); c.moveTo(-r * 0.45, top + r * 0.12); c.lineTo(-r * 0.5, top - r * 0.32); c.lineTo(-r * 0.22, top - r * 0.08); c.lineTo(0, top - r * 0.42); c.lineTo(r * 0.22, top - r * 0.08); c.lineTo(r * 0.5, top - r * 0.32); c.lineTo(r * 0.45, top + r * 0.12); c.closePath();
        fillStroke(c, '#ffd23f', lw * 0.8); E(c, 0, top - r * 0.02, r * 0.07, r * 0.07); c.fillStyle = '#ff4d6d'; c.fill();
        break;
      case 'flames': {
        const f = (k) => Math.sin(t * 11 + k * 1.7) * r * 0.1;
        c.beginPath(); c.moveTo(-r * 0.7, top + r * 0.45);
        c.quadraticCurveTo(-r * 0.75, top - r * 0.2 + f(1), -r * 0.4, top - r * 0.35 + f(2)); c.quadraticCurveTo(-r * 0.35, top - r * 0.05, -r * 0.1, top - r * 0.7 + f(3));
        c.quadraticCurveTo(r * 0.1, top - r * 0.2, r * 0.35, top - r * 0.5 + f(4)); c.quadraticCurveTo(r * 0.4, top - r * 0.1, r * 0.7, top - r * 0.25 + f(5));
        c.quadraticCurveTo(r * 0.75, top + r * 0.2, r * 0.7, top + r * 0.45); c.closePath();
        fillStroke(c, '#ffd23f', lw * 0.8);
        break;
      }
      case 'mane': // crinière (lion, licorne) : boucles autour du haut de la tête
        for (let k = 0; k < 7; k++) { const a = Math.PI + (k / 6) * Math.PI, px = Math.cos(a) * r * 0.85, py = Math.sin(a) * r * 0.85 - r * 0.15; E(c, px, py, r * 0.24, r * 0.24); fillStroke(c, s.topc, lw * 0.7); }
        break;
      case 'afro': // cheveux de clown de chaque côté
        [-1, 1].forEach((d) => { for (let k = 0; k < 3; k++) { E(c, d * (r * 0.78 + k * r * 0.12), -r * 0.55 + k * r * 0.22, r * 0.24, r * 0.22); fillStroke(c, ['#ff4d6d', '#3dd6ff', '#ffd23f'][k], lw * 0.7); } });
        break;
      case 'peak': // cheveux plaqués en pointe de vampire
        c.beginPath(); c.moveTo(-r * 0.88, -r * 0.25); c.quadraticCurveTo(-r * 0.85, top - r * 0.05, 0, top - r * 0.02); c.quadraticCurveTo(r * 0.85, top - r * 0.05, r * 0.88, -r * 0.25);
        c.quadraticCurveTo(r * 0.45, -r * 0.62, 0, -r * 0.42); c.quadraticCurveTo(-r * 0.45, -r * 0.62, -r * 0.88, -r * 0.25); c.closePath(); fillStroke(c, '#1b1440', lw * 0.6);
        break;
      case 'fringe': // garniture de taco : salade et tomate
        for (let k = -3; k <= 3; k++) { E(c, k * r * 0.24, top + r * 0.18 + Math.abs(k) * r * 0.06, r * 0.17, r * 0.14); fillStroke(c, k % 2 ? '#ff4d6d' : '#7ed957', lw * 0.6); }
        break;
      case 'fin':
        c.beginPath(); c.moveTo(-r * 0.25, top + r * 0.1); c.quadraticCurveTo(r * 0.05, top - r * 0.55, r * 0.35, top - r * 0.6); c.quadraticCurveTo(r * 0.15, top - r * 0.2, r * 0.3, top + r * 0.12); c.closePath(); fillStroke(c, shade(s.c, -0.15), lw * 0.8);
        break;
      case 'brain': { // circonvolutions sur le haut du crâne
        c.strokeStyle = shade(s.c, -0.35); c.lineWidth = lw * 0.8;
        for (let k = 0; k < 5; k++) { c.beginPath(); c.arc(-r * 0.5 + k * r * 0.25, -r * 0.6 + (k % 2) * r * 0.1, r * 0.16, Math.PI, 0); c.stroke(); }
        c.beginPath(); c.moveTo(0, top + r * 0.08); c.lineTo(0, -r * 0.2); c.stroke();
        break;
      }
      case 'bandana':
        c.save(); bodyPath(c, r, tall); c.clip(); c.fillStyle = '#ff4d6d'; c.fillRect(-r * 1.2, top - r, r * 2.4, r * 1.25);
        c.fillStyle = '#fff'; for (let k = 0; k < 4; k++) { E(c, -r * 0.6 + k * r * 0.4, -r * 0.45, r * 0.05, r * 0.05); c.fill(); }
        c.restore();
        c.strokeStyle = INK; c.lineWidth = lw * 0.8; c.beginPath(); c.moveTo(-r * 0.9, -r * 0.27); c.quadraticCurveTo(0, -r * 0.18, r * 0.9, -r * 0.27); c.stroke();
        c.beginPath(); c.moveTo(r * 0.85, -r * 0.35); c.lineTo(r * 1.15, -r * 0.15); c.lineTo(r * 0.95, -r * 0.05); c.closePath(); fillStroke(c, '#ff4d6d', lw * 0.7);
        break;
      case 'whitehead': // tête blanche d'aigle
        c.save(); bodyPath(c, r, tall); c.clip(); c.fillStyle = '#fbfbff'; c.fillRect(-r * 1.2, top - r, r * 2.4, r * 1.05); c.restore();
        break;
      default: break;
    }
  }

  // yeux : ils regardent dans la direction de visée ; clignent de temps en temps
  function drawEyes(c, s, r, lw, look, t, blinkSeed, mood) {
    const lx = Math.cos(look), ly = Math.sin(look);
    const blink = (Math.sin(t * 0.9 + blinkSeed) > 0.985) || mood === 'hurt';
    const ey = -r * 0.32, ex = r * 0.32;
    const pupil = (x, y, rr) => { E(c, x + lx * rr * 0.6, y + ly * rr * 0.6, rr * 0.55, rr * 0.55); c.fillStyle = INK; c.fill(); E(c, x + lx * rr * 0.6 - rr * 0.2, y + ly * rr * 0.6 - rr * 0.22, rr * 0.16, rr * 0.16); c.fillStyle = '#fff'; c.fill(); };
    const shut = (x, y, rr) => { c.strokeStyle = INK; c.lineWidth = lw; c.beginPath(); c.moveTo(x - rr, y); c.quadraticCurveTo(x, y + rr * 0.6, x + rr, y); c.stroke(); };
    switch (s.eyes) {
      case 'robot':
        [-1, 1].forEach((d) => { c.beginPath(); c.roundRect(d * ex - r * 0.2, ey - r * 0.15, r * 0.4, r * 0.3, r * 0.06); fillStroke(c, '#14102e', lw * 0.8);
          if (!blink) { c.fillStyle = '#3dd6ff'; c.fillRect(d * ex - r * 0.1 + lx * r * 0.06, ey - r * 0.06 + ly * r * 0.04, r * 0.2, r * 0.12); } });
        return;
      case 'visor':
        c.beginPath(); c.roundRect(-r * 0.68, ey - r * 0.15, r * 1.36, r * 0.3, r * 0.15); fillStroke(c, '#14102e', lw * 0.8);
        E(c, lx * r * 0.35, ey, r * 0.22, r * 0.08); c.fillStyle = '#ff4d6d'; c.fill();
        return;
      case 'alien':
        [-1, 1].forEach((d) => { E(c, d * ex * 1.05, ey, r * 0.27, r * 0.17, d * 0.45); c.fillStyle = INK; c.fill(); E(c, d * ex * 1.05 + lx * r * 0.06 - r * 0.06, ey - r * 0.05, r * 0.06, r * 0.04); c.fillStyle = '#fff'; c.fill(); });
        return;
      case 'sockets':
        [-1, 1].forEach((d) => { E(c, d * ex, ey, r * 0.21, r * 0.24); c.fillStyle = INK; c.fill(); E(c, d * ex + lx * r * 0.06, ey + ly * r * 0.06, r * 0.05, r * 0.05); c.fillStyle = '#ff4d6d'; c.fill(); });
        c.fillStyle = INK; c.beginPath(); c.moveTo(0, -r * 0.08); c.lineTo(-r * 0.07, r * 0.04); c.lineTo(r * 0.07, r * 0.04); c.closePath(); c.fill();
        return;
      case 'hollow':
        [-1, 1].forEach((d) => { E(c, d * ex * 0.85 + lx * r * 0.05, ey + ly * r * 0.04, r * 0.11, blink ? r * 0.02 : r * 0.17); c.fillStyle = INK; c.fill(); });
        return;
      case 'jack': // yeux triangulaires lumineux de citrouille
        [-1, 1].forEach((d) => { c.beginPath(); c.moveTo(d * ex - r * 0.16, ey + r * 0.1); c.lineTo(d * ex, ey - r * 0.16); c.lineTo(d * ex + r * 0.16, ey + r * 0.1); c.closePath(); c.fillStyle = INK; c.fill(); c.fillStyle = '#ffd23f'; E(c, d * ex + lx * r * 0.04, ey + r * 0.02, r * 0.05, r * 0.05); c.fill(); });
        return;
      case 'cyclops':
        E(c, 0, -r * 0.18, r * 0.55, r * 0.5); fillStroke(c, '#fff', lw);
        if (blink) { shut(0, -r * 0.18, r * 0.45); return; }
        E(c, lx * r * 0.2, -r * 0.18 + ly * r * 0.16, r * 0.26, r * 0.26); c.fillStyle = '#3dd6ff'; c.fill();
        E(c, lx * r * 0.24, -r * 0.18 + ly * r * 0.2, r * 0.13, r * 0.13); c.fillStyle = INK; c.fill();
        E(c, lx * r * 0.2 - r * 0.08, -r * 0.27 + ly * r * 0.16, r * 0.05, r * 0.05); c.fillStyle = '#fff'; c.fill();
        c.strokeStyle = 'rgba(255,77,109,.6)'; c.lineWidth = lw * 0.4; c.beginPath(); c.moveTo(-r * 0.5, -r * 0.3); c.lineTo(-r * 0.3, -r * 0.22); c.moveTo(r * 0.5, -r * 0.05); c.lineTo(r * 0.32, -r * 0.1); c.stroke();
        return;
      case 'stalks': // yeux au bout de tentacules d'escargot
        [-1, 1].forEach((d) => {
          const tx = d * r * 0.35 + lx * r * 0.08, ty = -r * 1.35 + Math.sin(t * 3 + d) * r * 0.05;
          c.strokeStyle = INK; c.lineWidth = lw * 1.8; c.beginPath(); c.moveTo(d * r * 0.25, -r * 0.7); c.lineTo(tx, ty); c.stroke();
          c.strokeStyle = s.c; c.lineWidth = lw * 0.8; c.stroke();
          E(c, tx, ty, r * 0.16, r * 0.16); fillStroke(c, '#fff', lw * 0.7);
          if (blink) { shut(tx, ty, r * 0.12); } else pupil(tx, ty, r * 0.14);
        });
        return;
      case 'frog': // gros yeux posés sur le dessus de la tête
        [-1, 1].forEach((d) => {
          E(c, d * r * 0.42, -r * 0.88, r * 0.3, r * 0.28); fillStroke(c, s.c, lw);
          E(c, d * r * 0.42, -r * 0.9, r * 0.2, r * 0.19); fillStroke(c, '#fff', lw * 0.6);
          if (blink) shut(d * r * 0.42, -r * 0.9, r * 0.16); else pupil(d * r * 0.42, -r * 0.9, r * 0.17);
        });
        return;
      default: { // yeux ronds classiques (et sourcils froncés pour les méchants)
        const er = r * 0.22;
        [-1, 1].forEach((d) => {
          E(c, d * ex, ey, er, er * 1.08); fillStroke(c, '#fff', lw * 0.8);
          if (blink) shut(d * ex, ey, er * 0.8); else pupil(d * ex, ey, er);
        });
        if (s.eyes === 'angry' || mood === 'angry') {
          c.strokeStyle = INK; c.lineWidth = lw * 1.3; c.lineCap = 'round';
          [-1, 1].forEach((d) => { c.beginPath(); c.moveTo(d * ex * 1.6, ey - er * 1.25); c.lineTo(d * ex * 0.35, ey - er * 0.75); c.stroke(); });
          c.lineCap = 'butt';
        }
        if (s.patch === 'panda') { /* les taches sont sous les yeux (dessinées avant) */ }
      }
    }
  }

  function drawFace(c, s, r, lw, open, look) {
    const lx = Math.cos(look) * r * 0.05;
    switch (s.face) {
      case 'muzzle':
        E(c, lx, r * 0.12, r * 0.42, r * 0.28); c.fillStyle = s.facec || '#fff3e0'; c.fill();
        E(c, lx, r * 0.0, r * 0.1, r * 0.07); c.fillStyle = INK; c.fill(); break;
      case 'snout':
        E(c, lx, r * 0.08, r * 0.22, r * 0.16); fillStroke(c, '#ff9ab5', lw * 0.8);
        [-1, 1].forEach((d) => { E(c, lx + d * r * 0.08, r * 0.08, r * 0.04, r * 0.06); c.fillStyle = INK; c.fill(); }); break;
      case 'plate':
        E(c, lx, r * 0.02, r * 0.55, r * 0.45); c.fillStyle = s.facec; c.fill(); break;
      case 'beak': {
        const o = open ? r * 0.12 : r * 0.02;
        c.beginPath(); c.moveTo(lx - r * 0.25, r * 0.0); c.quadraticCurveTo(lx, -r * 0.08, lx + r * 0.25, r * 0.0); c.quadraticCurveTo(lx, r * 0.14, lx - r * 0.25, r * 0.0); fillStroke(c, '#ff9f1c', lw * 0.8);
        if (open) { c.beginPath(); c.moveTo(lx - r * 0.2, r * 0.05 + o); c.quadraticCurveTo(lx, r * 0.18 + o, lx + r * 0.2, r * 0.05 + o); c.quadraticCurveTo(lx, r * 0.06, lx - r * 0.2, r * 0.05 + o); fillStroke(c, '#e8850f', lw * 0.7); }
        return true;
      }
      case 'hook':
        c.beginPath(); c.moveTo(lx - r * 0.18, -r * 0.05); c.quadraticCurveTo(lx + r * 0.2, -r * 0.15, lx + r * 0.25, r * 0.15); c.quadraticCurveTo(lx + r * 0.05, r * 0.12, lx - r * 0.18, r * 0.08); c.closePath(); fillStroke(c, '#ffd23f', lw * 0.8);
        return true;
      case 'clown':
        E(c, lx, r * 0.02, r * 0.15, r * 0.15); fillStroke(c, '#ff4d6d', lw * 0.8);
        E(c, lx - r * 0.05, -r * 0.03, r * 0.04, r * 0.04); c.fillStyle = '#fff'; c.fill(); break;
      case 'whiskers':
        E(c, lx, r * 0.02, r * 0.08, r * 0.06); c.fillStyle = '#ff9ab5'; c.fill();
        c.strokeStyle = INK; c.lineWidth = lw * 0.5;
        [-1, 1].forEach((d) => { for (let k = -1; k <= 1; k++) { c.beginPath(); c.moveTo(lx + d * r * 0.15, r * 0.06 + k * r * 0.04); c.lineTo(lx + d * r * 0.55, r * 0.02 + k * r * 0.1); c.stroke(); } }); break;
      default: break;
    }
    return false;
  }

  function drawMouth(c, s, r, lw, open, look) {
    const mx = Math.cos(look) * r * 0.06, my = r * 0.28;
    c.strokeStyle = INK; c.lineWidth = lw * 0.9; c.lineCap = 'round';
    const m = open && !['teeth', 'grill', 'jack'].includes(s.mouth) ? 'o' : s.mouth || 'smile';
    switch (m) {
      case 'o': E(c, mx, my, r * 0.09, r * 0.11); c.fillStyle = '#7a1e3a'; c.fill(); c.stroke(); break;
      case 'wide': c.beginPath(); c.moveTo(mx - r * 0.4, my - r * 0.05); c.quadraticCurveTo(mx, my + r * 0.14, mx + r * 0.4, my - r * 0.05); c.stroke(); break;
      case 'line': c.beginPath(); c.moveTo(mx - r * 0.1, my); c.lineTo(mx + r * 0.1, my); c.stroke(); break;
      case 'teeth':
        c.beginPath(); c.moveTo(mx - r * 0.3, my - r * 0.04); c.quadraticCurveTo(mx, my + r * 0.18, mx + r * 0.3, my - r * 0.04); c.closePath(); c.fillStyle = '#fff'; c.fill(); c.stroke();
        c.lineWidth = lw * 0.4; for (let k = -2; k <= 2; k++) { c.beginPath(); c.moveTo(mx + k * r * 0.1, my - r * 0.02); c.lineTo(mx + k * r * 0.1, my + r * 0.07); c.stroke(); }
        break;
      case 'fangs':
        c.beginPath(); c.moveTo(mx - r * 0.22, my); c.quadraticCurveTo(mx, my + r * 0.12, mx + r * 0.22, my); c.stroke();
        [-1, 1].forEach((d) => { c.beginPath(); c.moveTo(mx + d * r * 0.14, my + r * 0.02); c.lineTo(mx + d * r * 0.1, my + r * 0.14); c.lineTo(mx + d * r * 0.06, my + r * 0.04); c.closePath(); c.fillStyle = '#fff'; c.fill(); c.lineWidth = lw * 0.5; c.stroke(); });
        break;
      case 'grin': c.beginPath(); c.moveTo(mx - r * 0.28, my - r * 0.06); c.quadraticCurveTo(mx, my + r * 0.2, mx + r * 0.28, my - r * 0.06); c.stroke(); c.beginPath(); c.moveTo(mx + r * 0.28, my - r * 0.06); c.lineTo(mx + r * 0.33, my - r * 0.12); c.stroke(); break;
      case 'bigsmile':
        c.beginPath(); c.moveTo(mx - r * 0.35, my - r * 0.08); c.quadraticCurveTo(mx, my + r * 0.3, mx + r * 0.35, my - r * 0.08); c.closePath(); c.fillStyle = '#ff4d6d'; c.fill(); c.stroke(); break;
      case 'grill':
        c.beginPath(); c.roundRect(mx - r * 0.2, my - r * 0.05, r * 0.4, r * 0.12, r * 0.03); c.fillStyle = '#14102e'; c.fill(); c.stroke();
        c.lineWidth = lw * 0.4; for (let k = -1; k <= 1; k++) { c.beginPath(); c.moveTo(mx + k * r * 0.1, my - r * 0.04); c.lineTo(mx + k * r * 0.1, my + r * 0.06); c.stroke(); }
        break;
      case 'jack':
        c.beginPath(); c.moveTo(mx - r * 0.35, my - r * 0.06); c.lineTo(mx - r * 0.2, my + r * 0.04); c.lineTo(mx - r * 0.08, my - r * 0.04); c.lineTo(mx + r * 0.05, my + r * 0.06); c.lineTo(mx + r * 0.18, my - r * 0.04); c.lineTo(mx + r * 0.35, my - r * 0.06); c.quadraticCurveTo(mx, my + r * 0.24, mx - r * 0.35, my - r * 0.06);
        c.fillStyle = INK; c.fill(); break;
      default: c.beginPath(); c.moveTo(mx - r * 0.16, my - r * 0.02); c.quadraticCurveTo(mx, my + r * 0.12, mx + r * 0.16, my - r * 0.02); c.stroke();
    }
    c.lineCap = 'butt';
  }

  // motifs posés sur le corps (dans la silhouette)
  function drawPatch(c, s, r, lw, tall) {
    switch (s.patch) {
      case 'panda': [-1, 1].forEach((d) => { E(c, d * r * 0.33, -r * 0.3, r * 0.27, r * 0.22, d * -0.5); c.fillStyle = '#2a2350'; c.fill(); }); break;
      case 'spots': [[-0.45, -0.55, 0.12], [0.5, -0.4, 0.09], [0.35, -0.75, 0.07], [-0.6, -0.15, 0.07]].forEach(([x, y, rr]) => { E(c, x * r, y * r, rr * r, rr * r); c.fillStyle = s.spotc; c.fill(); }); break;
      case 'holes': [[-0.5, -0.55, 0.13], [0.45, -0.7, 0.1], [0.6, -0.15, 0.12], [-0.65, -0.05, 0.08], [0.0, -0.88, 0.07]].forEach(([x, y, rr]) => { E(c, x * r, y * r, rr * r, rr * r * 0.9); c.fillStyle = '#e8b20e'; c.fill(); }); break;
      case 'ridges': c.strokeStyle = shade(s.c, -0.25); c.lineWidth = lw * 0.8; [-0.45, 0, 0.45].forEach((x) => { c.beginPath(); c.moveTo(x * r, -r * tall + r * 0.1); c.quadraticCurveTo(x * r * 1.6, -r * 0.3, x * r, r * 0.2); c.stroke(); }); break;
      case 'pit': E(c, 0, -r * 0.1, r * 0.55, r * 0.6); c.fillStyle = '#f5f0b0'; c.fill(); break;
      case 'bands': c.strokeStyle = shade(s.c, -0.3); c.lineWidth = lw; [-0.7, -0.45].forEach((y) => { c.beginPath(); c.moveTo(-r, y * r); c.quadraticCurveTo(0, (y + 0.1) * r, r, y * r); c.stroke(); }); break;
      case 'bolts': [-1, 1].forEach((d) => { E(c, d * r * 0.72, -r * 0.05, r * 0.07, r * 0.07); c.fillStyle = '#8a90a8'; c.fill(); c.lineWidth = lw * 0.5; c.strokeStyle = INK; c.stroke(); }); break;
      case 'shine': E(c, -r * 0.42, -r * 0.55, r * 0.12, r * 0.28, 0.4); c.fillStyle = 'rgba(255,255,255,.35)'; c.fill(); break;
      default: break;
    }
  }

  function drawFeet(c, s, r, lw, run, air, t, col) {
    const fc = shade(col, -0.25);
    const ph = run ? t * 14 : 0, k = Math.min(1, Math.abs(run) / 120);
    switch (s.feet) {
      case 'ghost': { // bas ondulé, pas de pieds
        c.beginPath(); c.moveTo(-r * 0.8, r * 0.55);
        for (let i = 0; i <= 4; i++) { const x = -r * 0.8 + i * r * 0.4; c.quadraticCurveTo(x - r * 0.2, r * (0.95 + Math.sin(t * 6 + i) * 0.08), x, r * 0.75); }
        c.lineTo(r * 0.8, r * 0.55); c.closePath(); fillStroke(c, s.c, lw);
        return;
      }
      case 'tentacles':
        for (let i = 0; i < 4; i++) {
          const x0 = -r * 0.5 + i * r * 0.33, sw = Math.sin(t * 7 + i * 1.3 + ph) * r * 0.12;
          c.strokeStyle = INK; c.lineWidth = r * 0.24; c.lineCap = 'round'; c.beginPath(); c.moveTo(x0, r * 0.55); c.quadraticCurveTo(x0 + sw, r * 0.85, x0 - sw, r * (air ? 0.95 : 1.02)); c.stroke();
          c.strokeStyle = s.c; c.lineWidth = r * 0.14; c.stroke(); c.lineCap = 'butt';
        }
        return;
      case 'slug':
        c.beginPath(); c.roundRect(-r * 0.95, r * 0.62, r * 1.9, r * 0.32, r * 0.16); fillStroke(c, shade(s.c, -0.1), lw); return;
      default: {
        const web = s.feet === 'webbed';
        [-1, 1].forEach((d) => {
          const step = air ? -0.12 : Math.sin(ph + (d > 0 ? Math.PI : 0)) * 0.12 * k;
          const fx = d * r * 0.36 + (air ? d * r * 0.08 : Math.cos(ph + (d > 0 ? Math.PI : 0)) * r * 0.12 * k), fy = r * (0.86 + Math.min(0, step));
          E(c, fx, fy, r * 0.24, r * 0.15); fillStroke(c, web ? '#ff9f1c' : fc, lw * 0.85);
        });
      }
    }
  }

  // cadres cosmétiques : une aura autour du personnage
  function frameAura(c, frame, r, color, t, tall) {
    const lw = Math.max(2, r * 0.14);
    const ring = (col, blur, extra = 1.0) => { c.save(); c.lineWidth = lw; c.strokeStyle = col; if (blur) { c.shadowColor = col; c.shadowBlur = blur; } c.globalAlpha *= 0.9; E(c, 0, -r * 0.1, r * 1.12 * extra, r * (1.05 + tall * 0.1) * extra); c.stroke(); c.restore(); };
    switch (frame) {
      case 'neon': ring('#fff', r * 0.9); break;
      case 'gold': ring('#ffd700', r * 0.5); break;
      case 'diamond': ring('#b9f2ff', r * 0.6); break;
      case 'void': ring('#b388ff', r * 0.8); break;
      case 'blood': ring('#a3001b', 0); break;
      case 'fire': { const k = 0.5 + 0.5 * Math.sin(t * 9); ring(k > 0.5 ? '#ff4d6d' : '#ff9f1c', r * (0.6 + k * 0.6)); break; }
      case 'rainbow': ring(`hsl(${(t * 120) % 360},90%,62%)`, r * 0.4); break;
      case 'stripes': c.save(); c.setLineDash([r * 0.3, r * 0.22]); c.lineDashOffset = -t * r; ring('#fff', 0); c.restore(); break;
      case 'glitch': { const j = Math.sin(t * 23) > 0.6 ? r * 0.08 : 0; c.save(); c.translate(j, 0); ring('#ff004c', 0); c.translate(-2 * j, 0); ring('#00e5ff', 0); c.restore(); break; }
      default: break;
    }
  }

  /**
   * Dessine un personnage.
   * o = { x, y, r, color (joueur), avatar, frame, me, dead, vx, vy, t, name, label, shadow, bob, flip,
   *       look (angle des yeux, en radians), air (en l'air), run (vitesse horizontale px/s), mood }
   */
  function draw(c, o) {
    const { x, y, r } = o;
    const t = o.t != null ? o.t : performance.now() / 1000;
    const col = o.color || '#ffd23f';
    const s = spec(o.avatar);
    const tall = s.tall || 1;
    const lw = Math.max(1.6, r * 0.12);
    const look = o.look != null ? o.look : (o.vx || 0) < -0.2 ? Math.PI : (o.flip ? Math.PI : 0);
    c.save();
    if (o.alpha != null) c.globalAlpha *= o.alpha;

    // ombre portée
    if (o.shadow !== false) { c.fillStyle = 'rgba(27,20,64,.28)'; E(c, x, y + r * 1.02, r * 0.8, r * 0.2); c.fill(); }

    if (o.dead) {
      // éliminé : le personnage devient un fantôme pâle, yeux en croix, qui flotte
      const fy = y - Math.sin(t * 3) * r * 0.15;
      c.translate(x, fy);
      c.globalAlpha *= 0.7;
      bodyPath(c, r, tall); fillStroke(c, '#eef0ff', lw);
      c.strokeStyle = INK; c.lineWidth = lw;
      [-1, 1].forEach((d) => { const ex = d * r * 0.32, ey = -r * 0.32, k = r * 0.12; c.beginPath(); c.moveTo(ex - k, ey - k); c.lineTo(ex + k, ey + k); c.moveTo(ex + k, ey - k); c.lineTo(ex - k, ey + k); c.stroke(); });
      E(c, 0, r * 0.3, r * 0.1, r * 0.12); c.stroke();
      c.restore();
      if (o.name) nameTag(c, o.name, x, y - r * 1.7, col, r, false, o.label);
      return;
    }

    // vie : respiration à l'arrêt, étirement dans le sens du mouvement, petit penché en course
    const sp = Math.hypot(o.vx || 0, o.vy || 0);
    const stretch = Math.min(0.2, sp * 0.032);
    const breathe = sp < 0.2 ? Math.sin(t * 3.2 + (o.bob || 0)) * 0.03 : 0;
    const ang = sp > 0.2 ? Math.atan2(o.vy, o.vx) : 0;
    const run = o.run != null ? o.run : (o.vx || 0) * 30;
    c.translate(x, y);
    c.rotate(Math.max(-0.18, Math.min(0.18, run / 1500))); // penché vers l'avant en courant
    c.rotate(ang); c.scale(1 + stretch - breathe * 0.5, 1 - stretch * 0.6 + breathe); c.rotate(-ang);

    // halo « c'est toi »
    if (o.me) {
      const p = 0.5 + 0.5 * Math.sin(t * 4);
      c.strokeStyle = `rgba(255,255,255,${0.3 + p * 0.4})`; c.lineWidth = Math.max(2, r * 0.16);
      E(c, 0, -r * 0.1, r * (1.3 + p * 0.08), r * (1.3 + p * 0.08)); c.stroke();
    }
    frameAura(c, o.frame, r, col, t, tall);

    drawFeet(c, s, r, lw, s.feet === 'ghost' || s.feet === 'tentacles' || s.feet === 'slug' ? run : (o.air ? 0 : run), !!o.air, t, s.c);
    drawBack(c, s, r, lw, t, run);

    // le corps : couleur de l'espèce en haut, t-shirt à la couleur du joueur en bas
    bodyPath(c, r, tall);
    const g = c.createLinearGradient(-r, -r, r, r);
    g.addColorStop(0, shade(s.c, 0.18)); g.addColorStop(1, shade(s.c, -0.12));
    c.fillStyle = g; c.fill();
    c.save(); bodyPath(c, r, tall); c.clip();
    if (s.belly) { E(c, 0, r * 0.15, r * 0.55, r * 0.6); c.fillStyle = s.belly; c.fill(); }
    if (s.rim) { c.strokeStyle = s.rim; c.lineWidth = r * 0.22; bodyPath(c, r * 0.97, tall); c.stroke(); }
    drawPatch(c, s, r, lw, tall);
    // t-shirt
    const sh = c.createLinearGradient(0, r * 0.2, 0, r);
    sh.addColorStop(0, shade(col, 0.15)); sh.addColorStop(1, shade(col, -0.2));
    c.fillStyle = sh;
    c.beginPath(); c.moveTo(-r * 1.3, r * 0.38); c.quadraticCurveTo(0, r * 0.52, r * 1.3, r * 0.38); c.lineTo(r * 1.3, r * 1.3); c.lineTo(-r * 1.3, r * 1.3); c.closePath(); c.fill();
    c.strokeStyle = INK; c.lineWidth = lw * 0.8; c.beginPath(); c.moveTo(-r * 1.3, r * 0.38); c.quadraticCurveTo(0, r * 0.52, r * 1.3, r * 0.38); c.stroke();
    // reflet en haut à gauche
    E(c, -r * 0.42, -r * 0.6 * tall, r * 0.18, r * 0.1, -0.6); c.fillStyle = 'rgba(255,255,255,.45)'; c.fill();
    c.restore();
    bodyPath(c, r, tall); c.lineWidth = lw; c.strokeStyle = INK; c.stroke();

    // visage
    const open = !!o.air && (o.vy || 0) < -1;
    if (o.flip) c.scale(-1, 1); // regarde à gauche : on retourne la tête (les yeux suivent quand même la visée)
    const lk = o.flip ? Math.PI - look : look;
    drawTop(c, s, r, lw, t, tall);
    const hasBeak = s.face === 'beak' || s.face === 'hook';
    drawEyes(c, s, r, lw, lk, t, (o.bob || 0) * 3.1, o.mood);
    const beak = drawFace(c, s, r, lw, open, lk);
    if (!hasBeak && !beak) drawMouth(c, s, r, lw, open, lk);
    if (s.patch === 'blush') [-1, 1].forEach((d) => { E(c, d * r * 0.55, -r * 0.02, r * 0.12, r * 0.07); c.fillStyle = 'rgba(255,95,162,.45)'; c.fill(); });
    c.restore();

    if (o.name) nameTag(c, o.name, x, y - r * (1.55 + (s.top || s.horn || s.eyes === 'stalks' || s.ears ? 0.35 : 0)), col, r, o.me, o.label);
  }

  // étiquette de nom : pastille à la couleur du joueur, petite flèche, « TOI » en blanc
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

  // ── portraits pour les menus (image en cache par avatar + couleur + taille) ──
  const portraits = new Map();
  function portrait(avatar, color = '#ffd23f', px = 64) {
    const key = `${avatar}|${color}|${px}`;
    if (portraits.has(key)) return portraits.get(key);
    const dpr = Math.min(devicePixelRatio || 1, 2), cv = document.createElement('canvas');
    cv.width = cv.height = Math.round(px * dpr);
    const c = cv.getContext('2d'); c.scale(dpr, dpr);
    const r = px * 0.3;
    draw(c, { x: px / 2, y: px * 0.58, r, color, avatar, shadow: false, t: 0.4, look: 0.35, bob: 0 });
    const url = cv.toDataURL();
    if (portraits.size > 400) portraits.clear();
    portraits.set(key, url);
    return url;
  }

  return { draw, emoji, nameTag, shade, portrait, spec, EMOJI, SPECIES: Object.keys(SP) };
})();
