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

- **Synology NAS / ARM EC2** — `docker-compose.yml` runs the app behind Caddy,
  which handles automatic HTTPS.
- **AWS App Runner** — App Runner terminates TLS at its edge; run the app image
  alone, no Caddy.

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

## AWS App Runner

App Runner provides HTTPS automatically, so the app runs plain HTTP on `3000`.

1. Build for arm64 (App Runner runs on Graviton) and push to ECR:
   ```sh
   docker buildx build --platform linux/arm64 -f infra/docker/Dockerfile \
     -t <acct>.dkr.ecr.<region>.amazonaws.com/mecoil:latest --push .
   ```
2. Create an App Runner service from that ECR image, port `3000`.
3. Health check: HTTP path `/` (the server returns the client `index.html`).

WebSockets work over App Runner's HTTPS endpoint (`wss://…`) with no extra
config.

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
