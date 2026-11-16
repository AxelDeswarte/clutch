# CLUTCH — mini-jeux compétitifs entre potes

Jeu multijoueur dans le navigateur, de 2 à 6 joueurs. Chaque manche tire un mini-jeu au hasard.

**Modes**
| Mode | Joueurs | Victoire |
|---|---|---|
| 1v1 | 2 | best of N manches |
| 2v2 · 3v3 | 4 · 6 | le camp du meilleur joueur gagne la manche, best of N |
| Chacun pour soi | 3 à 6 | N manches, 3 / 2 / 1 pts au podium |

Le nombre de manches se règle dans le salon (1 à 25). Égalité à la fin = manche décisive.
Les 20 mini-jeux sont jouables dans tous les modes.

**Mini-jeux** (plusieurs inspirés de Machine Party)
| Jeu | Principe |
|---|---|
| 🤠 Duel au soleil | dégainer au signal, pas avant |
| 🛗 Escalator | taper les flèches pour monter, un broyeur remonte derrière |
| 🏍️ Tron | coincer les autres avec son trait |
| 🧠 Mémoire | recliquer les cases allumées, une de plus par niveau |
| 🪚 Lames | esquiver scies circulaires et lasers rotatifs |
| 🏃 Course de haies | alterner ← → et sauter au bon moment |
| 🔥 Le Filtre | 40 s de tapis infini : tableaux en caisse, ferraille au four, erreur = sonné |
| 🕳️ Sol instable | rester sur le bon symbole, bousculer les autres dans le vide |
| 🚬 Pause clope | tirer et relâcher dans la zone verte sans tousser |
| 🍽️ Bonnes manières | manger quand Tonton ne regarde pas, sinon il tire |
| 🕷️ L'Araignée | patate chaude : refiler l'araignée-bombe avant l'explosion |
| 💥 Champ de mines | traverser à l'aveugle, sonar à l'arrêt, moissonneuse aux trousses |
| 🕵️ Undercover | bluff (variante 1v1 : deviner le mot de l'autre en 2 essais) |
| 🪖 Tank | ZQSD pour rouler, flèches pour viser, espace pour tirer, 2 vies, caisses destructibles |
| 🧨 Syllabes | chacun son tour, un mot français qui contient la syllabe avant que la mèche brûle |
| 🏎️ Circuit | course en vue pilote (route pseudo-3D), turbos au sol, voitures fantômes |
| 🔐 Code secret | casser un code de 4 couleurs en 10 essais (⚫ bien placé, ⚪ mal placé) |
| 🐍 Serpents | manger pour grandir, ne toucher ni mur ni serpent |
| 🪶 Envol | un seul bouton pour battre des ailes entre les cheminées |
| 🚩 Déminage | la même grille pour tous, premier à tout déminer |

**Comptes, niveaux, skins, amis**
- Compte (pseudo + email + mot de passe) ou jeu en invité. Connexion avec le pseudo ou l'email.
- Mot de passe oublié : lien envoyé par email (valable 30 min). Pseudo et email modifiables dans ⚙️ Compte.
  Les comptes créés avant l'email voient un bandeau qui leur demande d'en ajouter un.
- XP à chaque match : participation, manches gagnées, victoire. Chaque niveau débloque des avatars, des cadres (Néon, Sanglant, Or, En feu, Glitch, Néant…) et des titres.
- Amis : ajout par pseudo, statut en direct (en ligne, dans un salon, en partie), bouton **Rejoindre** et invitations.
- Refresh ou coupure réseau : tu reviens automatiquement dans ton salon ou dans la manche en cours (45 s pour revenir).

L'hôte du salon (👑) choisit le mode, la durée et les mini-jeux actifs.
Chaque élimination déclenche une animation débile avec son. Le son se coupe avec le bouton 🔊 en bas à droite.

## Lancer en local

```bash
npm install
npm start           # → http://localhost:3000
```

Ouvre plusieurs onglets pour tester seul.

## Mettre en ligne

Voir **[DEPLOY.md](DEPLOY.md)** : VPS OVHcloud + un script qui installe tout (`deploy/setup.sh`).

## Architecture

- `server.js` : HTTP statique, WebSocket, salons, modes, scores, reconnexion, présence des amis.
- `accounts.js` / `store.js` : comptes (mots de passe scrypt, jetons signés HMAC), email, mot de passe oublié, amis, XP. Stockage Postgres si `DATABASE_URL` est défini (Neon), sinon fichier `data/db.json`.
- `mailer.js` : envoi des emails via Resend (`RESEND_API_KEY`). Sans clé, le lien est affiché dans la console du serveur.
- `public/cosmetics.js` : niveaux et catalogue des skins, partagé client/serveur.
- `games.js` : logique des 20 mini-jeux. **Serveur autoritaire** : il génère les manches, valide les inputs et décide des classements.
- `public/app.js` : client (salon, affichage de chaque jeu, interpolation des jeux en temps réel).
- `public/gags.js` : animations d'élimination (Web Animations API) + sons synthétisés (WebAudio, aucun fichier audio).

Seule exception à l'autorité du serveur : au Duel au soleil, le temps de réaction est mesuré côté client pour neutraliser la latence.

## Ajouter un mini-jeu

Dans `games.js` :

```js
GAMES.monJeu = {
  title: 'Mon jeu', min: 2,
  rules: 'Règle en une phrase.',
  create(room) {
    return {
      start() { room.send({ t: 'g', k: 'setup' }); },
      input(i, m) { /* ... */ room.finish(scoresParJoueur, 'raison'); },
    };
  },
};
```

L'API de `room` est documentée en haut de `games.js` (`send`, `later`, `every`, `eliminate`, `survivalOver`, `finish`…).
Le classement vient de `finish(scores)` : score plus haut = mieux classé.

Côté client, dans `public/app.js` : `GAMES.monJeu = { init(), msg(m), key(e)?, stop()? }`.

## Ajouter un gag d'élimination

Une ligne dans `GAGS` (`public/gags.js`) : emoji, son, chorégraphie (`suck`, `rain`, `explode`, `beam`, `cloud`, `launch`, `eat`, `rocket`, `slip`, `squash`, `wrap`) et texte (`{n}` = victime, `{o}` = un autre joueur au hasard).
