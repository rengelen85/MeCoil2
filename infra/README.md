# MeCoil — AWS deployment

Infrastructure-as-code to run the MeCoil game server on a small, secured,
cost-optimized AWS instance.

```text
                         Internet
                            │  80/443 (public)      22 (your IP only)
                            ▼
   ┌───────────────────────────────────────────────────────┐
   │  EC2 t4g.micro (Graviton, Amazon Linux 2023)           │
   │                                                        │
   │   Caddy :443  ──reverse_proxy──▶  node :3000 (local)   │
   │   (TLS: Let's Encrypt or self-signed)   mecoil.service │
   └───────────────────────────────────────────────────────┘
                            ▲
              dynamic public IP (new on every start)
                            ▲
        duckdns-update.service/.timer keeps
        <subdomain>.duckdns.org pointed at it
```

- **Compute:** one `t4g.micro` (2 vCPU / 1 GB, arm64). A 2 GB swapfile lets the
  Vite client build on-box.
- **TLS:** [Caddy](https://caddyserver.com/) terminates HTTPS and reverse-proxies
  to the Node server on `localhost:3000` (WebSocket-aware). With a DuckDNS
  subdomain configured it auto-obtains a **Let's Encrypt** cert; without one it
  uses a self-signed internal-CA cert on the instance's current public IP.
- **Dynamic IP, not an Elastic IP:** AWS bills every public IPv4 address ~$0.005/hr
  whether it's an Elastic IP or an auto-assigned one — but an Elastic IP is billed
  **24/7** (even while the instance is stopped), while an auto-assigned IP is only
  billed while the instance is **running**. Skipping the EIP and using
  [DuckDNS](https://www.duckdns.org) (free) to track the changing IP cuts that
  cost roughly in half versus a 24/7 EIP, on top of removing any Route53 hosted
  zone cost.
- **Security:** only ports **80/443** are public; **22** is restricted to a single
  source IP; port 3000 never leaves localhost. Both the SSH private key and the
  DuckDNS token live in **Secrets Manager** — never in the repo.
- **Cost control:** the instance schedules its own shutdown **4 hours** after each
  boot and *stops* (not terminates), so EBS persists (including Caddy's cached
  certificate) and it restarts in seconds. The game server itself runs endlessly
  (`Restart=always`) while up.

Rough cost: **≈ $2–4/month** — EBS (~$0.80), two Secrets Manager secrets (~$0.80),
and a public IP only while running (~$0.50 at 4h/day); DuckDNS is free. Compute
itself is a few cents a month with the 4h auto-stop.

## Layout

```text
infra/
  aws.env.example      # config template -> copy to infra/aws.env (gitignored)
  cdk/                 # AWS CDK app (Python) — the AWS resources
  ansible/             # playbook + templates — configures the Linux box
  README.md            # this file
```

## Prerequisites

- **AWS CLI v2**, **Node.js 20+** (for `npx aws-cdk`), and **[uv](https://astral.sh/uv)**
  (used for the CDK Python env and Ansible).
- An AWS account. **Export credentials into your shell** before running anything —
  they are read from the environment and never stored in the repo:

  ```sh
  export AWS_ACCESS_KEY_ID=...
  export AWS_SECRET_ACCESS_KEY=...
  export AWS_SESSION_TOKEN=...        # only if using temporary credentials
  ```

- (Optional, for a friendly hostname + real TLS cert) A free
  [DuckDNS](https://www.duckdns.org) account with a subdomain created.

## Configure

```sh
cp infra/aws.env.example infra/aws.env
# edit infra/aws.env: set AWS_REGION and SSH_ALLOWED_IP (your public IP).
# Find your IP:  curl -s https://checkip.amazonaws.com
```

Leave `DUCKDNS_SUBDOMAIN` blank to deploy with just the instance's current public
IP and a self-signed cert. Set it to get a friendly `<subdomain>.duckdns.org` name
and a real Let's Encrypt certificate — see below.

## Deploy

All commands are run from the repo root via `make`:

```sh
make aws-prereqs      # one-time: CDK Python env, Ansible, galaxy collections
make aws-bootstrap    # one-time per account/region
make aws-up           # deploy infra (CDK) + configure the box (Ansible)
```

If you configured `DUCKDNS_SUBDOMAIN`, also run **once**, after the first
`make aws-deploy` (which creates the secret) and before `make aws-provision`:

```sh
make aws-set-duckdns-token TOKEN=<your-token-from-the-duckdns-dashboard>
```

`make aws-up` prints the URL to open at the end. With no DuckDNS subdomain
configured, your browser will warn about the self-signed cert — expected.

### Day-to-day

| Command                       | What it does                                                  |
|--------------------------------|----------------------------------------------------------------|
| `make ssh`                    | SSH in (key pulled from Secrets Manager to `infra/.ssh/`, chmod 600); looks up the current public IP live |
| `make aws-start`               | Start the instance after it auto-stopped (gets a new public IP; DuckDNS updates itself at boot) |
| `make aws-stop`                | Stop it now                                                    |
| `make aws-status`              | Show instance state / type / current public IP                |
| `make aws-provision`           | Re-run Ansible to redeploy the current local code             |
| `make aws-deploy`              | Update the AWS infrastructure only                             |
| `make aws-set-duckdns-token`   | Store/update the DuckDNS token in Secrets Manager              |
| `make aws-destroy`             | Tear everything down                                           |

`make aws-provision` rsyncs your **local working tree** (excluding `node_modules`,
`.git`, `mobile`, `certs`, `infra`, `client/dist`) to `/opt/mecoil`, then
`npm ci` + `npm run build` and restarts the service. Commit first if you want the
deployed code to match a known revision.

## Enabling DuckDNS + Let's Encrypt later

1. Create a free account + subdomain at <https://www.duckdns.org>.
2. Set `DUCKDNS_SUBDOMAIN` in `infra/aws.env`.
3. `make aws-deploy` (creates the DuckDNS token secret) then
   `make aws-set-duckdns-token TOKEN=...` then `make aws-provision`
   (installs the updater and Caddy switches to Let's Encrypt automatically).
   No app code changes.

## Notes

- On-box services: `mecoil.service` (Node server), `caddy.service`, and — when
  DuckDNS is configured — `duckdns-update.service`/`.timer` (runs at boot, before
  Caddy, then every 5 minutes). Inspect with `make ssh` then
  `systemctl status mecoil caddy duckdns-update` / `journalctl -u mecoil -f`.
- The `mecoil-autoshutdown.service` arms `shutdown +240` on every boot. To keep the
  box up longer for a session, `sudo shutdown -c` on the box (or `sudo systemctl stop
  mecoil-autoshutdown`).
- Because there's no Elastic IP, the public IP is different every time the
  instance starts. `make ssh` / `make aws-status` always resolve it live via the
  EC2 API — don't hardcode it anywhere. Caddy's Let's Encrypt certificate is
  cached on the (persistent) EBS volume, so it's only re-issued once and simply
  renewed afterward, regardless of how often the IP changes.
- Session Manager (AWS SSM) is enabled as an SSH fallback if you ever lock yourself
  out of port 22.
