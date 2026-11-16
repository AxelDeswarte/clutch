# CLUTCH — mini-jeux compétitifs entre potes

Jeu multijoueur dans le navigateur, de 2 à 10 joueurs. Chaque manche tire un mini-jeu au hasard.

**Modes**
| Mode | Joueurs | Jeux |
|---|---|---|
| Chacun pour soi (mode principal) | 2 à 10 | les 20 mini-jeux |
| 2v2 · 3v3 | 4 · 6 | les 10 jeux marqués 👥, avec une règle d'équipe chacun |

Règles d'équipe : pas de tir ami (Tank), pas de passe à un coéquipier (Araignée), on ne bouscule que les adversaires
(Lames, Sol instable, Champ de mines), places additionnées dans les courses (Circuit, Course de haies, Champ de mines),
code et essais partagés (Code secret).

**Fin de partie** (au choix dans le salon) : un nombre de manches (1 à 25) ou un nombre de points à atteindre (1 à 50).
Chaque manche rapporte 1 point à son gagnant (ou à son équipe), 0 aux autres. Égalité à la fin = manche décisive,
égalité en tête aux points = on continue. Déminage et Undercover sont décochés par défaut.

Un chat de salon est dispo partout (salle d'attente et parties), avec l'historique des 40 derniers messages.
L'accueil affiche un classement : les derniers gagnants (invités compris) et le top 10 des comptes aux victoires.

**Mini-jeux** (plusieurs inspirés de Machine Party)
| Jeu | Principe |
|---|---|
| 🤠 Duel au soleil | dégainer au signal, pas avant |
| 🛗 Escalator | taper Z Q S D pour monter un escalator sans fin, le broyeur accélère : dernier survivant |
| 🏍️ Tron | coincer les autres avec son trait |
| 🧠 Mémoire | recliquer les cases allumées, une de plus par niveau |
| 🪚 Lames | esquiver scies circulaires et lasers rotatifs |
| 🏃 Course de haies | alterner ← → et sauter au bon moment |
| 🔥 Le Filtre | 30 s de tapis infini : objets de valeur en caisse, ferraille au four, 3 vies |
| 🕳️ Sol instable | rester sur le bon symbole, bousculer les autres dans le vide |
| 🚬 Pause clope | tirer et relâcher dans la zone verte sans tousser |
| 🍽️ Bonnes manières | manger quand Tonton ne regarde pas, sinon il tire |
| 🕷️ L'Araignée | patate chaude : refiler l'araignée-bombe avant l'explosion |
| 💥 Champ de mines | traverser à l'aveugle, sonar à l'arrêt, moissonneuse aux trousses |
| 🕵️ Undercover | bluff : 1 undercover jusqu'à 5, + Mr White dès 6, 2 undercovers dès 8 (à 2 : deviner le mot de l'autre) |
| 🪖 Tank | ZQSD pour rouler, flèches pour viser, espace pour tirer, 2 vies, caisses destructibles |
| 🧨 Syllabes | chacun son tour, un mot qui contient la syllabe ; la mèche raccourcit (10 s → 3 s) et repart après chaque explosion |
| 🏎️ Circuit | course en vue pilote (route pseudo-3D), feux de départ, virages, cônes, gosses qui traversent, turbos |
| 🔐 Code secret | casser un code de 4 couleurs en 8 essais, une marque sur chaque boule (⚫ bonne place, ⚪ ailleurs) |
| 🐍 Serpents | manger pour grandir, ne toucher ni mur ni serpent (rendu fluide entre les pas) |
| 🪶 Envol | un seul bouton pour battre des ailes entre les cheminées, départ après un 3-2-1 |
| 🚩 Déminage | la même grille pour tous, le premier qui a tout déminé termine la manche |

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
