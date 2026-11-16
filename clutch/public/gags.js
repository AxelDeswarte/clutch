// CLUTCH — sons synthétisés (WebAudio) + animations d'élimination débiles
'use strict';

// ════════════════════════ SONS ════════════════════════
const SFX = (() => {
  let ctx = null, muted = false, hushed = false;
  try { muted = localStorage.getItem('clutch-mute') === '1'; } catch {}
  function ac() {
    if (!ctx) { const C = window.AudioContext || window.webkitAudioContext; if (!C) return null; ctx = new C(); }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }
  function env(g, t, a, d, peak) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
  }
  function osc(type, f0, f1, dur, peak = 0.3, delay = 0) {
    const c = ac(); if (!c || muted) return;
    const t = c.currentTime + delay;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(f0, t);
    if (f1) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    env(g, t, 0.01, dur, peak);
    o.connect(g).connect(c.destination); o.start(t); o.stop(t + dur + 0.05);
  }
  function noise(dur, type, f0, f1, peak = 0.4, delay = 0, q = 1) {
    const c = ac(); if (!c || muted) return;
    const t = c.currentTime + delay;
    const len = Math.floor(c.sampleRate * dur);
    const buf = c.createBuffer(1, len, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const s = c.createBufferSource(); s.buffer = buf;
    const f = c.createBiquadFilter(); f.type = type; f.Q.value = q; f.frequency.setValueAtTime(f0, t);
    if (f1) f.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = c.createGain(); env(g, t, 0.01, dur, peak);
    s.connect(f).connect(g).connect(c.destination); s.start(t);
  }
  function fart(len = 0.9) {
    const c = ac(); if (!c || muted) return;
    const t = c.currentTime;
    const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.setValueAtTime(95, t);
    o.frequency.linearRampToValueAtTime(65, t + len);
    const lfo = c.createOscillator(); lfo.frequency.value = 22 + Math.random() * 8;
    const lg = c.createGain(); lg.gain.value = 40; lfo.connect(lg).connect(o.frequency);
    const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 520;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.55, t + 0.05);
    g.gain.setValueAtTime(0.5, t + len * 0.6); g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    o.connect(f).connect(g).connect(c.destination);
    o.start(t); lfo.start(t); o.stop(t + len + 0.05); lfo.stop(t + len + 0.05);
    noise(len, 'lowpass', 400, 150, 0.12);
  }
  const S = {
    boom() { noise(0.9, 'lowpass', 1500, 60, 0.8); osc('sine', 120, 30, 0.8, 0.6); },
    fart() { fart(0.9); },
    flush() { noise(1.7, 'bandpass', 2600, 250, 0.55, 0, 0.8); osc('sine', 420, 80, 1.5, 0.08); },
    splat() { noise(0.25, 'lowpass', 2200, 200, 0.7); osc('square', 160, 40, 0.2, 0.2); },
    boing() { osc('sine', 150, 620, 0.15, 0.4); osc('sine', 620, 120, 0.5, 0.35, 0.15); },
    whoosh() { noise(0.6, 'bandpass', 300, 3500, 0.5, 0, 2); },
    bonk() { osc('square', 220, 90, 0.12, 0.4); noise(0.08, 'highpass', 3000, null, 0.5); },
    chomp() { [0, 0.18, 0.36].forEach((d) => { osc('square', 140, 70, 0.1, 0.35, d); noise(0.08, 'lowpass', 900, null, 0.3, d); }); },
    beam() { osc('sine', 300, 1400, 1.2, 0.22); osc('triangle', 310, 1420, 1.2, 0.12); },
    rocket() { noise(1.5, 'lowpass', 300, 3000, 0.5); osc('sawtooth', 80, 600, 1.4, 0.12); },
    slip() { osc('sine', 900, 200, 0.5, 0.35); noise(0.25, 'lowpass', 800, null, 0.6, 0.6); },
    moo() { osc('sawtooth', 150, 95, 1.1, 0.18); osc('sine', 150, 95, 1.1, 0.25); },
    quack() { [0, 0.2, 0.4].forEach((d) => osc('square', 520, 360, 0.12, 0.22, d)); },
    ding() { osc('sine', 1320, null, 0.9, 0.3); osc('sine', 1980, null, 0.6, 0.1); },
    smooch() { [0, 0.15, 0.3, 0.45].forEach((d) => osc('sine', 700, 1700, 0.08, 0.35, d)); },
    gun() { noise(0.12, 'highpass', 900, null, 0.9); noise(0.5, 'lowpass', 1800, 120, 0.5, 0.03); osc('square', 90, 40, 0.25, 0.3); },
    saw() { osc('sawtooth', 900, 1300, 0.9, 0.12); noise(0.9, 'bandpass', 3000, 2000, 0.35, 0, 3); },
    train() { [0, 0.28].forEach((d) => osc('sawtooth', 330, 320, 0.5, 0.15, d)); noise(1.2, 'lowpass', 600, 2000, 0.5); },
    zap() { [0, 0.07, 0.14, 0.21].forEach((d) => osc('square', 1200, 200, 0.06, 0.25, d)); },
    gas() { noise(1.2, 'highpass', 4000, 1500, 0.3); },
    cough() { [0, 0.22, 0.44].forEach((d) => { noise(0.14, 'bandpass', 900, 500, 0.6, d, 2); osc('sawtooth', 160, 110, 0.12, 0.15, d); }); },
    ping() { osc('sine', 1400, 1500, 0.25, 0.12); },
    inhale() { noise(0.4, 'bandpass', 600, 1400, 0.12, 0, 2); },
    tick() { osc('sine', 880, null, 0.08, 0.15); },
    go() { osc('square', 660, null, 0.15, 0.18); osc('square', 990, null, 0.25, 0.18, 0.12); },
    win() { [523, 659, 784, 1047].forEach((f, i) => osc('triangle', f, null, 0.25, 0.25, i * 0.11)); },
    lose() { [392, 330, 262].forEach((f, i) => osc('triangle', f, null, 0.3, 0.25, i * 0.18)); },
    bad() { osc('square', 140, 90, 0.25, 0.22); },
    ok() { osc('sine', 880, 1320, 0.08, 0.14); },
  };
  return {
    play(n) { if (hushed) return; try { (S[n] || S.boom)(); } catch {} },
    hush(v) { hushed = !!v; },
    unlock() { ac(); },
    get muted() { return muted; },
    toggle() { muted = !muted; try { localStorage.setItem('clutch-mute', muted ? '1' : '0'); } catch {} return muted; },
  };
})();

// ════════════════════════ GAGS ════════════════════════
// e = emoji, s = son, a = chorégraphie, t = texte ({n} = victime, {o} = un autre joueur au hasard)
const GAGS = [
  { e: '🚆', s: 'train', a: 'launch', t: "{n} s'est fait percuter par un TER. Pour une fois qu'il était à l'heure." },
  { e: '🪚', s: 'saw', a: 'explode', t: '{n} a été découpé·e en 8 parts égales. {o} a pris la plus grosse.' },
  { e: '🛸', s: 'beam', a: 'beam', t: "{n} a été enlevé·e par des aliens. Sondage anal prévu à 14h, sans anesthésie." },
  { e: '🔫', s: 'gun', a: 'slip', t: "{n} s'est fait exécuter. Rien de personnel, juste du business." },
  { e: '🫀', s: 'chomp', a: 'eat', t: '{o} a revendu les organes de {n} sur Leboncoin. Rein gauche : 40 €, à débattre.' },
  { e: '💍', s: 'ding', a: 'squash', t: "{o} a demandé {n} en mariage. {n} a préféré la mort." },
  { e: '🪦', s: 'bonk', a: 'squash', t: "Ici gît {n}. Personne n'est venu à l'enterrement. Même pas sa mère." },
  { e: '🧠', s: 'splat', a: 'explode', t: 'Le cerveau de {n} a été donné à la science. La science l\'a rendu.' },
  { e: '🐊', s: 'chomp', a: 'eat', t: '{n} a voulu caresser le crocodile. Le crocodile a voulu manger {n}. Le crocodile a gagné.' },
  { e: '🎹', s: 'bonk', a: 'squash', t: 'Un piano est tombé sur {n}. Il jouait du Jul, ce qui est pire.' },
  { e: '⛓️', s: 'whoosh', a: 'wrap', t: "{n} a été retrouvé·e ligoté·e dans un donjon. Le safeword était « clutch ». Personne ne l'a entendu." },
  { e: '💉', s: 'gas', a: 'cloud', t: "{o} a injecté un truc pas clair à {n}. Effets secondaires : la mort, et une légère somnolence." },
  { e: '🐐', s: 'boom', a: 'beam', t: "{n} a été sacrifié·e à une chèvre satanique. La chèvre n'a même pas dit merci." },
  { e: '🔌', s: 'zap', a: 'explode', t: '{n} a vérifié si la prise était branchée. Avec la langue.' },
  { e: '🍖', s: 'boom', a: 'rocket', t: '{n} a fini en merguez au barbecue de {o}. Bien cuit·e, comme d\'hab.' },
  { e: '🛒', s: 'train', a: 'launch', t: '{n} a été fauché·e par un caddie de Leclerc lancé à 90 km/h. Le caddie roulait encore droit, lui.' },
  { e: '🧟', s: 'chomp', a: 'eat', t: "Un zombie a mangé le cerveau de {n}. Le zombie est mort de faim deux heures plus tard." },
  { e: '📱', s: 'ding', a: 'slip', t: "{n} a liké par erreur une photo de 2014 de son ex. Son cœur a lâché à 3h12." },
  { e: '🦄', s: 'boing', a: 'launch', t: "{n} s'est fait encorner par une licorne en chaleur. Elle voulait juste faire connaissance." },
  { e: '🍆', s: 'rocket', a: 'rocket', t: '{n} a été envoyé·e en orbite par une aubergine très suspecte. Personne ne veut savoir.' },
  { e: '⚖️', s: 'gun', a: 'squash', t: '{n} a été condamné·e à perpétuité pour nullité aggravée. Le juge a applaudi.' },
  { e: '🦈', s: 'chomp', a: 'eat', t: '{n} a été dévoré·e par un requin. Le requin a demandé du ketchup.' },
  { e: '🚿', s: 'slip', a: 'slip', t: "{n} a glissé dans la douche. Retrouvé·e trois jours plus tard grâce à l'odeur." },
  { e: '🧨', s: 'boom', a: 'explode', t: '{n} a confondu sa vapoteuse avec un bâton de dynamite. Dernière taffe mémorable.' },
  { e: '🐍', s: 'chomp', a: 'eat', t: "{n} a été avalé·e tout rond par l'anaconda de {o}. On ne juge pas." },
  { e: '🪤', s: 'bonk', a: 'squash', t: "{n} est tombé·e dans le piège à loup de {o}. {o} nie tout en bloc." },
  { e: '🎰', s: 'ding', a: 'cloud', t: "{n} a misé son appart, sa voiture et sa grand-mère sur le rouge. C'était noir." },
  { e: '🌀', s: 'flush', a: 'suck', t: "{n} a été aspiré·e dans un trou noir. Même le trou noir l'a recraché·e à moitié." },
];

const $el = (tag, cls, css) => { const e = document.createElement(tag); if (cls) e.className = cls; if (css) Object.assign(e.style, css); return e; };
function em(stage, e, css) { const s = $el('span', 'gemo', css); s.textContent = e; stage.appendChild(s); return s; }
function flash(stage, delay = 0) {
  const f = $el('div', 'gflash'); stage.appendChild(f);
  f.animate([{ opacity: 0 }, { opacity: 0.9 }, { opacity: 0 }], { duration: 350, delay, fill: 'both' });
}
function shakeEl(el, delay = 0) {
  el.animate([{ transform: 'none' }, { transform: 'translate(-8px,4px)' }, { transform: 'translate(8px,-4px)' },
    { transform: 'translate(-5px,-3px)' }, { transform: 'none' }], { duration: 300, delay });
}

const CHOREO = {
  suck(st, nm, e) {
    const t = em(st, e, { left: '50%', bottom: '-6px', fontSize: '96px', marginLeft: '-48px' });
    t.animate([{ transform: 'scale(.5)' }, { transform: 'scale(1.15)' }, { transform: 'scale(1)' }], { duration: 500 });
    nm.animate([{ transform: 'none' }, { transform: 'translateY(10px) rotate(180deg) scale(.9)', offset: 0.3 },
      { transform: 'translateY(95px) rotate(1440deg) scale(0)' }], { duration: 1800, delay: 300, easing: 'ease-in', fill: 'forwards' });
    t.animate([{ transform: 'rotate(0)' }, { transform: 'rotate(-10deg)' }, { transform: 'rotate(10deg)' }, { transform: 'rotate(0)' }],
      { duration: 180, iterations: 5, delay: 2000 });
  },
  rain(st, nm, e) {
    for (let k = 0; k < 24; k++) {
      const d = em(st, e, { left: 8 + Math.random() * 84 + '%', top: '-60px', fontSize: 24 + Math.random() * 26 + 'px' });
      d.animate([{ transform: 'translateY(0) rotate(0)' }, { transform: `translateY(${150 + Math.random() * 70}px) rotate(${Math.random() * 400 - 200}deg)` }],
        { duration: 650 + Math.random() * 500, delay: k * 55, easing: 'cubic-bezier(.5,0,1,1)', fill: 'forwards' });
    }
    nm.animate([{ filter: 'none' }, { filter: 'sepia(1) saturate(5) hue-rotate(-25deg) brightness(.6)', offset: 0.5 },
      { filter: 'sepia(1) saturate(5) hue-rotate(-25deg) brightness(.45)', transform: 'scaleY(.75) translateY(12px)' }],
    { duration: 1900, delay: 400, fill: 'forwards' });
  },
  explode(st, nm, e) {
    nm.animate([{ transform: 'none' }, { transform: 'scale(1.1) translateX(-5px)' }, { transform: 'scale(1.25) translateX(5px)' },
      { transform: 'scale(1.45) translateX(-5px)', opacity: 1 }, { transform: 'scale(2.4)', opacity: 0 }], { duration: 950, fill: 'forwards' });
    flash(st, 880);
    for (let k = 0; k < 28; k++) {
      const a = Math.random() * Math.PI * 2, dist = 140 + Math.random() * 220;
      const dx = Math.cos(a) * dist, dy = Math.sin(a) * dist * 0.7, rot = Math.random() * 1080 - 540;
      const p = em(st, e, { left: '50%', top: '50%', fontSize: 22 + Math.random() * 26 + 'px' });
      p.animate([{ transform: 'translate(-50%,-50%) scale(.2)', opacity: 0 },
        { transform: 'translate(-50%,-50%) scale(1)', opacity: 1, offset: 0.08 },
        { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) rotate(${rot}deg)`, opacity: 1, offset: 0.8 },
        { transform: `translate(calc(-50% + ${dx * 1.1}px), calc(-50% + ${dy * 1.1 + 40}px)) rotate(${rot}deg)`, opacity: 0 }],
      { duration: 1700, delay: 900, easing: 'cubic-bezier(.1,.8,.3,1)', fill: 'both' });
    }
    shakeEl(st.parentElement, 900);
  },
  beam(st, nm, e) {
    const u = em(st, e, { left: '50%', top: '-6px', fontSize: '84px', marginLeft: '-42px' });
    u.animate([{ transform: 'translateX(-420px)' }, { transform: 'none' }], { duration: 650, easing: 'ease-out', fill: 'both' });
    const b = $el('div', 'gbeam'); st.appendChild(b);
    b.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 300, delay: 650, fill: 'both' });
    nm.animate([{ transform: 'none' }, { transform: 'translateY(-12px) rotate(-12deg)', offset: 0.3 },
      { transform: 'translateY(-45px) rotate(18deg)', offset: 0.6 }, { transform: 'translateY(-120px) scale(.15) rotate(-40deg)', opacity: 0.1 }],
    { duration: 1500, delay: 750, fill: 'forwards' });
    b.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 300, delay: 2250, fill: 'forwards' });
    u.animate([{ transform: 'none' }, { transform: 'translate(520px,-80px) rotate(20deg)' }], { duration: 500, delay: 2450, easing: 'ease-in', fill: 'forwards' });
  },
  cloud(st, nm, e) {
    const c = em(st, e, { left: '8%', top: '38%', fontSize: '60px' });
    c.animate([{ transform: 'scale(.3)', opacity: 1 }, { transform: 'scale(9) translateX(22px)', opacity: 0.7 }], { duration: 1500, easing: 'ease-out', fill: 'forwards' });
    const tint = $el('div', 'gtint'); st.appendChild(tint);
    tint.animate([{ opacity: 0 }, { opacity: 0.55 }], { duration: 1200, delay: 300, fill: 'forwards' });
    nm.animate([{ transform: 'none', filter: 'none' }, { transform: 'rotate(-6deg)', filter: 'hue-rotate(90deg) saturate(3)', offset: 0.3 },
      { transform: 'rotate(7deg) translateY(-5px)', offset: 0.5 },
      { transform: 'rotate(90deg) translate(36px,-12px)', filter: 'hue-rotate(90deg) saturate(3) brightness(.7)' }],
    { duration: 2000, delay: 500, easing: 'ease-in', fill: 'forwards' });
  },
  launch(st, nm, e) {
    const w = st.clientWidth || 600;
    const h = em(st, e, { left: '0', top: '34%', fontSize: '84px' });
    h.animate([{ transform: 'translateX(-120px)' }, { transform: `translateX(${w / 2 - 150}px)`, offset: 0.7 },
      { transform: `translateX(${w / 2 - 175}px) rotate(-10deg)` }], { duration: 600, easing: 'ease-in', fill: 'forwards' });
    nm.animate([{ transform: 'none' }, { transform: `translate(${w * 0.7}px,-280px) rotate(1000deg) scale(.25)` }],
      { duration: 1100, delay: 450, easing: 'cubic-bezier(.2,.7,.4,1)', fill: 'forwards' });
    for (let k = 0; k < 7; k++) {
      const s = em(st, '⭐', { left: '50%', top: '45%', fontSize: '22px' });
      const a = Math.random() * 6.28;
      s.animate([{ transform: 'scale(0)', opacity: 1 }, { transform: `translate(${Math.cos(a) * 90}px,${Math.sin(a) * 60}px) scale(1.2)`, opacity: 0 }],
        { duration: 700, delay: 450, fill: 'both' });
    }
    setTimeout(() => SFX.play('whoosh'), 500);
    shakeEl(st.parentElement, 450);
  },
  eat(st, nm, e) {
    const k = em(st, e, { left: '50%', top: '50%', fontSize: '42px' });
    k.animate([{ transform: 'translate(-50%,-50%) translateX(-300px) scale(.6)' }, { transform: 'translate(-50%,-50%) translateX(-60px) scale(2)', offset: 0.6 },
      { transform: 'translate(-50%,-50%) scale(3.4)' }], { duration: 900, easing: 'ease-in', fill: 'forwards' });
    k.animate([{ transform: 'translate(-50%,-50%) scale(3.4)' }, { transform: 'translate(-50%,-50%) scale(3,3.9)' }, { transform: 'translate(-50%,-50%) scale(3.4)' }],
      { duration: 180, iterations: 5, delay: 900 });
    nm.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 120, delay: 830, fill: 'forwards' });
    const burp = $el('div', 'gburp'); burp.textContent = '*BUUURP*'; st.appendChild(burp);
    burp.animate([{ opacity: 0, transform: 'scale(.4)' }, { opacity: 1, transform: 'scale(1.1) rotate(-6deg)' }], { duration: 300, delay: 1900, fill: 'both' });
  },
  rocket(st, nm, e) {
    const r = em(st, e, { left: '50%', top: '56%', fontSize: '74px', marginLeft: '-37px' });
    r.animate([{ transform: 'rotate(-45deg) translateX(-3px)' }, { transform: 'rotate(-45deg) translateX(3px)' }], { duration: 60, iterations: 11, direction: 'alternate' });
    r.animate([{ transform: 'rotate(-45deg)' }, { transform: 'translateY(-420px) rotate(-45deg)' }], { duration: 1000, delay: 700, easing: 'ease-in', fill: 'forwards' });
    nm.animate([{ transform: 'none' }, { transform: 'translateY(-420px) rotate(25deg)' }], { duration: 1000, delay: 700, easing: 'ease-in', fill: 'forwards' });
    for (let k = 0; k < 14; k++) {
      const f = em(st, '🔥', { left: 46 + Math.random() * 8 + '%', top: '75%', fontSize: 18 + Math.random() * 16 + 'px' });
      f.animate([{ opacity: 0, transform: 'translateY(0) scale(.5)' }, { opacity: 1, transform: `translateY(${-40 - k * 22}px) scale(1.2)`, offset: 0.4 },
        { opacity: 0, transform: `translateY(${-60 - k * 25}px) scale(.3)` }], { duration: 900, delay: 650 + k * 40, fill: 'both' });
    }
  },
  slip(st, nm, e) {
    const b = em(st, e, { left: '50%', top: '64%', fontSize: '44px', marginLeft: '-22px' });
    b.animate([{ transform: 'none' }, { transform: 'translateX(260px) rotate(720deg)' }], { duration: 800, delay: 450, easing: 'ease-out', fill: 'forwards' });
    nm.animate([{ transform: 'none' }, { transform: 'translateX(12px) rotate(-22deg)', offset: 0.25 },
      { transform: 'translate(-20px,-70px) rotate(-200deg)', offset: 0.55 }, { transform: 'translate(-30px,45px) rotate(-270deg)', offset: 0.82 },
      { transform: 'translate(-30px,35px) rotate(-265deg)' }], { duration: 1500, delay: 300, fill: 'forwards', easing: 'ease-in-out' });
    for (let k = 0; k < 4; k++) {
      const s = em(st, '💫', { left: '44%', top: '70%', fontSize: '24px' });
      s.animate([{ opacity: 0 }, { opacity: 1, transform: `rotate(${k * 90}deg) translateX(40px) rotate(-${k * 90}deg)` },
        { opacity: 1, transform: `rotate(${k * 90 + 360}deg) translateX(40px) rotate(-${k * 90 + 360}deg)` }], { duration: 1400, delay: 1800, iterations: 2 });
    }
    shakeEl(st.parentElement, 1450);
  },
  squash(st, nm, e) {
    const a = em(st, e, { left: '50%', top: '0', fontSize: '120px', marginLeft: '-60px' });
    a.animate([{ transform: 'translateY(-260px)' }, { transform: 'translateY(26px)', offset: 0.85 }, { transform: 'translateY(34px) scale(1.1,.85)' }],
      { duration: 720, easing: 'ease-in', fill: 'forwards' });
    nm.animate([{ transform: 'none' }, { transform: 'none', offset: 0.88 }, { transform: 'translateY(48px) scale(1.8,.1)' }], { duration: 760, fill: 'forwards' });
    shakeEl(st.parentElement, 650);
    const sp = $el('div', 'gburp'); sp.textContent = 'SPLOTCH'; st.appendChild(sp);
    sp.animate([{ opacity: 0, transform: 'scale(.4)' }, { opacity: 1, transform: 'scale(1.1) rotate(4deg)' }], { duration: 250, delay: 700, fill: 'both' });
  },
  wrap(st, nm, e) {
    for (let k = 0; k < 10; k++) {
      const p = em(st, e, { left: '50%', top: '50%', fontSize: '34px', marginLeft: '-17px', marginTop: '-20px' });
      const a0 = k * 36;
      p.animate([{ transform: `rotate(${a0}deg) translateX(240px) rotate(${-a0}deg)` },
        { transform: `rotate(${a0 + 540}deg) translateX(70px) rotate(${-a0 - 540}deg)` },
        { transform: `rotate(${a0 + 720}deg) translateX(0) rotate(${-a0 - 720}deg) scale(0)` }], { duration: 1500, delay: k * 50, easing: 'ease-in', fill: 'forwards' });
    }
    nm.animate([{ filter: 'none' }, { filter: 'grayscale(1) brightness(2.5)', transform: 'rotate(-3deg)' }], { duration: 400, delay: 1300, fill: 'forwards' });
    nm.animate([{ letterSpacing: '0px' }, { letterSpacing: '6px' }], { duration: 300, delay: 1300, fill: 'forwards' });
    const z = $el('div', 'gburp'); z.textContent = '🪦 ci-gît un rouleau'; st.appendChild(z);
    z.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 300, delay: 1900, fill: 'both' });
  },
};

function gagFor(r) { return GAGS[Math.floor(r * GAGS.length) % GAGS.length]; }
function gagText(g, name, other) { return g.t.replace('{n}', name).replace('{o}', other || "quelqu'un"); }

// Version grand écran (victime + fin de manche)
function playGag(box, { name, color, other, r, capName }) {
  const g = gagFor(r);
  box.innerHTML = '';
  const st = $el('div', 'gstage'); box.appendChild(st);
  const nm = $el('div', 'gname'); nm.textContent = name; nm.style.color = color || '#fff'; st.appendChild(nm);
  const cap = $el('div', 'gcap'); cap.textContent = gagText(g, capName || name, other); box.appendChild(cap);
  cap.animate([{ opacity: 0, transform: 'translateY(10px)' }, { opacity: 1, transform: 'none' }], { duration: 400, delay: 1000, fill: 'both' });
  SFX.play(g.s);
  try { CHOREO[g.a](st, nm, g.e); } catch {}
  return g;
}

// Version mini (fil des éliminations, pour les autres joueurs)
function gagToast(feed, { name, color, other, r, extra }) {
  const g = gagFor(r);
  const t = $el('div', 'toast');
  const e = $el('span', 'temo'); e.textContent = g.e;
  const tx = $el('span'); tx.textContent = gagText(g, name, other) + (extra || '');
  t.append(e, tx);
  t.style.borderLeftColor = color || '#fff';
  feed.prepend(t);
  e.animate([{ transform: 'scale(0) rotate(-90deg)' }, { transform: 'scale(1.4) rotate(10deg)' }, { transform: 'scale(1)' }], { duration: 500 });
  t.animate([{ opacity: 0, transform: 'translateX(-30px)' }, { opacity: 1, transform: 'none' }], { duration: 250 });
  setTimeout(() => t.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 400, fill: 'forwards' }).onfinish = () => t.remove(), 5000);
  while (feed.children.length > 4) feed.lastChild.remove();
  SFX.play(g.s);
}
