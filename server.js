// CLUTCH — serveur (HTTP statique + WebSocket + salons + comptes)
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const { GAMES, shuffle, ri } = require('./games');
const store = require('./store');
const ACC = require('./accounts');
const C = require('./public/cosmetics');
const mailer = require('./mailer');

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';
// adresse publique du site pour les liens envoyés par email (jamais l'en-tête Host, falsifiable)
const PUBLIC_URL = (process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const PUBLIC = path.join(__dirname, 'public');
const MAX_MEMBERS = 10;
const GRACE_MS = 45000; // temps laissé pour revenir après un refresh / une coupure

// Chacun pour soi = le mode principal (tous les jeux). Les équipes n'ont que les jeux qui ont du sens à plusieurs.
const MODES = {
  ffa: { label: 'Chacun pour soi', min: 2, max: MAX_MEMBERS },
  '2v2': { label: '2v2', min: 4, max: 4, teamSize: 2 },
  '3v3': { label: '3v3', min: 6, max: 6, teamSize: 3 },
};
const TEAM_GAMES = Object.keys(GAMES).filter((k) => GAMES[k].team);
const OFF_BY_DEFAULT = ['mines2', 'undercover'];
const MAX_ROUNDS = 25;
const MAX_TARGET = 50; // victoire aux points : objectif max
const PALETTE = ['#3dd6ff', '#ff5fa2', '#ffd23f', '#2ee59d', '#ff9f1c', '#b388ff', '#ff4d6d', '#5b8cff', '#c6f432', '#ff8fd8'];
const TEAM_PAL = [['#3dd6ff', '#5b8cff', '#2ee5c9'], ['#ff5fa2', '#ff4d6d', '#ff9f1c']];
const TEAM_NAMES = ['Équipe Bleue', 'Équipe Rose'];
const GAME_KEYS = Object.keys(GAMES);
// règles de tous les jeux pour la page « Les mini-jeux » du menu
const CATALOG = GAME_KEYS.map((k) => {
  const g = GAMES[k];
  const rules = typeof g.rules === 'function' ? `${g.rules(3)} — À 2 joueurs : ${g.rules(2)}` : g.rules;
  return { key: k, title: g.title, icon: g.icon, desc: g.desc, rules, keys: g.keys, touch: g.touch, team: g.team || null };
});

const sendWs = (ws, msg) => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg)); };
const ranksFromScores = (sc) => sc.map((s) => 1 + sc.filter((o) => o > s).length);
const guestAvatar = (a) => (C.BASE_AVATARS.includes(a) ? a : C.BASE_AVATARS[0]);

const rooms = new Map();
const online = new Map(); // userId -> Set(session)
let nextMemberId = 1;

// ═════════════════ présence & amis ═════════════════
function statusOf(uid) {
  const set = online.get(uid);
  if (!set || !set.size) return { status: 'offline' };
  let st = { status: 'online' };
  for (const S of set) {
    if (S.room && S.member && !S.member.offline) {
      st = S.room.state === 'lobby'
        ? { status: 'lobby', code: S.room.code, joinable: S.room.members.length < MAX_MEMBERS }
        : { status: 'game', code: S.room.code };
    }
  }
  return st;
}
function friendsPayload(u) {
  const prof = (id) => { const v = store.get(id); return v ? ACC.publicProfile(v) : null; };
  return {
    t: 'friends',
    friends: u.friends.map((id) => { const p = prof(id); return p && { ...p, ...statusOf(id) }; }).filter(Boolean),
    reqIn: u.reqIn.map(prof).filter(Boolean),
    reqOut: u.reqOut.map(prof).filter(Boolean),
  };
}
function pushFriends(uid) {
  const u = store.get(uid), set = online.get(uid);
  if (!u || !set) return;
  const p = friendsPayload(u);
  set.forEach((S) => sendWs(S.ws, p));
}
function pushMe(uid) {
  const u = store.get(uid), set = online.get(uid);
  if (!u || !set) return;
  set.forEach((S) => sendWs(S.ws, { t: 'me', me: ACC.meProfile(u) }));
}
function presenceChanged(uid) {
  if (!uid) return;
  const u = store.get(uid);
  if (!u) return;
  pushFriends(uid);
  u.friends.forEach(pushFriends);
}

// ═════════════════ salons ═════════════════
class Room {
  constructor(code) {
    this.code = code;
    this.members = [];
    this.hostId = null;
    this.mode = 'ffa';
    this.rounds = 5;
    this.goal = 'rounds'; // 'rounds' = nombre de manches · 'points' = premier à `target` points
    this.target = 5;
    this.enabled = new Set(GAME_KEYS.filter((k) => !OFF_BY_DEFAULT.includes(k)));
    this.state = 'lobby'; // lobby | intro | round | between
    this.timers = new Set();
    this.lastResult = '';
    this.roundLog = [];
    this.chatLog = []; // derniers messages du chat, renvoyés à qui arrive ou revient après un refresh
  }

  // ---------- API utilisée par les mini-jeux ----------
  get n() { return this.p.length; }
  get twoSides() { return this.sides.length === 2; }
  name(i) { return this.p[i] ? this.p[i].name : '?'; }
  send(msg, only) {
    if (msg.t === 'g' && this.state !== 'round') return; // rien après la fin d'une manche
    if (this.state === 'round' && (msg.t === 'g' || msg.t === 'elim')) this.logMsg(msg, only);
    const s = JSON.stringify(msg);
    if (this.state === 'lobby' || !this.p) {
      this.members.forEach((m) => { if (m.ws && m.ws.readyState === 1) m.ws.send(s); });
      return;
    }
    this.p.forEach((m, i) => { if ((only === undefined || only === i) && m.ws && m.ws.readyState === 1) m.ws.send(s); });
  }
  // journal de la manche, rejoué à un joueur qui revient après un refresh
  logMsg(msg, only) {
    if (msg.t === 'g' && msg.k === 's') {
      const k = this.roundLog.findIndex((e) => e.msg.k === 's' && e.only === only);
      if (k >= 0) this.roundLog.splice(k, 1);
    }
    this.roundLog.push({ msg, only });
    if (this.roundLog.length > 8000) this.roundLog.shift();
  }
  later(fn, ms) {
    const id = setTimeout(() => { this.timers.delete(id); fn(); }, ms);
    this.timers.add(id);
    return id;
  }
  every(fn, ms) { const id = setInterval(fn, ms); this.timers.add(id); return id; }
  cancel(id) { if (id) { clearTimeout(id); clearInterval(id); this.timers.delete(id); } }
  clearTimers() { for (const id of this.timers) { clearTimeout(id); clearInterval(id); } this.timers.clear(); }
  survivalOver(alive) {
    const s = new Set();
    alive.forEach((a, i) => { if (a) s.add(this.sideOf[i]); });
    return s.size <= 1;
  }
  otherThan(i) {
    const o = [...Array(this.n).keys()].filter((j) => j !== i);
    return o.length ? o[ri(0, o.length - 1)] : i;
  }
  eliminate(i, extra = {}) {
    this.send({ t: 'elim', i, r: Math.random(), o: this.otherThan(i), ...extra });
  }

  // ---------- salon ----------
  isHost(id) { return this.hostId === id; }
  teamCount(t) { return this.members.filter((m) => m.team === t).length; }
  presence() { this.members.forEach((m) => presenceChanged(m.uid)); }

  startCheck() {
    const m = MODES[this.mode];
    const c = this.members.length;
    if (c < m.min) return { ok: false, hint: `Il faut ${m.min} joueurs pour le mode ${m.label} (${c} actuellement).` };
    if (c > m.max) return { ok: false, hint: `Trop de joueurs pour le mode ${m.label} (max ${m.max}). Changez de mode.` };
    if (m.teamSize && (this.teamCount(0) !== m.teamSize || this.teamCount(1) !== m.teamSize)) {
      return { ok: false, hint: `Équipes déséquilibrées : il faut ${m.teamSize} joueurs par équipe.` };
    }
    if (this.members.some((x) => x.offline)) return { ok: false, hint: "Un joueur s'est déconnecté, on l'attend…" };
    const playable = this.playable(c);
    if (!playable.length) return { ok: false, hint: m.teamSize ? 'Aucun jeu d\'équipe activé (ceux marqués 👥).' : 'Aucun mini-jeu activé jouable avec ce nombre de joueurs.' };
    return { ok: true, hint: '' };
  }

  playable(c) {
    const teams = !!MODES[this.mode].teamSize;
    return [...this.enabled].filter((k) => GAMES[k].min <= c && (!teams || GAMES[k].team));
  }

  broadcastRoom() {
    const chk = this.startCheck();
    const members = this.members.map((x) => ({ id: x.id, uid: x.uid, name: x.name, team: x.team, avatar: x.avatar, frame: x.frame, title: x.title, level: x.level, offline: !!x.offline }));
    this.members.forEach((m) => sendWs(m.ws, {
      t: 'room', code: this.code, you: m.id, key: m.key, host: this.hostId,
      mode: this.mode, rounds: this.rounds, goal: this.goal, target: this.target,
      modes: Object.entries(MODES).map(([k, v]) => ({ key: k, label: v.label, min: v.min, max: v.max })),
      members,
      games: GAME_KEYS.map((k) => ({ key: k, title: GAMES[k].title, icon: GAMES[k].icon, desc: GAMES[k].desc, min: GAMES[k].min, on: this.enabled.has(k), team: !!GAMES[k].team })),
      canStart: chk.ok, hint: chk.hint, inMatch: this.state !== 'lobby', lastResult: this.lastResult,
    }));
  }

  join(S, guest) {
    const t0 = this.teamCount(0), t1 = this.teamCount(1);
    const u = S.user;
    const member = {
      id: nextMemberId++, key: crypto.randomBytes(12).toString('hex'), ws: S.ws, team: t0 <= t1 ? 0 : 1, offline: false,
      uid: u ? u.id : null,
      name: u ? u.name : guest.name,
      avatar: u ? u.avatar : guestAvatar(guest.avatar),
      frame: u ? u.frame : 'classic',
      title: u ? u.title : '',
      level: u ? ACC.level(u) : 0,
    };
    this.members.push(member);
    if (!this.hostId) this.hostId = member.id;
    this.broadcastRoom();
    sendWs(S.ws, { t: 'chatHist', list: this.chatLog });
    presenceChanged(member.uid);
    return member;
  }

  leave(member) {
    clearTimeout(member.dropTimer);
    if (!this.members.includes(member)) return;
    this.members = this.members.filter((m) => m !== member);
    presenceChanged(member.uid);
    if (this.members.length === 0) { this.clearTimers(); rooms.delete(this.code); return; }
    if (this.hostId === member.id) this.hostId = (this.members.find((m) => !m.offline) || this.members[0]).id;
    if (this.state !== 'lobby' && this.p && this.p.includes(member)) {
      this.abort(`${member.name} a quitté la partie.`);
    } else {
      this.broadcastRoom();
    }
  }

  // coupure (refresh, réseau) : on garde la place GRACE_MS, la partie continue
  disconnect(member) {
    member.ws = null;
    member.offline = true;
    member.dropTimer = setTimeout(() => { if (member.offline) this.leave(member); }, GRACE_MS);
    this.broadcastRoom();
    presenceChanged(member.uid);
    this.checkLaunch();
  }

  resume(member, ws) {
    clearTimeout(member.dropTimer);
    member.ws = ws;
    member.offline = false;
    this.broadcastRoom();
    sendWs(ws, { t: 'chatHist', list: this.chatLog });
    presenceChanged(member.uid);
    if (this.p && this.p.includes(member) && this.state !== 'lobby') {
      const i = this.p.indexOf(member);
      sendWs(ws, {
        t: 'resync', match: { ...this.matchInfo, me: i }, scores: this.scores, round: this.round, state: this.state,
        intro: this.lastIntro, ready: this.readyList(), launching: !!this.launching,
        log: this.state === 'round' ? this.roundLog.filter((e) => e.only === undefined || e.only === i).map((e) => e.msg) : [],
      });
    }
  }

  abort(msg) {
    this.clearTimers();
    this.state = 'lobby';
    this.game = null;
    this.p = null;
    this.lastResult = '';
    this.members.forEach((m) => sendWs(m.ws, { t: 'aborted', msg }));
    this.broadcastRoom();
    this.presence();
  }

  // ---------- match ----------
  startMatch() {
    const mode = MODES[this.mode];
    const teams = !!mode.teamSize;
    this.p = teams ? [...this.members].sort((a, b) => a.team - b.team) : [...this.members];
    if (this.mode === 'ffa') this.sides = this.p.map((_, i) => [i]);
    else if (teams) this.sides = [0, 1].map((t) => this.p.map((m, i) => (m.team === t ? i : -1)).filter((i) => i >= 0));
    else this.sides = [[0], [1]];
    this.sideOf = [];
    this.sides.forEach((s, si) => s.forEach((i) => { this.sideOf[i] = si; }));
    this.isFfa = this.mode === 'ffa';
    this.isTeams = teams;
    this.maxRounds = this.rounds;
    this.byPoints = this.goal === 'points';
    this.targetPts = this.target;
    this.perRound = 1;
    this.scores = new Array(this.sides.length).fill(0);
    this.queue = [];
    this.round = 0;
    this.gameKey = null;
    this.lastResult = '';
    const colors = this.p.map((m, i) => (teams ? TEAM_PAL[m.team][this.sides[m.team].indexOf(i)] : PALETTE[i]));
    const sideNames = teams ? TEAM_NAMES : this.p.map((m) => m.name);
    this.matchInfo = {
      t: 'matchStart', mode: this.mode, teams, maxRounds: this.maxRounds, byPoints: this.byPoints, target: this.targetPts, sides: this.sides, sideNames,
      players: this.p.map((x, j) => ({ name: x.name, avatar: x.avatar, frame: x.frame, title: x.title, level: x.level, color: colors[j], side: this.sideOf[j] })),
    };
    this.p.forEach((m, i) => sendWs(m.ws, { ...this.matchInfo, me: i }));
    this.state = 'between';
    this.presence();
    this.nextRound();
  }

  nextRound() {
    const playable = this.playable(this.n);
    if (this.queue.length === 0) {
      this.queue = shuffle([...playable]);
      if (this.queue.length > 1 && this.queue[0] === this.gameKey) this.queue.push(this.queue.shift());
    }
    const key = this.queue.shift();
    const def = GAMES[key];
    this.gameKey = key;
    this.round++;
    this.state = 'intro';
    this.roundLog = [];
    this.game = def.create(this);
    this.lastGame = def;
    const decisive = !this.byPoints && this.round > this.maxRounds;
    // Chacun lit les règles et clique « Prêt » ; départ forcé au bout de 90 s (AFK)
    this.roundReady = new Set();
    this.launching = false;
    this.lastIntro = {
      t: 'roundIntro', game: key, title: def.title, icon: def.icon, rules: typeof def.rules === 'function' ? def.rules(this.n) : def.rules, keys: def.keys, touch: def.touch,
      teamRule: this.isTeams && def.team ? def.team.rule : null,
      round: this.round, maxRounds: this.maxRounds, decisive, scores: this.scores,
    };
    this.send({ ...this.lastIntro, ready: this.readyList() });
    this.introTimer = this.later(() => this.launch(), 90000);
  }

  readyList() { return this.p ? this.p.map((_, i) => this.roundReady.has(i)) : []; }

  setRoundReady(member) {
    if (this.state !== 'intro' || this.launching || !this.p) return;
    const i = this.p.indexOf(member);
    if (i < 0) return;
    this.roundReady.add(i);
    this.send({ t: 'readyState', ready: this.readyList() });
    this.checkLaunch();
  }

  // on démarre quand tous les joueurs connectés sont prêts
  checkLaunch() {
    if (this.state !== 'intro' || this.launching || !this.p) return;
    const present = this.p.map((m, i) => i).filter((i) => !this.p[i].offline);
    if (present.length && present.every((i) => this.roundReady.has(i))) this.launch();
  }

  launch() {
    if (this.state !== 'intro' || this.launching) return;
    this.launching = true;
    this.cancel(this.introTimer);
    this.send({ t: 'countdown', ms: 3000 });
    this.later(() => { this.launching = false; this.state = 'round'; this.game.start(); }, 3000);
  }

  input(member, m) {
    if (this.state !== 'round' || !this.game || !this.p) return;
    const i = this.p.indexOf(member);
    if (i >= 0) this.game.input(i, m);
  }

  // scores[i] : plus haut = mieux classé
  finish(scores, reason = '') {
    if (this.state !== 'round') return;
    this.state = 'between';
    this.clearTimers();
    this.game = null;
    const n = this.n;
    const ranks = ranksFromScores(scores);
    const worst = Math.max(...ranks);
    const gained = new Array(this.sides.length).fill(0);
    let winSide = -1;

    if (this.isFfa) {
      // 1 point au(x) premier(s), 0 aux autres ; tout le monde ex æquo = personne ne marque
      const firsts = ranks.map((r, i) => (r === 1 ? i : -1)).filter((i) => i >= 0);
      if (worst > 1) firsts.forEach((i) => { gained[this.sideOf[i]] = 1; });
      winSide = firsts.length === 1 && worst > 1 ? this.sideOf[firsts[0]] : -1;
    } else {
      const firstSides = new Set(ranks.map((r, i) => (r === 1 ? this.sideOf[i] : -1)).filter((s) => s >= 0));
      // jeux « à l'addition » (courses) : chaque place compte pour l'équipe, pas seulement le 1er
      const sumRule = this.lastGame && this.lastGame.team && this.lastGame.team.sum;
      if (firstSides.size === 1 && !sumRule) winSide = [...firstSides][0];
      else {
        const sum = [0, 0];
        ranks.forEach((r, i) => { sum[this.sideOf[i]] += n - r; });
        winSide = sum[0] > sum[1] ? 0 : sum[1] > sum[0] ? 1 : -1;
      }
      if (winSide >= 0) gained[winSide] = 1;
    }
    gained.forEach((g, s) => { this.scores[s] += g; });

    const losers = worst > 1 ? ranks.map((r, i) => (r === worst ? i : -1)).filter((i) => i >= 0) : [];
    this.send({
      t: 'roundEnd', ranks, reason, scores: this.scores, gained, winSide, losers,
      r: Math.random(), o: losers.length ? this.otherThan(losers[0]) : 0,
    });

    const best = Math.max(...this.scores);
    const sorted = [...this.scores].sort((a, b) => b - a);
    const lead = sorted[0] - sorted[1];
    const remaining = Math.max(0, this.maxRounds - this.round);
    // aux points : fini dès qu'un camp atteint l'objectif seul en tête (égalité au sommet = on continue)
    const over = lead > 0 && (this.byPoints ? best >= this.targetPts : remaining === 0 || lead > this.perRound * remaining);
    this.later(() => {
      if (!over) return this.nextRound();
      const winners = this.scores.map((s, i) => (s === best ? i : -1)).filter((i) => i >= 0);
      const low = Math.min(...this.scores);
      const losersM = this.scores.map((s, i) => (s === low && s < best ? i : -1)).filter((i) => i >= 0);
      this.send({ t: 'matchEnd', scores: this.scores, winners, losers: losersM, r: Math.random() });
      // XP pour les joueurs connectés à un compte
      this.p.forEach((m, i) => {
        if (!m.uid) return sendWs(m.ws, { t: 'xp', guest: true });
        const u = store.get(m.uid);
        if (!u) return;
        const side = this.sideOf[i];
        const res = ACC.awardMatch(u, {
          won: winners.includes(side),
          roundsWon: this.isFfa ? 0 : this.scores[side],
          points: this.isFfa ? this.scores[side] : 0,
        });
        m.level = res.level;
        sendWs(m.ws, { t: 'xp', ...res });
        pushMe(m.uid);
      });
      const names = (sides) => sides.map((s) => (this.mode === '2v2' || this.mode === '3v3' ? TEAM_NAMES[s] : this.p[s].name)).join(' & ');
      this.lastResult = `🏆 ${names(winners)} ${winners.length > 1 ? 'gagnent' : 'gagne'} (${this.scores.join(' – ')})`;
      this.state = 'lobby';
      this.p = null;
      this.broadcastRoom();
      this.presence();
    }, 5500);
  }
}

function newCode() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  let c;
  do { c = Array.from({ length: 4 }, () => A[ri(0, A.length - 1)]).join(''); } while (rooms.has(c));
  return c;
}

// ═════════════════ HTTP ═════════════════
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8' };
const server = http.createServer((req, res) => {
  let p;
  try { p = decodeURIComponent(req.url.split('?')[0]); } catch { res.writeHead(400); return res.end(); }
  if (p === '/') p = '/index.html';
  if (p === '/health') { res.writeHead(200); return res.end('ok'); }
  const file = path.join(PUBLIC, path.normalize(p));
  if (!file.startsWith(PUBLIC)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
});

// ═════════════════ WebSocket ═════════════════
const wss = new WebSocketServer({ server, maxPayload: 2048 });

function setUser(S, u) {
  if (S.user) { const set = online.get(S.user.id); if (set) { set.delete(S); if (!set.size) online.delete(S.user.id); } presenceChanged(S.user.id); }
  S.user = u;
  if (u) {
    if (!online.has(u.id)) online.set(u.id, new Set());
    online.get(u.id).add(S);
    sendWs(S.ws, { t: 'me', me: ACC.meProfile(u) });
    presenceChanged(u.id);
  } else {
    sendWs(S.ws, { t: 'me', me: null });
  }
}

function leaveRoom(S) {
  if (!S.room) return;
  const r = S.room, m = S.member;
  S.room = null; S.member = null;
  r.leave(m);
}

wss.on('connection', (ws) => {
  const S = { ws, user: null, room: null, member: null, tries: [] };
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  const reply = (msg) => sendWs(ws, msg);
  const fail = (msg) => reply({ t: 'error', msg });
  const rateLimited = () => {
    const now = Date.now();
    S.tries = S.tries.filter((t) => now - t < 60000);
    S.tries.push(now);
    return S.tries.length > 10;
  };

  ws.on('message', (raw) => {
    let m;
    try { m = JSON.parse(raw); } catch { return; }
    if (!m || typeof m.t !== 'string') return;
    const room = S.room, member = S.member;

    switch (m.t) {
      // ── session ──
      case 'hello': {
        // Render sans base de données : le disque est effacé à chaque déploiement, les comptes avec
        reply({ t: 'catalog', games: CATALOG, ephemeral: store.kind === 'file' && !!process.env.RENDER });
        const u = m.token ? ACC.readToken(m.token) : null;
        setUser(S, u);
        if (m.token && !u) reply({ t: 'tokenBad' });
        if (m.resume && m.resume.code && m.resume.key) {
          const r = rooms.get(String(m.resume.code));
          const mem = r && r.members.find((x) => x.key === m.resume.key);
          if (mem) {
            if (mem.ws && mem.ws !== ws) sendWs(mem.ws, { t: 'kicked', msg: 'Partie reprise dans un autre onglet.' });
            S.room = r; S.member = mem;
            r.resume(mem, ws);
            reply({ t: 'resumed' });
          } else reply({ t: 'resumeFail' });
        }
        return;
      }
      case 'register':
      case 'login': {
        if (rateLimited()) return fail('Trop d\'essais, attends une minute.');
        const res = m.t === 'register' ? ACC.register(m.name, m.pass, m.email) : ACC.login(m.name, m.pass);
        if (res.err) return reply({ t: 'authErr', msg: res.err });
        setUser(S, res.user);
        reply({ t: 'token', token: ACC.makeToken(res.user.id) });
        return;
      }
      case 'logout':
        setUser(S, null);
        return;
      case 'forgot': {
        if (rateLimited()) return reply({ t: 'acctErr', msg: 'Trop d\'essais, attends une minute.' });
        const r = ACC.startReset(m.email);
        if (r) {
          mailer.sendReset(r.u.email, r.u.name, `${PUBLIC_URL}/?reset=${r.token}`, ACC.RESET_MS / 60000)
            .catch((e) => console.error('Email de réinitialisation non envoyé :', e.message));
        }
        // même réponse que le compte existe ou non : on ne révèle pas quels emails sont inscrits
        reply({ t: 'acctOk', k: 'forgot', msg: 'Si un compte utilise cet email, un lien vient d\'être envoyé (pense aux spams).' });
        return;
      }
      case 'resetPass': {
        if (rateLimited()) return reply({ t: 'acctErr', msg: 'Trop d\'essais, attends une minute.' });
        const res = ACC.finishReset(m.token, m.pass);
        if (res.err) return reply({ t: 'acctErr', k: 'reset', msg: res.err });
        // les autres sessions de ce compte sont déconnectées (leur jeton n'est plus valable)
        online.get(res.user.id)?.forEach((S2) => { if (S2 !== S) { sendWs(S2.ws, { t: 'tokenBad' }); setUser(S2, null); } });
        setUser(S, res.user);
        reply({ t: 'token', token: ACC.makeToken(res.user.id) });
        reply({ t: 'acctOk', k: 'reset', msg: 'Mot de passe changé, tu es connecté 🎉' });
        return;
      }
      case 'rename': {
        if (!S.user) return;
        const err = ACC.rename(S.user, m.name);
        if (err) return reply({ t: 'acctErr', k: 'rename', msg: err });
        pushMe(S.user.id);
        presenceChanged(S.user.id);
        online.get(S.user.id)?.forEach((S2) => {
          if (S2.room && S2.member) { S2.member.name = S.user.name; if (S2.room.state === 'lobby') S2.room.broadcastRoom(); }
        });
        reply({ t: 'acctOk', k: 'rename', msg: `Tu t'appelles maintenant ${S.user.name} ✨` });
        return;
      }
      case 'setEmail': {
        if (!S.user) return;
        if (rateLimited()) return reply({ t: 'acctErr', msg: 'Trop d\'essais, attends une minute.' });
        const err = ACC.setEmail(S.user, m.email, m.pass);
        if (err) return reply({ t: 'acctErr', k: 'email', msg: err });
        pushMe(S.user.id);
        reply({ t: 'acctOk', k: 'email', msg: 'Email enregistré ✉️' });
        return;
      }
      case 'equip': {
        if (!S.user) return;
        const err = ACC.equip(S.user, { avatar: m.avatar, frame: m.frame, title: m.title });
        if (err) return fail(err);
        pushMe(S.user.id);
        presenceChanged(S.user.id);
        if (room && member && room.state === 'lobby') {
          Object.assign(member, { avatar: S.user.avatar, frame: S.user.frame, title: S.user.title, level: ACC.level(S.user) });
          room.broadcastRoom();
        }
        return;
      }
      case 'avatar': // invité
        if (S.user || !room || room.state !== 'lobby') return;
        member.avatar = guestAvatar(m.avatar);
        room.broadcastRoom();
        return;

      // ── amis ──
      case 'friendAdd': case 'friendAccept': case 'friendRemove': {
        if (!S.user) return fail('Connecte-toi pour avoir des amis.');
        const err = m.t === 'friendAdd' ? ACC.friendRequest(S.user, m.name) : m.t === 'friendAccept' ? ACC.friendAccept(S.user, m.id) : ACC.friendRemove(S.user, m.id);
        if (err) return fail(err);
        const other = m.t === 'friendAdd' ? store.findByName(m.name) : store.get(m.id);
        pushFriends(S.user.id);
        if (other) pushFriends(other.id);
        if (m.t === 'friendAdd' && other) online.get(other.id)?.forEach((S2) => sendWs(S2.ws, { t: 'friendPing', from: ACC.publicProfile(S.user) }));
        return;
      }
      case 'friends':
        if (S.user) pushFriends(S.user.id);
        return;
      case 'invite': {
        if (!S.user || !room || !S.user.friends.includes(m.id)) return;
        online.get(m.id)?.forEach((S2) => sendWs(S2.ws, { t: 'invited', from: ACC.publicProfile(S.user), code: room.code }));
        reply({ t: 'info', msg: 'Invitation envoyée ✉️' });
        return;
      }

      // ── salons ──
      case 'create': case 'join': {
        let r;
        if (m.t === 'create') { r = new Room(newCode()); rooms.set(r.code, r); }
        else {
          r = rooms.get(String(m.code || '').toUpperCase().trim());
          if (!r) return fail('Aucune partie avec ce code.');
          if (r === room) return;
          if (r.members.length >= MAX_MEMBERS) return fail(`Salon plein (${MAX_MEMBERS} max).`);
          if (r.state !== 'lobby') return fail('Un match est en cours, réessaie à la fin.');
        }
        if (room) leaveRoom(S);
        const name = String(m.name || '').trim().slice(0, 16) || 'Invité';
        S.room = r;
        S.member = r.join(S, { name, avatar: m.avatar });
        presenceChanged(S.user && S.user.id); // le statut « dans un salon » dépend de S.member
        return;
      }
      case 'leave':
        leaveRoom(S);
        reply({ t: 'left' });
        return;
    }

    if (!room) return;
    switch (m.t) {
      case 'cfg':
        if (!room.isHost(member.id) || room.state !== 'lobby') return;
        if (m.mode && MODES[m.mode]) room.mode = m.mode;
        if (Number.isInteger(m.rounds)) room.rounds = Math.max(1, Math.min(MAX_ROUNDS, m.rounds));
        if (m.goal === 'rounds' || m.goal === 'points') room.goal = m.goal;
        if (Number.isInteger(m.target)) room.target = Math.max(1, Math.min(MAX_TARGET, m.target));
        if (typeof m.game === 'string' && GAMES[m.game]) {
          if (room.enabled.has(m.game)) room.enabled.delete(m.game); else room.enabled.add(m.game);
        }
        room.broadcastRoom();
        break;
      case 'team':
        if (room.state !== 'lobby' || (m.team !== 0 && m.team !== 1)) return;
        member.team = m.team;
        room.broadcastRoom();
        break;
      case 'start':
        if (!room.isHost(member.id) || room.state !== 'lobby' || !room.startCheck().ok) return;
        room.startMatch();
        break;
      case 'input':
        room.input(member, m);
        break;
      case 'ready':
        room.setRoundReady(member);
        break;
      case 'chat': {
        // chat du salon, dispo en salle d'attente comme en pleine partie : 5 messages / 5 s max
        const text = String(m.text || '').replace(/\s+/g, ' ').trim().slice(0, 200);
        const now = Date.now();
        S.chatT = (S.chatT || []).filter((x) => now - x < 5000);
        if (!text || S.chatT.length >= 5) return;
        S.chatT.push(now);
        const msg = { t: 'chat', id: member.id, name: member.name, av: member.avatar, text };
        room.chatLog.push(msg);
        if (room.chatLog.length > 40) room.chatLog.shift();
        room.members.forEach((x) => sendWs(x.ws, msg));
        break;
      }
    }
  });

  ws.on('close', () => {
    if (S.room && S.member && S.member.ws === ws) S.room.disconnect(S.member);
    if (S.user) {
      const set = online.get(S.user.id);
      if (set) { set.delete(S); if (!set.size) online.delete(S.user.id); }
      presenceChanged(S.user.id);
    }
  });
});

setInterval(() => {
  wss.clients.forEach((ws) => {
    if (!ws.isAlive) return ws.terminate();
    ws.isAlive = false;
    ws.ping();
  });
}, 15000);

async function shutdown() {
  try { await store.close(); } catch (e) { console.error(e); }
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

store.init()
  .then(() => server.listen(PORT, HOST, () => console.log(`CLUTCH en ligne sur http://${HOST}:${PORT}`)))
  .catch((e) => { console.error('Impossible de démarrer le stockage :', e); process.exit(1); });
