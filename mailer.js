// CLUTCH — envoi d'emails via Resend (https://resend.com), sans dépendance
// RESEND_API_KEY : clé API · MAIL_FROM : expéditeur (domaine vérifié chez Resend)
// Sans clé (en local), l'email est affiché dans la console au lieu d'être envoyé.
const FROM = process.env.MAIL_FROM || 'CLUTCH <onboarding@resend.dev>';

async function sendMail(to, subject, html, text) {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    console.log(`📧 [pas de RESEND_API_KEY] email pour ${to} — ${subject}\n${text}`);
    return;
  }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: FROM, to: [to], subject, html, text }),
  });
  if (!res.ok) throw new Error(`Resend ${res.status} : ${(await res.text()).slice(0, 200)}`);
}

const escHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function sendReset(to, name, link, minutes) {
  const text = `Salut ${name},\n\nPour choisir un nouveau mot de passe CLUTCH, ouvre ce lien (valable ${minutes} minutes) :\n${link}\n\nSi tu n'as rien demandé, ignore cet email : ton mot de passe ne change pas.`;
  const html = `<div style="font-family:system-ui,sans-serif;max-width:480px;margin:auto;padding:20px">
    <h2 style="margin:0 0 12px">🔑 Mot de passe oublié</h2>
    <p>Salut <b>${escHtml(name)}</b>,</p>
    <p>Pour choisir un nouveau mot de passe CLUTCH, clique ici (valable ${minutes} minutes) :</p>
    <p><a href="${escHtml(link)}" style="display:inline-block;background:#3dd6ff;color:#1b1440;font-weight:800;padding:12px 20px;border-radius:12px;border:3px solid #1b1440;text-decoration:none">Choisir un nouveau mot de passe</a></p>
    <p style="color:#777;font-size:13px">Si tu n'as rien demandé, ignore cet email : ton mot de passe ne change pas.</p></div>`;
  return sendMail(to, 'CLUTCH — nouveau mot de passe', html, text);
}

module.exports = { sendReset };
