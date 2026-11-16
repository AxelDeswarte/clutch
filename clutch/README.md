# CLUTCH — mini-jeux compétitifs entre potes

Jeu multijoueur dans le navigateur, de 2 à 6 joueurs. Chaque manche tire un mini-jeu au hasard.

**Modes**
| Mode | Joueurs | Victoire |
|---|---|---|
| 1v1 | 2 | best of N manches |
| 2v2 · 3v3 | 4 · 6 | le camp du meilleur joueur gagne la manche, best of N |
| Chacun pour soi | 3 à 6 | N manches, 3 / 2 / 1 pts au podium |

Le nombre de manches se règle dans le salon (1 à 25). Égalité à la fin = manche décisive.
Les 13 mini-jeux sont jouables dans tous les modes.

**Mini-jeux** (plusieurs inspirés de Machine Party)
| Jeu | Principe |
|---|---|
| 🤠 Duel au soleil | dégainer au signal, pas avant |
| 🛗 Escalator | taper les flèches pour monter, un broyeur remonte derrière |
| 🏍️ Tron | coincer les autres avec son trait |
| 🧠 Mémoire | recliquer les cases allumées, une de plus par niveau |
| 🪚 Lames | esquiver scies circulaires et lasers rotatifs |
| 🏃 Course de haies | alterner ← → et sauter au bon moment |
| 🔥 Le Filtre | tapis roulant : brûler les portraits, laisser passer la ferraille |
| 🕳️ Sol instable | rester sur le bon symbole, bousculer les autres dans le vide |
| 🚬 Pause clope | tirer et relâcher dans la zone verte sans tousser |
| 🍽️ Bonnes manières | manger quand Tonton ne regarde pas, sinon il tire |
| 🕷️ L'Araignée | patate chaude : refiler l'araignée-bombe avant l'explosion |
| 💥 Champ de mines | traverser à l'aveugle, sonar à l'arrêt, moissonneuse aux trousses |
| 🕵️ Undercover | bluff (variante 1v1 : deviner le mot de l'autre en 2 essais) |

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

- `server.js` : HTTP statique, WebSocket, salons, modes, scores.
- `games.js` : logique des 9 mini-jeux. **Serveur autoritaire** : il génère les manches, valide les inputs et décide des classements.
- `public/app.js` : client (salon, affichage de chaque jeu, interpolation pour Esquive et Course).
- `public/gags.js` : animations d'élimination (Web Animations API) + sons synthétisés (WebAudio, aucun fichier audio).

Seule exception à l'autorité du serveur : en Réflexe, le temps de réaction est mesuré côté client pour neutraliser la latence.

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
