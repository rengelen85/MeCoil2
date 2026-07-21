# EC2 Graviton bootstrap (manual)

Step-by-step for standing up MeCoil on a single ARM (Graviton) EC2 host. For an
unattended first boot, paste [`ec2-user-data.sh`](ec2-user-data.sh) into the
instance's **User data** field instead — this file is the by-hand equivalent
plus the day-2 (update / rollback / logs) flow. See [README.md](README.md) for
the cost breakdown and why this beats App Runner / ECS Express Mode.

## 1. Launch the instance

| Setting        | Value                                                        |
| -------------- | ----------------------------------------------------------- |
| AMI            | Amazon Linux 2023, **arm64**                                 |
| Instance type  | `t4g.small` (2 GB) — or `t4g.micro` (1 GB) for light use     |
| Storage        | 8–10 GB gp3                                                  |
| Security group | inbound `80` + `443` from anywhere; `22` from your IP only   |
| Address        | **auto-assigned public IP** (dynamic — no Elastic IP)        |

No Elastic IP: the public IP changes on stop/start, and a DuckDNS updater
(step 2) re-points the name within a few minutes. That also skips the ~$3.60/mo
charge AWS now levies on *every* public IPv4 address, Elastic or not.

## 2. DuckDNS (dynamic DNS + cert name)

Phones need a **trusted** cert for Web Bluetooth + GPS, and Let's Encrypt only
issues for a real DNS name — Caddy's self-signed fallback
(`MECOIL_DOMAIN=localhost`) is rejected on-device. We use the free
[DuckDNS](https://www.duckdns.org) name **`mecoil.duckdns.org`** and a small
updater that keeps its `A` record pointed at the instance's current public IP.

1. Sign in at [duckdns.org](https://www.duckdns.org), create the `mecoil`
   subdomain, and copy your account **token**.
2. Install the updater as a systemd timer (fires at boot + every 5 min).
   `ip=` is left empty so DuckDNS uses the request's source address — this
   host's current public IP — with no IP detection needed:

   ```sh
   sudo install -d -m 700 /etc/duckdns
   # replace YOUR_TOKEN below:
   sudo tee /etc/duckdns/update.sh >/dev/null <<'EOF'
   #!/usr/bin/env bash
   resp=$(curl -fsS "https://www.duckdns.org/update?domains=mecoil&token=YOUR_TOKEN&ip=")
   echo "duckdns (mecoil.duckdns.org): $resp"; [ "$resp" = "OK" ]
   EOF
   sudo chmod 700 /etc/duckdns/update.sh

   sudo tee /etc/systemd/system/duckdns.service >/dev/null <<'EOF'
   [Unit]
   Description=Update DuckDNS A record for MeCoil
   Wants=network-online.target
   After=network-online.target
   [Service]
   Type=oneshot
   ExecStart=/etc/duckdns/update.sh
   EOF

   sudo tee /etc/systemd/system/duckdns.timer >/dev/null <<'EOF'
   [Unit]
   Description=Refresh the DuckDNS A record for MeCoil
   [Timer]
   OnBootSec=30s
   OnUnitActiveSec=5min
   Unit=duckdns.service
   [Install]
   WantedBy=timers.target
   EOF

   sudo systemctl daemon-reload
   sudo systemctl enable --now duckdns.timer
   sudo systemctl start duckdns.service      # register now; check: journalctl -u duckdns
   ```

Give DNS a few seconds to resolve to this host before the first `up`, or the
initial cert request fails (Caddy retries, so it self-heals once DNS is live).
On a later stop/start the timer re-points `mecoil.duckdns.org` within ~5 min;
the cert is tied to the name, not the IP, so it keeps working.

## 3. Install Docker (SSH in as `ec2-user`)

```sh
sudo dnf update -y
sudo dnf install -y docker git
sudo systemctl enable --now docker
sudo usermod -aG docker ec2-user        # log out/in for the group to take effect

# docker compose plugin (arm64):
sudo mkdir -p /usr/libexec/docker/cli-plugins
sudo curl -fsSL \
  https://github.com/docker/compose/releases/latest/download/docker-compose-linux-aarch64 \
  -o /usr/libexec/docker/cli-plugins/docker-compose
sudo chmod +x /usr/libexec/docker/cli-plugins/docker-compose

# docker buildx plugin (arm64): AL2023's docker package ships no (or an old)
# buildx, but `docker compose --build` needs buildx >= 0.17.0. Install the
# latest release binary:
BUILDX_TAG=$(curl -fsSL https://api.github.com/repos/docker/buildx/releases/latest \
  | grep -oP '"tag_name":\s*"\K[^"]+')
sudo curl -fsSL \
  "https://github.com/docker/buildx/releases/download/${BUILDX_TAG}/buildx-${BUILDX_TAG}.linux-arm64" \
  -o /usr/libexec/docker/cli-plugins/docker-buildx
sudo chmod +x /usr/libexec/docker/cli-plugins/docker-buildx
docker buildx version   # must be >= 0.17.0
```

## 4. Clone, configure, start

```sh
git clone https://github.com/rengelen85/MeCoil2.git && cd MeCoil2
cp infra/docker/.env.example infra/docker/.env
# edit infra/docker/.env → MECOIL_DOMAIN=mecoil.duckdns.org

docker compose -f infra/docker/docker-compose.yml --env-file infra/docker/.env up -d --build
```

The image builds natively as arm64 on the Graviton host. Caddy fetches the cert
on first start; then browse to `https://<your-domain>`.

> Amazon Linux 2023 has no `make` by default (`sudo dnf install -y make` if you
> want it). The compose command above is exactly what `make docker-up` runs.

## Day 2

```sh
cd ~/MeCoil2
# --- update to latest ---
git pull
docker compose -f infra/docker/docker-compose.yml --env-file infra/docker/.env up -d --build

# --- rollback to a known-good commit ---
git checkout <commit-sha>
docker compose -f infra/docker/docker-compose.yml --env-file infra/docker/.env up -d --build

# --- logs / stop ---
docker compose -f infra/docker/docker-compose.yml logs -f
docker compose -f infra/docker/docker-compose.yml --env-file infra/docker/.env down
```

Compose has `restart: unless-stopped` on both services, so the stack comes back
on reboot automatically — no systemd unit needed.
