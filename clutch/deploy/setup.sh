#!/usr/bin/env bash
# CLUTCH — installation / mise à jour sur un VPS Ubuntu (OVH, Hostinger, peu importe)
#
#   sudo bash deploy/setup.sh                 → HTTPS automatique sur <ip>.sslip.io
#   sudo bash deploy/setup.sh mondomaine.fr   → HTTPS sur ton propre domaine (DNS A → IP du VPS)
#
# Relançable autant de fois que tu veux : ça met à jour le code et redémarre le jeu.
set -euo pipefail

APP_DIR=/opt/clutch
SRC_DIR="$(cd "$(dirname "$0")/.." && pwd)"
DOMAIN="${1:-}"

if [ "$(id -u)" -ne 0 ]; then echo "❌ Lance-moi avec sudo : sudo bash deploy/setup.sh"; exit 1; fi

echo "==> Paquets système"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y curl ca-certificates gnupg nginx certbot python3-certbot-nginx ufw rsync

IP="$(curl -4 -fsS https://api.ipify.org || hostname -I | awk '{print $1}')"
if [ -z "$DOMAIN" ]; then DOMAIN="${IP//./-}.sslip.io"; fi
echo "==> IP : $IP  ·  adresse du jeu : $DOMAIN"

echo "==> Node.js"
NODE_MAJOR=0
if command -v node >/dev/null 2>&1; then NODE_MAJOR="$(node -v | sed 's/^v//' | cut -d. -f1)"; fi
if [ "$NODE_MAJOR" -lt 18 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi
node -v

echo "==> Code du jeu → $APP_DIR"
id clutch >/dev/null 2>&1 || useradd --system --home-dir "$APP_DIR" --shell /usr/sbin/nologin clutch
mkdir -p "$APP_DIR"
if [ "$SRC_DIR" != "$APP_DIR" ]; then
  rsync -a --delete --exclude node_modules --exclude .git --exclude data "$SRC_DIR"/ "$APP_DIR"/
fi
cd "$APP_DIR"
npm install --omit=dev --no-audit --no-fund
chown -R clutch:clutch "$APP_DIR"

echo "==> Service systemd"
cat > /etc/systemd/system/clutch.service <<EOF
[Unit]
Description=CLUTCH - mini-jeux multijoueur
After=network.target

[Service]
User=clutch
WorkingDirectory=$APP_DIR
Environment=PORT=3000 HOST=127.0.0.1 NODE_ENV=production
ExecStart=$(command -v node) server.js
Restart=always
RestartSec=2

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable clutch >/dev/null
systemctl restart clutch

echo "==> Nginx (reverse proxy + WebSocket)"
cat > /etc/nginx/sites-available/clutch <<EOF
server {
    listen 80;
    listen [::]:80;
    server_name $DOMAIN;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
    }
}
EOF
ln -sf /etc/nginx/sites-available/clutch /etc/nginx/sites-enabled/clutch
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl reload nginx

echo "==> Pare-feu"
ufw allow OpenSSH >/dev/null
ufw allow 'Nginx Full' >/dev/null
ufw --force enable >/dev/null

echo "==> HTTPS (Let's Encrypt)"
if [ -d "/etc/letsencrypt/live/$DOMAIN" ]; then
  certbot --nginx -d "$DOMAIN" --non-interactive --reinstall --redirect >/dev/null 2>&1 || true
  URL="https://$DOMAIN"
elif certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos --register-unsafely-without-email --redirect; then
  URL="https://$DOMAIN"
else
  echo "⚠️  HTTPS pas configuré (domaine pas encore propagé ?). Le jeu marche quand même en HTTP."
  URL="http://$DOMAIN"
fi

sleep 1
if curl -fsS http://127.0.0.1:3000/health >/dev/null; then
  echo ""
  echo "✅ CLUTCH est en ligne : $URL"
  echo "   Logs : sudo journalctl -u clutch -f"
else
  echo "❌ Le serveur ne répond pas. Regarde : sudo journalctl -u clutch -n 50"
  exit 1
fi
