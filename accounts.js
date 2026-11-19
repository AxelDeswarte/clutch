// CLUTCH — comptes : mots de passe, jetons de connexion, profils, amis, XP
const crypto = require('crypto');
const store = require('./store');
const C = require('./public/cosmetics');

const NAME_RE = /^[\p{L}\p{N}_.-]{3,16}$/u;
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;
const RESET_MS = 30 * 60 * 1000;
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

function secret() {
  if (process.env.CLUTCH_SECRET) return process.env.CLUTCH_SECRET;
  // pas de variable d'env : on génère un secret une fois et on le garde dans la base
  if (!store.meta.secret) store.setMeta('secret', crypto.randomBytes(32).toString('hex'));
  return store.meta.secret;
}

// scrypt asynchrone : un hachage (~50 ms) ne doit pas figer les parties en cours
const scrypt = (pass, salt) => new Promise((ok, ko) => crypto.scrypt(pass, salt, 32, (e, k) => (e ? ko(e) : ok(k))));
async function hashPass(pass) {
  const salt = crypto.randomBytes(16).toString('hex');
  return `${salt}:${(await scrypt(pass, salt)).toString('hex')}`;
}
async function checkPass(pass, stored) {
  const [salt, h] = String(stored).split(':');
  if (!salt || !h) return false;
  const a = await scrypt(pass, salt), b = Buffer.from(h, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// jeton = id.expiration.signature (HMAC-SHA256), valable 60 jours.
// La signature inclut u.pv (version du mot de passe) : changer de mot de passe déconnecte les autres appareils.
const signBody = (body, pv) => crypto.createHmac('sha256', secret()).update(pv ? `${body}.${pv}` : body).digest('base64url');
function makeToken(id) {
  const exp = Date.now() + 60 * 24 * 3600 * 1000;
  const body = `${id}.${exp}`;
  const u = store.get(id);
  return `${body}.${signBody(body, u && u.pv)}`;
}
function readToken(tok) {
  const parts = String(tok || '').split('.');
  if (parts.length !== 3) return null;
  const [id, exp, sig] = parts;
  const u = store.get(id);
  if (!u) return null;
  // comparer des octets, pas des caractères : un « é » dans la signature ferait sinon planter timingSafeEqual (et le serveur)
  const a = Buffer.from(sig), b = Buffer.from(signBody(`${id}.${exp}`, u.pv));
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  if (Number(exp) < Date.now()) return null;
  return u;
}

const nameErr = (name, self) => {
  if (!NAME_RE.test(name)) return 'Pseudo : 3 à 16 caractères (lettres, chiffres, _ . -).';
  const o = store.findByName(name);
  if (o && o !== self) return 'Ce pseudo est déjà pris.';
  return null;
};
const emailErr = (email, self) => {
  if (!EMAIL_RE.test(email) || email.length > 254) return 'Adresse email invalide.';
  const o = store.findByEmail(email);
  if (o && o !== self) return 'Cet email est déjà utilisé par un autre compte.';
  return null;
};
// 8 caractères minimum pour tout nouveau mot de passe (les anciens comptes gardent le leur)
const PASS_MIN = 8;
const passErr = (pass) => (pass.length < PASS_MIN ? `Mot de passe : ${PASS_MIN} caractères minimum.` : pass.length > 72 ? 'Mot de passe : 72 caractères maximum.' : null);

// trop d'échecs de connexion sur un même compte : on le bloque 15 min (contre le devinage de mot de passe)
const FAIL_MAX = 10, FAIL_MS = 15 * 60 * 1000;
const fails = new Map(); // id -> [horodatages]
const recentFails = (id) => { const now = Date.now(), l = (fails.get(id) || []).filter((t) => now - t < FAIL_MS); if (l.length) fails.set(id, l); else fails.delete(id); return l; };

async function register(name, pass, email) {
  name = String(name || '').trim();
  pass = String(pass || '');
  email = String(email || '').trim();
  let err = nameErr(name) || emailErr(email) || passErr(pass);
  if (err) return { err };
  const hash = await hashPass(pass);
  err = nameErr(name) || emailErr(email); // revérifié : un autre a pu prendre le pseudo pendant le hachage
  if (err) return { err };
  const u = {
    id: crypto.randomBytes(8).toString('hex'), name, email, pass: hash, created: Date.now(),
    xp: 0, avatar: C.BASE_AVATARS[Math.floor(Math.random() * C.BASE_AVATARS.length)], frame: 'classic', title: 'bleu',
    stats: { matches: 0, wins: 0, rounds: 0 }, friends: [], reqIn: [], reqOut: [],
  };
  store.create(u);
  return { user: u };
}
// on se connecte avec son pseudo OU son email
async function login(name, pass) {
  const u = String(name || '').includes('@') ? store.findByEmail(name) : store.findByName(name);
  if (u && recentFails(u.id).length >= FAIL_MAX) return { err: 'Trop d\'essais sur ce compte. Réessaie dans 15 minutes, ou utilise « Mot de passe oublié ».' };
  if (!u || !(await checkPass(String(pass || ''), u.pass))) {
    if (u) { fails.set(u.id, [...recentFails(u.id), Date.now()]); console.warn(`Connexion refusée pour le compte ${u.id}`); }
    return { err: 'Pseudo ou mot de passe incorrect.' };
  }
  fails.delete(u.id);
  return { user: u };
}

const level = (u) => C.levelFromXp(u.xp);
function publicProfile(u) {
  return { id: u.id, name: u.name, avatar: u.avatar, frame: u.frame, title: u.title, level: level(u), xp: u.xp };
}
function meProfile(u) {
  const L = level(u);
  return { ...publicProfile(u), email: u.email || '', stats: u.stats, xpLevel: C.xpForLevel(L), xpNext: C.xpForLevel(L + 1) };
}

// ── pseudo, email, mot de passe oublié ──
function rename(u, name) {
  name = String(name || '').trim();
  if (name === u.name) return null;
  const err = nameErr(name, u);
  if (err) return err;
  store.rename(u, name);
  return null;
}
async function setEmail(u, email, pass) {
  email = String(email || '').trim();
  if (!(await checkPass(String(pass || ''), u.pass))) return 'Mot de passe incorrect.';
  const err = emailErr(email, u);
  if (err) return err;
  store.setEmail(u, email);
  return null;
}
// renvoie { u, token } si l'email correspond à un compte ; seul le hash du jeton est stocké
function startReset(email) {
  const u = store.findByEmail(String(email || '').trim());
  if (!u) return null;
  if (u.reset && Date.now() < u.reset.exp - RESET_MS + 60000) return null; // 1 email par minute max
  const token = crypto.randomBytes(24).toString('base64url');
  u.reset = { h: sha(token), exp: Date.now() + RESET_MS };
  store.save(u);
  return { u, token };
}
async function finishReset(token, pass) {
  pass = String(pass || '');
  const h = sha(String(token || ''));
  const find = () => { for (const v of store.users.values()) if (v.reset && v.reset.h === h && v.reset.exp >= Date.now()) return v; return null; };
  let u = find();
  if (!u) return { err: 'Lien expiré ou déjà utilisé. Redemande un email.' };
  const err = passErr(pass);
  if (err) return { err };
  const hash = await hashPass(pass);
  if (find() !== u) return { err: 'Lien expiré ou déjà utilisé. Redemande un email.' }; // lien utilisé entre-temps
  u.pass = hash;
  u.pv = (u.pv || 0) + 1;
  delete u.reset;
  fails.delete(u.id);
  store.save(u);
  return { user: u };
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

module.exports = { PASS_MIN, register, login, rename, setEmail, startReset, finishReset, RESET_MS, makeToken, readToken, publicProfile, meProfile, equip, friendRequest, friendAccept, friendRemove, awardMatch, level };
