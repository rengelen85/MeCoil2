# Docker deployment

All Docker assets live in this directory (`infra/docker/`): the `Dockerfile`,
`docker-compose.yml`, `Caddyfile`, and `.env.example`. The **build context is
still the repo root** — the Dockerfile `COPY`s `client/`, `server/`, and
`shared/` — so compose sets `context: ../..` and the Makefile builds with
`-f infra/docker/Dockerfile .`.

The image is a single multi-arch build (amd64 + arm64) that serves both the
Svelte client and the WebSocket game server from one Node process on port
`3000`. The client talks to `/ws` on the same origin, so no build-time server
URL is needed.

TLS is always terminated **in front of** the app, because phones require HTTPS
for Web Bluetooth and Geolocation:

- **Synology NAS / ARM EC2 (Graviton)** — `docker-compose.yml` runs the app
  behind Caddy, which handles automatic HTTPS. This is the recommended cloud
  deployment; see [EC2 Graviton](#aws-ec2-graviton) below.
- **Managed container PaaS** — put a WebSocket-capable load balancer (an ALB) in
  front; see the [note on App Runner / ECS Express Mode](#a-note-on-app-runner--ecs-express-mode).

## Self-hosted (Synology NAS, ARM EC2) — docker compose

```sh
cp infra/docker/.env.example infra/docker/.env   # set MECOIL_DOMAIN
make docker-up                                    # from the repo root
```

`make docker-up` runs compose with `-f infra/docker/docker-compose.yml` and the
sibling `.env`. To drive compose by hand, run it from this directory so the
compose file and `.env` are picked up automatically:

```sh
cd infra/docker && docker compose up -d --build
```

Makefile targets (run from the repo root): `make docker-build`,
`make docker-test`, `make docker-up`, `make docker-down`.

The Dockerfile, Caddyfile, and `docker-compose.yml` are linted as part of the
central `make lint` and auto-formatted by `make fmt` (host tools — no container).
Install those tools once with `make config-tools` (hadolint + caddy); without them
`make lint` prints a skip notice rather than failing.

- Point your domain's DNS at the host and open ports `80` + `443`. Caddy fetches
  a Let's Encrypt certificate for `MECOIL_DOMAIN` on first start.
- With the default `MECOIL_DOMAIN=localhost` Caddy serves HTTPS via its own
  internal CA — good for a first smoke test at `https://localhost` (expect a
  browser warning for the self-signed cert).
- Logs: `make docker-down` to stop; `cd infra/docker && docker compose logs -f`
  to follow logs.

On Synology, point **Container Manager → Project** at this `infra/docker/` folder
(it holds the `docker-compose.yml`), or use the NAS's built-in reverse proxy
instead of Caddy (in that case run only the `app` service and publish port
`3000`).

## AWS EC2 Graviton

The recommended cloud deployment: a single ARM (Graviton) EC2 instance running
the `docker compose` stack above. Caddy terminates TLS and upgrades the `/ws`
WebSocket, so it needs no ALB — which also makes it the cheapest option
(≈ **$10–18/mo**: `t4g.micro`/`t4g.small` on-demand + EBS + the ~$3.60/mo AWS now
charges for a public IPv4 address, Elastic or not).

**Provision (once):**

1. Launch **Amazon Linux 2023, arm64** — `t4g.small` (2 GB, comfortable) or
   `t4g.micro` (1 GB, light use); 8–10 GB gp3 storage.
2. Security group: inbound `80` + `443` from anywhere, `22` from your IP only.
3. Use the **auto-assigned (dynamic) public IP** — no Elastic IP. The public IP
   changes on stop/start; a DuckDNS updater keeps the name in sync (next step).
4. A real DNS name is required for a *trusted* (Let's Encrypt) cert — phones
   reject Caddy's self-signed CA for BLE/GPS. Create the free DuckDNS name
   **`mecoil.duckdns.org`** and grab your token; the bootstrap installs a
   systemd timer that re-points it at the current public IP at boot + every
   5 min.

**Deploy:** the fastest path is to paste [`ec2-user-data.sh`](ec2-user-data.sh)
into the instance's **User data** field at launch (set `DUCKDNS_TOKEN` at the
top first) — it installs Docker, wires up the DuckDNS updater, clones the repo,
and starts the stack on first boot. To do it by hand instead, or for the
update/rollback flow, see [BOOTSTRAP.md](BOOTSTRAP.md).

### A note on App Runner / ECS Express Mode

> **Not App Runner.** It never supported WebSockets (this app is a WebSocket
> game server), and AWS moved App Runner to maintenance on 2026-04-30 — no new
> services. Its successor, **ECS Express Mode**, *does* work (it fronts Fargate
> with a WebSocket-capable ALB), but a single service still pays for a full ALB,
> so it lands around **$27/mo** and never scales to zero — roughly double the
> Graviton box for no functional gain here. If you ever run several services and
> want a managed PaaS, Express Mode's shared ALB makes sense; otherwise prefer
> the EC2 Graviton route above.

## Plain Docker (bring your own TLS)

```sh
docker build -f infra/docker/Dockerfile -t mecoil .
docker run -d -p 3000:3000 -e NO_HTTPS=1 mecoil
```

Put any TLS terminator (existing ingress, cloud load balancer, the Synology
reverse proxy) in front. Serving the app over plain HTTP works for a laptop, but
phones won't get BLE/GPS without HTTPS.

## Multi-arch notes

- `node:22-alpine` is multi-arch, so the same `Dockerfile` builds natively on a
  Synology (arm64/x86), an ARM EC2 host, or an Apple-silicon laptop.
- To build one host and run on another architecture, use
  `docker buildx build -f infra/docker/Dockerfile --platform linux/arm64,linux/amd64 …`.

## Environment variables

| Variable           | Default     | Purpose                                              |
| ------------------ | ----------- | ---------------------------------------------------- |
| `PORT`             | `3000`      | Port the Node server listens on.                     |
| `NO_HTTPS`         | (unset)     | `1` forces plain HTTP even if certs are present.     |
| `MECOIL_DOMAIN`    | `localhost` | (compose/Caddy) hostname to serve + request a cert.  |

To receive Let's Encrypt expiry/renewal notices, add an `email` line to a global
block in [Caddyfile](Caddyfile) (see the comment there).
