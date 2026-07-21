#!/usr/bin/env bash
# MeCoil — first-boot bootstrap for an Amazon Linux 2023 arm64 (Graviton) EC2 host
# that uses a DYNAMIC public IP (no Elastic IP). A DuckDNS updater (systemd
# timer) keeps mecoil.duckdns.org pointed at whatever public IP the instance
# currently has, so the address survives stop/start within a few minutes.
#
# Paste this into the instance's "User data" field at launch (or run it by hand
# as root on a fresh box). It installs Docker + the compose plugin, wires up the
# DuckDNS updater, clones the repo, and brings up the app + Caddy stack. Caddy
# fetches a Let's Encrypt cert for $MECOIL_DOMAIN once DNS resolves here. See
# BOOTSTRAP.md for the manual walk-through.
#
# EDIT THESE before launching:
DUCKDNS_SUBDOMAIN="mecoil"                       # -> mecoil.duckdns.org
DUCKDNS_TOKEN="REPLACE_WITH_YOUR_DUCKDNS_TOKEN"  # from https://www.duckdns.org
REPO_URL="https://github.com/rengelen85/MeCoil2.git"

MECOIL_DOMAIN="${DUCKDNS_SUBDOMAIN}.duckdns.org"

set -euxo pipefail

# --- Docker + git ---------------------------------------------------------
dnf update -y
dnf install -y docker git
systemctl enable --now docker
usermod -aG docker ec2-user   # so `ec2-user` can run docker without sudo

# --- docker compose plugin (arm64) ---------------------------------------
mkdir -p /usr/libexec/docker/cli-plugins
curl -fsSL \
  https://github.com/docker/compose/releases/latest/download/docker-compose-linux-aarch64 \
  -o /usr/libexec/docker/cli-plugins/docker-compose
chmod +x /usr/libexec/docker/cli-plugins/docker-compose

# --- DuckDNS dynamic-DNS updater (systemd oneshot + 5-min timer) ----------
# `ip=` left empty means DuckDNS uses the request's source address — i.e. this
# host's current public IP — so no IP detection is needed here.
install -d -m 700 /etc/duckdns
cat > /etc/duckdns/update.sh <<EOF
#!/usr/bin/env bash
resp=\$(curl -fsS "https://www.duckdns.org/update?domains=${DUCKDNS_SUBDOMAIN}&token=${DUCKDNS_TOKEN}&ip=")
echo "duckdns (${MECOIL_DOMAIN}): \$resp"
[ "\$resp" = "OK" ]
EOF
chmod 700 /etc/duckdns/update.sh

cat > /etc/systemd/system/duckdns.service <<'EOF'
[Unit]
Description=Update DuckDNS A record for MeCoil
Wants=network-online.target
After=network-online.target

[Service]
Type=oneshot
ExecStart=/etc/duckdns/update.sh
EOF

cat > /etc/systemd/system/duckdns.timer <<'EOF'
[Unit]
Description=Refresh the DuckDNS A record for MeCoil

[Timer]
OnBootSec=30s
OnUnitActiveSec=5min
Unit=duckdns.service

[Install]
WantedBy=timers.target
EOF

systemctl daemon-reload
systemctl enable --now duckdns.timer
# Register immediately (via systemd, so the token isn't echoed by `set -x`) so
# DNS resolves here before Caddy requests its cert. A hiccup here must not abort
# the deploy — the timer will retry.
systemctl start duckdns.service || true

# --- clone + configure ----------------------------------------------------
install -d -o ec2-user -g ec2-user /opt/mecoil
sudo -u ec2-user git clone "$REPO_URL" /opt/mecoil/MeCoil2
cd /opt/mecoil/MeCoil2
printf 'MECOIL_DOMAIN=%s\n' "$MECOIL_DOMAIN" > infra/docker/.env
chown ec2-user:ec2-user infra/docker/.env

# --- build + start (builds the arm64 image natively on this Graviton host) -
docker compose -f infra/docker/docker-compose.yml --env-file infra/docker/.env \
  up -d --build
