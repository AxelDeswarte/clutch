// CLUTCH — client
'use strict';
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ARROW = { up: '⬆', down: '⬇', left: '⬅', right: '➡' };
// e.code = touche physique : KeyW/A/S/D = ZQSD sur AZERTY et WASD sur QWERTY
const DIRK = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right', KeyW: 'up', KeyS: 'down', KeyA: 'left', KeyD: 'right' };
const isTouch = matchMedia('(pointer: coarse)').matches;
const PALETTE = ['#3dd6ff', '#ff5fa2', '#ffd23f', '#2ee59d', '#ff9f1c', '#b388ff', '#ff4d6d', '#5b8cff', '#c6f432', '#ff8fd8'];
const TEAMC = ['#3dd6ff', '#ff5fa2'];
const TEAMN = ['Équipe Bleue', 'Équipe Rose'];
const AVATARS = COSMETICS.BASE_AVATARS;
const MODE_UI = { ffa: ['🎉', 'Chacun pour soi', '2 à 10 joueurs · tous les jeux'], '2v2': ['👯', '2v2', '4 joueurs · jeux 👥'], '3v3': ['🛡️', '3v3', '6 joueurs · jeux 👥'] };
const MEDALS = ['🥇', '🥈', '🥉'];

let ws = null, room = null, M = null, scores = [], prevScores = [], roundNo = 0, decisive = false;
let cur = null, active = false, dead = false;
let toLobbyTimer = null, countTimer = null, gagTimer = null, introOpen = false;
let me = null, friendsData = null, replaying = false, kicked = false, reconnectTimer = null;
let myAvatar = AVATARS[Math.floor(Math.random() * AVATARS.length)];
try { const a = localStorage.getItem('clutch-avatar'); if (AVATARS.includes(a)) myAvatar = a; } catch {}

const P = (i) => M.players[i];
const range = (n) => [...Array(n).keys()];
const pillRaw = (o, color, extra = '') => `<span class="pill fr-${o.frame || 'classic'}" style="background:${color};--pc:${color}"><span class="av">${esc(o.avatar)}</span>${esc(o.name)}${o.level ? ` <span class="lv">${o.level}</span>` : ''}${extra}</span>`;
const pill = (i, extra = '') => pillRaw(P(i), P(i).color, (i === M.me ? ' (toi)' : '') + extra);
const sideLabel = (s) => (M.teams ? M.sideNames[s] : P(M.sides[s][0]).name);
const sideColor = (s) => (M.teams ? TEAMC[s] : P(M.sides[s][0]).color);

// ════════════════ réseau ════════════════
const pending = [];
function send(o) {
  if (ws && ws.readyState === 1) return ws.send(JSON.stringify(o));
  if (o.t !== 'input') pending.push(o); // les inputs de jeu périmés ne servent à rien
  connect();
}
const store = {
  get: (k, ses) => { try { return (ses ? sessionStorage : localStorage).getItem(k); } catch { return null; } },
  set: (k, v, ses) => { try { (ses ? sessionStorage : localStorage).setItem(k, v); } catch {} },
  del: (k, ses) => { try { (ses ? sessionStorage : localStorage).removeItem(k); } catch {} },
};
// Connexion ouverte dès le chargement ; si elle saute (refresh, réseau), on se reconnecte
// et le serveur nous remet dans notre salon / notre manche grâce à la clé de reprise.
function connect() {
  if (kicked || (ws && ws.readyState <= 1)) return;
  ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host);
  ws.onopen = () => {
    $('#netbar').classList.add('hidden');
    let resume = null;
    try { resume = JSON.parse(store.get('clutch-resume', true) || 'null'); } catch {}
    ws.send(JSON.stringify({ t: 'hello', token: store.get('clutch-token'), resume }));
    pending.splice(0).forEach((o) => ws.send(JSON.stringify(o)));
  };
  ws.onmessage = (e) => onMsg(JSON.parse(e.data));
  ws.onclose = () => {
    ws = null;
    if (kicked) return;
    $('#netbar').classList.remove('hidden');
    clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(connect, 1500);
  };
}

// ════════════════ UI de base ════════════════
function show(id) {
  document.querySelectorAll('.screen').forEach((s) => s.classList.toggle('hidden', s.id !== id));
  $('#topbar').classList.toggle('hidden', id === 'home');
  document.body.classList.toggle('withbar', id !== 'home');
}
// retour au menu : quitte le salon (et le match en cours, après confirmation)
function backToMenu() {
  if (M) confirmBox("Quitter le match en cours ? Ça l'arrête pour tout le monde.", leaveToMenu);
  else leaveToMenu();
}
function leaveToMenu() {
  if (room) send({ t: 'leave' });
  goHome();
}
function goHome() {
  stopGame(); cur = null; active = false; dead = false; M = null; introOpen = false; room = null;
  chatShow(false);
  clearTimeout(toLobbyTimer); toLobbyTimer = null;
  hideOverlay(); hideGag();
  store.del('clutch-resume', true);
  history.replaceState(null, '', location.pathname);
  show('home');
}
function confirmBox(text, onYes) {
  $('#cfText').textContent = text;
  $('#confirmBox').classList.remove('hidden');
  $('#cfYes').onclick = () => { $('#confirmBox').classList.add('hidden'); onYes(); };
  $('#cfNo').onclick = () => $('#confirmBox').classList.add('hidden');
}
function isShown(id) { return !$('#' + id).classList.contains('hidden'); }
function shake(el) { if (!el) return; el.classList.remove('shake'); void el.offsetWidth; el.classList.add('shake'); }
function bump(el) { if (!el) return; el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump'); }

function logo(el) {
  const cols = ['#ffd23f', '#ff5fa2', '#3dd6ff', '#2ee59d', '#ff9f1c', '#b388ff'];
  el.innerHTML = 'CLUTCH'.split('').map((ch, i) => `<span style="--c:${cols[i]};--i:${i}">${ch}</span>`).join('');
}
logo($('#logoBig')); logo($('#logoSmall'));

// bloc « Commandes » : chaque ligne = des groupes de touches équivalentes (séparés par « ou ») + l'action
function keysHTML(keys, touch) {
  if (!keys || !keys.length) return '';
  const cap = (k) => (k === '…' ? '<span class="kor">à</span>' : `<kbd>${esc(k)}</kbd>`);
  return `<div class="keys">${keys.map(([groups, action]) => `<div class="krow"><span class="kk">${groups.map((g) => g.map(cap).join('')).join('<span class="kor">ou</span>')}</span><span class="ka">${esc(action)}</span></div>`).join('')}
    ${touch && isTouch ? `<div class="ktouch">📱 Sur téléphone : ${esc(touch)}</div>` : ''}</div>`;
}
function overlay({ icon, title, color, text, delay, badge, keys, touch, teamRule }) {
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
  $('#ovText').classList.toggle('goal', !!keys);
  $('#ovKeys').innerHTML = (teamRule ? `<div class="teamrule">👥 ${esc(teamRule)}</div>` : '') + keysHTML(keys, touch);
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
  const box = $('#ovReady');
  if (!box.querySelector('.readyrow')) {
    box.innerHTML = `<div class="readyrow"></div>
      <button class="btn big green" id="btnReady" type="button">✅ J'ai lu, prêt ! <span style="font-size:14px">(Espace / Entrée)</span></button>
      <p class="mut hidden" id="readyWait"></p>`;
    const b = $('#btnReady');
    b.addEventListener('pointerdown', (e) => { e.preventDefault(); sendReady(); });
    b.addEventListener('click', sendReady);
  }
  const meReady = list[M.me];
  box.querySelector('.readyrow').innerHTML = M.players.map((p, i) => `<span style="opacity:${list[i] ? 1 : 0.55}">${pill(i, ` ${list[i] ? '✔' : '…'}`)}</span>`).join('');
  $('#btnReady').classList.toggle('hidden', !!meReady);
  $('#readyWait').classList.toggle('hidden', !meReady);
  $('#readyWait').textContent = `✔ Prêt — en attente des autres (${list.filter(Boolean).length}/${list.length})`;
}
let readySent = false;
function sendReady() {
  if (!introOpen || readySent) return;
  readySent = true;
  SFX.unlock();
  send({ t: 'ready' });
  $('#btnReady') && $('#btnReady').classList.add('hidden');
  $('#readyWait') && $('#readyWait').classList.remove('hidden');
}
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
  const rnd = decisive ? '⚡ Manche décisive' : M.byPoints ? `Manche ${roundNo} · premier à ${M.target} pt${M.target > 1 ? 's' : ''}` : `Manche ${roundNo} / ${M.maxRounds}`;
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
  const canAdd = (m) => me && m.uid && m.uid !== me.id && friendsData && !friendsData.friends.some((f) => f.id === m.uid) && !friendsData.reqOut.some((f) => f.id === m.uid);
  const row = (m) => `<div class="pl ${m.id === r.you ? 'me' : ''} ${m.offline ? 'off' : ''}"><span class="av fr-${m.frame || 'classic'}" style="--pc:#ffd23f">${esc(m.avatar)}</span>
    <span class="nm">${esc(m.name)}${m.id === r.you ? ' (toi)' : ''}${m.level ? ` <span class="lv">${m.level}</span>` : ' <span class="mut" style="font-size:11px">invité</span>'}
    ${m.title ? `<small class="ptitle">${esc(COSMETICS.titleName(m.title))}</small>` : ''}</span>
    ${m.offline ? '<span title="Déconnecté, on l\'attend">🔌</span>' : ''}${canAdd(m) ? `<button class="btn sm white" data-addfriend="${esc(m.name)}" title="Ajouter en ami">➕</button>` : ''}${m.id === r.host ? '👑' : ''}</div>`;
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
  $('#count').textContent = `${r.members.length}/10`;
  $('#modes').innerHTML = r.modes.map((m) => { const u = MODE_UI[m.key]; return `<div class="mode ${m.key === r.mode ? 'on' : ''}" data-mode="${m.key}"><span class="i">${u[0]}</span><b>${u[1]}</b><small>${u[2]}</small></div>`; }).join('');
  const pts = r.goal === 'points';
  const N = pts ? r.target : r.rounds;
  const twoSides = r.mode !== 'ffa';
  const pl = (v, w) => `${v} ${w}${v > 1 ? 's' : ''}`;
  $('#rounds').innerHTML = `<div class="goaltabs"><button class="tab ${pts ? '' : 'on'}" data-goal="rounds">🎯 Nombre de manches</button><button class="tab ${pts ? 'on' : ''}" data-goal="points">🏆 Points à atteindre</button></div>
    <div class="stepper"><button class="btn white" data-r="${N - 1}">−</button><span class="n">${N}</span><button class="btn white" data-r="${N + 1}">+</button></div>
    ${(pts ? [3, 5, 10, 15, 20] : [3, 5, 7, 10, 15]).map((v) => `<button class="btn sm ${v === N ? 'pink' : 'white'}" data-r="${v}">${v}</button>`).join('')}
    <div class="roundsinfo">${pts
      ? twoSides
        ? `Le premier camp à <b>${pl(N, 'point')}</b> gagne la partie. 1 manche gagnée = 1 point.`
        : `Le premier à <b>${pl(N, 'point')}</b> gagne la partie. 1 point au gagnant de chaque manche, 0 pour les autres. Égalité en tête = on continue.`
      : twoSides
        ? `Best of ${N} : le premier à <b>${pl(Math.floor(N / 2) + 1, 'manche')}</b> gagnée${Math.floor(N / 2) + 1 > 1 ? 's' : ''} l'emporte. Égalité = manche décisive.`
        : `${pl(N, 'manche')} · 1 point au gagnant de chaque manche · le plus de points gagne (fin anticipée si c'est plié). Égalité = manche décisive.`}</div>`;
  $('#gamesList').innerHTML = r.games.map((g) => {
    const out = isTeam && !g.team;
    return `<button class="gcard ${g.on && !out ? 'on' : ''} ${out ? 'noteam' : ''}" data-game="${g.key}" ${out ? 'disabled title="Pas jouable en équipe"' : ''}>
    <span class="tick">${out ? '—' : g.on ? '✔' : '✖'}</span><span class="i">${g.icon}</span><b>${esc(g.title)}${g.team ? ' <span title="Jouable en équipe">👥</span>' : ''}</b><small>${out ? 'Pas en équipe' : esc(g.desc)}</small></button>`;
  }).join('');
  ['#modes', '#rounds', '#gamesList'].forEach((s) => $(s).classList.toggle('nohost', !host));
  $('#btnStart').classList.toggle('hidden', !host);
  $('#btnStart').disabled = !r.canStart;
  $('#lobbyMsg').textContent = r.hint || (host ? 'Tout est prêt, lance quand tu veux !' : "⏳ En attente que l'hôte 👑 lance la partie…");
  $('#guestAv').classList.toggle('hidden', !!me);
  $('#btnCustomLobby').classList.toggle('hidden', !me);
  if (!me) avatarGrid($('#avGridLobby'), (x) => { setAvatar(x); send({ t: 'avatar', avatar: x }); });
  renderFriends();
}

// ════════════════ messages serveur ════════════════
function onMsg(m) {
  switch (m.t) {
    case 'error':
      if (isShown('home')) $('#homeErr').textContent = m.msg; else toast('⚠️ ' + m.msg);
      break;
    case 'room':
      room = m;
      store.set('clutch-resume', JSON.stringify({ code: m.code, key: m.key }), true);
      history.replaceState(null, '', '?code=' + m.code);
      renderLobby();
      chatShow(true);
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
      overlay({ icon: m.icon, title: m.title, text: m.rules, badge: m.decisive ? '⚡ MANCHE DÉCISIVE ⚡' : M.byPoints ? `Manche ${m.round} · premier à ${M.target} pts` : `Manche ${m.round} / ${m.maxRounds}`, keys: m.keys, touch: m.touch, teamRule: m.teamRule });
      introOpen = true; readySent = false;
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
      if (!active) { active = true; hideOverlay(); if (!replaying) SFX.play('go'); }
      cur.msg(m);
      break;
    case 'elim': onElim(m); break;
    case 'roundEnd':
      active = false; stopGame();
      scores = m.scores; renderScore();
      showRoundEnd(m);
      break;
    case 'matchEnd': showMatchEnd(m); break;
    case 'resync': resync(m); break;
    case 'resumeFail':
      store.del('clutch-resume', true);
      if (!room) { show('home'); }
      break;
    case 'left':
      goHome();
      break;
    case 'catalog':
      CATALOG = m.games;
      $('#storeWarn').classList.toggle('hidden', !m.ephemeral);
      break;
    case 'chat': chatAdd(m); break;
    case 'chatHist':
      // historique à l'arrivée ou après un refresh : affiché sans compter comme non lu
      $('#chatLog').innerHTML = m.list.length ? m.list.map(chatLine).join('') : '<div class="empty">Personne n\'a encore écrit. Dis bonjour 👋</div>';
      $('#chatLog').scrollTop = $('#chatLog').scrollHeight;
      break;
    case 'kicked':
      kicked = true; store.del('clutch-resume', true);
      document.body.innerHTML = `<div class="card" style="margin:60px auto;max-width:420px;text-align:center"><h2>👋 ${esc(m.msg)}</h2><p class="mut">Tu peux fermer cet onglet.</p></div>`;
      break;
    case 'aborted':
      stopGame(); cur = null; active = false; M = null;
      clearTimeout(toLobbyTimer); toLobbyTimer = null;
      hideOverlay(); hideGag(); show('lobby');
      setTimeout(() => { $('#lobbyMsg').textContent = '⚠️ ' + m.msg; }, 50);
      break;
    default:
      onAccountMsg(m);
  }
}

// Retour après un refresh : on reconstruit l'écran du match là où il en est
function resync(m) {
  clearTimeout(toLobbyTimer); toLobbyTimer = null;
  stopGame(); hideGag(); hideOverlay();
  M = m.match; scores = m.scores; prevScores = [...m.scores]; roundNo = m.round; decisive = m.intro && m.intro.decisive;
  show('game'); renderScore();
  if (!m.intro) return;
  cur = GAMES[m.intro.game]; active = false; dead = false;
  $('#stage').innerHTML = '';
  cur.init();
  if (m.state === 'intro') {
    onMsg({ ...m.intro, ready: m.ready });
    if (m.launching) onMsg({ t: 'countdown', ms: 1500 });
  } else if (m.state === 'round') {
    replaying = true; SFX.hush(true);
    try { m.log.forEach((x) => onMsg(x)); } finally { replaying = false; SFX.hush(false); }
    if (!active) hideOverlay();
    toast('🔄 Reconnecté — tu reprends la manche en cours');
  } else {
    overlay({ icon: '🔄', title: 'Reconnecté !', text: 'La prochaine manche arrive…' });
  }
}

function stopGame() { if (cur && cur.stop) { try { cur.stop(); } catch {} } }

function onElim(m) {
  if (!M) return;
  if (replaying) { if (m.i === M.me) dead = true; return; }
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
  if (introOpen && (e.key === 'Enter' || e.code === 'Space')) { e.preventDefault(); sendReady(); return; }
  if (active && !dead && cur && cur.key) cur.key(e);
});
document.addEventListener('keyup', (e) => { if (active && cur && cur.keyup) cur.keyup(e); });
window.addEventListener('blur', () => { if (cur && cur.blur) cur.blur(); });

// ════════════════ interpolation (jeux temps réel) ════════════════
function pushSnap(S, data) { S.prev = S.cur || { time: performance.now(), d: data }; S.cur = { time: performance.now(), d: data }; }
function alphaOf(S) { return Math.max(0, Math.min(1, (performance.now() - S.cur.time) / 34)); }
const lerp = (a, b, t) => a + (b - a) * t;
// police des emojis sur canvas : on nomme les polices couleur, sinon certains navigateurs n'affichent rien
const EMOJI_FONT = '"Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", serif';
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
        <button class="btn sortbtn" data-b="0" style="background:#ff9f1c"><span class="k">⬅ ou Q</span>🔥 AU FOUR<small>la ferraille 🔩⚙️🔧</small></button>
        <button class="btn sortbtn" data-b="1" style="background:#3dd6ff"><span class="k">➡ ou D</span>📦 EN CAISSE<small>les tableaux 🖼️</small></button>
      </div>
      <div class="ucturn" id="fnow" style="margin:0 0 8px">Le tapis démarre…</div><div class="tbar" style="margin-bottom:10px"><div id="fbar" style="width:0"></div></div>
      <div class="screen-dark"><canvas id="fc" width="820" height="280"></canvas></div>${legend()}
      <p class="sub">40 secondes, tapis infini. Erreur = sonné 1,5 s.</p>`;
    this.items = null; this.pos = 0; this.stunUntil = 0; this.anims = []; this.slideT = 0; this.raf = null;
    $('#stage').querySelectorAll('.sortbtn').forEach((b) => b.addEventListener('pointerdown', (e) => { e.preventDefault(); this.sort(+b.dataset.b); }));
  },
  msg(m) {
    if (m.k === 'belt') {
      this.items = m.items; this.N = m.n; this.stunMs = m.stun;
      M.players.forEach((_, i) => legendSet(i, '0'));
      timerBar($('#fbar'), m.ms); this.status(); this.loop();
    }
    if (m.k === 'prog') {
      m.pos.forEach((p, i) => legendSet(i, String(p)));
      if (m.pos[M.me] > this.pos) { this.pos = m.pos[M.me]; this.status(); }
    }
    // le serveur a refusé un tri : on recale le tapis sur sa position
    if (m.k === 'sync') { this.pos = m.p; this.anims = []; this.status(); }
    if (m.k === 'stun' && m.i === M.me && performance.now() > this.stunUntil) this.stunUntil = performance.now() + m.ms;
  },
  key(e) {
    if (e.repeat) return;
    if (e.code === 'ArrowLeft' || e.code === 'KeyA') { e.preventDefault(); this.sort(0); }
    else if (e.code === 'ArrowRight' || e.code === 'KeyD') { e.preventDefault(); this.sort(1); }
  },
  status() {
    const el = $('#fnow'); if (!el || !this.items) return;
    el.textContent = this.pos >= this.N ? '🏁 Tout trié !' : `Trié : ${this.pos} · ${this.items[this.pos].e} ${this.items[this.pos].n}`;
  },
  sort(b) {
    if (!this.items || !active || dead || this.pos >= this.N) return;
    const now = performance.now();
    if (now < this.stunUntil) { shake($('#fc')); return; }
    send({ t: 'input', a: 'sort', b, p: this.pos });
    const it = this.items[this.pos];
    const want = it.e === '🖼️' ? 1 : 0;
    if (b === want) {
      this.anims.push({ e: it.e, b, t: now });
      this.pos++; this.slideT = now;
      SFX.play(b === 0 ? 'whoosh' : 'bonk');
    } else {
      this.stunUntil = now + (this.stunMs || 1500);
      SFX.play('bad'); shake($('#fc'));
    }
    this.status();
  },
  loop() {
    const cv = $('#fc'), c = cv.getContext('2d'), W = cv.width, ZX = 430, GAP = 120, BY = 165;
    const draw = () => {
      this.raf = requestAnimationFrame(draw);
      const now = performance.now();
      c.fillStyle = '#14102e'; c.fillRect(0, 0, W, 280);
      // four (en bas à gauche) et caisse (en haut à droite), comme les boutons
      const fl = c.createLinearGradient(0, 200, 0, 280); fl.addColorStop(0, '#ffd23f'); fl.addColorStop(0.5, '#ff9f1c'); fl.addColorStop(1, '#ff4d6d');
      c.fillStyle = fl; c.fillRect(ZX - 250, 205, 150, 75);
      for (let k = 0; k < 7; k++) { c.font = '22px serif'; c.textAlign = 'center'; c.fillText('🔥', ZX - 240 + k * 22, 276 - Math.abs(Math.sin(now / 120 + k)) * 14); }
      strokeText(c, '⬅ FOUR (ferraille)', ZX - 175, 228, '#fff', 14);
      c.fillStyle = '#c98b4a'; c.strokeStyle = '#1b1440'; c.lineWidth = 3;
      c.fillRect(ZX + 110, 14, 150, 62); c.strokeRect(ZX + 110, 14, 150, 62);
      c.beginPath(); c.moveTo(ZX + 110, 45); c.lineTo(ZX + 260, 45); c.stroke();
      strokeText(c, 'CAISSE (tableaux) ➡', ZX + 185, 38, '#fff', 14);
      // tapis : les objets arrivent par la gauche et glissent d'un cran vers la zone de tri à chaque tri
      const slide = Math.max(0, 1 - (now - this.slideT) / 160);
      const ease = slide * slide;
      c.fillStyle = '#3a3166'; c.fillRect(0, BY, W, 24);
      c.fillStyle = '#58508f';
      const off = (((this.pos - ease) * GAP) % 30 + 30) % 30;
      for (let x = off - 30; x < W; x += 30) c.fillRect(x, BY + 4, 14, 16);
      c.strokeStyle = '#ffd23f'; c.lineWidth = 4; c.setLineDash([8, 6]); c.strokeRect(ZX - 55, 80, 110, 112); c.setLineDash([]);
      c.textAlign = 'center';
      for (let k = 0; k < 6; k++) {
        const idx = this.pos + k; if (idx >= this.N) break;
        const it = this.items[idx];
        const x = ZX - (k + ease) * GAP;
        if (x < -60) break;
        c.font = (k === 0 ? 58 : 40) + 'px ' + EMOJI_FONT; c.globalAlpha = k === 0 ? 1 : 0.75;
        c.fillText(it.e, x, BY - 10); c.globalAlpha = 1;
        if (k === 0 && slide < 0.5) strokeText(c, it.n, x, BY + 46, '#fff', 14);
      }
      // objets triés qui partent vers le four ou la caisse
      this.anims = this.anims.filter((a) => now - a.t < 380);
      this.anims.forEach((a) => {
        const k = (now - a.t) / 380;
        const tx = a.b === 0 ? ZX - 175 : ZX + 185, ty = a.b === 0 ? 250 : 50;
        c.globalAlpha = 1 - k * 0.6; c.font = '48px ' + EMOJI_FONT; c.textAlign = 'center';
        c.fillText(a.e, lerp(ZX, tx, k), lerp(BY - 10, ty, k) - Math.sin(k * Math.PI) * 50); c.globalAlpha = 1;
      });
      if (this.pos >= this.N) strokeText(c, '🏁 FINI !', ZX, 130, '#2ee59d', 30);
      if (now < this.stunUntil) {
        c.fillStyle = 'rgba(20,16,46,.55)'; c.fillRect(0, 0, W, 280);
        strokeText(c, '💫 SONNÉ 💫', ZX, 120, '#ffd23f', 34);
        const left = (this.stunUntil - now) / (this.stunMs || 1500);
        c.fillStyle = '#ff4d6d'; c.fillRect(ZX - 100, 140, 200 * left, 10);
      }
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
    $('#stage').innerHTML = `<div class="screen-dark" style="background:#2b1d14"><canvas id="mnc" width="820" height="470"></canvas></div>
      <div class="ucturn" id="mst">Tonton Gérard lit son journal…</div><p class="sub">Maintiens ESPACE pour manger · relâche quand il baisse le journal</p>`;
    if (isTouch) $('#stage').appendChild(holdBtn('🍴 MANGER', () => this.down(), () => this.up()));
    const n = M.players.length;
    this.eating = false; this.ph = 'read'; this.phT = performance.now();
    this.pr = new Array(n).fill(0); this.e = new Array(n).fill(false); this.al = new Array(n).fill(true);
    this.bangT = 0; this.bangI = -1; this.raf = null;
    this.loop();
  },
  msg(m) {
    if (m.k === 'ph') {
      this.ph = m.ph; this.phT = performance.now();
      const st = $('#mst');
      if (m.ph === 'read') st.textContent = 'Tonton Gérard lit son journal… mange !';
      if (m.ph === 'rustle') { st.textContent = '📰 *froisse froisse*… il va regarder !'; SFX.play('gas'); }
      if (m.ph === 'look') st.textContent = '👀 IL REGARDE. NE BOUGE PLUS.';
    }
    if (m.k === 'bang') { this.bangT = performance.now(); this.bangI = m.i; SFX.play('gun'); }
    if (m.k === 's') { this.pr = m.pr; this.e = m.e; this.al = m.al; }
  },
  key(e) { if (e.code === 'Space') { e.preventDefault(); if (!e.repeat) this.down(); } },
  keyup(e) { if (e.code === 'Space') this.up(); },
  blur() { this.up(); },
  down() { if (!this.eating) { this.eating = true; send({ t: 'input', a: 'eat' }); } },
  up() { if (this.eating) { this.eating = false; send({ t: 'input', a: 'stop' }); } },
  loop() {
    const cv = $('#mnc'), c = cv.getContext('2d'), W = 820, H = 470, CX = 410;
    const draw = () => {
      this.raf = requestAnimationFrame(draw);
      const now = performance.now(), t = now / 1000, ph = this.ph;
      // ── la salle à manger ──
      c.fillStyle = '#e9dcc0'; c.fillRect(0, 0, W, H);
      c.fillStyle = '#dccaa2'; for (let x = 0; x < W; x += 44) c.fillRect(x, 0, 18, 300);
      c.fillStyle = '#7a4b2a'; c.fillRect(0, 280, W, H - 280);
      c.fillStyle = '#5e381f'; c.fillRect(0, 280, W, 8);
      // tableau de cerf + horloge
      c.fillStyle = '#5e381f'; c.fillRect(60, 40, 120, 90); c.fillStyle = '#c9b48a'; c.fillRect(70, 50, 100, 70);
      c.font = '44px serif'; c.textAlign = 'center'; c.fillText('🦌', 120, 102);
      c.font = '46px serif'; c.fillText('🕰️', 720, 100);
      // lustre qui se balance
      const sw = Math.sin(t * 1.3) * 0.06;
      c.save(); c.translate(CX, 0); c.rotate(sw);
      c.strokeStyle = '#3a2a1a'; c.lineWidth = 3; c.beginPath(); c.moveTo(0, 0); c.lineTo(0, 34); c.stroke();
      c.fillStyle = '#c99a2e'; c.beginPath(); c.moveTo(-30, 52); c.lineTo(30, 52); c.lineTo(14, 34); c.lineTo(-14, 34); c.closePath(); c.fill();
      c.fillStyle = 'rgba(255,230,140,.35)'; c.beginPath(); c.moveTo(-30, 52); c.lineTo(30, 52); c.lineTo(90, 200); c.lineTo(-90, 200); c.closePath(); c.fill();
      c.restore();
      // ── Tonton Gérard ──
      c.fillStyle = '#3d2b1f'; c.beginPath(); c.ellipse(CX, 285, 95, 85, 0, Math.PI, 0); c.fill();             // costume
      c.fillStyle = '#fff'; c.beginPath(); c.moveTo(CX - 26, 205); c.lineTo(CX + 26, 205); c.lineTo(CX, 270); c.closePath(); c.fill(); // chemise
      c.fillStyle = '#b3122e'; c.beginPath(); c.moveTo(CX - 7, 210); c.lineTo(CX + 7, 210); c.lineTo(CX + 9, 262); c.lineTo(CX, 274); c.lineTo(CX - 9, 262); c.closePath(); c.fill(); // cravate
      const head = () => {
        c.fillStyle = '#f1c27d'; c.beginPath(); c.arc(CX, 160, 42, 0, 7); c.fill(); c.strokeStyle = '#1b1440'; c.lineWidth = 3; c.stroke();
        c.fillStyle = '#6b6b6b'; c.beginPath(); c.arc(CX, 140, 42, Math.PI * 1.08, Math.PI * 1.92); c.lineTo(CX + 30, 128); c.lineTo(CX - 30, 128); c.fill(); // cheveux gris
      };
      if (ph === 'look') {
        head();
        // regard qui tue
        const glow = 0.6 + 0.4 * Math.sin(now / 80);
        c.fillStyle = `rgba(255,30,60,${glow})`; c.beginPath(); c.arc(CX - 15, 156, 7, 0, 7); c.arc(CX + 15, 156, 7, 0, 7); c.fill();
        c.strokeStyle = '#1b1440'; c.lineWidth = 5;
        c.beginPath(); c.moveTo(CX - 28, 140); c.lineTo(CX - 6, 149); c.moveTo(CX + 28, 140); c.lineTo(CX + 6, 149); c.stroke(); // sourcils froncés
        c.fillStyle = '#4a3020'; c.beginPath(); c.ellipse(CX - 13, 177, 16, 7, 0.25, 0, 7); c.ellipse(CX + 13, 177, 16, 7, -0.25, 0, 7); c.fill(); // moustache
        c.strokeStyle = '#1b1440'; c.lineWidth = 3; c.beginPath(); c.arc(CX, 196, 10, Math.PI * 1.15, Math.PI * 1.85); c.stroke();
        // fusil braqué sur toi
        c.fillStyle = '#5e381f'; c.fillRect(CX - 40, 222, 80, 26);
        c.fillStyle = '#2b2b33'; c.beginPath(); c.arc(CX - 17, 232, 19, 0, 7); c.arc(CX + 17, 232, 19, 0, 7); c.fill();
        c.fillStyle = '#000'; c.beginPath(); c.arc(CX - 17, 232, 11, 0, 7); c.arc(CX + 17, 232, 11, 0, 7); c.fill();
        c.fillStyle = '#f1c27d'; c.beginPath(); c.arc(CX - 58, 238, 14, 0, 7); c.arc(CX + 58, 238, 14, 0, 7); c.fill();
        // journal posé
        c.save(); c.translate(CX + 165, 300); c.rotate(-0.15); c.fillStyle = '#f4f1e8'; c.fillRect(-45, -20, 90, 40); c.restore();
      } else {
        // la tête dépasse un peu quand il froisse le journal
        if (ph === 'rustle') {
          head();
          c.fillStyle = '#1b1440'; c.beginPath(); c.arc(CX - 14, 158, 4, 0, 7); c.arc(CX + 14, 158, 4, 0, 7); c.fill();
        }
        const shakeA = ph === 'rustle' ? Math.sin(now / 35) * 0.05 : Math.sin(t * 0.8) * 0.01;
        const py = ph === 'rustle' ? 184 : 98;
        c.save(); c.translate(CX, py + 80); c.rotate(shakeA);
        c.fillStyle = '#f4f1e8'; c.strokeStyle = '#1b1440'; c.lineWidth = 3;
        c.fillRect(-125, -80, 250, 160); c.strokeRect(-125, -80, 250, 160);
        c.beginPath(); c.moveTo(0, -80); c.lineTo(0, 80); c.stroke();
        c.fillStyle = '#1b1440'; c.font = '900 22px Georgia, serif'; c.textAlign = 'center'; c.fillText('LE TONTON', -62, -52);
        c.font = '900 13px Georgia, serif'; c.fillText('LIBÉRÉ', -62, -34);
        c.fillStyle = '#9a96a8'; for (let k = 0; k < 6; k++) { c.fillRect(-112, -20 + k * 14, 96, 6); c.fillRect(14, -66 + k * 14, 96, 6); }
        c.fillStyle = '#c9c4d6'; c.fillRect(20, 22, 90, 46);
        c.font = '30px serif'; c.fillText('🍷', 65, 56);
        c.fillStyle = '#f1c27d'; c.beginPath(); c.arc(-125, 18, 14, 0, 7); c.arc(125, 18, 14, 0, 7); c.fill();
        c.restore();
        if (ph === 'rustle') strokeText(c, '*froisse froisse*', CX + 180, 120, '#ff9f1c', 18);
      }
      // ── la table ──
      c.save();
      c.beginPath(); c.moveTo(110, 300); c.lineTo(710, 300); c.lineTo(810, 430); c.lineTo(10, 430); c.closePath(); c.clip();
      c.fillStyle = '#fff'; c.fillRect(0, 300, W, 130);
      c.fillStyle = 'rgba(214,40,57,.85)';
      for (let y = 300; y < 430; y += 26) for (let x = 0; x < W; x += 52) c.fillRect(x + ((y / 26) % 2) * 26, y, 26, 26);
      c.restore();
      c.fillStyle = '#5e381f'; c.fillRect(10, 430, 800, 14);
      // ── les convives ──
      const n = M.players.length;
      const sc = Math.min(1, 5.5 / n); // assiettes plus petites quand on est nombreux
      for (let i = 0; i < n; i++) {
        const x = 90 + (i + 0.5) * (640 / n), py = 372;
        const alive = this.al[i], pr = this.pr[i] || 0, eating = alive && this.e[i] && ph !== 'look';
        if (!alive) {
          c.fillStyle = 'rgba(140,0,20,.85)';
          [[-30, -6, 18], [22, 8, 14], [-6, 20, 22], [36, -14, 9]].forEach(([dx, dy, r]) => { c.beginPath(); c.arc(x + dx, py + dy, r, 0, 7); c.fill(); });
        }
        // assiette + spaghettis qui diminuent
        c.fillStyle = '#fff'; c.strokeStyle = '#1b1440'; c.lineWidth = 2.5;
        c.beginPath(); c.ellipse(x, py, 44 * sc, 20 * sc, 0, 0, 7); c.fill(); c.stroke();
        const left = Math.max(0, 1 - pr / 100);
        if (left > 0) {
          c.strokeStyle = '#e8b830'; c.lineWidth = 3;
          for (let k = 0; k < 8 * left + 1; k++) { c.beginPath(); c.ellipse(x + Math.sin(k * 2.1) * 12 * left * sc, py - 3, (24 * left + 4) * sc, (9 * left + 2) * sc, k * 0.7, 0, 7); c.stroke(); }
          c.fillStyle = '#c0392b'; c.beginPath(); c.arc(x, py - 6, (9 * left + 2) * sc, 0, 7); c.fill();
        }
        // la tête du convive (vue de dos) et sa fourchette
        const bob = eating ? Math.sin(now / 70) * 5 : 0;
        c.font = Math.round(46 * sc) + 'px serif'; c.textAlign = 'center';
        c.fillText(alive ? P(i).avatar : '💀', x, 462 + bob);
        if (eating) { c.font = '26px serif'; c.fillText('🍴', x + 26, py - 4 - Math.abs(Math.sin(now / 90)) * 30); }
        if (pr >= 100 && alive) strokeText(c, '🏁 FINI', x, py - 34, '#2ee59d', 16);
        strokeText(c, P(i).name + (i === M.me ? ' (toi)' : ''), x, 300 + 22 - 6, P(i).color, n > 6 ? 11 : 13);
        c.fillStyle = '#1b1440'; c.fillRect(x - 32, py + 26, 64, 7);
        c.fillStyle = P(i).color; c.fillRect(x - 31, py + 27, 62 * Math.min(1, pr / 100), 5);
      }
      // ── coup de feu ──
      const sinceBang = now - this.bangT;
      if (sinceBang < 260) {
        c.fillStyle = `rgba(255,255,255,${0.8 * (1 - sinceBang / 260)})`; c.fillRect(0, 0, W, H);
        c.font = '70px serif'; c.textAlign = 'center'; c.fillText('💥', CX, 250);
      }
      if (ph === 'look') {
        const a = 0.18 + 0.1 * Math.sin(now / 90);
        const g = c.createRadialGradient(CX, H / 2, 150, CX, H / 2, 520); g.addColorStop(0, 'rgba(255,0,40,0)'); g.addColorStop(1, `rgba(255,0,40,${a + 0.25})`);
        c.fillStyle = g; c.fillRect(0, 0, W, H);
      }
    };
    draw();
  },
  stop() { cancelAnimationFrame(this.raf); },
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
        $('#uct').innerHTML = `${pill(m.i)} est éliminé·e${m.tie ? ' (égalité → tirage au sort)' : ''} : ${m.role === 'undercover' ? '🕵️ UNDERCOVER !' : '😇 civil'}`;
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

// ── Tank ──
// ZQSD = rouler, flèches = canon (ici on ne passe pas par DIRK, qui confond les deux)
const MOVEK = { KeyW: 'up', KeyS: 'down', KeyA: 'left', KeyD: 'right' };
const AIMK = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };
const vecOf = (h) => [(h.has('right') ? 1 : 0) - (h.has('left') ? 1 : 0), (h.has('down') ? 1 : 0) - (h.has('up') ? 1 : 0)];
GAMES.tank = {
  init() {
    $('#stage').innerHTML = `<div class="screen-dark"><canvas id="tc" width="800" height="500"></canvas></div>${legend()}
      <p class="sub">ZQSD rouler · flèches viser · ESPACE tirer</p>`;
    this.held = new Set(); this.aimHeld = new Set(); this.lastV = '0,0';
    this.S = {}; this.raf = null; this.boxes = []; this.fx = []; this.booms = [];
    // tactile : le pad sert à rouler et vise dans la même direction
    $('#stage').appendChild(dpad((d) => { this.held.add(d); this.sendMv(true); }, (d) => { this.held.delete(d); this.sendMv(true); }));
    if (isTouch) {
      const b = document.createElement('button'); b.className = 'btn pink'; b.style.marginTop = '10px'; b.textContent = '💥 Tirer';
      b.addEventListener('pointerdown', (e) => { e.preventDefault(); if (active && !dead) send({ t: 'input', a: 'fire' }); });
      $('#stage').appendChild(b);
    }
  },
  sendMv(aimToo) {
    const [x, y] = vecOf(this.held), v = x + ',' + y;
    if (v !== this.lastV) { this.lastV = v; send({ t: 'input', a: 'mv', x, y }); }
    if (aimToo && (x || y)) send({ t: 'input', a: 'aim', x, y });
  },
  sendAim() { const [x, y] = vecOf(this.aimHeld); if (x || y) send({ t: 'input', a: 'aim', x, y }); },
  key(e) {
    if (MOVEK[e.code]) { e.preventDefault(); if (!e.repeat) { this.held.add(MOVEK[e.code]); this.sendMv(); } }
    else if (AIMK[e.code]) { e.preventDefault(); if (!e.repeat) { this.aimHeld.add(AIMK[e.code]); this.sendAim(); } }
    else if (e.code === 'Space') { e.preventDefault(); send({ t: 'input', a: 'fire' }); } // maintenu = tir auto (recharge côté serveur)
  },
  keyup(e) {
    if (MOVEK[e.code]) { this.held.delete(MOVEK[e.code]); this.sendMv(); }
    if (AIMK[e.code]) { this.aimHeld.delete(AIMK[e.code]); this.sendAim(); }
  },
  blur() { this.held.clear(); this.aimHeld.clear(); this.sendMv(); },
  msg(m) {
    if (m.k === 'tank') {
      this.W = m.w; this.H = m.h; this.PR = m.pr; this.BR = m.br;
      this.boxes = m.boxes.map(([x, y, w, h, metal, hp]) => ({ x, y, w, h, metal, hp }));
      M.players.forEach((_, i) => legendSet(i, '❤️❤️'));
      this.loop();
    }
    if (m.k === 'fire') SFX.play('gun');
    if (m.k === 'box') {
      const b = this.boxes[m.id]; if (b) b.hp = m.hp;
      this.booms.push({ x: m.x, y: m.y, t: performance.now(), r: b && b.hp <= 0 ? 50 : 14 });
      SFX.play(b && b.hp <= 0 ? 'boom' : 'bonk');
    }
    if (m.k === 'hit') {
      legendSet(m.i, m.l > 0 ? '❤️'.repeat(m.l) : '💀');
      const q = this.S.cur && this.S.cur.d.p[m.i];
      if (q) { this.booms.push({ x: q[0], y: q[1], t: performance.now(), r: 40 }); fxText(this, q[0], q[1] - 26, m.l > 0 ? 'TOUCHÉ !' : 'DÉTRUIT !', '#ff4d6d'); }
      SFX.play('boom');
    }
    if (m.k === 's') pushSnap(this.S, m);
  },
  loop() {
    const c = $('#tc').getContext('2d');
    const draw = () => {
      this.raf = requestAnimationFrame(draw);
      const S = this.S; if (!S.cur) return;
      const a = alphaOf(S), A = S.prev.d, B = S.cur.d, now = performance.now();
      c.fillStyle = '#3b5f3a'; c.fillRect(0, 0, this.W, this.H);
      c.strokeStyle = 'rgba(0,0,0,.08)'; c.lineWidth = 1;
      for (let x = 0; x < this.W; x += 50) { c.beginPath(); c.moveTo(x, 0); c.lineTo(x, this.H); c.stroke(); }
      for (let y = 0; y < this.H; y += 50) { c.beginPath(); c.moveTo(0, y); c.lineTo(this.W, y); c.stroke(); }
      this.boxes.forEach((b) => {
        if (b.hp <= 0) return;
        c.fillStyle = b.metal ? '#8a90a8' : ['#7a4f24', '#a8692f', '#c98b4a'][b.hp - 1] || '#c98b4a';
        c.fillRect(b.x, b.y, b.w, b.h); c.strokeStyle = '#1b1440'; c.lineWidth = 3; c.strokeRect(b.x, b.y, b.w, b.h);
        c.beginPath();
        if (b.metal) { [[6, 6], [b.w - 6, 6], [6, b.h - 6], [b.w - 6, b.h - 6]].forEach(([dx, dy]) => { c.moveTo(b.x + dx + 3, b.y + dy); c.arc(b.x + dx, b.y + dy, 3, 0, 7); }); }
        else { c.moveTo(b.x, b.y); c.lineTo(b.x + b.w, b.y + b.h); c.moveTo(b.x + b.w, b.y); c.lineTo(b.x, b.y + b.h); }
        c.stroke();
      });
      B.b.forEach(([x, y, o]) => {
        c.fillStyle = P(o).color; c.strokeStyle = '#1b1440'; c.lineWidth = 2;
        c.beginPath(); c.arc(x, y, this.BR, 0, 7); c.fill(); c.stroke();
      });
      drawPlayersAt(c, S, a, this.PR, 0, (i, x, y) => {
        const p = B.p[i], ang = p[3] / 100;
        // canon
        c.strokeStyle = '#1b1440'; c.lineWidth = 9; c.lineCap = 'round';
        c.beginPath(); c.moveTo(x + Math.cos(ang) * (this.PR - 2), y + Math.sin(ang) * (this.PR - 2)); c.lineTo(x + Math.cos(ang) * (this.PR + 14), y + Math.sin(ang) * (this.PR + 14)); c.stroke();
        c.strokeStyle = P(i).color; c.lineWidth = 5;
        c.beginPath(); c.moveTo(x + Math.cos(ang) * (this.PR - 1), y + Math.sin(ang) * (this.PR - 1)); c.lineTo(x + Math.cos(ang) * (this.PR + 13), y + Math.sin(ang) * (this.PR + 13)); c.stroke();
        c.lineCap = 'butt';
        if (p[5] && Math.floor(now / 100) % 2) { c.strokeStyle = '#fff'; c.lineWidth = 3; c.beginPath(); c.arc(x, y, this.PR + 9, 0, 7); c.stroke(); }
        c.font = '11px ' + EMOJI_FONT; c.textAlign = 'center'; c.fillText('❤️'.repeat(p[4]), x, y + this.PR + 20);
      });
      this.booms = this.booms.filter((b) => now - b.t < 500);
      this.booms.forEach((b) => { const k = (now - b.t) / 500; c.globalAlpha = 1 - k; c.fillStyle = '#ffd23f'; c.beginPath(); c.arc(b.x, b.y, 6 + k * b.r, 0, 7); c.fill(); c.globalAlpha = 1; });
      drawFx(c, this);
    };
    draw();
  },
  stop() { cancelAnimationFrame(this.raf); },
};

// ── Syllabes ──
GAMES.words = {
  init() {
    $('#stage').innerHTML = `<div class="sylbox" id="syl"><span>Syllabe</span><b>…</b><span id="sylwho">On allume la mèche…</span></div>
      <div class="ucturn" id="wst"></div><div class="tbar"><div id="wbar" style="width:0"></div></div>
      <div class="ucin hidden" id="win"><input id="wtxt" maxlength="30" placeholder="Un mot avec la syllabe…" autocomplete="off" autocapitalize="off" spellcheck="false">
        <button class="btn blue" id="wsend">✅ Valider</button></div>
      <div class="uclist" id="wl"></div><p class="sub">Accents facultatifs · un mot déjà dit ne compte plus</p>`;
    const n = M.players.length;
    this.lives = range(n).map(() => 2); this.typed = range(n).map(() => ''); this.last = range(n).map(() => null);
    this.cur = -1; this.syl = '';
    const go = () => { const v = $('#wtxt').value.trim(); if (v) send({ t: 'input', a: 'word', text: v }); };
    $('#wsend').onclick = go;
    $('#wtxt').addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
    $('#wtxt').addEventListener('input', () => send({ t: 'input', a: 'type', text: $('#wtxt').value }));
    this.render();
  },
  msg(m) {
    switch (m.k) {
      case 'words': this.lives = m.lives; this.render(); break;
      case 'turn': {
        this.cur = m.i; this.syl = m.syl; this.lives = m.lives; this.typed[m.i] = '';
        $('#syl b').textContent = m.syl.toUpperCase();
        $('#syl').classList.remove('hot');
        clearTimeout(this.hotT); this.hotT = setTimeout(() => $('#syl') && $('#syl').classList.add('hot'), Math.max(0, m.ms - 3000));
        $('#sylwho').innerHTML = m.i === M.me ? '<b style="font-size:16px;color:#ff4d6d;-webkit-text-stroke:0;letter-spacing:0">À TOI !</b>' : `au tour de ${esc(P(m.i).name)}`;
        $('#wst').textContent = '';
        timerBar($('#wbar'), m.ms);
        const mine = m.i === M.me;
        $('#win').classList.toggle('hidden', !mine);
        if (mine) { $('#wtxt').value = ''; $('#wtxt').focus(); SFX.play('ding'); }
        this.render();
        break;
      }
      case 'type': this.typed[m.i] = m.text; this.render(); break;
      case 'ok':
        this.last[m.i] = { t: m.text, c: 'good' }; this.typed[m.i] = '';
        if (m.i === M.me) $('#win').classList.add('hidden');
        clearTimeout(this.hotT); SFX.play('ok'); this.render();
        break;
      case 'nope':
        if (m.i === M.me) { $('#wst').textContent = '⛔ ' + m.msg; shake($('#win')); SFX.play('bad'); }
        else { this.last[m.i] = { t: m.text, c: 'bad' }; this.render(); }
        break;
      case 'boom':
        clearTimeout(this.hotT);
        this.lives = m.lives; this.typed[m.i] = '';
        if (m.i === M.me) $('#win').classList.add('hidden');
        $('#wst').innerHTML = `💥 ${pill(m.i)} a explosé sur « ${esc(m.syl.toUpperCase())} »`;
        timerBar($('#wbar'), 1);
        SFX.play('boom'); this.render();
        break;
    }
  },
  render() {
    const el = $('#wl'); if (!el) return;
    // surligne la syllabe dans le mot tapé, accents compris (« É » compte comme « e »)
    const hl = (s) => {
      const chars = [...s], flat = chars.map((ch) => ch.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''));
      const at = []; // position dans le texte sans accents → index du caractère d'origine
      flat.forEach((f, i) => { for (const _ of f) at.push(i); });
      const k = this.syl ? flat.join('').indexOf(this.syl) : -1;
      if (k < 0) return esc(s);
      const a = at[k], b = at[k + this.syl.length - 1] + 1;
      return esc(chars.slice(0, a).join('')) + '<mark>' + esc(chars.slice(a, b).join('')) + '</mark>' + esc(chars.slice(b).join(''));
    };
    el.innerHTML = M.players.map((p, i) => {
      const L = this.lives[i];
      const said = i === this.cur && this.typed[i] ? `<span class="typed">${hl(this.typed[i])}</span>`
        : this.last[i] ? `<span class="bubble ${this.last[i].c}">${esc(this.last[i].t)}</span>` : '';
      return `<div class="ucp ${L <= 0 ? 'out' : ''} ${this.cur === i ? 'speaking' : ''}" style="grid-template-columns:auto 1fr auto">${pill(i)}<span>${said}</span>
        <span class="lives">${L > 0 ? '❤️'.repeat(L) : '💀'}</span></div>`;
    }).join('');
  },
  stop() { clearTimeout(this.hotT); },
};

// ── compte à rebours dessiné dans le jeu (Envol, Circuit) : le serveur envoie `go` = secondes restantes ──
function goTrack(g, m) {
  const was = g.S.cur && g.S.cur.d.go;
  if (m.go && Math.ceil(m.go) !== g.goN) { g.goN = Math.ceil(m.go); if (!replaying) SFX.play('tick'); }
  if (!m.go && was) { g.goEnd = performance.now(); if (!replaying) SFX.play('go'); }
}
function drawGo(c, W, H, B, g) {
  const go = B.go;
  if (go) {
    const k = Math.ceil(go);
    // trois feux : rouges qui s'allument un par un
    for (let q = 0; q < 3; q++) {
      const x = W / 2 + (q - 1) * 64;
      c.fillStyle = '#1b1440'; c.beginPath(); c.arc(x, H * 0.3, 28, 0, 7); c.fill();
      c.fillStyle = q < 4 - k ? '#ff4d6d' : '#3a3166'; c.beginPath(); c.arc(x, H * 0.3, 21, 0, 7); c.fill();
    }
    strokeText(c, String(k), W / 2, H * 0.3 + 110, '#fff', 80);
  } else if (g.goEnd && performance.now() - g.goEnd < 800) {
    strokeText(c, 'GO !', W / 2, H * 0.36, '#2ee59d', 90);
  }
}

// ── Circuit (vue pilote, route pseudo-3D) ──
const DRIVEK = { ArrowUp: 'gas', KeyW: 'gas', ArrowDown: 'brake', KeyS: 'brake', ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right' };
function drawCar(c, cx, by, w, color, avatar, tilt = 0) {
  const h = w * 0.42;
  c.save(); c.translate(cx, by); c.rotate(tilt * 0.06);
  c.fillStyle = '#1b1440';
  c.fillRect(-w / 2, -h * 0.35, w * 0.16, h * 0.35); c.fillRect(w / 2 - w * 0.16, -h * 0.35, w * 0.16, h * 0.35);
  c.fillStyle = color; c.strokeStyle = '#1b1440'; c.lineWidth = Math.max(1.5, w / 50);
  c.beginPath(); c.roundRect(-w / 2, -h * 0.75, w, h * 0.5, w * 0.06); c.fill(); c.stroke();
  c.beginPath(); c.roundRect(-w * 0.3, -h, w * 0.6, h * 0.32, w * 0.08); c.fill(); c.stroke();
  c.fillStyle = 'rgba(255,255,255,.75)'; c.fillRect(-w * 0.24, -h * 0.94, w * 0.48, h * 0.2);
  c.fillStyle = '#ff4d6d'; c.fillRect(-w * 0.45, -h * 0.62, w * 0.12, h * 0.1); c.fillRect(w * 0.33, -h * 0.62, w * 0.12, h * 0.1);
  if (w > 26) { c.font = Math.round(h * 0.26) + 'px ' + EMOJI_FONT; c.textAlign = 'center'; c.fillText(avatar, 0, -h * 0.75); }
  c.restore();
}
GAMES.circuit = {
  init() {
    $('#stage').innerHTML = `<div class="screen-dark" style="padding:4px"><canvas id="cc" width="800" height="450" style="display:block;max-width:100%;border-radius:12px"></canvas></div>${legend()}
      <p class="sub">⬆ / Z accélérer · ⬇ / S freiner · ⬅ ➡ / Q D tourner · flèches jaunes = turbo</p>`;
    this.held = new Set(); this.last = ''; this.S = {}; this.raf = null; this.sky = 0; this.done = new Set();
    if (isTouch) {
      const row = document.createElement('div'); row.className = 'row'; row.style.justifyContent = 'center';
      [['⬅', 'left'], ['➡', 'right'], ['🛑', 'brake'], ['⬆ GAZ', 'gas']].forEach(([l, k]) => {
        const b = holdBtn(l, () => { this.held.add(k); this.sendDrive(); }, () => { this.held.delete(k); this.sendDrive(); });
        b.classList.add(k === 'gas' ? 'green' : 'white'); row.appendChild(b);
      });
      $('#stage').appendChild(row);
    }
  },
  sendDrive() {
    const h = this.held, m = { g: h.has('gas') ? 1 : 0, b: h.has('brake') ? 1 : 0, s: (h.has('right') ? 1 : 0) - (h.has('left') ? 1 : 0) };
    const k = m.g + ',' + m.b + ',' + m.s;
    if (k !== this.last) { this.last = k; send({ t: 'input', a: 'drive', ...m }); }
  },
  key(e) { const k = DRIVEK[e.code]; if (k) { e.preventDefault(); if (!e.repeat) { this.held.add(k); this.sendDrive(); } } },
  keyup(e) { const k = DRIVEK[e.code]; if (k) { this.held.delete(k); this.sendDrive(); } },
  blur() { this.held.clear(); this.sendDrive(); },
  msg(m) {
    if (m.k === 'track') {
      this.SEG = m.seg; this.MAX = m.max; this.LEN = m.len;
      this.segs = m.s.map(([c, y, b], i) => ({ c, y1: i ? m.s[i - 1][1] : 0, y2: y, b }));
      this.obs = m.o || [];
      M.players.forEach((_, i) => legendSet(i, ''));
      // après un refresh, le serveur garde les dernières touches reçues : on repart pédales relâchées
      if (replaying) { this.last = 'reset'; this.sendDrive(); }
      this.loop();
    }
    if (m.k === 's') { goTrack(this, m); pushSnap(this.S, m); }
    if (m.k === 'boost' && m.i === M.me) SFX.play('whoosh');
    if (m.k === 'crash' && m.i === M.me) { this.crashT = performance.now(); SFX.play('bonk'); }
    if (m.k === 'fin') { this.done.add(m.i); legendSet(m.i, `🏁 ${m.tm.toFixed(2)} s`); SFX.play(m.i === M.me ? 'win' : 'ding'); }
  },
  loop() {
    const cv = $('#cc'), c = cv.getContext('2d'), W = cv.width, H = cv.height;
    const RW = 2000, CH = 1000, DEPTH = 1 / Math.tan((50 * Math.PI) / 180), DRAW = 160, SEG = this.SEG, segs = this.segs, PZ = CH * DEPTH;
    const last = segs[segs.length - 1];
    // avant le départ et après l'arrivée : ligne droite plate
    const seg = (k) => segs[k] || { c: 0, y1: k < 0 ? 0 : last.y2, y2: k < 0 ? 0 : last.y2, b: 0 };
    // coordonnées arrondies : sinon des fentes d'un pixel laissent voir l'herbe entre deux segments
    const proj = (wy, wz, cx, cy, cz) => { const z = wz - cz, s = DEPTH / z; return { x: Math.round(W / 2 - s * cx * W / 2), y: Math.round(H / 2 - s * (wy - cy) * H / 2), w: Math.round(s * RW * W / 2), s, z }; };
    const quad = (x1, y1, w1, x2, y2, w2, col) => { c.fillStyle = col; c.beginPath(); c.moveTo(x1 - w1, y1); c.lineTo(x1 + w1, y1); c.lineTo(x2 + w2, y2); c.lineTo(x2 - w2, y2); c.closePath(); c.fill(); };
    const hills = (off, base, amp, col) => {
      c.fillStyle = col; c.beginPath(); c.moveTo(0, H / 2);
      for (let x = 0; x <= W; x += 16) { const u = x + off; c.lineTo(x, base - (Math.sin(u / 130) + 0.5 * Math.sin(u / 47) + 1.5) * amp); }
      c.lineTo(W, H / 2); c.closePath(); c.fill();
    };
    const draw = () => {
      this.raf = requestAnimationFrame(draw);
      const S = this.S; if (!S.cur) return;
      const a = alphaOf(S), A = S.prev.d.p, B = S.cur.d.p, me = M.me;
      const pz = (i) => lerp(A[i][0], B[i][0], a), px = (i) => lerp(A[i][1], B[i][1], a) / 100;
      const pos = pz(me), plx = px(me), sp = B[me][2];
      const camZ = pos - PZ, base = Math.floor(camZ / SEG), bp = (camZ - base * SEG) / SEG;
      const ps = seg(Math.floor(pos / SEG)), camY = CH + lerp(ps.y1, ps.y2, (pos % SEG) / SEG);
      this.sky += ps.c * (sp / this.MAX) * 0.9;
      // ciel, soleil, collines en parallaxe
      const g = c.createLinearGradient(0, 0, 0, H / 2); g.addColorStop(0, '#5ec8ff'); g.addColorStop(1, '#d7f3ff');
      c.fillStyle = g; c.fillRect(0, 0, W, H / 2 + 2);
      c.fillStyle = '#ffd23f'; c.beginPath(); c.arc(W * 0.78 - (this.sky * 0.1) % W, 70, 30, 0, 7); c.fill();
      hills(this.sky * 0.4, H / 2 + 4, 26, '#9b8cff');
      hills(this.sky + 500, H / 2 + 6, 14, '#4fb36b');
      c.fillStyle = '#3f9a55'; c.fillRect(0, H / 2, W, H / 2);
      // route : du plus proche au plus loin, chaque segment masque ce qui est derrière lui
      let maxy = H, x = 0, dx = -(seg(base).c * bp);
      const vis = new Map();
      for (let n = 0; n < DRAW; n++) {
        const k = base + n, s = seg(k), cx = plx * RW;
        const p1 = proj(s.y1, k * SEG, cx - x, camY, camZ), p2 = proj(s.y2, (k + 1) * SEG, cx - x - dx, camY, camZ);
        x += dx; dx += s.c;
        if (p1.z <= DEPTH || p2.y >= p1.y || p2.y >= maxy) continue;
        const dark = Math.floor(k / 3) % 2;
        c.fillStyle = dark ? '#3f9a55' : '#4aa862'; c.fillRect(0, p2.y, W, p1.y - p2.y);
        quad(p1.x, p1.y, p1.w * 1.12, p2.x, p2.y, p2.w * 1.12, dark ? '#ff4d6d' : '#fff');
        quad(p1.x, p1.y, p1.w, p2.x, p2.y, p2.w, dark ? '#5d587a' : '#66618a');
        const z0 = k * SEG;
        if (z0 >= this.LEN && z0 < this.LEN + SEG * 2 || k === 2) {
          for (let q = 0; q < 8; q++) {
            const f = -1 + q / 4, f2 = f + 0.25;
            c.fillStyle = (q + k) % 2 ? '#1b1440' : '#fff';
            c.beginPath(); c.moveTo(p1.x + p1.w * f, p1.y); c.lineTo(p1.x + p1.w * f2, p1.y); c.lineTo(p2.x + p2.w * f2, p2.y); c.lineTo(p2.x + p2.w * f, p2.y); c.fill();
          }
        } else if (!dark) {
          [-1 / 3, 1 / 3].forEach((f) => quad(p1.x + p1.w * f, p1.y, p1.w / 40, p2.x + p2.w * f, p2.y, p2.w / 40, '#fff'));
        }
        if (s.b) {
          // turbo : chevrons jaunes sur la moitié gauche (1) ou droite (2)
          const sd = s.b === 1 ? -0.5 : 0.5;
          quad(p1.x + p1.w * sd, p1.y, p1.w * 0.42, p2.x + p2.w * sd, p2.y, p2.w * 0.42, k % 2 ? '#ffd23f' : '#ff9f1c');
        }
        vis.set(k, { p1, p2, clip: maxy });
        maxy = p2.y;
      }
      // cônes, du plus loin au plus proche (masqués derrière les bosses comme les voitures)
      for (let q = this.obs.length - 1; q >= 0; q--) {
        const [k, ox] = this.obs[q], v = vis.get(k); if (!v) continue;
        const s = lerp(v.p1.s, v.p2.s, 0.5), w = s * 300 * W / 2, h = w * 1.15;
        if (w < 2) continue;
        const sx = lerp(v.p1.x, v.p2.x, 0.5) + s * ox * RW * W / 2, sy = lerp(v.p1.y, v.p2.y, 0.5);
        c.save(); c.beginPath(); c.rect(0, 0, W, v.clip); c.clip();
        c.fillStyle = '#1b1440'; c.fillRect(sx - w * 0.6, sy - h * 0.12, w * 1.2, h * 0.12);
        c.fillStyle = '#ff7a1a'; c.beginPath(); c.moveTo(sx - w / 2, sy - h * 0.1); c.lineTo(sx, sy - h); c.lineTo(sx + w / 2, sy - h * 0.1); c.closePath(); c.fill();
        c.fillStyle = '#fff'; c.beginPath(); c.moveTo(sx - w * 0.33, sy - h * 0.4); c.lineTo(sx - w * 0.2, sy - h * 0.65); c.lineTo(sx + w * 0.2, sy - h * 0.65); c.lineTo(sx + w * 0.33, sy - h * 0.4); c.closePath(); c.fill();
        if (w > 8) { c.strokeStyle = '#1b1440'; c.lineWidth = Math.max(1, w / 30); c.beginPath(); c.moveTo(sx - w / 2, sy - h * 0.1); c.lineTo(sx, sy - h); c.lineTo(sx + w / 2, sy - h * 0.1); c.stroke(); }
        c.restore();
      }
      // voitures fantômes, de la plus loin à la plus proche
      range(M.players.length).filter((i) => i !== me).map((i) => [i, pz(i)]).sort((u, v) => v[1] - u[1]).forEach(([i, z]) => {
        const v = vis.get(Math.floor(z / SEG)); if (!v) return;
        const f = (z % SEG) / SEG, s = lerp(v.p1.s, v.p2.s, f);
        const sx = lerp(v.p1.x, v.p2.x, f) + s * px(i) * RW * W / 2, sy = lerp(v.p1.y, v.p2.y, f), w = s * 760 * W / 2;
        if (w < 3) return;
        c.save(); c.beginPath(); c.rect(0, 0, W, v.clip); c.clip();
        c.globalAlpha = 0.8; drawCar(c, sx, sy, w, P(i).color, P(i).avatar);
        if (w > 30) strokeText(c, P(i).name, sx, sy - w * 0.48, P(i).color, 12);
        c.restore();
      });
      // ma voiture
      const steer = (this.held.has('right') ? 1 : 0) - (this.held.has('left') ? 1 : 0);
      const bounce = sp > 0 ? Math.sin(performance.now() / 60) * (Math.abs(plx) > 1 ? 3 : 1) : 0;
      if (B[me][4]) { c.fillStyle = 'rgba(255,159,28,.6)'; c.beginPath(); c.ellipse(W / 2, H - 10, 70, 10 + Math.random() * 6, 0, 0, 7); c.fill(); }
      drawCar(c, W / 2, H - 14 + bounce, 190, P(me).color, P(me).avatar, steer);
      // tableau de bord
      const rank = 1 + B.filter((p, i) => i !== me && (this.done.has(i) && !this.done.has(me) || p[0] > B[me][0] && this.done.has(i) === this.done.has(me))).length;
      strokeText(c, `⏱ ${S.cur.d.tm.toFixed(1)} s`, 70, 30, '#fff', 20);
      strokeText(c, `${rank}${rank === 1 ? 'er' : 'e'} / ${M.players.length}`, W - 60, 34, '#ffd23f', 26);
      strokeText(c, `${Math.round((sp / this.MAX) * 280)} km/h`, 80, H - 20, B[me][4] ? '#ff9f1c' : '#fff', 24);
      if (Math.abs(plx) > 1 && !this.done.has(me)) strokeText(c, '🌿 HORS PISTE', W / 2, 90, '#ff4d6d', 22);
      if (this.crashT && performance.now() - this.crashT < 900) strokeText(c, '💥 AÏE ! Un cône…', W / 2, 140, '#ff9f1c', 32);
      if (this.done.has(me)) strokeText(c, '🏁 ARRIVÉ !', W / 2, 120, '#2ee59d', 40);
      c.fillStyle = 'rgba(255,255,255,.85)'; c.fillRect(150, 12, W - 300, 8);
      B.forEach((p, i) => { c.fillStyle = P(i).color; c.strokeStyle = '#1b1440'; c.lineWidth = 2; c.beginPath(); c.arc(150 + (W - 300) * Math.min(1, p[0] / this.LEN), 16, i === me ? 8 : 6, 0, 7); c.fill(); c.stroke(); });
      drawGo(c, W, H, S.cur.d, this);
    };
    draw();
  },
  stop() { cancelAnimationFrame(this.raf); this.raf = null; },
};

// ── Code secret ──
const CODE_COLORS = ['#ff4d6d', '#ffd23f', '#2ee59d', '#3dd6ff', '#b388ff', '#ff9f1c'];
const CODE_NAMES = ['rouge', 'jaune', 'vert', 'bleu', 'violet', 'orange'];
GAMES.code = {
  init() {
    $('#stage').innerHTML = `<div class="ucturn" id="cst" style="margin-top:0">Prépare-toi…</div><div class="tbar" style="margin-bottom:14px"><div id="cbar" style="width:0"></div></div>
      <div class="crow" id="cslots"></div>
      <div class="crow cpal" id="cpal" style="margin:18px 0 26px">${CODE_COLORS.map((col, k) => `<button class="cdot" data-c="${k}" style="background:${col}" title="${CODE_NAMES[k]}"><small>${k + 1}</small></button>`).join('')}</div>
      <div class="crow"><button class="btn white sm" id="cdel">⌫ Effacer</button><button class="btn blue" id="cgo">✅ Proposer</button></div>
      <div class="chist" id="chist"></div>${legend()}
      <p class="sub">Clique les couleurs (ou touches 1 à 6) · ⌫ efface · Entrée propose · ⚫ bien placé · ⚪ mal placé</p>`;
    this.g = []; this.hist = []; this.len = 4; this.max = 10; this.solved = false;
    $('#cpal').addEventListener('click', (e) => { const b = e.target.closest('[data-c]'); if (b) this.add(+b.dataset.c); });
    $('#cslots').addEventListener('click', (e) => { const b = e.target.closest('[data-k]'); if (b && !this.locked()) { this.g.splice(+b.dataset.k, 1); this.render(); } });
    $('#cdel').onclick = () => { if (!this.locked()) { this.g.pop(); this.render(); } };
    $('#cgo').onclick = () => this.submit();
    this.render();
  },
  locked() { return !active || dead || this.solved || this.hist.length >= this.max; },
  add(k) { if (this.locked() || this.g.length >= this.len) return; this.g.push(k); SFX.play('tick'); this.render(); },
  submit() {
    if (this.locked() || this.g.length !== this.len) { shake($('#cslots')); return; }
    send({ t: 'input', a: 'guess', g: this.g });
    this.g = []; this.render();
  },
  key(e) {
    if (/^Digit[1-6]$|^Numpad[1-6]$/.test(e.code)) { e.preventDefault(); this.add(+e.code.slice(-1) - 1); }
    else if (e.key === 'Backspace') { e.preventDefault(); if (!this.locked()) { this.g.pop(); this.render(); } }
    else if (e.key === 'Enter') { e.preventDefault(); this.submit(); }
  },
  dot(k, extra = '', mark = '') { return `<span class="cdot ${k == null ? 'empty' : ''} ${mark ? 'mk-' + mark : ''}" ${extra} style="${k == null ? '' : `background:${CODE_COLORS[k]}`}"></span>`; },
  render() {
    $('#cslots').innerHTML = range(this.len).map((k) => (this.g[k] != null ? `<button class="cdot" data-k="${k}" style="background:${CODE_COLORS[this.g[k]]}" title="Retirer"></button>` : this.dot(null))).join('');
    // la marque est posée SUR la boule concernée : ⚫ bonne place, ⚪ présente ailleurs, rien = pas dans le code
    const say = (h) => (h.b + h.w === 0 ? 'aucune couleur du code' : [h.b && `${h.b} bien placée${h.b > 1 ? 's' : ''}`, h.w && `${h.w} mal placée${h.w > 1 ? 's' : ''}`].filter(Boolean).join(' · '));
    const who = (h) => (M.teams && h.who != null && h.who !== M.me ? ` <span class="mut">(${esc(P(h.who).name)})</span>` : '');
    $('#chist').innerHTML = (this.hist.length ? '<div class="chead"><span class="cdot mk-b mini"></span> bonne couleur, bonne place · <span class="cdot mk-w mini"></span> couleur présente mais ailleurs · sans marque = pas dans le code</div>' : '')
      + this.hist.slice().reverse().map((h) => `<div class="crow chrow"><b class="cn">${h.n}.</b>${h.g.map((k, x) => this.dot(k, '', h.mk ? h.mk[x] : '')).join('')}
      <span class="csay">${say(h)}${who(h)}</span></div>`).join('');
    $('#cgo').disabled = this.g.length !== this.len || this.locked();
  },
  msg(m) {
    if (m.k === 'code') {
      this.len = m.len; this.max = m.max;
      timerBar($('#cbar'), m.ms);
      $('#cst').textContent = `Trouve le code : ${m.len} couleurs, ${m.max} essais`;
      M.players.forEach((_, i) => legendSet(i, `0/${m.max}`));
      this.render();
    }
    if (m.k === 'fb') {
      this.hist.push(m);
      if (m.b === this.len) { this.solved = true; $('#cst').textContent = `🔓 Code cassé en ${m.n} essai${m.n > 1 ? 's' : ''} !`; SFX.play('win'); }
      else { $('#cst').textContent = m.n >= this.max ? '🔒 Plus d\'essais… on attend les autres' : `Essai ${m.n} / ${this.max} : ${m.b} bien placée${m.b > 1 ? 's' : ''}, ${m.w} mal placée${m.w > 1 ? 's' : ''}`; SFX.play(m.b + m.w ? 'ok' : 'bad'); }
      this.render();
    }
    if (m.k === 'prog') m.tries.forEach((n, i) => legendSet(i, m.done[i] ? `🔓 ${n}` : `${n}/${this.max}`));
  },
};

// ── Serpents ──
GAMES.snake = {
  init() {
    $('#stage').innerHTML = `<div class="screen-dark"><canvas id="snc"></canvas></div>${legend()}<p class="sub">Flèches ou ZQSD · mange les 🍎 · anneau blanc = toi</p>`;
    $('#stage').appendChild(dpad((d) => send({ t: 'input', a: 'dir', d })));
    this.C = 18; this.raf = null; this.started = false;
  },
  key(e) { const d = DIRK[e.code]; if (d) { e.preventDefault(); send({ t: 'input', a: 'dir', d }); } },
  msg(m) {
    if (m.k === 'snake') {
      this.W = m.w; this.H = m.h; this.b = m.b; this.f = m.f; this.dir = m.dir;
      this.C = Math.floor(Math.min(820 / m.w, 520 / m.h));
      const cv = $('#snc'); cv.width = m.w * this.C; cv.height = m.h * this.C;
      M.players.forEach((_, i) => legendSet(i, String(m.b[i].length)));
      this.loop();
    }
    if (m.k === 's') {
      if (!this.started) this.started = true;
      const ate = m.b.some((b, i) => b.length > (this.b[i] || []).length && b.length);
      this.b = m.b; this.f = m.f;
      m.b.forEach((b, i) => legendSet(i, b.length ? String(b.length) : '💀'));
      if (m.d.length) SFX.play('boom'); else if (ate) SFX.play('ok');
    }
  },
  loop() {
    const c = $('#snc').getContext('2d');
    const draw = () => {
      this.raf = requestAnimationFrame(draw);
      const C = this.C, W = this.W, now = performance.now();
      c.fillStyle = '#163a2a'; c.fillRect(0, 0, W * C, this.H * C);
      c.fillStyle = 'rgba(255,255,255,.05)';
      for (let y = 0; y < this.H; y++) for (let x = (y % 2); x < W; x += 2) c.fillRect(x * C, y * C, C, C);
      // les emojis prennent l'opacité de fillStyle : on repart d'une couleur opaque
      c.font = Math.round(C * 0.9) + 'px ' + EMOJI_FONT; c.textAlign = 'center'; c.fillStyle = '#000';
      this.f.forEach((f) => c.fillText('🍎', (f % W) * C + C / 2, Math.floor(f / W) * C + C * 0.82));
      this.b.forEach((body, i) => {
        if (!body.length) return;
        const col = P(i).color;
        body.slice().reverse().forEach((cell, k) => {
          const x = (cell % W) * C, y = Math.floor(cell / W) * C, head = k === body.length - 1;
          c.fillStyle = col; c.strokeStyle = '#1b1440'; c.lineWidth = 2;
          c.beginPath(); c.roundRect(x + 1, y + 1, C - 2, C - 2, head ? C * 0.45 : C * 0.25); c.fill(); c.stroke();
          if (!head && k % 2) { c.fillStyle = 'rgba(255,255,255,.25)'; c.fillRect(x + C * 0.3, y + C * 0.3, C * 0.4, C * 0.4); }
        });
        const h = body[0], hx = (h % W) * C + C / 2, hy = Math.floor(h / W) * C + C / 2;
        c.font = Math.round(C * 0.85) + 'px ' + EMOJI_FONT; c.fillStyle = '#000'; c.fillText(P(i).avatar, hx, hy + C * 0.3);
        if (i === M.me) {
          c.strokeStyle = '#fff'; c.lineWidth = 3; c.beginPath(); c.arc(hx, hy, C * (1 + 0.2 * Math.sin(now / 120)), 0, 7); c.stroke();
          if (!this.started) strokeText(c, '▼ TOI ▼', hx, Math.max(16, hy - C * 1.4), '#fff', 15);
        }
      });
    };
    draw();
  },
  stop() { cancelAnimationFrame(this.raf); this.raf = null; },
};

// ── Envol ──
GAMES.flap = {
  init() {
    $('#stage').innerHTML = `<div class="screen-dark"><canvas id="flc" width="800" height="500" style="touch-action:manipulation"></canvas></div>${legend()}
      <p class="sub">ESPACE, ⬆, clic ou tap = battre des ailes · les fantômes transparents sont les autres</p>`;
    this.S = {}; this.raf = null;
    $('#flc').addEventListener('pointerdown', (e) => { e.preventDefault(); this.flap(); });
  },
  flap() { if (active && !dead) { send({ t: 'input', a: 'flap' }); SFX.play('tick'); } },
  key(e) { if (e.code === 'Space' || e.code === 'ArrowUp' || e.code === 'KeyW') { e.preventDefault(); if (!e.repeat) this.flap(); } },
  msg(m) {
    if (m.k === 'flap') { Object.assign(this, { W: m.w, H: m.h, BX: m.bx, BR: m.br, PW: m.pw, gates: m.gates }); this.loop(); }
    if (m.k === 's') {
      if (this.S.cur) m.p.forEach((p, i) => { if (!p[1] && this.S.cur.d.p[i][1]) legendSet(i, '💀'); });
      goTrack(this, m);
      pushSnap(this.S, m);
    }
  },
  loop() {
    const c = $('#flc').getContext('2d');
    const draw = () => {
      this.raf = requestAnimationFrame(draw);
      const S = this.S; if (!S.cur) return;
      const a = alphaOf(S), A = S.prev.d, B = S.cur.d, W = this.W, H = this.H, d = lerp(A.d, B.d, a);
      const g = c.createLinearGradient(0, 0, 0, H); g.addColorStop(0, '#ff9f7a'); g.addColorStop(1, '#ffd9a8');
      c.fillStyle = g; c.fillRect(0, 0, W, H);
      // immeubles au loin
      c.fillStyle = 'rgba(107,63,150,.35)';
      for (let k = -1; k < 12; k++) { const x = k * 90 - (d * 0.25) % 90, h = 80 + ((k + Math.floor(d * 0.25 / 90)) * 37 % 5) * 30; c.fillRect(x, H - 28 - h, 70, h); }
      // cheminées
      this.gates.forEach(([x, y, gap]) => {
        const sx = x - d; if (sx < -this.PW || sx > W) return;
        const top = y - gap / 2, bot = y + gap / 2;
        [[0, top], [bot, H - 28]].forEach(([y0, y1]) => {
          c.fillStyle = '#b5541b'; c.fillRect(sx, y0, this.PW, y1 - y0);
          c.strokeStyle = 'rgba(27,20,64,.35)'; c.lineWidth = 1;
          for (let yy = y0 + 10; yy < y1; yy += 12) { c.beginPath(); c.moveTo(sx, yy); c.lineTo(sx + this.PW, yy); c.stroke(); }
          c.strokeStyle = '#1b1440'; c.lineWidth = 3; c.strokeRect(sx, y0, this.PW, y1 - y0);
        });
        c.fillStyle = '#5d587a'; c.strokeStyle = '#1b1440'; c.lineWidth = 3;
        c.fillRect(sx - 6, top - 16, this.PW + 12, 16); c.strokeRect(sx - 6, top - 16, this.PW + 12, 16);
        c.fillRect(sx - 6, bot, this.PW + 12, 16); c.strokeRect(sx - 6, bot, this.PW + 12, 16);
      });
      c.fillStyle = '#4fb36b'; c.fillRect(0, H - 28, W, 28); c.fillStyle = '#1b1440'; c.fillRect(0, H - 28, W, 3);
      // oiseaux : les autres en transparence, moi par-dessus
      const order = range(M.players.length).filter((i) => i !== M.me).concat([M.me]);
      order.forEach((i) => {
        const p = B.p[i], pp = A.p[i] || p, y = lerp(pp[0], p[0], a), x = this.BX;
        c.globalAlpha = i === M.me ? 1 : 0.45;
        if (!p[1]) { c.font = '24px ' + EMOJI_FONT; c.textAlign = 'center'; c.fillText('💀', x, y + 8); c.globalAlpha = 1; return; }
        const up = p[2];
        c.fillStyle = '#fff'; c.strokeStyle = '#1b1440'; c.lineWidth = 2;
        c.beginPath(); c.moveTo(x - 6, y); c.lineTo(x - 26, y + (up ? -16 : 10)); c.lineTo(x - 10, y + 8); c.closePath(); c.fill(); c.stroke();
        c.beginPath(); c.arc(x, y, this.BR + 3, 0, 7); c.fillStyle = P(i).color; c.fill(); c.lineWidth = 3; c.strokeStyle = i === M.me ? '#fff' : '#1b1440'; c.stroke();
        c.font = '16px ' + EMOJI_FONT; c.textAlign = 'center'; c.fillText(P(i).avatar, x, y + 6);
        if (i === M.me) strokeText(c, 'TOI', x, y - this.BR - 10, '#fff', 12);
        c.globalAlpha = 1;
      });
      const passed = this.gates.filter(([x]) => x + this.PW < this.BX + d).length;
      strokeText(c, `🏭 ${passed}`, 50, 34, '#fff', 24);
      drawGo(c, W, H, B, this);
    };
    draw();
  },
  stop() { cancelAnimationFrame(this.raf); this.raf = null; },
};

// ── Déminage ──
GAMES.mines2 = {
  init() {
    $('#stage').innerHTML = `<div class="ucturn" id="dmt" style="margin-top:0">Prépare-toi…</div><div class="tbar" style="margin-bottom:12px"><div id="dmbar" style="width:0"></div></div>
      <div class="msgrid" id="dmg"></div>${legend()}
      <p class="sub">Clic = ouvrir · clic droit / appui long = 🚩 · double-clic sur un chiffre = ouvrir autour</p>`;
    this.flags = new Set(); this.num = new Map(); this.stunUntil = 0; this.lp = null;
    const g = $('#dmg');
    g.addEventListener('contextmenu', (e) => { e.preventDefault(); const b = e.target.closest('[data-c]'); if (b) this.flag(+b.dataset.c); });
    g.addEventListener('pointerdown', (e) => {
      const b = e.target.closest('[data-c]'); if (!b || e.button === 2) return;
      const c = +b.dataset.c;
      if (e.pointerType === 'touch') { this.lpDone = false; clearTimeout(this.lp); this.lp = setTimeout(() => { this.lpDone = true; this.flag(c); }, 380); }
    });
    g.addEventListener('pointerup', () => clearTimeout(this.lp));
    g.addEventListener('click', (e) => { const b = e.target.closest('[data-c]'); if (!b || this.lpDone) { this.lpDone = false; return; } this.open(+b.dataset.c); });
    g.addEventListener('dblclick', (e) => { const b = e.target.closest('[data-c]'); if (b) this.chord(+b.dataset.c); });
  },
  nb(c) { const W = this.W, H = this.H, x = c % W, y = Math.floor(c / W), o = []; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const X = x + dx, Y = y + dy; if ((dx || dy) && X >= 0 && Y >= 0 && X < W && Y < H) o.push(Y * W + X); } return o; },
  can() { return active && !dead && !this.finished && performance.now() >= this.stunUntil; },
  open(c) {
    if (!this.can()) { if (performance.now() < this.stunUntil) shake($('#dmg')); return; }
    if (this.num.has(c) || this.flags.has(c)) return;
    send({ t: 'input', a: 'open', c });
  },
  // double-clic sur un chiffre : si assez de drapeaux autour, on ouvre les autres voisines
  chord(c) {
    if (!this.num.has(c) || !this.can()) return;
    const around = this.nb(c);
    if (around.filter((o) => this.flags.has(o)).length !== this.num.get(c)) return;
    around.forEach((o) => { if (!this.num.has(o) && !this.flags.has(o)) send({ t: 'input', a: 'open', c: o }); });
  },
  flag(c) {
    if (!active || dead || this.num.has(c)) return;
    if (this.flags.has(c)) this.flags.delete(c); else this.flags.add(c);
    this.paint(c); SFX.play('tick');
  },
  paint(c) {
    const b = this.cells[c]; if (!b) return;
    if (this.num.has(c)) { const v = this.num.get(c); b.className = 'o' + (v ? ' n' + v : ''); b.textContent = v || ''; }
    else if (this.flags.has(c)) { b.className = ''; b.textContent = '🚩'; }
    else { b.className = ''; b.textContent = ''; }
  },
  msg(m) {
    if (m.k === 'grid') {
      this.W = m.w; this.H = m.h; this.safe = m.w * m.h - m.nm;
      const g = $('#dmg'); g.style.gridTemplateColumns = `repeat(${m.w}, 1fr)`;
      g.innerHTML = range(m.w * m.h).map((c) => `<button data-c="${c}"></button>`).join('');
      this.cells = [...g.children];
      m.open.forEach(([c, v]) => { this.num.set(c, v); this.paint(c); });
      timerBar($('#dmbar'), m.ms);
      $('#dmt').textContent = `💣 ${m.nm} mines · ouvre toutes les autres cases`;
    }
    if (m.k === 'open') {
      m.cells.forEach(([c, v]) => { this.num.set(c, v); this.flags.delete(c); this.paint(c); });
      SFX.play(m.cells.length > 4 ? 'whoosh' : 'tick');
      if (this.num.size >= this.safe) { this.finished = true; $('#dmt').textContent = '✅ Grille déminée !'; SFX.play('win'); }
    }
    if (m.k === 'boom') {
      this.stunUntil = performance.now() + m.ms;
      this.flags.add(m.c); this.paint(m.c); this.cells[m.c].classList.add('m'); this.cells[m.c].textContent = '💥';
      $('#dmg').classList.add('off'); SFX.play('boom'); shake($('#dmg'));
      $('#dmt').textContent = '💥 BOUM ! Sonné 4 s…';
      clearTimeout(this.st);
      this.st = setTimeout(() => { $('#dmg') && $('#dmg').classList.remove('off'); if ($('#dmt') && !this.finished) $('#dmt').textContent = 'C\'est reparti !'; if (this.cells[m.c]) this.paint(m.c); }, m.ms);
    }
    if (m.k === 'prog') m.p.forEach((p, i) => legendSet(i, `${Math.floor(p * 100)} %${m.b[i] ? ' 💥'.repeat(Math.min(3, m.b[i])) : ''}`));
  },
  stop() { clearTimeout(this.st); clearTimeout(this.lp); },
};

// ════════════════ chat du salon ════════════════
// Dispo dans le salon et pendant les parties. Fermé : un compteur + les derniers messages en aperçu 5 s.
let chatOpen = false, chatUnread = 0;
const chatLine = (m) => `<div class="cm"><b style="color:${PALETTE[m.id % PALETTE.length]};-webkit-text-stroke:.4px var(--line)">${esc(m.av)} ${esc(m.name)}</b> ${esc(m.text)}</div>`;
function chatAdd(m) {
  const log = $('#chatLog');
  const empty = log.querySelector('.empty'); if (empty) empty.remove();
  log.insertAdjacentHTML('beforeend', chatLine(m));
  while (log.children.length > 80) log.firstChild.remove();
  log.scrollTop = log.scrollHeight;
  if (chatOpen || (room && m.id === room.you)) return; // ses propres messages ne sont pas « non lus »
  chatUnread++; $('#chatN').textContent = chatUnread; $('#chatN').classList.remove('hidden');
  const pk = $('#chatPeek');
  pk.insertAdjacentHTML('beforeend', chatLine(m));
  const el = pk.lastElementChild; setTimeout(() => el.remove(), 5000);
  while (pk.children.length > 3) pk.firstChild.remove();
  if (!replaying) SFX.play('tick');
}
function chatToggle(open = !chatOpen) {
  chatOpen = open;
  $('#chatBox').classList.toggle('hidden', !open);
  if (!open) return;
  chatUnread = 0; $('#chatN').classList.add('hidden'); $('#chatPeek').innerHTML = '';
  $('#chatLog').scrollTop = $('#chatLog').scrollHeight; $('#chatIn').focus();
}
function chatShow(on) {
  $('#chat').classList.toggle('hidden', !on);
  if (on) return;
  chatToggle(false); chatUnread = 0; $('#chatN').classList.add('hidden'); $('#chatPeek').innerHTML = '';
  $('#chatLog').innerHTML = '<div class="empty">Personne n\'a encore écrit. Dis bonjour 👋</div>';
}
chatShow(false);
$('#chatBtn').onclick = () => chatToggle();
$('#chatForm').onsubmit = (e) => {
  e.preventDefault();
  const v = $('#chatIn').value.trim();
  // Entrée sur un champ vide = on referme et on rend le clavier au jeu
  if (!v) { chatToggle(false); $('#chatIn').blur(); return; }
  send({ t: 'chat', text: v }); $('#chatIn').value = '';
};
$('#chatIn').addEventListener('keydown', (e) => { if (e.key === 'Escape') { chatToggle(false); $('#chatIn').blur(); } });

// ════════════════ accueil / salon ════════════════
const params = new URLSearchParams(location.search);
if (params.get('code')) $('#code').value = params.get('code').toUpperCase();
try { $('#name').value = localStorage.getItem('clutch-name') || ''; } catch {}
setAvatar(myAvatar);
$('#avBig').onclick = () => $('#avGrid').classList.toggle('hidden');
$('#btnMute').textContent = SFX.muted ? '🔇' : '🔊';
$('#btnMute').onclick = () => { $('#btnMute').textContent = SFX.toggle() ? '🔇' : '🔊'; };

function getName() {
  if (me) { SFX.unlock(); return me.name; }
  const n = $('#name').value.trim();
  if (!n) { $('#homeErr').textContent = 'Choisis un pseudo 😉'; $('#name').focus(); shake($('#name')); return null; }
  try { localStorage.setItem('clutch-name', n); } catch {}
  SFX.unlock();
  return n;
}
$('#btnCreate').onclick = () => {
  const name = getName(); if (!name) return;
  $('#homeErr').textContent = '';
  send({ t: 'create', name, avatar: myAvatar });
};
$('#btnJoin').onclick = () => {
  const name = getName(); if (!name) return;
  const code = $('#code').value.trim().toUpperCase();
  if (code.length !== 4) { $('#homeErr').textContent = 'Le code fait 4 lettres.'; return; }
  $('#homeErr').textContent = '';
  send({ t: 'join', code, name, avatar: myAvatar });
};
$('#code').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#btnJoin').click(); });
$('#name').addEventListener('keydown', (e) => { if (e.key === 'Enter') ($('#code').value.trim() ? $('#btnJoin') : $('#btnCreate')).click(); });

const isHost = () => room && room.you === room.host;
$('#modes').addEventListener('click', (e) => { const b = e.target.closest('[data-mode]'); if (b && isHost()) send({ t: 'cfg', mode: b.dataset.mode }); });
$('#rounds').addEventListener('click', (e) => {
  if (!isHost()) return;
  const g = e.target.closest('[data-goal]'); if (g) send({ t: 'cfg', goal: g.dataset.goal });
  const b = e.target.closest('[data-r]'); if (b) send({ t: 'cfg', [room.goal === 'points' ? 'target' : 'rounds']: +b.dataset.r });
});
$('#gamesList').addEventListener('click', (e) => { const b = e.target.closest('[data-game]'); if (b && isHost()) send({ t: 'cfg', game: b.dataset.game }); });
$('#teams').addEventListener('click', (e) => {
  const b = e.target.closest('[data-team]'); if (b) send({ t: 'team', team: +b.dataset.team });
  const f = e.target.closest('[data-addfriend]'); if (f) { send({ t: 'friendAdd', name: f.dataset.addfriend }); f.remove(); toast('✉️ Demande d\'ami envoyée'); }
});
$('#btnLeave').onclick = leaveToMenu;
$('#btnMenu').onclick = backToMenu;
let CATALOG = [];
$('#btnGames').onclick = () => {
  $('#gmBody').innerHTML = CATALOG.map((g) => `<div class="gmrow"><span class="i">${g.icon}</span><div><b>${esc(g.title)}</b><small>${esc(g.desc)}</small><p>${esc(g.rules)}</p>${keysHTML(g.keys, g.touch)}</div></div>`).join('') || '<p class="mut">Connexion au serveur…</p>';
  $('#gamesModal').classList.remove('hidden');
};
$('#gamesModal').addEventListener('click', (e) => { if (e.target.id === 'gamesModal' || e.target.closest('#gmClose')) $('#gamesModal').classList.add('hidden'); });
$('#btnStart').onclick = () => { SFX.unlock(); send({ t: 'start' }); };
$('#btnCopy').onclick = async () => {
  const link = location.origin + '/?code=' + room.code;
  try { await navigator.clipboard.writeText(link); $('#btnCopy').textContent = '✅ Lien copié !'; }
  catch { $('#btnCopy').textContent = link; }
  setTimeout(() => { $('#btnCopy').textContent = "📋 Copier le lien d'invitation"; }, 2000);
};
document.addEventListener('pointerdown', () => SFX.unlock(), { once: true });
// au chargement : si on revient d'un refresh en pleine partie, on attend la reprise avant d'afficher l'accueil
if (store.get('clutch-resume', true)) { show('lobby'); $('#netbar').classList.remove('hidden'); }
connect();
