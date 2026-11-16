// CLUTCH — client : comptes, profil, personnalisation, amis, notifications
'use strict';

// ════════════════ notifications ════════════════
function toast(html, actions = [], ms = 6000) {
  const t = document.createElement('div');
  t.className = 'notif';
  t.innerHTML = `<div>${html}</div>`;
  if (actions.length) {
    const row = document.createElement('div'); row.className = 'row'; row.style.marginTop = '6px';
    actions.forEach(([label, fn, cls]) => {
      const b = document.createElement('button'); b.className = 'btn sm ' + (cls || 'white'); b.textContent = label;
      b.onclick = () => { fn(); t.remove(); };
      row.appendChild(b);
    });
    t.appendChild(row);
  }
  $('#notifs').prepend(t);
  t.animate([{ opacity: 0, transform: 'translateY(-14px)' }, { opacity: 1, transform: 'none' }], { duration: 250 });
  setTimeout(() => t.remove(), ms);
  while ($('#notifs').children.length > 4) $('#notifs').lastChild.remove();
}

// ════════════════ messages liés au compte ════════════════
function onAccountMsg(m) {
  switch (m.t) {
    case 'me':
      me = m.me;
      renderAccount();
      if (room) renderLobby();
      if (!$('#custom').classList.contains('hidden')) renderCustom();
      break;
    case 'token':
      store.set('clutch-token', m.token);
      $('#aPass').value = '';
      $('#aErr').textContent = '';
      break;
    case 'tokenBad':
      store.del('clutch-token');
      break;
    case 'authErr':
      $('#aErr').textContent = m.msg;
      shake($('#acctOut'));
      break;
    case 'acctOk':
      if (m.k === 'forgot') { $('#aErr').textContent = ''; toast('📧 ' + esc(m.msg), [], 10000); showAuthForm(); }
      else if (m.k === 'reset') { $('#resetModal').classList.add('hidden'); toast('🔑 ' + esc(m.msg)); }
      else { $('#mErr').textContent = ''; $('#mPass').value = ''; toast(esc(m.msg)); }
      SFX.play('ok');
      break;
    case 'acctErr': {
      const box = m.k === 'reset' ? '#rErr' : m.k === 'rename' || m.k === 'email' ? '#mErr' : '#aErr';
      $(box).textContent = m.msg;
      shake($(box).parentElement);
      break;
    }
    case 'friends':
      friendsData = m;
      renderFriends();
      if (room) renderLobby();
      break;
    case 'friendPing':
      toast(`👋 <b>${esc(m.from.name)}</b> veut être ton ami`, [['Accepter', () => send({ t: 'friendAccept', id: m.from.id }), 'green'], ['Plus tard', () => {}]], 12000);
      SFX.play('ding');
      break;
    case 'invited':
      toast(`🎮 <b>${esc(m.from.name)}</b> t'invite dans son salon <b>${esc(m.code)}</b>`,
        [['Rejoindre', () => joinCode(m.code), 'green'], ['Non merci', () => {}]], 20000);
      SFX.play('ding');
      break;
    case 'info':
      toast(esc(m.msg));
      break;
    case 'xp':
      showXp(m);
      break;
  }
}

function joinCode(code) {
  if (M) return toast('Termine ton match avant de rejoindre un autre salon.');
  const name = getName(); if (!name) return;
  send({ t: 'join', code, name, avatar: myAvatar });
}

// ════════════════ carte compte (accueil) ════════════════
let authMode = 'login';
function renderAccount() {
  $('#acctOut').classList.toggle('hidden', !!me);
  $('#acctIn').classList.toggle('hidden', !me);
  $('#friendsHome').classList.toggle('hidden', !me);
  if (!me) return;
  const span = me.xpNext - me.xpLevel, into = me.xp - me.xpLevel;
  const st = me.stats || { matches: 0, wins: 0, rounds: 0 };
  $('#acctIn').innerHTML = `<div class="profile">
      <div class="avbig fr-${me.frame}" style="--pc:#ffd23f">${esc(me.avatar)}</div>
      <div class="grow">
        <div class="pname">${esc(me.name)} <span class="lv big">Nv ${me.level}</span></div>
        ${me.title ? `<div class="ptitle">« ${esc(COSMETICS.titleName(me.title))} »</div>` : ''}
        <div class="xpbar"><div style="width:${Math.round((into / span) * 100)}%"></div></div>
        <div class="mut">${into} / ${span} XP avant le niveau ${me.level + 1}</div>
      </div>
    </div>
    <div class="statsrow"><span>🎮 ${st.matches} partie${st.matches > 1 ? 's' : ''}</span><span>🏆 ${st.wins} victoire${st.wins > 1 ? 's' : ''}</span><span>⭐ ${st.rounds} manches gagnées</span></div>
    ${me.email ? '' : `<div class="mailwarn">⚠️ Ton compte n'a pas d'email : sans lui, impossible de le récupérer si tu oublies ton mot de passe.
      <div style="margin-top:6px"><button class="btn sm blue" data-act="account">✉️ Ajouter mon email</button></div></div>`}
    <div class="row" style="margin-top:12px"><button class="btn pink" data-act="custom">🎨 Personnaliser</button><button class="btn white sm" data-act="account">⚙️ Compte</button><button class="btn white sm" data-act="logout">Déconnexion</button></div>`;
  if (!$('#acctModal').classList.contains('hidden')) fillAccountModal();
}

// ════════════════ mon compte : pseudo, email ════════════════
function fillAccountModal() {
  if (document.activeElement !== $('#mName')) $('#mName').value = me.name;
  if (document.activeElement !== $('#mEmail')) $('#mEmail').value = me.email || '';
  $('#btnEmail').textContent = me.email ? "Changer l'email" : "Enregistrer l'email";
}
function openAccount() {
  if (!me) return;
  $('#mErr').textContent = ''; $('#mPass').value = '';
  $('#acctModal').classList.remove('hidden');
  fillAccountModal();
  if (!me.email) $('#mEmail').focus();
}
$('#acctModal').addEventListener('click', (e) => { if (e.target.id === 'acctModal' || e.target.closest('#acctClose')) $('#acctModal').classList.add('hidden'); });
$('#btnRename').onclick = () => {
  const name = $('#mName').value.trim();
  if (name && me && name !== me.name) send({ t: 'rename', name });
};
$('#mName').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#btnRename').click(); });
$('#btnEmail').onclick = () => {
  const email = $('#mEmail').value.trim(), pass = $('#mPass').value;
  if (!email || !pass) { $('#mErr').textContent = 'Email et mot de passe actuel requis.'; return; }
  send({ t: 'setEmail', email, pass });
};
$('#mPass').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#btnEmail').click(); });

// ════════════════ mot de passe oublié ════════════════
function showAuthForm() { $('#forgotForm').classList.add('hidden'); $('#authForm').classList.remove('hidden'); }
$('#btnForgot').onclick = () => {
  $('#aErr').textContent = '';
  $('#authForm').classList.add('hidden'); $('#forgotForm').classList.remove('hidden');
  const v = $('#aName').value.trim();
  if (v.includes('@')) $('#fEmail').value = v;
  $('#fEmail').focus();
};
$('#btnForgotBack').onclick = () => { $('#aErr').textContent = ''; showAuthForm(); };
$('#btnSendReset').onclick = () => {
  const email = $('#fEmail').value.trim();
  if (!email.includes('@')) { $('#aErr').textContent = 'Entre ton adresse email.'; return; }
  send({ t: 'forgot', email });
};
$('#fEmail').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#btnSendReset').click(); });
// lien reçu par email : /?reset=JETON
const resetToken = new URLSearchParams(location.search).get('reset');
if (resetToken) {
  history.replaceState(null, '', location.pathname);
  $('#resetModal').classList.remove('hidden');
  $('#rPass').focus();
}
$('#btnReset').onclick = () => {
  const a = $('#rPass').value, b = $('#rPass2').value;
  if (a.length < 4) { $('#rErr').textContent = 'Mot de passe : 4 caractères minimum.'; return; }
  if (a !== b) { $('#rErr').textContent = 'Les deux mots de passe ne sont pas identiques.'; return; }
  send({ t: 'resetPass', token: resetToken, pass: a });
};
$('#rPass2').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#btnReset').click(); });
$('#btnResetCancel').onclick = () => $('#resetModal').classList.add('hidden');

$('#acct').addEventListener('click', (e) => {
  const tab = e.target.closest('[data-tab]');
  if (tab) {
    authMode = tab.dataset.tab;
    document.querySelectorAll('#acct .tab').forEach((x) => x.classList.toggle('on', x === tab));
    $('#btnAuth').textContent = authMode === 'login' ? 'Se connecter' : 'Créer mon compte';
    $('#aPass').autocomplete = authMode === 'login' ? 'current-password' : 'new-password';
    $('#aName').placeholder = authMode === 'login' ? 'Pseudo ou email' : 'Pseudo';
    $('#aName').maxLength = authMode === 'login' ? 254 : 16;
    $('#aEmail').classList.toggle('hidden', authMode === 'login');
    $('#btnForgot').classList.toggle('hidden', authMode !== 'login');
    $('#aErr').textContent = '';
    showAuthForm();
  }
  const act = e.target.closest('[data-act]');
  if (act && act.dataset.act === 'custom') openCustom();
  if (act && act.dataset.act === 'account') openAccount();
  if (act && act.dataset.act === 'logout') { store.del('clutch-token'); send({ t: 'logout' }); friendsData = null; renderFriends(); }
});
function doAuth() {
  const name = $('#aName').value.trim(), pass = $('#aPass').value, email = $('#aEmail').value.trim();
  if (!name || !pass) { $('#aErr').textContent = 'Pseudo et mot de passe requis.'; return; }
  if (authMode === 'register' && !email) { $('#aErr').textContent = 'Email requis (pour récupérer ton compte).'; return; }
  SFX.unlock();
  send(authMode === 'register' ? { t: 'register', name, pass, email } : { t: 'login', name, pass });
}
$('#btnAuth').onclick = doAuth;
$('#aPass').addEventListener('keydown', (e) => { if (e.key === 'Enter') doAuth(); });

// ════════════════ fin de match : XP ════════════════
function showXp(m) {
  const box = $('#ovXp');
  if (!box) return;
  if (m.guest) {
    box.innerHTML = `<div class="xpbox">🔒 Crée un compte pour gagner de l'XP, monter de niveau et débloquer des skins.</div>`;
    return;
  }
  const span = m.xpNext - m.xpLevel, into = m.xp - m.xpLevel;
  const up = m.level > m.prevLevel;
  box.innerHTML = `<div class="xpbox ${up ? 'up' : ''}">
    <div><b>+${m.gained} XP</b> ${up ? `· <b>NIVEAU ${m.level} !</b> 🎉` : `· niveau ${m.level}`}</div>
    <div class="xpbar"><div style="width:${Math.round((into / span) * 100)}%"></div></div>
    ${m.unlocks.length ? `<div style="margin-top:6px">🔓 Débloqué : ${m.unlocks.map(esc).join(', ')}</div>` : ''}</div>`;
  if (up) { Confetti.burst(200); SFX.play('win'); }
}

// ════════════════ personnalisation ════════════════
function openCustom() { if (!me) return; $('#custom').classList.remove('hidden'); renderCustom(); }
$('#custom').addEventListener('click', (e) => {
  if (e.target.id === 'custom' || e.target.closest('#customClose')) { $('#custom').classList.add('hidden'); return; }
  const b = e.target.closest('[data-eq]');
  if (!b || b.classList.contains('locked')) return;
  const [kind, val] = [b.dataset.eq, b.dataset.v];
  send({ t: 'equip', [kind]: val });
  SFX.play('ok');
});
function renderCustom() {
  if (!me) return;
  const L = me.level, C = COSMETICS;
  const lock = (lvl) => (lvl > L ? `<span class="lock">🔒 Nv ${lvl}</span>` : '');
  const avatars = [...C.BASE_AVATARS.map((a) => [a, 1]), ...C.LOCKED_AVATARS];
  $('#customBody').innerHTML = `
    <div class="lbl">Aperçu</div>
    <div style="margin-bottom:14px">${pillRaw(me, '#3dd6ff')} ${me.title ? `<span class="ptitle">« ${esc(C.titleName(me.title))} »</span>` : ''}</div>
    <div class="lbl">Avatar</div>
    <div class="cgrid">${avatars.map(([a, l]) => `<button class="citem ${me.avatar === a ? 'on' : ''} ${l > L ? 'locked' : ''}" data-eq="avatar" data-v="${a}"><span style="font-size:28px">${a}</span>${lock(l)}</button>`).join('')}</div>
    <div class="lbl" style="margin-top:16px">Cadre</div>
    <div class="cgrid wide">${C.FRAMES.map((f) => `<button class="citem ${me.frame === f.id ? 'on' : ''} ${f.lvl > L ? 'locked' : ''}" data-eq="frame" data-v="${f.id}">
      <span class="pill fr-${f.id}" style="background:#ff5fa2;--pc:#ff5fa2"><span class="av">${esc(me.avatar)}</span>${esc(f.name)}</span>${lock(f.lvl)}</button>`).join('')}</div>
    <div class="lbl" style="margin-top:16px">Titre</div>
    <div class="cgrid wide">${C.TITLES.map((t) => `<button class="citem ${me.title === t.id ? 'on' : ''} ${t.lvl > L ? 'locked' : ''}" data-eq="title" data-v="${t.id}"><span>${esc(t.name)}</span>${lock(t.lvl)}</button>`).join('')}</div>
    <p class="mut" style="margin-top:14px">Tu gagnes de l'XP à chaque match (participation, manches gagnées, victoire). Chaque niveau débloque de nouveaux skins.</p>`;
}

// ════════════════ amis ════════════════
const STATUS = {
  offline: ['⚫', 'Hors ligne'], online: ['🟢', 'En ligne'], lobby: ['🎮', 'Dans un salon'], game: ['⚔️', 'En pleine partie'],
};
function renderFriends() {
  const boxes = [$('#friendsHome'), $('#friendsLobby')];
  boxes.forEach((b) => b.classList.toggle('hidden', !me));
  if (!me) return;
  const F = friendsData || { friends: [], reqIn: [], reqOut: [] };
  const order = { lobby: 0, game: 1, online: 2, offline: 3 };
  const list = [...F.friends].sort((a, b) => order[a.status] - order[b.status] || a.name.localeCompare(b.name));
  const nOn = list.filter((f) => f.status !== 'offline').length;
  const inRoom = room && room.code;
  const html = `<div class="lbl">👥 Amis <span class="mut" style="text-transform:none;letter-spacing:0;font-family:var(--body)">${nOn} en ligne</span></div>
    <div class="row"><input class="grow fadd" maxlength="16" placeholder="Pseudo d'un pote"><button class="btn sm blue" data-fa="add">➕ Ajouter</button></div>
    ${F.reqIn.length ? `<div class="flbl">Demandes reçues</div>${F.reqIn.map((u) => `<div class="frow">${pillRaw(u, '#ffd23f')}<span class="grow"></span>
      <button class="btn sm green" data-fa="accept" data-id="${u.id}">✔</button><button class="btn sm white" data-fa="remove" data-id="${u.id}">✖</button></div>`).join('')}` : ''}
    ${list.length ? list.map((f) => {
      const [ic, label] = STATUS[f.status] || STATUS.offline;
      const here = inRoom && f.code === room.code;
      let btn = '';
      if (f.status === 'lobby' && f.joinable && !here) btn = `<button class="btn sm green" data-fa="join" data-code="${esc(f.code)}">Rejoindre</button>`;
      else if (inRoom && !here && f.status !== 'offline' && room.members.length < 6) btn = `<button class="btn sm pink" data-fa="invite" data-id="${f.id}">Inviter</button>`;
      return `<div class="frow ${f.status === 'offline' ? 'off' : ''}">${pillRaw(f, '#3dd6ff')}
        <span class="fst">${ic} ${here ? 'Dans ton salon' : label}</span><span class="grow"></span>${btn}
        <button class="btn sm white fdel" data-fa="remove" data-id="${f.id}" title="Retirer">✖</button></div>`;
    }).join('') : '<div class="empty" style="margin-top:8px">Pas encore d\'amis. Ajoute tes potes avec leur pseudo !</div>'}
    ${F.reqOut.length ? `<div class="flbl">En attente de réponse</div>${F.reqOut.map((u) => `<div class="frow off">${pillRaw(u, '#e9e4f5')}<span class="grow"></span><button class="btn sm white" data-fa="remove" data-id="${u.id}">Annuler</button></div>`).join('')}` : ''}`;
  boxes.forEach((b) => { b.innerHTML = html; });
}
function friendsClick(e) {
  const b = e.target.closest('[data-fa]'); if (!b) return;
  const box = e.currentTarget;
  switch (b.dataset.fa) {
    case 'add': {
      const inp = box.querySelector('.fadd'); const name = inp.value.trim();
      if (name) { send({ t: 'friendAdd', name }); inp.value = ''; toast("✉️ Demande d'ami envoyée à " + esc(name)); }
      break;
    }
    case 'accept': send({ t: 'friendAccept', id: b.dataset.id }); break;
    case 'remove': if (b.classList.contains('fdel') && !confirm('Retirer cet ami ?')) return; send({ t: 'friendRemove', id: b.dataset.id }); break;
    case 'join': joinCode(b.dataset.code); break;
    case 'invite': send({ t: 'invite', id: b.dataset.id }); b.disabled = true; b.textContent = 'Invité ✔'; break;
  }
}
$('#friendsHome').addEventListener('click', friendsClick);
$('#friendsLobby').addEventListener('click', friendsClick);
['#friendsHome', '#friendsLobby'].forEach((s) => $(s).addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.classList.contains('fadd')) e.currentTarget.querySelector('[data-fa="add"]').click();
}));
$('#btnCustomLobby').onclick = openCustom;
