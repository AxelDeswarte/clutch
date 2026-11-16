# Mettre CLUTCH en ligne

## Option gratuite : Render + Neon (recommandée)

### 1. Le jeu sur Render
Dépôt GitHub → render.com → **New → Web Service** → Region **Frankfurt**, Build `npm install`, Start `npm start`, Instance **Free**, Health Check Path `/health`.

### 2. La base de données des comptes sur Neon (obligatoire pour les comptes)
Le disque de Render gratuit est effacé à chaque mise en veille : sans base externe, les comptes, l'XP et les amis disparaîtraient.

1. Crée un compte gratuit sur **neon.com** → **New Project** → région **AWS Europe (Frankfurt)**.
2. Sur le tableau de bord du projet, clique **Connect** et copie la *connection string* (elle commence par `postgresql://` et finit par `?sslmode=require`).
3. Sur Render → ton service → **Environment** → **Add Environment Variable** :
   - `DATABASE_URL` = la chaîne copiée
4. Sauvegarde : Render redéploie. Dans les logs tu dois voir `Comptes : stockage postgres`.

La table est créée automatiquement au premier démarrage. Rien d'autre à faire.

*(Optionnel)* `CLUTCH_SECRET` = une longue chaîne aléatoire. Sinon un secret est généré et stocké dans la base tout seul.

### Mettre à jour
```powershell
git add -A
git commit -m "mise à jour"
git push
```
Render redéploie automatiquement. Les parties en cours sont coupées, mais les comptes sont conservés.

---

## Option payante : VPS (OVH, Hostinger…)

Compte ~15 minutes la première fois. Ensuite, une mise à jour prend 30 secondes.

### Pourquoi OVH plutôt que Hostinger

- **Serveurs en France** (Gravelines, Roubaix, Strasbourg) : le meilleur ping pour vous, et ça compte pour Tron, Esquive et Réflexe.
- **Facturation au mois, sans engagement.** Chez Hostinger, le prix d'appel du KVM 1 demande de payer 24 mois d'avance, puis double au renouvellement.
- L'anti-DDoS et le trafic illimité sont inclus.

Le plus petit VPS suffit largement : le jeu consomme quelques dizaines de Mo de RAM.
Hostinger marche aussi avec le même script (même procédure, l'utilisateur est `root`).

## 1. Commander le VPS

1. Sur ovhcloud.com, va dans **VPS**, prends le modèle d'entrée de gamme (**VPS-1**).
2. Système : **Ubuntu 24.04**. Localisation : **France** (Gravelines, Roubaix ou Strasbourg).
3. Pas d'options payantes nécessaires. Vérifie la durée d'engagement dans le panier : « sans engagement » coûte un peu plus cher par mois mais tu peux arrêter quand tu veux.
4. Tu reçois un mail avec l'**IP**, l'utilisateur **`ubuntu`** et un mot de passe (ou ta clé SSH si tu en as donné une).

## 2. Envoyer le jeu sur le serveur

Depuis ton PC, dans le dossier qui contient `clutch/` (PowerShell sous Windows, terminal sous Linux/Mac) :

```bash
scp -r clutch ubuntu@TON_IP:~
```

## 3. Lancer l'installation

```bash
ssh ubuntu@TON_IP
sudo bash ~/clutch/deploy/setup.sh
```

Le script installe Node.js, nginx et un certificat HTTPS gratuit, puis démarre le jeu comme un service qui redémarre tout seul.
À la fin, il affiche l'adresse, du style :

```
✅ CLUTCH est en ligne : https://51-75-12-34.sslip.io
```

Envoie ce lien à tes potes, c'est tout. (`sslip.io` est un service gratuit qui transforme l'IP en nom de domaine, ce qui permet d'avoir le HTTPS sans rien acheter.)

### Avec ton propre nom de domaine (optionnel)

Crée un enregistrement DNS **A** `clutch.tondomaine.fr → TON_IP`, attends quelques minutes, puis :

```bash
sudo bash ~/clutch/deploy/setup.sh clutch.tondomaine.fr
```

## Mettre à jour le jeu

```bash
scp -r clutch ubuntu@TON_IP:~
ssh ubuntu@TON_IP "sudo bash ~/clutch/deploy/setup.sh"
```

(Si tu as utilisé ton domaine, rajoute-le à la fin de la commande.)

Attention, la mise à jour redémarre le serveur : les parties en cours sont coupées.

## Commandes utiles

| Quoi | Commande |
|---|---|
| Voir les logs en direct | `sudo journalctl -u clutch -f` |
| Redémarrer le jeu | `sudo systemctl restart clutch` |
| Arrêter le jeu | `sudo systemctl stop clutch` |
| État du service | `systemctl status clutch` |

## Si ça coince

- **Le site ne charge pas** : `systemctl status clutch` puis `sudo journalctl -u clutch -n 50`.
- **« HTTPS pas configuré »** : en général le domaine n'est pas encore propagé. Relance le script 10 minutes plus tard.
- **Connexion perdue en pleine partie** : regarde si le serveur a redémarré (`journalctl`). Un joueur qui ferme son onglet coupe aussi la manche pour tout le monde (retour au salon).


Sur un VPS, les comptes sont enregistrés dans `/opt/clutch/data/db.json` (conservé lors des mises à jour). Tu peux aussi définir `DATABASE_URL` pour utiliser Postgres.
