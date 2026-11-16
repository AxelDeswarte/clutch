// CLUTCH — client
'use strict';
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ARROW = { up: '⬆', down: '⬇', left: '⬅', right: '➡' };
// e.code = touche physique : KeyW/A/S/D = ZQSD sur AZERTY et WASD sur QWERTY
const DIRK = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right', KeyW: 'up', KeyS: 'down', KeyA: 'left', KeyD: 'right' };
const isTouch = matchMedia('(pointer: coarse)').matches;
const PALETTE = ['#3dd6ff', '#ff5fa2', '#ffd23f', '#2ee59d', '#ff9f1c', '#b388ff'];
const TEAMC = ['#3dd6ff', '#ff5fa2'];
const TEAMN = ['Équipe Bleue', 'Équipe Rose'];
const AVATARS = ['🦊', '🐸', '🐼', '🐙', '🦄', '🐷', '🐵', '🦖', '👽', '🤖', '💩', '🤡', '👻', '🍆', '🍑', '🌮', '🧀', '🦆', '🐔', '🦍', '🐌', '🍄', '🎃', '🥑'];
const MODE_UI = { duel: ['⚔️', '1v1', '2 joueurs'], '2v2': ['👯', '2v2', '4 joueurs'], '3v3': ['🛡️', '3v3', '6 joueurs'], ffa: ['🎉', 'Chacun pour soi', '3 à 6'] };
const MEDALS = ['🥇', '🥈', '🥉'];

let ws = null, room = null, M = null, scores = [], prevScores = [], roundNo = 0, decisive = false;
let cur = null, active = false, dead = false;
let toLobbyTimer = null, countTimer = null, gagTimer = null, introOpen = false;
let myAvatar = AVATARS[Math.floor(Math.random() * AVATARS.length)];
try { myAvatar = localStorage.getItem('clutch-avatar') || myAvatar; } catch {}

const P = (i) => M.players[i];
const range = (n) => [...Array(n).keys()];
const pill = (i, extra = '') => `<span class="pill" style="background:${P(i).color}"><span class="av">${esc(P(i).avatar)}</span>${esc(P(i).name)}${i === M.me ? ' (toi)' : ''}${extra}</span>`;
const sideLabel = (s) => (M.teams ? M.sideNames[s] : P(M.sides[s][0]).name);
const sideColor = (s) => (M.teams ? TEAMC[s] : P(M.sides[s][0]).color);

// ════════════════ réseau ════════════════
function send(o) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(o)); }
function connect(then) {
  if (ws && ws.readyState === 1) return then();
  ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host);
  ws.onopen = then;
  ws.onmessage = (e) => onMsg(JSON.parse(e.data));
  ws.onclose = () => {
    ws = null; stopGame(); cur = null; active = false; M = null;
    hideOverlay(); hideGag(); show('home');
    $('#homeErr').textContent = 'Connexion au serveur perdue 😢';
  };
}

// ════════════════ UI de base ════════════════
function show(id) { document.querySelectorAll('.screen').forEach((s) => s.classList.toggle('hidden', s.id !== id)); }
function isShown(id) { return !$('#' + id).classList.contains('hidden'); }
function shake(el) { if (!el) return; el.classList.remove('shake'); void el.offsetWidth; el.classList.add('shake'); }
function bump(el) { if (!el) return; el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump'); }

function logo(el) {
  const cols = ['#ffd23f', '#ff5fa2', '#3dd6ff', '#2ee59d', '#ff9f1c', '#b388ff'];
  el.innerHTML = 'CLUTCH'.split('').map((ch, i) => `<span style="--c:${cols[i]};--i:${i}">${ch}</span>`).join('');
}
logo($('#logoBig')); logo($('#logoSmall'));

function overlay({ icon, title, color, text, delay, badge }) {
  clearInterval(countTimer);
  $('#overlay').classList.remove('hidden');
  const card = $('#overlay .ovcard');
  card.style.animation = 'none'; void card.offsetWidth; card.style.animation = '';
  $('#ovBadge').innerHTML = badge ? `<span class="decisive">${esc(badge)}</span>` : '';
  $('#ovIcon').textContent = icon || '';
  $('#ovIcon').classList.toggle('hidden', !icon);
  const t = $('#ovTitle');
  t.textContent = title;
  t.classList.toggle('stroke', !!color);
  t.style.setProperty('--c', color || '');
  $('#ovText').textContent = text || '';
  $('#ovGag').innerHTML = '';
  $('#ovList').innerHTML = '';
  $('#ovCount').innerHTML = '';
  $('#ovReady').innerHTML = '';
  introOpen = false;
  if (delay) startCount(delay);
}
function startCount(ms) {
  clearInterval(countTimer);
  const end = Date.now() + ms;
  let last = null;
  const tick = () => {
    const s = Math.ceil((end - Date.now()) / 1000);
    if (s === last) return;
    last = s;
    if (s > 0 && s <= 3) SFX.play('tick');
    $('#ovCount').innerHTML = s > 0 ? `<div class="countbub">${s}</div>` : '';
  };
  tick();
  countTimer = setInterval(tick, 100);
}
function renderReady(list) {
  if (!M) return;
  const meReady = list[M.me];
  const n = list.filter(Boolean).length;
  $('#ovReady').innerHTML = `<div class="readyrow">${M.players.map((p, i) => `<span class="pill" style="background:${list[i] ? p.color : '#ece7f7'};${list[i] ? '' : 'opacity:.65'}"><span class="av">${esc(p.avatar)}</span>${esc(p.name)}${i === M.me ? ' (toi)' : ''} ${list[i] ? '✔' : '…'}</span>`).join('')}</div>
    ${meReady ? `<p class="mut">✔ Prêt — en attente des autres (${n}/${list.length})</p>` : `<button class="btn big green" id="btnReady">✅ J'ai lu, prêt ! <span style="font-size:14px">(Entrée)</span></button>`}`;
  const b = $('#btnReady');
  if (b) b.onclick = sendReady;
}
function sendReady() { if (introOpen) { SFX.unlock(); send({ t: 'ready' }); } }
function hideOverlay() { clearInterval(countTimer); $('#overlay').classList.add('hidden'); $('#ovGag').innerHTML = ''; }
function hideGag() { clearTimeout(gagTimer); $('#gagLayer').classList.add('hidden'); $('#gagLayer .gwrap').innerHTML = ''; }

function timerBar(el, ms) {
  if (!el) return;
  el.getAnimations().forEach((a) => a.cancel());
  el.animate([{ width: '100%' }, { width: '0%' }], { duration: ms, fill: 'forwards', easing: 'linear' });
}

function dpad(onDown, onUp) {
  const el = document.createElement('div');
  if (!isTouch) return el;
  el.className = 'dpad';
  el.innerHTML = ['up', 'left', 'down', 'right'].map((d) => `<button class="btn white" data-d="${d}">${ARROW[d]}</button>`).join('');
  el.querySelectorAll('button').forEach((b) => {
    b.addEventListener('pointerdown', (e) => { e.preventDefault(); if (active && !dead) onDown(b.dataset.d); });
    if (onUp) ['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) => b.addEventListener(ev, () => onUp(b.dataset.d)));
  });
  return el;
}

function progsInit() { return '<div class="progs" id="progs"></div>'; }
function progsUpdate(vals) {
  const el = $('#progs'); if (!el) return;
  el.innerHTML = M.players.map((p, i) => `<div class="prow">${pill(i)}
    <div class="bar"><div style="width:${Math.min(1, vals[i]) * 100}%;background:${p.color}"></div></div><span>${vals[i] >= 1 ? '🏁' : ''}</span></div>`).join('');
}
function legend() {
  return `<div class="chips" id="legend">${M.players.map((p, i) => `<span data-i="${i}">${pill(i, ' <span class="st"></span>')}</span>`).join('')}</div>`;
}
function legendSet(i, txt) { const s = document.querySelector(`#legend [data-i="${i}"] .st`); if (s) s.textContent = txt; }

// ════════════════ confettis ════════════════
const Confetti = (() => {
  const cv = $('#confetti'), c = cv.getContext('2d');
  let parts = [], raf = null;
  const cols = ['#ffd23f', '#ff5fa2', '#3dd6ff', '#2ee59d', '#ff9f1c', '#b388ff', '#fff'];
  function frame() {
    cv.width = innerWidth; cv.height = innerHeight;
    c.clearRect(0, 0, cv.width, cv.height);
    parts.forEach((p) => {
      p.vy += 0.25; p.x += p.vx; p.y += p.vy; p.r += p.vr; p.vx *= 0.99;
      c.save(); c.translate(p.x, p.y); c.rotate(p.r); c.fillStyle = p.c; c.fillRect(-p.w / 2, -p.h / 2, p.w, p.h); c.restore();
    });
    parts = parts.filter((p) => p.y < cv.height + 40);
    raf = parts.length ? requestAnimationFrame(frame) : (c.clearRect(0, 0, cv.width, cv.height), null);
  }
  return {
    burst(n = 160) {
      for (let k = 0; k < n; k++) {
        const left = k % 2 === 0;
        parts.push({ x: left ? 0 : innerWidth, y: innerHeight * 0.7, vx: (left ? 1 : -1) * (6 + Math.random() * 10), vy: -12 - Math.random() * 10,
          r: Math.random() * 6, vr: (Math.random() - 0.5) * 0.4, w: 8 + Math.random() * 6, h: 5 + Math.random() * 6, c: cols[k % cols.length] });
      }
      if (!raf) frame();
    },
  };
})();

// ════════════════ scorebar ════════════════
function renderScore() {
  if (!M) return;
  const sb = $('#scorebar');
  const rnd = decisive ? '⚡ Manche décisive' : `Manche ${roundNo} / ${M.maxRounds}`;
  if (M.sides.length === 2) {
    const side = (s, r) => `<div class="sbside ${r ? 'r' : ''}">
      <span class="sbname" style="background:${sideColor(s)}">${M.teams ? esc(sideLabel(s)) : esc(P(M.sides[s][0]).avatar) + ' ' + esc(sideLabel(s)) + (M.sides[s][0] === M.me ? ' (toi)' : '')}</span>
      ${M.teams ? `<div class="sbmem">${M.sides[s].map((i) => pill(i)).join('')}</div>` : ''}</div>`;
    sb.innerHTML = `${side(0)}<div class="sbscore"><div class="big"><span id="sc0">${scores[0]}</span> – <span id="sc1">${scores[1]}</span></div><div class="rnd">${rnd}</div></div>${side(1, true)}`;
  } else {
    const best = Math.max(...scores);
    sb.innerHTML = `<div class="ffachips">${M.players.map((p, i) => `<span class="fchip ${i === M.me ? 'me' : ''}" style="background:${p.color}">
      <span class="av">${esc(p.avatar)}</span>${best > 0 && scores[i] === best ? '👑 ' : ''}${esc(p.name)} <b id="sc${i}">${scores[i]}</b></span>`).join('')}</div>
      <div class="sbscore"><div class="rnd">${rnd}</div></div>`;
  }
  scores.forEach((s, i) => { if (prevScores[i] !== undefined && s > prevScores[i]) bump($('#sc' + i)); });
  prevScores = [...scores];
}

// ════════════════ salon ════════════════
function avatarGrid(el, onPick) {
  el.innerHTML = AVATARS.map((a) => `<button class="${a === myAvatar ? 'on' : ''}" data-a="${a}">${a}</button>`).join('');
  el.onclick = (e) => { const b = e.target.closest('[data-a]'); if (b) onPick(b.dataset.a); };
}
function setAvatar(a) {
  myAvatar = a;
  try { localStorage.setItem('clutch-avatar', a); } catch {}
  $('#avBig').textContent = a;
  avatarGrid($('#avGrid'), setAvatar);
  avatarGrid($('#avGridLobby'), (x) => { setAvatar(x); send({ t: 'avatar', avatar: x }); });
}

function renderLobby() {
  const r = room; if (!r) return;
  const host = r.you === r.host;
  const meM = r.members.find((m) => m.id === r.you);
  $('#roomCode').textContent = r.code;
  $('#lobbyResult').classList.toggle('hidden', !r.lastResult);
  $('#lobbyResult').textContent = r.lastResult || '';
  const isTeam = r.mode === '2v2' || r.mode === '3v3';
  const row = (m) => `<div class="pl ${m.id === r.you ? 'me' : ''}"><span class="av">${esc(m.avatar)}</span><span class="nm">${esc(m.name)}${m.id === r.you ? ' (toi)' : ''}</span>${m.id === r.host ? '👑' : ''}</div>`;
  if (isTeam) {
    const size = r.mode === '2v2' ? 2 : 3;
    $('#teams').innerHTML = [0, 1].map((t) => {
      const mem = r.members.filter((m) => m.team === t);
      return `<div class="teamcol" style="background:${TEAMC[t]}33"><h4><span>${t === 0 ? '🔵' : '🩷'} ${TEAMN[t]} <span class="mut">${mem.length}/${size}</span></span>
        ${meM && meM.team !== t ? `<button class="btn white sm" data-team="${t}">Rejoindre</button>` : ''}</h4>
        <div class="plist">${mem.map(row).join('') || '<div class="empty">Personne pour l\'instant</div>'}</div></div>`;
    }).join('');
  } else {
    $('#teams').innerHTML = `<div class="plist">${r.members.map(row).join('')}</div>`;
  }
  $('#count').textContent = `${r.members.length}/6`;
  $('#modes').innerHTML = r.modes.map((m) => { const u = MODE_UI[m.key]; return `<div class="mode ${m.key === r.mode ? 'on' : ''}" data-mode="${m.key}"><span class="i">${u[0]}</span><b>${u[1]}</b><small>${u[2]}</small></div>`; }).join('');
  const N = r.rounds;
  const twoSides = r.mode !== 'ffa';
  $('#rounds').innerHTML = `<div class="stepper"><button class="btn white" data-r="${N - 1}">−</button><span class="n">${N}</span><button class="btn white" data-r="${N + 1}">+</button></div>
    ${[3, 5, 7, 10, 15].map((v) => `<button class="btn sm ${v === N ? 'pink' : 'white'}" data-r="${v}">${v}</button>`).join('')}
    <div class="roundsinfo">${twoSides
      ? `Best of ${N} : le premier à <b>${Math.floor(N / 2) + 1}</b> manche${Math.floor(N / 2) + 1 > 1 ? 's' : ''} gagnée${Math.floor(N / 2) + 1 > 1 ? 's' : ''} l'emporte. Égalité = manche décisive.`
      : `${N} manche${N > 1 ? 's' : ''} · podium 3 / 2 / 1 pts · le plus de points gagne. Égalité = manche décisive.`}</div>`;
  $('#gamesList').innerHTML = r.games.map((g) => `<button class="gcard ${g.on ? 'on' : ''}" data-game="${g.key}">
    <span class="tick">${g.on ? '✔' : '✖'}</span><span class="i">${g.icon}</span><b>${esc(g.title)}</b><small>${esc(g.desc)}</small></button>`).join('');
  ['#modes', '#rounds', '#gamesList'].forEach((s) => $(s).classList.toggle('nohost', !host));
  $('#btnStart').classList.toggle('hidden', !host);
  $('#btnStart').disabled = !r.canStart;
  $('#lobbyMsg').textContent = r.hint || (host ? 'Tout est prêt, lance quand tu veux !' : "⏳ En attente que l'hôte 👑 lance la partie…");
  avatarGrid($('#avGridLobby'), (x) => { setAvatar(x); send({ t: 'avatar', avatar: x }); });
}

// ════════════════ messages serveur ════════════════
function onMsg(m) {
  switch (m.t) {
    case 'error':
      (isShown('home') ? $('#homeErr') : $('#lobbyMsg')).textContent = m.msg;
      break;
    case 'room':
      room = m;
      history.replaceState(null, '', '?code=' + m.code);
      renderLobby();
      if (isShown('home')) show('lobby');
      break;
    case 'matchStart':
      clearTimeout(toLobbyTimer); toLobbyTimer = null;
      M = m; scores = new Array(m.sides.length).fill(0); prevScores = []; roundNo = 0; decisive = false;
      show('game'); renderScore();
      break;
    case 'roundIntro':
      stopGame(); hideGag();
      roundNo = m.round; decisive = m.decisive; scores = m.scores; renderScore();
      cur = GAMES[m.game]; active = false; dead = false;
      $('#stage').innerHTML = '';
      cur.init();
      overlay({ icon: m.icon, title: m.title, text: m.rules, badge: m.decisive ? '⚡ MANCHE DÉCISIVE ⚡' : `Manche ${m.round} / ${m.maxRounds}` });
      introOpen = true;
      renderReady(m.ready);
      break;
    case 'readyState':
      if (introOpen) renderReady(m.ready);
      break;
    case 'countdown':
      introOpen = false;
      $('#ovReady').innerHTML = '';
      startCount(m.ms);
      break;
    case 'g':
      if (!cur || !M) break;
      if (!active) { active = true; hideOverlay(); SFX.play('go'); }
      cur.msg(m);
      break;
    case 'elim': onElim(m); break;
    case 'roundEnd':
      active = false; stopGame();
      scores = m.scores; renderScore();
      showRoundEnd(m);
      break;
    case 'matchEnd': showMatchEnd(m); break;
    case 'aborted':
      stopGame(); cur = null; active = false; M = null;
      clearTimeout(toLobbyTimer); toLobbyTimer = null;
      hideOverlay(); hideGag(); show('lobby');
      setTimeout(() => { $('#lobbyMsg').textContent = '⚠️ ' + m.msg; }, 50);
      break;
  }
}

function stopGame() { if (cur && cur.stop) { try { cur.stop(); } catch {} } }

function onElim(m) {
  if (!M) return;
  const name = P(m.i).name, color = P(m.i).color, other = P(m.o).name;
  const extra = m.role ? (m.role === 'undercover' ? " — c'était l'UNDERCOVER 🕵️" : " — c'était un civil 😇") : '';
  if (m.i === M.me) {
    dead = true;
    const L = $('#gagLayer');
    L.classList.remove('hidden');
    playGag(L.querySelector('.gwrap'), { name, color, other, r: m.r });
    clearTimeout(gagTimer);
    gagTimer = setTimeout(() => {
      hideGag();
      if (active && !$('#youdead')) {
        const b = document.createElement('div'); b.id = 'youdead'; b.className = 'youdead'; b.textContent = '💀 Éliminé·e — tu regardes la fin';
        $('#stage').appendChild(b);
      }
    }, 3400);
  } else {
    gagToast($('#feed'), { name, color, other, r: m.r, extra });
  }
}

function standingsHTML(m) {
  const order = range(M.players.length).sort((a, b) => m.ranks[a] - m.ranks[b]);
  return `<div class="standings">${order.map((i, k) => {
    const g = M.sides.length > 2 ? m.gained[P(i).side] : 0;
    const r = m.ranks[i];
    return `<div style="animation-delay:${k * 0.08}s"><span class="medal">${MEDALS[r - 1] || r + '.'}</span>${pill(i)}${g ? `<span class="pts">+${g}</span>` : ''}</div>`;
  }).join('')}</div>`;
}

function showRoundEnd(m) {
  let title, color, mine;
  if (m.winSide === -1) { title = '🤝 Égalité !'; color = '#ffd23f'; mine = null; }
  else {
    mine = P(M.me).side === m.winSide;
    title = mine ? (M.sides.length === 2 && M.teams ? `${sideLabel(m.winSide)} gagne !` : 'Manche gagnée !') : `${sideLabel(m.winSide)} gagne la manche`;
    color = sideColor(m.winSide);
  }
  overlay({ title, color, text: m.reason });
  hideGag();
  if (mine === true) { SFX.play('win'); Confetti.burst(90); } else if (mine === false) SFX.play('lose');
  if (m.losers.length && m.losers.length < M.players.length) {
    const names = m.losers.map((i) => P(i).name).join(' & ');
    const sameSide = m.losers.every((i) => P(i).side === P(m.losers[0]).side);
    // plusieurs perdants : nom collectif pour garder une phrase au singulier
    const capName = m.losers.length === 1 ? names : M.teams && sameSide ? `L'${sideLabel(P(m.losers[0]).side)}` : `La bande à ${P(m.losers[0]).name}`;
    setTimeout(() => { if (!$('#overlay').classList.contains('hidden')) playGag($('#ovGag'), { name: names, capName, color: P(m.losers[0]).color, other: P(m.o).name, r: m.r }); }, 700);
  }
  $('#ovList').innerHTML = standingsHTML(m);
}

function showMatchEnd(m) {
  stopGame(); cur = null; active = false; hideGag();
  const iWon = m.winners.includes(P(M.me).side);
  const winNames = m.winners.map(sideLabel).join(' & ');
  const line = M.sides.map((_, s) => `${sideLabel(s)} ${m.scores[s]}`).join(' · ');
  overlay({ icon: iWon ? '🏆' : '💀', title: iWon ? 'VICTOIRE !' : 'DÉFAITE…', color: iWon ? '#2ee59d' : '#ff4d6d', text: `${winNames} ${m.winners.length > 1 ? 'gagnent' : 'gagne'} le match — ${line}` });
  SFX.play(iWon ? 'win' : 'lose');
  if (iWon) { Confetti.burst(220); setTimeout(() => Confetti.burst(160), 900); }
  if (m.losers.length) {
    const names = m.losers.map(sideLabel).join(' & ');
    const capName = m.losers.length === 1 ? (M.teams ? `L'${names}` : names) : `La bande à ${sideLabel(m.losers[0])}`;
    const winnerName = P(M.sides[m.winners[0]][0]).name;
    setTimeout(() => playGag($('#ovGag'), { name: names, capName, color: sideColor(m.losers[0]), other: winnerName, r: m.r }), 800);
  }
  const Mref = M;
  toLobbyTimer = setTimeout(() => {
    toLobbyTimer = null;
    if (M !== Mref) return;
    hideOverlay(); M = null; show('lobby'); renderLobby();
  }, 8000);
}

// ════════════════ entrées clavier ════════════════
document.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT') return;
  if (introOpen && e.key === 'Enter') { e.preventDefault(); sendReady(); return; }
  if (active && !dead && cur && cur.key) cur.key(e);
});
document.addEventListener('keyup', (e) => { if (active && cur && cur.keyup) cur.keyup(e); });
window.addEventListener('blur', () => { if (cur && cur.blur) cur.blur(); });

// ════════════════ interpolation (jeux temps réel) ════════════════
function pushSnap(S, data) { S.prev = S.cur || { time: performance.now(), d: data }; S.cur = { time: performance.now(), d: data }; }
function alphaOf(S) { return Math.max(0, Math.min(1, (performance.now() - S.cur.time) / 34)); }
const lerp = (a, b, t) => a + (b - a) * t;
function strokeText(c, txt, x, y, fill, size = 12) {
  c.font = `800 ${size}px Nunito, system-ui`; c.textAlign = 'center'; c.lineWidth = 3; c.strokeStyle = '#1b1440';
  c.strokeText(txt, x, y); c.fillStyle = fill; c.fillText(txt, x, y);
}

// ════════════════ MINI-JEUX ════════════════
const GAMES = {};

// ── Réflexe ──
GAMES.reflex = {
  init() {
    $('#stage').innerHTML = `<div class="rxwrap"><div class="rx idle" id="rx"><span class="face">🤠</span><span id="rxt">Main sur le flingue…</span></div></div>
      <p class="sub">ESPACE, clic ou tap au cri « FEU ! » — pas avant</p>${legend()}`;
    this.t0 = null; this.done = false;
    $('#rx').addEventListener('pointerdown', () => this.press());
  },
  set(cls, face, txt) { $('#rx').className = 'rx ' + cls; $('#rx .face').textContent = face; $('#rxt').textContent = txt; },
  msg(m) {
    if (m.k === 'wait') this.set('wait', '😐', 'Attends…');
    if (m.k === 'fake' && !this.done) {
      this.set('fake', '🤡', m.txt);
      clearTimeout(this.ft);
      this.ft = setTimeout(() => { if (!this.done && $('#rx') && $('#rx').classList.contains('fake')) this.set('wait', '😐', 'Attends…'); }, 700);
    }
    if (m.k === 'go') {
      clearTimeout(this.ft);
      this.set('go', '🔫', 'FEU !');
      this.t0 = performance.now();
      requestAnimationFrame((t) => { this.t0 = t; });
    }
    if (m.k === 't') legendSet(m.i, `⏱ ${m.ms} ms`);
    if (m.k === 'fs') { legendSet(m.i, '⚰️ abattu'); SFX.play('gun'); }
  },
  key(e) { if (e.code === 'Space') { e.preventDefault(); this.press(); } },
  press() {
    if (!active || dead || this.done) return;
    this.done = true;
    const ms = this.t0 == null ? -1 : Math.round(performance.now() - this.t0);
    send({ t: 'input', a: 'press', ms });
    SFX.play('gun');
    if (ms < 0) this.set('wait', '⚰️', 'TROP TÔT !');
    else this.set('go', ms < 250 ? '😎' : ms < 350 ? '🤠' : '🐢', ms + ' ms');
  },
};


// ════════════════ helpers jeux d'arène ════════════════
function sawblade(c, x, y, r, rot) {
  c.save(); c.translate(x, y); c.rotate(rot);
  c.beginPath();
  const T = 12;
  for (let k = 0; k < T * 2; k++) { const a = (k / (T * 2)) * Math.PI * 2, rr = k % 2 ? r * 0.78 : r; c.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); }
  c.closePath();
  const g = c.createRadialGradient(-r / 3, -r / 3, 2, 0, 0, r);
  g.addColorStop(0, '#ffffff'); g.addColorStop(0.6, '#b8bcd0'); g.addColorStop(1, '#6d7290');
  c.fillStyle = g; c.fill(); c.strokeStyle = '#1b1440'; c.lineWidth = 2.5; c.stroke();
  c.fillStyle = '#ff4d6d'; c.beginPath(); c.arc(0, 0, r * 0.22, 0, 7); c.fill(); c.stroke();
  c.restore();
}
function drawPlayersAt(c, S, a, PR, offX = 0, extra) {
  const A = S.prev.d.p, B = S.cur.d.p;
  B.forEach((p, i) => {
    const pp = A[i] || p;
    const x = lerp(pp[0], p[0], a) - offX, y = lerp(pp[1], p[1], a);
    if (!p[2]) { c.font = '24px serif'; c.textAlign = 'center'; c.fillText('💀', x, y + 8); return; }
    c.beginPath(); c.arc(x, y, PR + 4, 0, 7); c.fillStyle = P(i).color; c.fill();
    c.lineWidth = 3; c.strokeStyle = i === M.me ? '#fff' : '#1b1440'; c.stroke();
    c.font = '16px serif'; c.textAlign = 'center'; c.fillText(P(i).avatar, x, y + 6);
    strokeText(c, P(i).name, x, y - PR - 9, P(i).color, 12);
    if (extra) extra(i, x, y);
  });
}
// déplacement au clavier (+ bousculade optionnelle) partagé par les jeux d'arène
function mover(g, shove) {
  g.held = new Set(); g.lastV = '0,0'; g.fx = [];
  g.sendMv = () => {
    const h = g.held;
    const x = (h.has('right') ? 1 : 0) - (h.has('left') ? 1 : 0), y = (h.has('down') ? 1 : 0) - (h.has('up') ? 1 : 0);
    const v = x + ',' + y;
    if (v !== g.lastV) { g.lastV = v; send({ t: 'input', a: 'mv', x, y }); }
  };
  g.key = (e) => {
    const d = DIRK[e.code];
    if (d) { e.preventDefault(); if (!e.repeat) { g.held.add(d); g.sendMv(); } }
    else if (shove && e.code === 'Space') { e.preventDefault(); if (!e.repeat) send({ t: 'input', a: 'shove' }); }
  };
  g.keyup = (e) => { const d = DIRK[e.code]; if (d) { g.held.delete(d); g.sendMv(); } };
  g.blur = () => { g.held.clear(); g.sendMv(); };
  $('#stage').appendChild(dpad((d) => { g.held.add(d); g.sendMv(); }, (d) => { g.held.delete(d); g.sendMv(); }));
  if (shove && isTouch) {
    const b = document.createElement('button'); b.className = 'btn pink'; b.style.marginTop = '10px'; b.textContent = '💥 Bousculer';
    b.addEventListener('pointerdown', (e) => { e.preventDefault(); if (active && !dead) send({ t: 'input', a: 'shove' }); });
    $('#stage').appendChild(b);
  }
}
function fxText(g, x, y, txt, color = '#ffd23f') { g.fx.push({ x, y, txt, color, t: performance.now() }); }
function drawFx(c, g, offX = 0) {
  const now = performance.now();
  g.fx = g.fx.filter((f) => now - f.t < 900);
  g.fx.forEach((f) => { const k = (now - f.t) / 900; c.globalAlpha = 1 - k; strokeText(c, f.txt, f.x - offX, f.y - k * 30, f.color, 18 + k * 8); c.globalAlpha = 1; });
}
function holdBtn(label, onDown, onUp) {
  const b = document.createElement('button');
  b.className = 'btn big'; b.style.marginTop = '14px'; b.style.touchAction = 'none'; b.textContent = label;
  b.addEventListener('pointerdown', (e) => { e.preventDefault(); if (active && !dead) onDown(); });
  ['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) => b.addEventListener(ev, () => onUp()));
  return b;
}

// ── Escalator ──
GAMES.seq = {
  init() {
    $('#stage').innerHTML = `<div class="seq" id="seqMe"></div><div class="screen-dark" style="margin-top:14px"><canvas id="ec" width="800" height="380"></canvas></div>
      <p class="sub">Flèches ou ZQSD — une erreur te fait glisser vers les lames</p>`;
    $('#stage').appendChild(dpad((d) => this.dir(d)));
    this.seq = []; this.idx = 0; this.S = {}; this.raf = null;
  },
  render() {
    const nx = this.seq.length ? range(6).map((k) => this.seq[(this.idx + k) % this.seq.length]) : [];
    $('#seqMe').innerHTML = nx.map((d, k) => `<span class="key ${k === 0 ? 'cur' : ''}" style="${k ? `opacity:${1 - k * 0.14}` : ''}">${ARROW[d]}</span>`).join('');
  },
  msg(m) {
    if (m.k === 'esc') { this.seq = m.seq; this.top = m.top; this.render(); this.loop(); }
    if (m.k === 's') {
      if (this.S.cur) m.al.forEach((a, i) => { if (!a && this.S.cur.d.al[i]) legendSet(i, '💀'); });
      pushSnap(this.S, m);
      if (m.idx[M.me] > this.idx) { this.idx = m.idx[M.me]; this.render(); }
    }
  },
  key(e) { const d = DIRK[e.code]; if (d) { e.preventDefault(); this.dir(d); } },
  dir(d) {
    if (!this.seq.length) return;
    send({ t: 'input', a: 'key', key: d });
    if (d === this.seq[this.idx % this.seq.length]) { this.idx++; SFX.play('ok'); }
    else { shake($('#seqMe')); SFX.play('bad'); }
    this.render();
  },
  loop() {
    const cv = $('#ec'), c = cv.getContext('2d'), n = M.players.length, W = cv.width, H = cv.height;
    const draw = () => {
      this.raf = requestAnimationFrame(draw);
      const S = this.S; if (!S.cur) return;
      const a = alphaOf(S), A = S.prev.d, B = S.cur.d, TOP = this.top;
      const y = (st) => H - 20 - (st / TOP) * (H - 50);
      const lw = W / n;
      c.fillStyle = '#14102e'; c.fillRect(0, 0, W, H);
      const cy = y(lerp(A.c, B.c, a));
      for (let i = 0; i < n; i++) {
        const x0 = i * lw;
        c.fillStyle = i % 2 ? '#221b4a' : '#2a2258'; c.fillRect(x0 + 4, 0, lw - 8, H);
        c.strokeStyle = 'rgba(255,255,255,.12)'; c.lineWidth = 2;
        const off = (performance.now() / 20) % 18;
        for (let yy = -18 + off; yy < H; yy += 18) { c.beginPath(); c.moveTo(x0 + 10, yy); c.lineTo(x0 + lw - 10, yy); c.stroke(); }
        c.fillStyle = '#ffd23f'; c.fillRect(x0 + 4, y(TOP) - 4, lw - 8, 6);
      }
      // broyeur
      const g = c.createLinearGradient(0, cy, 0, H); g.addColorStop(0, '#ff4d6d'); g.addColorStop(1, '#5c0b1f');
      c.fillStyle = g; c.fillRect(0, cy, W, H - cy);
      c.fillStyle = '#d7dbe8';
      const sh = (performance.now() / 15) % 24;
      for (let x = -24 + sh; x < W; x += 24) { c.beginPath(); c.moveTo(x, cy); c.lineTo(x + 12, cy - 14); c.lineTo(x + 24, cy); c.fill(); }
      strokeText(c, '⚙️ BROYEUR ⚙️', W / 2, Math.min(H - 8, cy + 26), '#fff', 16);
      B.pos.forEach((p, i) => {
        const x = i * lw + lw / 2, yy = y(lerp(A.pos[i], p, a));
        if (!B.al[i]) { c.font = '26px serif'; c.textAlign = 'center'; c.fillText('🩸', x, Math.min(H - 10, yy)); return; }
        c.font = '30px serif'; c.textAlign = 'center'; c.fillText(P(i).avatar, x, yy);
        if (i === M.me) { c.strokeStyle = '#fff'; c.lineWidth = 3; c.beginPath(); c.arc(x, yy - 10, 21, 0, 7); c.stroke(); }
        strokeText(c, P(i).name, x, 16, P(i).color, 13);
      });
    };
    draw();
  },
  stop() { cancelAnimationFrame(this.raf); },
};

// ── Le Filtre ──
GAMES.filter = {
  init() {
    $('#stage').innerHTML = `<div class="sortkeys">
        <button class="btn sortbtn" data-b="0" style="background:#ff9f1c"><span class="k">⬅ ou Q</span>🔥 AU FOUR<small>les portraits 🖼️</small></button>
        <button class="btn sortbtn" data-b="1" style="background:#3dd6ff"><span class="k">➡ ou D</span>📦 EN CAISSE<small>la ferraille 🔩⚙️🔧</small></button>
      </div>
      <div class="ucturn" id="fnow" style="margin:0 0 8px">Les objets arrivent…</div>
      <div class="screen-dark"><canvas id="fc" width="820" height="300"></canvas></div>${legend()}
      <p class="sub">Trie chaque objet quand il est dans la zone jaune. Oublier = −1.</p>`;
    this.items = null; this.dec = new Map(); this.res = {}; this.raf = null;
    $('#stage').querySelectorAll('.sortbtn').forEach((b) => b.addEventListener('pointerdown', (e) => { e.preventDefault(); this.sort(+b.dataset.b); }));
  },
  msg(m) {
    if (m.k === 'belt') { this.items = m.items; this.half = m.half; this.t0 = performance.now(); this.loop(); M.players.forEach((_, i) => legendSet(i, '0 pt')); }
    if (m.k === 'res') {
      this.res[m.idx] = m.res[M.me];
      SFX.play(m.res[M.me] === 1 ? 'ok' : 'bad');
      m.s.forEach((v, i) => legendSet(i, `${v} pt${Math.abs(v) > 1 ? 's' : ''}`));
    }
  },
  key(e) {
    if (e.repeat) return;
    if (e.code === 'ArrowLeft' || e.code === 'KeyA') { e.preventDefault(); this.sort(0); }
    else if (e.code === 'ArrowRight' || e.code === 'KeyD') { e.preventDefault(); this.sort(1); }
  },
  inZone() {
    const el = performance.now() - this.t0;
    return this.items.findIndex((it, k) => !this.dec.has(k) && Math.abs(el - it.t) <= this.half + 60);
  },
  sort(b) {
    if (!this.items || !active || dead) return;
    send({ t: 'input', a: 'sort', b });
    const k = this.inZone();
    if (k >= 0) { this.dec.set(k, { b, at: performance.now() - this.t0 }); SFX.play(b === 0 ? 'whoosh' : 'bonk'); }
  },
  loop() {
    const cv = $('#fc'), c = cv.getContext('2d'), W = cv.width, ZX = 520, V = 70 / this.half, BY = 165;
    const draw = () => {
      this.raf = requestAnimationFrame(draw);
      const el = performance.now() - this.t0;
      c.fillStyle = '#14102e'; c.fillRect(0, 0, W, 300);
      // caisse (au-dessus) et four (en dessous) de la zone
      c.fillStyle = '#c98b4a'; c.strokeStyle = '#1b1440'; c.lineWidth = 3;
      c.fillRect(ZX - 55, 6, 110, 52); c.strokeRect(ZX - 55, 6, 110, 52);
      strokeText(c, '📦 CAISSE ➡', ZX, 38, '#fff', 15);
      const fl = c.createLinearGradient(0, 205, 0, 300); fl.addColorStop(0, '#ffd23f'); fl.addColorStop(0.5, '#ff9f1c'); fl.addColorStop(1, '#ff4d6d');
      c.fillStyle = fl; c.fillRect(ZX - 70, 205, 140, 95);
      for (let k = 0; k < 7; k++) { c.font = '24px serif'; c.textAlign = 'center'; c.fillText('🔥', ZX - 60 + k * 20, 295 - Math.abs(Math.sin(el / 120 + k)) * 16); }
      strokeText(c, '⬅ FOUR 🔥', ZX, 232, '#fff', 15);
      // tapis
      c.fillStyle = '#3a3166'; c.fillRect(0, BY, W, 24);
      c.fillStyle = '#58508f';
      const off = (el * V) % 30;
      for (let x = off - 30; x < W; x += 30) c.fillRect(x, BY + 4, 14, 16);
      const zk = this.inZone();
      c.strokeStyle = zk >= 0 ? '#ffd23f' : 'rgba(255,210,63,.45)'; c.lineWidth = zk >= 0 ? 5 : 3;
      c.setLineDash([8, 6]); c.strokeRect(ZX - 70, 70, 140, 128); c.setLineDash([]);
      this.items.forEach((it, k) => {
        let x = ZX + (el - it.t) * V, y = BY - 10;
        const d = this.dec.get(k);
        if (d) {
          const dt = el - d.at;
          x = ZX + (d.at - it.t) * V;
          y = d.b === 0 ? BY - 10 + dt * 0.4 : BY - 10 - dt * 0.4;
          if (y > 300 || y < 20) { if (this.res[k] !== undefined) strokeText(c, this.res[k] === 1 ? '✔' : '✖', ZX + 90, BY - 40, this.res[k] === 1 ? '#2ee59d' : '#ff4d6d', 26); return; }
        }
        if (x < -60 || x > W + 60) return;
        c.font = '46px serif'; c.textAlign = 'center'; c.fillText(it.e, x, y);
        if (!d) strokeText(c, it.n, x, y + 34 > BY + 40 ? BY + 44 : y - 52, '#fff', 12);
        if (!d && this.res[k] !== undefined) strokeText(c, this.res[k] === 2 ? '⏰ oublié' : this.res[k] === 1 ? '✔' : '✖', x, y - 52, this.res[k] === 1 ? '#2ee59d' : '#ff4d6d', 16);
      });
      const fnow = $('#fnow');
      if (fnow) fnow.textContent = zk >= 0 ? `Dans la zone : ${this.items[zk].e} ${this.items[zk].n} → ${this.items[zk].e === '🖼️' ? '⬅ FOUR' : '➡ CAISSE'} ?` : ' ';
    };
    draw();
  },
  stop() { cancelAnimationFrame(this.raf); },
};

// ── Sol instable ──
GAMES.floor = {
  init() {
    $('#stage').innerHTML = `<div class="ucturn" id="flt" style="margin-top:0">Prépare-toi…</div><div class="tbar" style="margin-bottom:10px"><div id="flbar" style="width:0"></div></div>
      <div class="screen-dark"><canvas id="flc" width="640" height="480"></canvas></div>${legend()}<p class="sub">Flèches / ZQSD pour bouger · ESPACE pour bousculer</p>`;
    mover(this, true);
    this.S = {}; this.tiles = null; this.holes = false; this.raf = null;
  },
  msg(m) {
    if (m.k === 'floor') { Object.assign(this, { W: m.w, H: m.h, C: m.c, R: m.r, T: m.tile, sym: m.sym, PR: m.pr }); this.loop(); }
    if (m.k === 'ph') { this.tiles = m.tiles; this.target = m.target; this.holes = false; $('#flt').innerHTML = `Va sur <span style="font-size:34px">${this.sym[m.target]}</span> !`; timerBar($('#flbar'), m.ms); SFX.play('ding'); }
    if (m.k === 'drop') { this.holes = true; $('#flt').textContent = '💥 EFFONDREMENT !'; SFX.play('boom'); }
    if (m.k === 'restore') this.holes = false;
    if (m.k === 'shove' && this.S.cur) { const q = this.S.cur.d.p[m.j]; fxText(this, q[0], q[1] - 20, 'POUSSÉ !', '#ff5fa2'); SFX.play('bonk'); }
    if (m.k === 's') { if (this.S.cur) m.p.forEach((p, i) => { if (!p[2] && this.S.cur.d.p[i][2]) legendSet(i, '💀'); }); pushSnap(this.S, m); }
  },
  loop() {
    const c = $('#flc').getContext('2d');
    const draw = () => {
      this.raf = requestAnimationFrame(draw);
      const S = this.S; if (!S.cur) return;
      const T = this.T;
      c.fillStyle = '#05030f'; c.fillRect(0, 0, this.W, this.H);
      for (let r = 0; r < this.R; r++) for (let k = 0; k < this.C; k++) {
        const id = r * this.C + k, v = this.tiles ? this.tiles[id] : 0;
        if (v === -1 || (this.holes && v !== this.target)) continue;
        const good = this.tiles && v === this.target;
        c.fillStyle = good ? '#fff3c4' : (r + k) % 2 ? '#b9b2d6' : '#cfc8ea';
        c.fillRect(k * T + 3, r * T + 3, T - 6, T - 6);
        c.strokeStyle = '#1b1440'; c.lineWidth = 3; c.strokeRect(k * T + 3, r * T + 3, T - 6, T - 6);
        if (this.tiles) { c.font = '30px serif'; c.textAlign = 'center'; c.globalAlpha = good ? 1 : 0.55; c.fillText(this.sym[v], k * T + T / 2, r * T + T / 2 + 11); c.globalAlpha = 1; }
      }
      drawPlayersAt(c, S, alphaOf(S), this.PR);
      drawFx(c, this);
    };
    draw();
  },
  stop() { cancelAnimationFrame(this.raf); },
};

// ── Pause clope ──
GAMES.smoke = {
  init() {
    $('#stage').innerHTML = `<div class="tbar" style="margin-bottom:14px"><div id="smbar" style="width:0"></div></div>
      <div style="display:flex;gap:30px;align-items:center;justify-content:center;flex-wrap:wrap">
        <div id="cig" style="font-size:80px;position:relative">🚬<div id="puffs" style="position:absolute;inset:0;pointer-events:none"></div></div>
        <div style="position:relative;width:70px;height:260px;border:4px solid #1b1440;border-radius:20px;background:#fff;overflow:hidden">
          <div id="zone" style="position:absolute;left:0;right:0;background:#2ee59d88"></div>
          <div id="lung" style="position:absolute;left:0;right:0;bottom:0;height:0;background:#b388ff;border-top:3px solid #1b1440"></div>
        </div>
        <div style="text-align:center"><div class="lvl" id="smcount">0 taffe</div><div class="ucturn" id="smst" style="margin:0">Maintiens ESPACE pour tirer</div></div>
      </div>${legend()}`;
    if (isTouch) $('#stage').appendChild(holdBtn('🚬 TIRER', () => this.down(), () => this.up()));
    this.state = 'idle'; this.fill = 1400; this.raf = null; this.mine = 0;
  },
  msg(m) {
    if (m.k === 'smoke') {
      this.fill = m.fill; this.lo = m.lo; this.hi = m.hi;
      $('#zone').style.bottom = m.lo + '%'; $('#zone').style.height = (m.hi - m.lo) + '%';
      timerBar($('#smbar'), m.ms); M.players.forEach((_, i) => legendSet(i, '0 🚬')); this.loop();
    }
    if (m.k === 'next') { this.fill = m.fill; this.state = 'idle'; $('#smst').textContent = 'Vas-y, tire !'; }
    if (m.k === 'cough') {
      legendSet(m.i, '🤧 KOF KOF');
      if (m.i === M.me) { this.state = 'cough'; $('#smst').textContent = '🤧 KOF KOF KOF… (2 s)'; shake($('#cig')); SFX.play('cough'); }
    }
    if (m.k === 'puff') {
      m.puffs.forEach((v, i) => legendSet(i, `${v} 🚬`));
      if (m.i === M.me) {
        this.mine = m.puffs[M.me]; this.state = 'out';
        $('#smcount').textContent = `${this.mine} taffe${this.mine > 1 ? 's' : ''}`;
        $('#smst').textContent = m.ok ? '😮‍💨 Parfait.' : m.lung < this.lo ? '😑 Trop court, gâché' : '😬 Limite…';
        if (m.ok) { const pf = document.createElement('span'); pf.textContent = '💨'; pf.style.cssText = 'position:absolute;left:70%;top:0;font-size:40px';
          $('#puffs').appendChild(pf); pf.animate([{ transform: 'translate(0,0) scale(.5)', opacity: 1 }, { transform: 'translate(40px,-90px) scale(2)', opacity: 0 }], { duration: 1200, fill: 'forwards' }).onfinish = () => pf.remove(); }
        $('#lung').style.height = '0%';
      }
    }
  },
  key(e) { if (e.code === 'Space') { e.preventDefault(); if (!e.repeat) this.down(); } },
  keyup(e) { if (e.code === 'Space') this.up(); },
  down() { if (this.state === 'cough') return; send({ t: 'input', a: 'in' }); if (this.state === 'idle') { this.state = 'in'; this.t = performance.now(); SFX.play('inhale'); } },
  up() { if (this.state !== 'in') return; send({ t: 'input', a: 'out' }); this.state = 'wait'; },
  loop() {
    const draw = () => {
      this.raf = requestAnimationFrame(draw);
      if (this.state === 'in') {
        const l = ((performance.now() - this.t) / this.fill) * 100;
        $('#lung').style.height = Math.min(100, l) + '%';
        $('#lung').style.background = l > this.hi ? '#ff4d6d' : l >= this.lo ? '#2ee59d' : '#b388ff';
      }
    };
    draw();
  },
  stop() { cancelAnimationFrame(this.raf); },
};

// ── Bonnes manières ──
GAMES.manners = {
  init() {
    $('#stage').innerHTML = `<div id="tonton" style="text-align:center;font-size:90px;line-height:1;height:110px;position:relative"><span id="tface">🧔‍♂️</span><span id="paper" style="position:absolute;left:50%;top:6px;transform:translateX(-50%);font-size:96px">📰</span></div>
      <div class="ucturn" id="mst">Tonton Gérard lit son journal…</div>
      <div class="uclist" id="plates"></div><p class="sub">Maintiens ESPACE pour manger · relâche quand il regarde</p>`;
    if (isTouch) $('#stage').appendChild(holdBtn('🍴 MANGER', () => this.down(), () => this.up()));
    this.eating = false; this.al = M.players.map(() => true);
  },
  plates(m) {
    $('#plates').innerHTML = M.players.map((p, i) => `<div class="ucp ${!m.al[i] ? 'out' : ''}">${pill(i)}
      <div class="bar"><div style="width:${m.pr[i]}%;background:${p.color}"></div></div><span style="font-size:24px">${!m.al[i] ? '⚰️' : m.pr[i] >= 100 ? '🏁' : m.e[i] ? '😋' : '🍝'}</span></div>`).join('');
  },
  msg(m) {
    if (m.k === 'table') this.plates({ pr: M.players.map(() => 0), e: [], al: this.al });
    if (m.k === 'ph') {
      const paper = $('#paper'), st = $('#mst');
      paper.getAnimations().forEach((x) => x.cancel());
      $('#tonton').style.filter = '';
      if (m.ph === 'read') { paper.style.display = ''; $('#tface').textContent = '🧔‍♂️'; st.textContent = 'Tonton Gérard lit son journal… mange !'; }
      if (m.ph === 'rustle') { paper.animate([{ transform: 'translateX(-50%) rotate(-6deg)' }, { transform: 'translateX(-50%) rotate(6deg)' }], { duration: 90, iterations: 20, direction: 'alternate' }); st.textContent = '*froisse froisse*'; SFX.play('gas'); }
      if (m.ph === 'look') { paper.style.display = 'none'; $('#tface').textContent = '😠🔫'; $('#tonton').style.filter = 'drop-shadow(0 0 12px #ff4d6d)'; st.textContent = '👀 IL REGARDE. NE BOUGE PLUS.'; }
    }
    if (m.k === 'bang') { SFX.play('gun'); shake($('#tonton')); }
    if (m.k === 's') this.plates(m);
  },
  key(e) { if (e.code === 'Space') { e.preventDefault(); if (!e.repeat) this.down(); } },
  keyup(e) { if (e.code === 'Space') this.up(); },
  blur() { this.up(); },
  down() { if (!this.eating) { this.eating = true; send({ t: 'input', a: 'eat' }); } },
  up() { if (this.eating) { this.eating = false; send({ t: 'input', a: 'stop' }); } },
};

// ── L'Araignée ──
GAMES.bomb = {
  init() {
    $('#stage').innerHTML = `<div class="ucturn" id="bst" style="margin-top:0"></div><div class="screen-dark"><canvas id="bc" width="800" height="500"></canvas></div>${legend()}
      <p class="sub">Flèches / ZQSD · touche quelqu'un pour lui refiler l'araignée</p>`;
    mover(this, false);
    this.S = {}; this.raf = null; this.booms = [];
  },
  msg(m) {
    if (m.k === 'bomb') { this.W = m.w; this.H = m.h; this.rects = m.rects; this.PR = m.pr; this.loop(); }
    if (m.k === 'arm' || m.k === 'pass') { $('#bst').innerHTML = m.i === M.me ? '🕷️ <b style="color:#ff4d6d">ELLE EST SUR TOI</b> — refile-la !' : `🕷️ L'araignée est sur ${pill(m.i)}`; SFX.play(m.k === 'pass' ? 'bonk' : 'ding'); }
    if (m.k === 'boom') { this.booms.push({ x: m.x, y: m.y, t: performance.now() }); SFX.play('boom'); legendSet(m.i, '💀'); $('#bst').textContent = '💥 BOUM.'; }
    if (m.k === 's') pushSnap(this.S, m);
  },
  loop() {
    const c = $('#bc').getContext('2d');
    const draw = () => {
      this.raf = requestAnimationFrame(draw);
      const S = this.S; if (!S.cur) return;
      const a = alphaOf(S), B = S.cur.d, now = performance.now();
      c.fillStyle = '#2a2060'; c.fillRect(0, 0, this.W, this.H);
      c.strokeStyle = 'rgba(255,255,255,.06)'; c.lineWidth = 1;
      for (let x = 0; x < this.W; x += 50) { c.beginPath(); c.moveTo(x, 0); c.lineTo(x, this.H); c.stroke(); }
      for (let y = 0; y < this.H; y += 50) { c.beginPath(); c.moveTo(0, y); c.lineTo(this.W, y); c.stroke(); }
      this.rects.forEach(([x, y, w, h]) => {
        c.fillStyle = '#c98b4a'; c.fillRect(x, y, w, h); c.strokeStyle = '#1b1440'; c.lineWidth = 3; c.strokeRect(x, y, w, h);
        c.beginPath(); c.moveTo(x, y); c.lineTo(x + w, y + h); c.moveTo(x + w, y); c.lineTo(x, y + h); c.stroke();
      });
      drawPlayersAt(c, S, a, this.PR, 0, (i, x, y) => {
        if (i !== B.h) return;
        const pulse = 1 + 0.15 * Math.sin(now / (B.f <= 3 ? 60 : 160));
        c.strokeStyle = '#ff4d6d'; c.lineWidth = 4; c.beginPath(); c.arc(x, y, (this.PR + 12) * pulse, 0, 7); c.stroke();
        c.font = '26px serif'; c.textAlign = 'center'; c.fillText('🕷️', x, y - 30);
        strokeText(c, String(B.f), x + 24, y - 30, B.f <= 3 ? '#ff4d6d' : '#ffd23f', 20);
      });
      this.booms = this.booms.filter((b) => now - b.t < 700);
      this.booms.forEach((b) => { const k = (now - b.t) / 700; c.globalAlpha = 1 - k; c.fillStyle = '#ff9f1c'; c.beginPath(); c.arc(b.x, b.y, 20 + k * 120, 0, 7); c.fill(); c.globalAlpha = 1; });
    };
    draw();
  },
  stop() { cancelAnimationFrame(this.raf); },
};

// ── Champ de mines ──
GAMES.mines = {
  init() {
    $('#stage').innerHTML = `<div class="screen-dark"><canvas id="mc" width="820" height="420"></canvas></div>${legend()}
      <p class="sub">Flèches / ZQSD · reste immobile 1 s pour détecter les mines · ESPACE pour bousculer</p>`;
    mover(this, true);
    this.S = {}; this.raf = null; this.known = new Map(); this.craters = []; this.booms = [];
  },
  msg(m) {
    if (m.k === 'mines') { this.L = m.l; this.H = m.h; this.PR = m.pr; this.loop(); }
    if (m.k === 'rev') { m.m.forEach(([k, x, y]) => this.known.set(k, [x, y])); SFX.play('ping'); }
    if (m.k === 'boom') { this.known.delete(m.m); this.craters.push([m.x, m.y]); this.booms.push({ x: m.x, y: m.y, t: performance.now() }); SFX.play('boom'); }
    if (m.k === 'shove' && this.S.cur) { const q = this.S.cur.d.p[m.j]; fxText(this, q[0], q[1] - 20, 'POUSSÉ !', '#ff5fa2'); SFX.play('bonk'); }
    if (m.k === 's') { if (this.S.cur) m.p.forEach((p, i) => { if (!p[2] && this.S.cur.d.p[i][2]) legendSet(i, '💀'); }); pushSnap(this.S, m); }
  },
  loop() {
    const cv = $('#mc'), c = cv.getContext('2d'), W = cv.width;
    const draw = () => {
      this.raf = requestAnimationFrame(draw);
      const S = this.S; if (!S.cur) return;
      const a = alphaOf(S), A = S.prev.d, B = S.cur.d, now = performance.now();
      let cam = B.p[M.me];
      if (!cam[2]) cam = B.p.find((p) => p[2]) || cam;
      const camX = Math.max(0, Math.min(this.L - W, cam[0] - W / 3));
      c.fillStyle = '#6b4f2a'; c.fillRect(0, 0, W, this.H);
      c.fillStyle = 'rgba(0,0,0,.12)';
      for (let x = -(camX % 60); x < W; x += 60) for (let y = 15; y < this.H; y += 60) { c.beginPath(); c.arc(x + ((y / 60) % 2) * 30, y, 6, 0, 7); c.fill(); }
      this.craters.forEach(([x, y]) => { c.fillStyle = '#2b1d0e'; c.beginPath(); c.ellipse(x - camX, y, 26, 18, 0, 0, 7); c.fill(); });
      this.known.forEach(([x, y]) => { c.font = '22px serif'; c.textAlign = 'center'; c.fillText('💣', x - camX, y + 8); c.strokeStyle = 'rgba(255,77,109,.7)'; c.lineWidth = 2; c.beginPath(); c.arc(x - camX, y, 16, 0, 7); c.stroke(); });
      const fx = this.L - 30 - camX;
      for (let k = 0; k < this.H / 14; k++) { c.fillStyle = k % 2 ? '#fff' : '#1b1440'; c.fillRect(fx, k * 14, 10, 14); }
      // moissonneuse
      const hv = lerp(A.hv, B.hv, a) - camX;
      if (hv > -60) {
        c.fillStyle = '#ff4d6d'; c.fillRect(0, 0, Math.max(0, hv), this.H);
        for (let y = 0; y < this.H; y += 40) sawblade(c, hv + 10, y + 20, 18, now / 60 + y);
        c.font = '50px serif'; c.textAlign = 'center'; c.fillText('🚜', Math.max(30, hv - 30), this.H / 2 + 16);
      }
      // sonar
      B.p.forEach((p, i) => {
        if (!p[2] || !B.st[i] || i !== M.me) return;
        const k = (now % 900) / 900;
        c.strokeStyle = `rgba(61,214,255,${1 - k})`; c.lineWidth = 3; c.beginPath(); c.arc(p[0] - camX, p[1], 20 + k * 130, 0, 7); c.stroke();
      });
      drawPlayersAt(c, S, a, this.PR, camX);
      this.booms = this.booms.filter((b) => now - b.t < 700);
      this.booms.forEach((b) => { const k = (now - b.t) / 700; c.globalAlpha = 1 - k; c.fillStyle = '#ffd23f'; c.beginPath(); c.arc(b.x - camX, b.y, 15 + k * 60, 0, 7); c.fill(); c.globalAlpha = 1; });
      drawFx(c, this, camX);
      // mini-carte
      c.fillStyle = 'rgba(255,255,255,.85)'; c.fillRect(20, 8, W - 40, 6);
      B.p.forEach((p, i) => { c.fillStyle = P(i).color; c.beginPath(); c.arc(20 + (W - 40) * p[0] / this.L, 11, 5, 0, 7); c.fill(); });
      c.fillStyle = '#ff4d6d'; c.fillRect(20, 6, Math.max(0, (W - 40) * Math.max(0, B.hv) / this.L), 10);
    };
    draw();
  },
  stop() { cancelAnimationFrame(this.raf); },
};

// ── Tron ──
GAMES.tron = {
  init() {
    $('#stage').innerHTML = `<div class="screen-dark" style="position:relative"><canvas id="tc"></canvas>
      <canvas id="tco" style="position:absolute;left:8px;top:8px;width:calc(100% - 16px);height:calc(100% - 16px);pointer-events:none"></canvas></div>
      ${legend()}<p class="sub">Flèches ou ZQSD · tu es la tête avec l'anneau blanc qui clignote</p>`;
    $('#stage').appendChild(dpad((d) => send({ t: 'input', a: 'dir', d })));
    this.C = 14; this.prev = null; this.heads = null; this.dead = new Set(); this.raf = null; this.started = false;
  },
  cell(x, y, color, glow, mine) {
    const C = this.C, c = this.ctx;
    c.save();
    if (glow) { c.shadowColor = color; c.shadowBlur = 10; }
    c.fillStyle = color; c.fillRect(x * C + 1, y * C + 1, C - 2, C - 2);
    if (mine) { c.shadowBlur = 0; c.strokeStyle = '#fff'; c.lineWidth = 2; c.strokeRect(x * C + 2, y * C + 2, C - 4, C - 4); }
    c.restore();
  },
  msg(m) {
    const C = this.C;
    if (m.k === 'tron') {
      const cv = $('#tc'); cv.width = m.w * C; cv.height = m.h * C;
      const ov = $('#tco'); ov.width = cv.width; ov.height = cv.height;
      this.w = m.w; this.h = m.h;
      const c = this.ctx = cv.getContext('2d');
      c.fillStyle = '#14102e'; c.fillRect(0, 0, cv.width, cv.height);
      c.strokeStyle = 'rgba(179,136,255,.08)'; c.lineWidth = 1;
      for (let x = 0; x <= m.w; x++) { c.beginPath(); c.moveTo(x * C + 0.5, 0); c.lineTo(x * C + 0.5, cv.height); c.stroke(); }
      for (let y = 0; y <= m.h; y++) { c.beginPath(); c.moveTo(0, y * C + 0.5); c.lineTo(cv.width, y * C + 0.5); c.stroke(); }
      m.heads.forEach(([x, y], i) => this.cell(x, y, P(i).color, true, i === M.me));
      this.prev = m.heads; this.heads = m.heads;
      this.loop();
    }
    if (m.k === 'tick') {
      this.started = true;
      if (this.prev) this.prev.forEach((h, i) => { if (h) this.cell(h[0], h[1], P(i).color, true, i === M.me); });
      m.h.forEach((h, i) => {
        if (!h) return;
        if (m.d.includes(i)) {
          this.dead.add(i);
          const c = this.ctx;
          c.font = `${C * 2.4}px serif`; c.textAlign = 'center'; c.fillText('💥', h[0] * C + C / 2, h[1] * C + C);
          legendSet(i, '💀');
        } else this.cell(h[0], h[1], '#ffffff', false);
      });
      this.prev = m.h.map((h, i) => (h && !m.d.includes(i) ? h : null));
      this.heads = this.prev;
    }
  },
  // calque redessiné à chaque image : avatars sur les têtes + gros repère clignotant sur toi
  loop() {
    const ov = $('#tco'), c = ov.getContext('2d'), C = this.C;
    const draw = () => {
      this.raf = requestAnimationFrame(draw);
      c.clearRect(0, 0, ov.width, ov.height);
      if (!this.heads) return;
      const now = performance.now();
      this.heads.forEach((h, i) => {
        if (!h || this.dead.has(i)) return;
        const x = h[0] * C + C / 2, y = h[1] * C + C / 2;
        if (i === M.me) {
          const r = C * (1.6 + 0.5 * Math.sin(now / 120));
          c.strokeStyle = '#fff'; c.lineWidth = 3; c.beginPath(); c.arc(x, y, r, 0, 7); c.stroke();
          c.strokeStyle = P(i).color; c.lineWidth = 2; c.beginPath(); c.arc(x, y, r + 4, 0, 7); c.stroke();
          const ly = y - C * 3.2 < 14 ? y + C * 3.6 : y - C * 3.2;
          strokeText(c, '▼ TOI ▼', x, ly, '#fff', this.started ? 13 : 18);
          if (!this.started) {
            const dir = h[0] < this.w * 0.2 ? '➡' : h[0] > this.w * 0.8 ? '⬅' : h[1] < this.h * 0.2 ? '⬇' : '⬆';
            strokeText(c, dir, x + (dir === '➡' ? C * 2.5 : dir === '⬅' ? -C * 2.5 : 0), y + (dir === '⬇' ? C * 2.8 : dir === '⬆' ? -C * 1.8 : 6), '#ffd23f', 26);
          }
        }
        c.font = `${C * 1.3}px serif`; c.textAlign = 'center';
        c.fillText(P(i).avatar, x, y - C * 0.9);
      });
    };
    draw();
  },
  stop() { cancelAnimationFrame(this.raf); },
  key(e) { const d = DIRK[e.code]; if (d) { e.preventDefault(); send({ t: 'input', a: 'dir', d }); } },
};

// ── Mémoire ──
GAMES.memory = {
  init() {
    $('#stage').innerHTML = `<div class="lvl" id="mlvl">Niveau 1</div><div class="tbar" style="margin-bottom:12px;max-width:360px"><div id="mbar" style="width:0"></div></div>
      <div class="mgrid" id="mg">${range(25).map((c) => `<button data-c="${c}"></button>`).join('')}</div>
      <p class="sub" id="minfo"></p>${legend()}`;
    this.phase = 'idle'; this.alive = M.players.map(() => true); this.doneMe = false; this.timers = []; this.len = 0;
    $('#mg').addEventListener('pointerdown', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      if (this.phase !== 'input' || dead || this.doneMe) return;
      send({ t: 'input', a: 'tap', c: +b.dataset.c });
    });
  },
  btns() { return document.querySelectorAll('#mg button'); },
  flash(c, cls, ms, txt) {
    const b = this.btns()[c]; if (!b) return;
    b.classList.add(cls); if (txt) b.textContent = txt;
    this.timers.push(setTimeout(() => { b.classList.remove(cls); b.textContent = ''; }, ms));
  },
  msg(m) {
    if (m.k === 'show') {
      this.stop();
      this.phase = 'show'; this.doneMe = false; this.alive = m.alive;
      $('#mlvl').textContent = `Niveau ${m.level} · séquence de ${m.seq.length}`;
      this.btns().forEach((b) => { b.className = ''; b.textContent = ''; });
      $('#minfo').textContent = "👀 Regarde bien l'ordre…";
      $('#mg').classList.toggle('off', !m.alive[M.me]);
      $('#mbar').style.width = '0';
      m.seq.forEach((c, k) => this.timers.push(setTimeout(() => { this.flash(c, 'lit', m.on, '⭐'); SFX.play('tick'); }, k * (m.on + m.off))));
      this.legend();
    }
    if (m.k === 'input') {
      this.phase = 'input'; this.len = m.len;
      $('#minfo').textContent = dead ? '👻 Tu regardes…' : `👆 À toi, dans l'ordre ! (0 / ${m.len})`;
      timerBar($('#mbar'), m.ms);
    }
    if (m.k === 'ok') { this.flash(m.c, 'ok', 260, '✔'); SFX.play('ok'); if (!this.doneMe) $('#minfo').textContent = `👆 Dans l'ordre ! (${m.p} / ${this.len})`; }
    if (m.k === 'bad') { this.flash(m.c, 'bad', 1500, '✖'); SFX.play('bad'); }
    if (m.k === 'st') {
      this.alive = m.alive;
      if (m.done[M.me] && !this.doneMe) { this.doneMe = true; $('#minfo').textContent = '✅ Parfait ! On attend les autres…'; }
      this.legend(m.done);
    }
  },
  legend(done) { M.players.forEach((_, i) => legendSet(i, !this.alive[i] ? '💀' : done && done[i] ? '✅' : '')); },
  stop() { (this.timers || []).forEach(clearTimeout); this.timers = []; },
};

// ── Esquive ──
GAMES.dodge = {
  init() {
    $('#stage').innerHTML = `<div class="screen-dark"><canvas id="dc" width="800" height="500"></canvas></div>${legend()}<p class="sub">Flèches ou ZQSD · ESPACE pour bousculer · contour blanc = toi · les scies en pointillés ne coupent pas encore</p>`;
    this.S = {}; this.raf = null;
    mover(this, true);
  },
  msg(m) {
    if (m.k === 'dodge') { this.W = m.w; this.H = m.h; this.PR = m.pr; this.loop(); }
    if (m.k === 'shove' && this.S.cur) { const q = this.S.cur.d.p[m.j]; fxText(this, q[0], q[1] - 20, 'POUSSÉ !', '#ff5fa2'); SFX.play('bonk'); }
    if (m.k === 's') {
      const before = this.S.cur ? this.S.cur.d.p : null;
      pushSnap(this.S, m);
      if (before) m.p.forEach((p, i) => { if (!p[2] && before[i][2]) legendSet(i, '💀'); });
    }
  },
  loop() {
    const c = $('#dc').getContext('2d');
    const bg = c.createRadialGradient(400, 250, 40, 400, 250, 500);
    bg.addColorStop(0, '#2a2060'); bg.addColorStop(1, '#14102e');
    const draw = () => {
      this.raf = requestAnimationFrame(draw);
      const S = this.S; if (!S.cur) return;
      const a = alphaOf(S), A = S.prev.d, B = S.cur.d, W = this.W, H = this.H, PR = this.PR;
      c.fillStyle = bg; c.fillRect(0, 0, W, H);
      c.fillStyle = 'rgba(255,255,255,.07)';
      for (let x = 20; x < W; x += 40) for (let y = 20; y < H; y += 40) { c.beginPath(); c.arc(x, y, 2, 0, 7); c.fill(); }
      B.l.forEach((L, k) => {
        const ang = A.l[k] ? lerp(A.l[k][0], L[0], a) : L[0];
        const ex = W / 2 + Math.cos(ang) * 1000, ey = H / 2 + Math.sin(ang) * 1000;
        c.save();
        if (L[1]) {
          c.shadowColor = '#ff4d6d'; c.shadowBlur = 24;
          c.strokeStyle = '#ff4d6d'; c.lineWidth = 10; c.beginPath(); c.moveTo(W / 2, H / 2); c.lineTo(ex, ey); c.stroke();
          c.strokeStyle = '#fff'; c.lineWidth = 3; c.beginPath(); c.moveTo(W / 2, H / 2); c.lineTo(ex, ey); c.stroke();
        } else {
          c.strokeStyle = 'rgba(255,77,109,.6)'; c.lineWidth = 3; c.setLineDash([12, 10]);
          c.beginPath(); c.moveTo(W / 2, H / 2); c.lineTo(ex, ey); c.stroke();
        }
        c.restore();
      });
      c.font = '26px serif'; c.textAlign = 'center'; c.fillText('👁️', W / 2, H / 2 + 9);
      B.b.forEach((b, k) => {
        const pb = A.b[k] || b;
        const x = lerp(pb[0], b[0], a), y = lerp(pb[1], b[1], a), r = b[2];
        c.beginPath(); c.arc(x, y, r, 0, 7);
        if (b[3]) { c.strokeStyle = 'rgba(255,255,255,.6)'; c.setLineDash([5, 5]); c.lineWidth = 2; c.stroke(); c.setLineDash([]); return; }
        sawblade(c, x, y, r, performance.now() / 90 + k);
      });
      B.p.forEach((p, i) => {
        const pp = A.p[i] || p;
        const x = lerp(pp[0], p[0], a), y = lerp(pp[1], p[1], a);
        if (!p[2]) { c.font = '24px serif'; c.textAlign = 'center'; c.fillText('💀', x, y + 8); return; }
        c.beginPath(); c.arc(x, y, PR + 4, 0, 7); c.fillStyle = P(i).color; c.fill();
        c.lineWidth = 3; c.strokeStyle = i === M.me ? '#fff' : '#1b1440'; c.stroke();
        c.font = '16px serif'; c.textAlign = 'center'; c.fillText(P(i).avatar, x, y + 6);
        strokeText(c, P(i).name, x, y - PR - 9, P(i).color, 12);
      });
      drawFx(c, this);
      strokeText(c, `⏱ ${B.tm.toFixed(1)} s`, 52, 28, '#fff', 18);
    };
    draw();
  },
  stop() { cancelAnimationFrame(this.raf); this.raf = null; },
};

// ── Course de haies ──
GAMES.race = {
  init() {
    const n = M.players.length;
    this.LH = 66;
    $('#stage').innerHTML = `<div class="screen-dark" style="background:#7fd3ff"><canvas id="rc" width="820" height="${50 + n * this.LH}"></canvas></div>
      <p class="sub">Alterne ⬅ ➡ (ou Q / D) pour courir · ⬆ / Z / Espace pour sauter</p>`;
    this.S = {}; this.raf = null;
    if (isTouch) {
      const pad = document.createElement('div'); pad.className = 'runpad';
      pad.innerHTML = '<button class="btn white" data-k="l">⬅</button><button class="btn" data-k="j">⬆</button><button class="btn white" data-k="r">➡</button>';
      pad.querySelectorAll('button').forEach((b) => b.addEventListener('pointerdown', (e) => {
        e.preventDefault(); if (!active || dead) return;
        if (b.dataset.k === 'j') send({ t: 'input', a: 'jump' }); else send({ t: 'input', a: 'run', k: b.dataset.k });
      }));
      $('#stage').appendChild(pad);
    }
  },
  key(e) {
    if (e.repeat) return;
    if (e.code === 'ArrowLeft' || e.code === 'KeyA') { e.preventDefault(); send({ t: 'input', a: 'run', k: 'l' }); }
    else if (e.code === 'ArrowRight' || e.code === 'KeyD') { e.preventDefault(); send({ t: 'input', a: 'run', k: 'r' }); }
    else if (e.code === 'ArrowUp' || e.code === 'KeyW' || e.code === 'Space') { e.preventDefault(); send({ t: 'input', a: 'jump' }); }
  },
  msg(m) {
    if (m.k === 'race') { this.L = m.L; this.hurdles = m.hurdles; this.loop(); }
    if (m.k === 's') pushSnap(this.S, m);
  },
  loop() {
    const cv = $('#rc'), c = cv.getContext('2d'), LH = this.LH;
    const draw = () => {
      this.raf = requestAnimationFrame(draw);
      const S = this.S; if (!S.cur) return;
      const a = alphaOf(S), A = S.prev.d.r, B = S.cur.d.r, Wc = cv.width, L = this.L;
      const xs = B.map((r, i) => lerp(A[i][0], r[0], a));
      const ys = B.map((r, i) => lerp(A[i][1], r[1], a));
      const viewX = xs[M.me] - 220;
      // ciel + nuages
      c.fillStyle = '#7fd3ff'; c.fillRect(0, 0, Wc, 50);
      c.fillStyle = 'rgba(255,255,255,.9)';
      for (let k = 0; k < 6; k++) { const cx = ((k * 260 - viewX * 0.2) % 1560 + 1560) % 1560 - 100; c.beginPath(); c.arc(cx, 22, 12, 0, 7); c.arc(cx + 14, 16, 15, 0, 7); c.arc(cx + 30, 22, 11, 0, 7); c.fill(); }
      // mini-carte
      c.fillStyle = '#fff'; c.strokeStyle = '#1b1440'; c.lineWidth = 2.5;
      c.beginPath(); c.roundRect(20, 32, Wc - 40, 10, 5); c.fill(); c.stroke();
      c.font = '16px serif'; c.textAlign = 'center'; c.fillText('🏁', Wc - 22, 30);
      B.forEach((r, i) => { const mx = 20 + (Wc - 40) * Math.min(1, xs[i] / L); c.font = (i === M.me ? 20 : 15) + 'px serif'; c.fillText(P(i).avatar, mx, 46); });
      B.forEach((r, i) => {
        const y0 = 50 + i * LH, gy = y0 + LH - 12;
        c.fillStyle = i % 2 ? '#e0673e' : '#e8744a'; c.fillRect(0, y0, Wc, LH);
        c.fillStyle = '#fff'; c.fillRect(0, y0, Wc, 2);
        c.fillStyle = 'rgba(255,255,255,.25)';
        for (let k = Math.floor(viewX / 120) * 120; k < viewX + Wc; k += 120) c.fillRect(k - viewX, gy + 4, 40, 3);
        this.hurdles.forEach((h) => {
          const sx = h - viewX; if (sx < -20 || sx > Wc + 20) return;
          c.fillStyle = '#1b1440'; c.fillRect(sx - 2, gy - 30, 4, 30); c.fillRect(sx + 12, gy - 30, 4, 30);
          c.fillStyle = '#fff'; c.strokeStyle = '#1b1440'; c.lineWidth = 2;
          c.beginPath(); c.rect(sx - 5, gy - 34, 24, 8); c.fill(); c.stroke();
          c.fillStyle = '#ff4d6d'; c.fillRect(sx + 3, gy - 33, 8, 6);
        });
        const fx = L - viewX;
        if (fx > -20 && fx < Wc + 20) for (let k = 0; k < (LH - 2) / 8; k++) for (let j = 0; j < 2; j++) { c.fillStyle = (k + j) % 2 ? '#fff' : '#1b1440'; c.fillRect(fx + j * 8, y0 + 2 + k * 8, 8, 8); }
        let sx = xs[i] - viewX;
        const off = sx < 10 ? 'left' : sx > Wc - 10 ? 'right' : null;
        sx = Math.max(16, Math.min(Wc - 16, sx));
        const jy = ys[i] * 0.33;
        const hop = jy ? 0 : Math.abs(Math.sin(xs[i] / 14)) * 5;
        c.fillStyle = 'rgba(27,20,64,.3)'; c.beginPath(); c.ellipse(sx, gy, 14 - jy / 6, 4, 0, 0, 7); c.fill();
        c.font = '30px serif'; c.textAlign = 'center'; c.fillText(P(i).avatar, sx, gy - 6 - jy - hop);
        if (i === M.me) { c.strokeStyle = '#fff'; c.lineWidth = 3; c.beginPath(); c.arc(sx, gy - 16 - jy - hop, 20, 0, 7); c.stroke(); }
        if (B[i][2]) { c.font = '20px serif'; c.fillText('💫', sx, gy - 40 - jy); }
        if (off) strokeText(c, off === 'left' ? '◀' : '▶', off === 'left' ? 8 : Wc - 8, gy - 18, '#fff', 16);
        c.textAlign = 'left'; c.font = '800 13px Nunito, system-ui'; c.lineWidth = 3; c.strokeStyle = '#1b1440';
        const lbl = P(i).name + (i === M.me ? ' (toi)' : '') + (xs[i] >= L ? ' 🏁' : '');
        c.strokeText(lbl, 8, y0 + 17); c.fillStyle = P(i).color; c.fillText(lbl, 8, y0 + 17);
      });
    };
    draw();
  },
  stop() { cancelAnimationFrame(this.raf); this.raf = null; },
};

// ── Undercover (groupe et 1v1) ──
GAMES.undercover = {
  init() {
    $('#stage').innerHTML = `<div class="secret" id="ucw"><span>Distribution des mots…</span></div>
      <div class="ucturn" id="uct"></div><div class="tbar"><div id="ucbar" style="width:0"></div></div>
      <div class="ucin hidden" id="ucin"><input id="ucclue" maxlength="20" placeholder="Un seul mot…" autocomplete="off">
        <button class="btn blue" id="ucsend">💬 Indice</button><button class="btn pink hidden" id="ucguess">🎯 Deviner son mot</button></div>
      <div class="uclist" id="ucl"></div><p class="sub" id="ucsub">Débattez en vocal avant de voter !</p>`;
    const n = M.players.length;
    this.alive = range(n).map(() => true); this.said = range(n).map(() => []); this.roles = {};
    this.phase = 'idle'; this.speaking = null; this.voted = new Set(); this.myVote = null; this.tally = null; this.duel = false; this.lives = [2, 2];
    const go = (a) => { const v = $('#ucclue').value.trim(); if (v) send({ t: 'input', a, text: v }); };
    $('#ucsend').onclick = () => go('clue');
    $('#ucguess').onclick = () => go('guess');
    $('#ucclue').addEventListener('keydown', (e) => { if (e.key === 'Enter') go('clue'); });
    $('#ucl').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-v]'); if (!b || this.phase !== 'vote') return;
      this.myVote = +b.dataset.v; send({ t: 'input', a: 'vote', target: this.myVote }); this.render();
    });
    this.render();
  },
  msg(m) {
    switch (m.k) {
      case 'word':
        this.duel = !!m.duel;
        this.word = m.word;
        this.wordNote = this.duel
          ? "Ton adversaire a un mot proche du tien. Trouve-le avant qu'il trouve le tien !"
          : `${m.nu > 1 ? m.nu + ' undercovers' : '1 undercover'} dans la partie… c'est peut-être toi 😏`;
        this.renderWord();
        $('#uct').textContent = 'Lisez bien vos mots…';
        $('#ucsub').textContent = this.duel ? 'À ton tour : un indice OU une tentative (2 essais max). Attention, tes indices l\'aident aussi !' : 'Débattez en vocal avant de voter !';
        $('#ucguess').classList.toggle('hidden', !this.duel);
        if (m.lives) this.lives = m.lives;
        this.render();
        break;
      case 'turn':
        this.phase = 'clue'; this.speaking = m.i; this.tally = null;
        $('#uct').innerHTML = m.i === M.me ? (this.duel ? '🎤 À toi ! Un indice… ou tu tentes ta chance ?' : '🎤 À toi de donner un indice !') : `🎤 ${pill(m.i)} réfléchit…`;
        timerBar($('#ucbar'), m.ms);
        $('#ucin').classList.toggle('hidden', m.i !== M.me);
        if (m.i === M.me) { $('#ucclue').value = ''; $('#ucclue').focus(); SFX.play('ding'); }
        this.render();
        break;
      case 'clue':
        this.said[m.i].push({ t: m.text });
        if (m.i === M.me) $('#ucin').classList.add('hidden');
        this.render();
        break;
      case 'guess':
        this.said[m.i].push({ t: '🎯 ' + m.text, c: m.ok ? 'good' : 'bad' });
        this.lives = m.lives;
        if (m.i === M.me) $('#ucin').classList.add('hidden');
        $('#uct').innerHTML = m.ok ? `🎯 ${pill(m.i)} a TROUVÉ !` : `❌ ${pill(m.i)} se plante : « ${esc(m.text)} »`;
        SFX.play(m.ok ? 'win' : 'bad');
        this.render();
        break;
      case 'nope':
        $('#uct').textContent = '⛔ ' + m.msg; shake($('#ucin')); SFX.play('bad');
        break;
      case 'vote':
        this.phase = 'vote'; this.speaking = null; this.voted = new Set(); this.myVote = null;
        $('#uct').textContent = this.alive[M.me] ? "🗳️ Votez pour éliminer l'intrus !" : '🗳️ Les survivants votent…';
        $('#ucin').classList.add('hidden');
        timerBar($('#ucbar'), m.ms);
        this.render();
        break;
      case 'voted': this.voted = new Set(m.who); this.render(); break;
      case 'out':
        this.phase = 'reveal'; this.alive[m.i] = false; this.roles[m.i] = m; this.tally = m.tally;
        $('#uct').innerHTML = `${pill(m.i)} est éliminé·e${m.tie ? ' (égalité → tirage au sort)' : ''} : ${m.role === 'undercover' ? '🕵️ UNDERCOVER !' : '😇 civil'} — son mot : « ${esc(m.word)} »`;
        timerBar($('#ucbar'), 1);
        this.render();
        break;
    }
  },
  renderWord() {
    let hidden = false;
    try { hidden = localStorage.getItem('clutch-uc-hide') === '1'; } catch {}
    $('#ucw').innerHTML = `<span>Ton mot secret</span><b>${hidden ? '••••••' : esc(this.word)}</b><span>${esc(this.wordNote)}</span>
      <div style="margin-top:8px"><button class="btn sm white" id="uchide">${hidden ? '👁️ Afficher mon mot' : '🙈 Cacher mon mot'}</button></div>`;
    $('#uchide').onclick = () => {
      try { localStorage.setItem('clutch-uc-hide', hidden ? '0' : '1'); } catch {}
      this.renderWord();
    };
  },
  render() {
    const el = $('#ucl'); if (!el) return;
    const canVote = this.phase === 'vote' && this.alive[M.me];
    el.innerHTML = M.players.map((p, i) => {
      const role = this.roles[i];
      let right = '';
      if (this.duel) right = `<span class="lives">${'❤️'.repeat(Math.max(0, this.lives[i]))}${'🖤'.repeat(Math.max(0, 2 - this.lives[i]))}</span>`;
      else if (role) right = role.role === 'undercover' ? '🕵️' : '😇';
      else if (canVote && i !== M.me && this.alive[i]) right = `<button class="btn sm ${this.myVote === i ? 'pink' : 'white'}" data-v="${i}">${this.myVote === i ? '✔ Voté' : '👉 Lui !'}</button>`;
      if (this.tally && this.tally[i]) right += ` <span class="mut">${this.tally[i]} vote${this.tally[i] > 1 ? 's' : ''}</span>`;
      if (this.phase === 'vote' && this.voted.has(i)) right += ' 🗳️';
      return `<div class="ucp ${!this.alive[i] ? 'out' : ''} ${this.speaking === i ? 'speaking' : ''}">${pill(i)}
        <span class="bubbles">${this.said[i].map((c) => `<span class="bubble ${c.c || ''}">${esc(c.t)}</span>`).join('')}</span><span>${right}</span></div>`;
    }).join('');
  },
};

// ════════════════ accueil / salon ════════════════
const params = new URLSearchParams(location.search);
if (params.get('code')) $('#code').value = params.get('code').toUpperCase();
try { $('#name').value = localStorage.getItem('clutch-name') || ''; } catch {}
setAvatar(myAvatar);
$('#avBig').onclick = () => $('#avGrid').classList.toggle('hidden');
$('#btnMute').textContent = SFX.muted ? '🔇' : '🔊';
$('#btnMute').onclick = () => { $('#btnMute').textContent = SFX.toggle() ? '🔇' : '🔊'; };

function getName() {
  const n = $('#name').value.trim();
  if (!n) { $('#homeErr').textContent = 'Choisis un pseudo 😉'; $('#name').focus(); shake($('#name')); return null; }
  try { localStorage.setItem('clutch-name', n); } catch {}
  SFX.unlock();
  return n;
}
$('#btnCreate').onclick = () => {
  const name = getName(); if (!name) return;
  $('#homeErr').textContent = '';
  connect(() => send({ t: 'create', name, avatar: myAvatar }));
};
$('#btnJoin').onclick = () => {
  const name = getName(); if (!name) return;
  const code = $('#code').value.trim().toUpperCase();
  if (code.length !== 4) { $('#homeErr').textContent = 'Le code fait 4 lettres.'; return; }
  $('#homeErr').textContent = '';
  connect(() => send({ t: 'join', code, name, avatar: myAvatar }));
};
$('#code').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#btnJoin').click(); });
$('#name').addEventListener('keydown', (e) => { if (e.key === 'Enter') ($('#code').value.trim() ? $('#btnJoin') : $('#btnCreate')).click(); });

const isHost = () => room && room.you === room.host;
$('#modes').addEventListener('click', (e) => { const b = e.target.closest('[data-mode]'); if (b && isHost()) send({ t: 'cfg', mode: b.dataset.mode }); });
$('#rounds').addEventListener('click', (e) => { const b = e.target.closest('[data-r]'); if (b && isHost()) send({ t: 'cfg', rounds: +b.dataset.r }); });
$('#gamesList').addEventListener('click', (e) => { const b = e.target.closest('[data-game]'); if (b && isHost()) send({ t: 'cfg', game: b.dataset.game }); });
$('#teams').addEventListener('click', (e) => { const b = e.target.closest('[data-team]'); if (b) send({ t: 'team', team: +b.dataset.team }); });
$('#btnStart').onclick = () => { SFX.unlock(); send({ t: 'start' }); };
$('#btnCopy').onclick = async () => {
  const link = location.origin + '/?code=' + room.code;
  try { await navigator.clipboard.writeText(link); $('#btnCopy').textContent = '✅ Lien copié !'; }
  catch { $('#btnCopy').textContent = link; }
  setTimeout(() => { $('#btnCopy').textContent = "📋 Copier le lien d'invitation"; }, 2000);
};
document.addEventListener('pointerdown', () => SFX.unlock(), { once: true });
