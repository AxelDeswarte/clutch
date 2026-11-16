// CLUTCH — comptes : mots de passe, jetons de connexion, profils, amis, XP
const crypto = require('crypto');
const store = require('./store');
const C = require('./public/cosmetics');

const NAME_RE = /^[\p{L}\p{N}_.-]{3,16}$/u;

function secret() {
  if (process.env.CLUTCH_SECRET) return process.env.CLUTCH_SECRET;
  // pas de variable d'env : on génère un secret une fois et on le garde dans la base
  if (!store.meta.secret) store.setMeta('secret', crypto.randomBytes(32).toString('hex'));
  return store.meta.secret;
}

function hashPass(pass) {
  const salt = crypto.randomBytes(16).toString('hex');
  const h = crypto.scryptSync(pass, salt, 32).toString('hex');
  return `${salt}:${h}`;
}
function checkPass(pass, stored) {
  const [salt, h] = String(stored).split(':');
  if (!salt || !h) return false;
  const a = crypto.scryptSync(pass, salt, 32), b = Buffer.from(h, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// jeton = id.expiration.signature (HMAC-SHA256), valable 60 jours
function makeToken(id) {
  const exp = Date.now() + 60 * 24 * 3600 * 1000;
  const body = `${id}.${exp}`;
  const sig = crypto.createHmac('sha256', secret()).update(body).digest('base64url');
  return `${body}.${sig}`;
}
function readToken(tok) {
  const parts = String(tok || '').split('.');
  if (parts.length !== 3) return null;
  const [id, exp, sig] = parts;
  const good = crypto.createHmac('sha256', secret()).update(`${id}.${exp}`).digest('base64url');
  if (sig.length !== good.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(good))) return null;
  if (Number(exp) < Date.now()) return null;
  return store.get(id);
}

function register(name, pass) {
  name = String(name || '').trim();
  pass = String(pass || '');
  if (!NAME_RE.test(name)) return { err: 'Pseudo : 3 à 16 caractères (lettres, chiffres, _ . -).' };
  if (pass.length < 4 || pass.length > 72) return { err: 'Mot de passe : 4 caractères minimum.' };
  if (store.findByName(name)) return { err: 'Ce pseudo est déjà pris.' };
  const u = {
    id: crypto.randomBytes(8).toString('hex'), name, pass: hashPass(pass), created: Date.now(),
    xp: 0, avatar: C.BASE_AVATARS[Math.floor(Math.random() * C.BASE_AVATARS.length)], frame: 'classic', title: 'bleu',
    stats: { matches: 0, wins: 0, rounds: 0 }, friends: [], reqIn: [], reqOut: [],
  };
  store.create(u);
  return { user: u };
}
function login(name, pass) {
  const u = store.findByName(name);
  if (!u || !checkPass(String(pass || ''), u.pass)) return { err: 'Pseudo ou mot de passe incorrect.' };
  return { user: u };
}

const level = (u) => C.levelFromXp(u.xp);
function publicProfile(u) {
  return { id: u.id, name: u.name, avatar: u.avatar, frame: u.frame, title: u.title, level: level(u), xp: u.xp };
}
function meProfile(u) {
  const L = level(u);
  return { ...publicProfile(u), stats: u.stats, xpLevel: C.xpForLevel(L), xpNext: C.xpForLevel(L + 1) };
}

function equip(u, { avatar, frame, title }) {
  const L = level(u);
  if (avatar !== undefined) { const l = C.avatarLevel(avatar); if (l === null || l > L) return 'Avatar verrouillé.'; u.avatar = avatar; }
  if (frame !== undefined) { const l = C.frameLevel(frame); if (l === null || l > L) return 'Cadre verrouillé.'; u.frame = frame; }
  if (title !== undefined) { const l = C.titleLevel(title); if (l === null || l > L) return 'Titre verrouillé.'; u.title = title; }
  store.save(u);
  return null;
}

// ── amis ──
function friendRequest(u, name) {
  const v = store.findByName(name);
  if (!v) return 'Aucun joueur avec ce pseudo.';
  if (v.id === u.id) return "Tu ne peux pas t'ajouter toi-même 🙃";
  if (u.friends.includes(v.id)) return `${v.name} est déjà ton ami.`;
  if (u.reqIn.includes(v.id)) return friendAccept(u, v.id); // il t'avait déjà demandé : on accepte
  if (!u.reqOut.includes(v.id)) u.reqOut.push(v.id);
  if (!v.reqIn.includes(u.id)) v.reqIn.push(u.id);
  store.save(u); store.save(v);
  return null;
}
function friendAccept(u, id) {
  const v = store.get(id);
  if (!v || !u.reqIn.includes(id)) return 'Demande introuvable.';
  u.reqIn = u.reqIn.filter((x) => x !== id); v.reqOut = v.reqOut.filter((x) => x !== u.id);
  if (!u.friends.includes(id)) u.friends.push(id);
  if (!v.friends.includes(u.id)) v.friends.push(u.id);
  store.save(u); store.save(v);
  return null;
}
function friendRemove(u, id) {
  // refuse une demande, annule une demande envoyée, ou supprime un ami
  const v = store.get(id);
  u.friends = u.friends.filter((x) => x !== id); u.reqIn = u.reqIn.filter((x) => x !== id); u.reqOut = u.reqOut.filter((x) => x !== id);
  if (v) { v.friends = v.friends.filter((x) => x !== u.id); v.reqIn = v.reqIn.filter((x) => x !== u.id); v.reqOut = v.reqOut.filter((x) => x !== u.id); store.save(v); }
  store.save(u);
  return null;
}

// ── XP de fin de match ──
function awardMatch(u, { roundsWon, won, points }) {
  const before = level(u);
  const gained = 30 + roundsWon * 12 + (points || 0) * 4 + (won ? 60 : 0);
  u.xp += gained;
  u.stats.matches++;
  if (won) u.stats.wins++;
  u.stats.rounds += roundsWon;
  store.save(u);
  const after = level(u);
  return { gained, xp: u.xp, level: after, prevLevel: before, unlocks: C.unlocksBetween(before, after), xpLevel: C.xpForLevel(after), xpNext: C.xpForLevel(after + 1) };
}

module.exports = { register, login, makeToken, readToken, publicProfile, meProfile, equip, friendRequest, friendAccept, friendRemove, awardMatch, level };
