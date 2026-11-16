// CLUTCH — serveur (HTTP statique + WebSocket + salons)
const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');
const { GAMES, shuffle, ri } = require('./games');

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const PUBLIC = path.join(__dirname, 'public');
const MAX_MEMBERS = 6;

const MODES = {
  duel: { label: '1v1', min: 2, max: 2 },
  '2v2': { label: '2v2', min: 4, max: 4, teamSize: 2 },
  '3v3': { label: '3v3', min: 6, max: 6, teamSize: 3 },
  ffa: { label: 'Chacun pour soi', min: 3, max: 6 },
};
const MAX_ROUNDS = 25;
const PALETTE = ['#3dd6ff', '#ff5fa2', '#ffd23f', '#2ee59d', '#ff9f1c', '#b388ff'];
const TEAM_PAL = [['#3dd6ff', '#5b8cff', '#2ee5c9'], ['#ff5fa2', '#ff4d6d', '#ff9f1c']];
const cleanAvatar = (a) => { const s = String(a || '').trim(); return s && [...s].length <= 4 && s.length <= 12 ? s : '😎'; };
const TEAM_NAMES = ['Équipe Bleue', 'Équipe Rose'];
const GAME_KEYS = Object.keys(GAMES);

const sendWs = (ws, msg) => { if (ws.readyState === 1) ws.send(JSON.stringify(msg)); };
const ranksFromScores = (sc) => sc.map((s) => 1 + sc.filter((o) => o > s).length);

const rooms = new Map();
let nextMemberId = 1;

class Room {
  constructor(code) {
    this.code = code;
    this.members = [];          // { id, ws, name, team }
    this.hostId = null;
    this.mode = 'duel';
    this.rounds = 5;
    this.enabled = new Set(GAME_KEYS);
    this.state = 'lobby';       // lobby | intro | round | between
    this.timers = new Set();
    this.lastResult = '';
  }

  // ---------- API utilisée par les mini-jeux ----------
  get n() { return this.p.length; }
  get twoSides() { return this.sides.length === 2; }
  name(i) { return this.p[i] ? this.p[i].name : '?'; }
  send(msg, only) {
    if (msg.t === 'g' && this.state !== 'round') return; // rien après la fin d'une manche
    const s = JSON.stringify(msg);
    if (this.state === 'lobby' || !this.p) {
      this.members.forEach((m) => { if (m.ws.readyState === 1) m.ws.send(s); });
      return;
    }
    this.p.forEach((m, i) => { if ((only === undefined || only === i) && m.ws.readyState === 1) m.ws.send(s); });
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

  startCheck() {
    const m = MODES[this.mode];
    const c = this.members.length;
    if (c < m.min) return { ok: false, hint: `Il faut ${m.min} joueurs pour le mode ${m.label} (${c} actuellement).` };
    if (c > m.max) return { ok: false, hint: `Trop de joueurs pour le mode ${m.label} (max ${m.max}). Changez de mode.` };
    if (m.teamSize && (this.teamCount(0) !== m.teamSize || this.teamCount(1) !== m.teamSize)) {
      return { ok: false, hint: `Équipes déséquilibrées : il faut ${m.teamSize} joueurs par équipe.` };
    }
    const playable = [...this.enabled].filter((k) => GAMES[k].min <= c);
    if (!playable.length) return { ok: false, hint: 'Aucun mini-jeu activé jouable avec ce nombre de joueurs.' };
    return { ok: true, hint: '' };
  }

  broadcastRoom() {
    const chk = this.startCheck();
    this.members.forEach((m) => sendWs(m.ws, {
      t: 'room', code: this.code, you: m.id, host: this.hostId,
      mode: this.mode, rounds: this.rounds,
      modes: Object.entries(MODES).map(([k, v]) => ({ key: k, label: v.label, min: v.min, max: v.max })),
      members: this.members.map((x) => ({ id: x.id, name: x.name, team: x.team, avatar: x.avatar })),
      games: GAME_KEYS.map((k) => ({ key: k, title: GAMES[k].title, icon: GAMES[k].icon, desc: GAMES[k].desc, min: GAMES[k].min, on: this.enabled.has(k) })),
      canStart: chk.ok, hint: chk.hint, inMatch: this.state !== 'lobby', lastResult: this.lastResult,
    }));
  }

  join(ws, name, avatar) {
    const t0 = this.teamCount(0), t1 = this.teamCount(1);
    const member = { id: nextMemberId++, ws, name, avatar: cleanAvatar(avatar), team: t0 <= t1 ? 0 : 1 };
    this.members.push(member);
    if (!this.hostId) this.hostId = member.id;
    this.broadcastRoom();
    return member;
  }

  leave(member) {
    this.members = this.members.filter((m) => m !== member);
    if (this.members.length === 0) { this.clearTimers(); rooms.delete(this.code); return; }
    if (this.hostId === member.id) this.hostId = this.members[0].id;
    if (this.state !== 'lobby' && this.p && this.p.includes(member)) {
      this.abort(`${member.name} a quitté la partie.`);
    } else {
      this.broadcastRoom();
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
  }

  // ---------- match ----------
  startMatch() {
    const mode = MODES[this.mode];
    const teams = !!mode.teamSize;
    this.p = teams ? [...this.members].sort((a, b) => a.team - b.team) : [...this.members];
    const n = this.p.length;
    if (this.mode === 'ffa') this.sides = this.p.map((_, i) => [i]);
    else if (teams) this.sides = [0, 1].map((t) => this.p.map((m, i) => (m.team === t ? i : -1)).filter((i) => i >= 0));
    else this.sides = [[0], [1]];
    this.sideOf = [];
    this.sides.forEach((s, si) => s.forEach((i) => { this.sideOf[i] = si; }));
    this.isFfa = this.mode === 'ffa';
    this.maxRounds = this.rounds;
    this.perRound = this.isFfa ? 3 : 1; // points max gagnables par camp et par manche
    this.scores = new Array(this.sides.length).fill(0);
    this.queue = [];
    this.round = 0;
    this.gameKey = null;
    this.lastResult = '';
    const colors = this.p.map((m, i) => (teams ? TEAM_PAL[m.team][this.sides[m.team].indexOf(i)] : PALETTE[i]));
    const sideNames = teams ? TEAM_NAMES : this.p.map((m) => m.name);
    this.p.forEach((m, i) => sendWs(m.ws, {
      t: 'matchStart', me: i, mode: this.mode, teams, maxRounds: this.maxRounds, sides: this.sides, sideNames,
      players: this.p.map((x, j) => ({ name: x.name, avatar: x.avatar, color: colors[j], side: this.sideOf[j] })),
    }));
    this.state = 'between';
    this.nextRound();
  }

  nextRound() {
    const playable = [...this.enabled].filter((k) => GAMES[k].min <= this.n);
    if (this.queue.length === 0) {
      this.queue = shuffle([...playable]);
      if (this.queue.length > 1 && this.queue[0] === this.gameKey) this.queue.push(this.queue.shift());
    }
    const key = this.queue.shift();
    const def = GAMES[key];
    this.gameKey = key;
    this.round++;
    this.state = 'intro';
    this.game = def.create(this);
    const delay = def.intro || 4500;
    const decisive = this.round > this.maxRounds;
    this.send({ t: 'roundIntro', game: key, title: def.title, icon: def.icon, rules: def.rules, round: this.round, maxRounds: this.maxRounds, decisive, scores: this.scores, delay });
    this.later(() => { this.state = 'round'; this.game.start(); }, delay);
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
      // 3 / 2 / 1 points pour le podium — jamais de point pour le dernier
      ranks.forEach((r, i) => { if (r < worst || worst === 1) gained[this.sideOf[i]] += r === 1 ? 3 : r === 2 ? 2 : r === 3 ? 1 : 0; });
      if (worst === 1) gained.fill(0); // tout le monde à égalité : personne ne marque
      const firsts = ranks.map((r, i) => (r === 1 ? i : -1)).filter((i) => i >= 0);
      winSide = firsts.length === 1 ? this.sideOf[firsts[0]] : -1;
    } else {
      // le camp du (des) meilleur(s) gagne ; si les deux camps ont un 1er, on compare la somme des places
      const firstSides = new Set(ranks.map((r, i) => (r === 1 ? this.sideOf[i] : -1)).filter((s) => s >= 0));
      if (firstSides.size === 1) winSide = [...firstSides][0];
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

    // Fin : toutes les manches jouées avec un leader unique, ou avance impossible à remonter.
    // Égalité en tête après la dernière manche → manche décisive.
    const best = Math.max(...this.scores);
    const sorted = [...this.scores].sort((a, b) => b - a);
    const lead = sorted[0] - sorted[1];
    const remaining = Math.max(0, this.maxRounds - this.round);
    const over = lead > 0 && (remaining === 0 || lead > this.perRound * remaining);
    this.later(() => {
      if (!over) return this.nextRound();
      const winners = this.scores.map((s, i) => (s === best ? i : -1)).filter((i) => i >= 0);
      const low = Math.min(...this.scores);
      const losersM = this.scores.map((s, i) => (s === low && s < best ? i : -1)).filter((i) => i >= 0);
      this.send({ t: 'matchEnd', scores: this.scores, winners, losers: losersM, r: Math.random() });
      const names = (sides) => sides.map((s) => (this.mode === '2v2' || this.mode === '3v3' ? TEAM_NAMES[s] : this.p[s].name)).join(' & ');
      this.lastResult = `🏆 ${names(winners)} ${winners.length > 1 ? 'gagnent' : 'gagne'} (${this.scores.join(' – ')})`;
      this.state = 'lobby';
      this.p = null;
      this.broadcastRoom();
    }, 5500);
  }
}

function newCode() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  let c;
  do { c = Array.from({ length: 4 }, () => A[ri(0, A.length - 1)]).join(''); } while (rooms.has(c));
  return c;
}

// ---------- HTTP ----------
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

// ---------- WebSocket ----------
const wss = new WebSocketServer({ server, maxPayload: 2048 });

wss.on('connection', (ws) => {
  let room = null, member = null;
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('message', (raw) => {
    let m;
    try { m = JSON.parse(raw); } catch { return; }
    if (!m || typeof m.t !== 'string') return;

    if (m.t === 'create' || m.t === 'join') {
      if (room) return;
      const name = String(m.name || '').trim().slice(0, 16) || 'Joueur';
      let r;
      if (m.t === 'create') { r = new Room(newCode()); rooms.set(r.code, r); }
      else {
        r = rooms.get(String(m.code || '').toUpperCase().trim());
        if (!r) return sendWs(ws, { t: 'error', msg: 'Aucune partie avec ce code.' });
        if (r.members.length >= MAX_MEMBERS) return sendWs(ws, { t: 'error', msg: 'Salon plein (6 max).' });
        if (r.state !== 'lobby') return sendWs(ws, { t: 'error', msg: 'Un match est en cours, réessaie à la fin.' });
      }
      room = r;
      member = r.join(ws, name, m.avatar);
      return;
    }
    if (!room) return;

    switch (m.t) {
      case 'cfg':
        if (!room.isHost(member.id) || room.state !== 'lobby') return;
        if (m.mode && MODES[m.mode]) room.mode = m.mode;
        if (Number.isInteger(m.rounds)) room.rounds = Math.max(1, Math.min(MAX_ROUNDS, m.rounds));
        if (typeof m.game === 'string' && GAMES[m.game]) {
          if (room.enabled.has(m.game)) room.enabled.delete(m.game); else room.enabled.add(m.game);
        }
        room.broadcastRoom();
        break;
      case 'avatar':
        if (room.state !== 'lobby') return;
        member.avatar = cleanAvatar(m.avatar);
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
    }
  });

  ws.on('close', () => { if (room) room.leave(member); room = null; });
});

setInterval(() => {
  wss.clients.forEach((ws) => {
    if (!ws.isAlive) return ws.terminate();
    ws.isAlive = false;
    ws.ping();
  });
}, 15000);

server.listen(PORT, HOST, () => console.log(`CLUTCH en ligne sur http://${HOST}:${PORT}`));
