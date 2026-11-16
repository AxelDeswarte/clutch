// CLUTCH — catalogue partagé client/serveur : niveaux, avatars, cadres, titres
(function (root) {
  'use strict';
  // XP cumulée pour atteindre le niveau L : 0, 100, 300, 600, 1000, 1500…
  const xpForLevel = (L) => 50 * L * (L - 1);
  const levelFromXp = (xp) => { let L = 1; while (xp >= xpForLevel(L + 1)) L++; return L; };

  const BASE_AVATARS = ['🦊', '🐸', '🐼', '🐙', '🦄', '🐷', '🐵', '🦖', '👽', '🤖', '🤡', '👻', '🍆', '🍑', '🌮', '🧀', '🦆', '🐔', '🦍', '🐌', '🍄', '🎃', '🥑', '🐀'];
  const LOCKED_AVATARS = [
    ['🐉', 2], ['🦂', 3], ['🦁', 4], ['🧛', 5], ['🦈', 6], ['💀', 7], ['🐺', 8], ['👹', 10],
    ['🦅', 12], ['👑', 14], ['😈', 16], ['🔥', 18], ['☠️', 20], ['🧠', 22], ['👁️', 25], ['🦾', 30],
  ];
  const FRAMES = [
    { id: 'classic', name: 'Classique', lvl: 1 },
    { id: 'neon', name: 'Néon', lvl: 3 },
    { id: 'stripes', name: 'Rayures', lvl: 5 },
    { id: 'blood', name: 'Sanglant', lvl: 7 },
    { id: 'gold', name: 'Or', lvl: 9 },
    { id: 'fire', name: 'En feu', lvl: 12 },
    { id: 'rainbow', name: 'Arc-en-ciel', lvl: 15 },
    { id: 'glitch', name: 'Glitch', lvl: 19 },
    { id: 'diamond', name: 'Diamant', lvl: 24 },
    { id: 'void', name: 'Néant', lvl: 30 },
  ];
  const TITLES = [
    { id: '', name: '(aucun)', lvl: 1 },
    { id: 'bleu', name: 'Le Bleu', lvl: 1 },
    { id: 'chair', name: 'Chair à canon', lvl: 2 },
    { id: 'survivant', name: 'Survivant', lvl: 4 },
    { id: 'rageux', name: 'Rageux certifié', lvl: 6 },
    { id: 'psycho', name: 'Psychopathe du clavier', lvl: 8 },
    { id: 'boucher', name: 'Le Boucher', lvl: 10 },
    { id: 'patron', name: 'Le Patron', lvl: 13 },
    { id: 'mainfroide', name: 'Main froide', lvl: 16 },
    { id: 'legende', name: 'Légende vivante', lvl: 20 },
    { id: 'dieu', name: 'Dieu du Clutch', lvl: 25 },
    { id: 'fin', name: 'Fin de game', lvl: 30 },
  ];

  const avatarLevel = (a) => {
    if (BASE_AVATARS.includes(a)) return 1;
    const f = LOCKED_AVATARS.find((x) => x[0] === a);
    return f ? f[1] : null;
  };
  const frameLevel = (id) => { const f = FRAMES.find((x) => x.id === id); return f ? f.lvl : null; };
  const titleLevel = (id) => { const f = TITLES.find((x) => x.id === id); return f ? f.lvl : null; };
  const titleName = (id) => { const f = TITLES.find((x) => x.id === id); return f && f.id ? f.name : ''; };

  // tout ce qui se débloque en passant du niveau a au niveau b (exclu a, inclus b)
  function unlocksBetween(a, b) {
    const out = [];
    LOCKED_AVATARS.forEach(([e, l]) => { if (l > a && l <= b) out.push('avatar ' + e); });
    FRAMES.forEach((f) => { if (f.lvl > a && f.lvl <= b) out.push('cadre « ' + f.name + ' »'); });
    TITLES.forEach((t) => { if (t.id && t.lvl > a && t.lvl <= b) out.push('titre « ' + t.name + ' »'); });
    return out;
  }

  const C = { xpForLevel, levelFromXp, BASE_AVATARS, LOCKED_AVATARS, FRAMES, TITLES, avatarLevel, frameLevel, titleLevel, titleName, unlocksBetween };
  if (typeof module !== 'undefined' && module.exports) module.exports = C;
  else root.COSMETICS = C;
})(typeof window !== 'undefined' ? window : globalThis);
