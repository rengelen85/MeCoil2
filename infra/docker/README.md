# Docker deployment

The `Dockerfile` at the repo root builds a single multi-arch image (amd64 +
arm64) that serves both the Svelte client and the WebSocket game server from one
Node process on port `3000`. The client talks to `/ws` on the same origin, so no
build-time server URL is needed.

TLS is always terminated **in front of** the app, because phones require HTTPS
for Web Bluetooth and Geolocation:

- **Synology NAS / ARM EC2** — `docker-compose.yml` runs the app behind Caddy,
  which handles automatic HTTPS.
- **AWS App Runner** — App Runner terminates TLS at its edge; run the app image
  alone, no Caddy.

## Self-hosted (Synology NAS, ARM EC2) — docker compose

```sh
cp infra/docker/.env.example .env      # set MECOIL_DOMAIN + MECOIL_TLS_EMAIL
docker compose up -d --build
```

- Point your domain's DNS at the host and open ports `80` + `443`. Caddy fetches
  a Let's Encrypt certificate for `MECOIL_DOMAIN` on first start.
- With the default `MECOIL_DOMAIN=localhost` Caddy serves HTTPS via its own
  internal CA — good for a first smoke test at `https://localhost` (expect a
  browser warning for the self-signed cert).
- Logs: `docker compose logs -f`. Stop: `docker compose down`.

On Synology you can run the same file from **Container Manager → Project**, or use
the NAS's built-in reverse proxy instead of Caddy (in that case run only the
`app` service and publish port `3000`).

## AWS App Runner

App Runner provides HTTPS automatically, so the app runs plain HTTP on `3000`.

1. Build for arm64 (App Runner runs on Graviton) and push to ECR:
   ```sh
   docker buildx build --platform linux/arm64 \
     -t <acct>.dkr.ecr.<region>.amazonaws.com/mecoil:latest --push .
   ```
2. Create an App Runner service from that ECR image, port `3000`.
3. Health check: HTTP path `/` (the server returns the client `index.html`).

WebSockets work over App Runner's HTTPS endpoint (`wss://…`) with no extra
config.

## Plain Docker (bring your own TLS)

```sh
docker build -t mecoil .
docker run -d -p 3000:3000 -e NO_HTTPS=1 mecoil
```

Put any TLS terminator (existing ingress, cloud load balancer, the Synology
reverse proxy) in front. Serving the app over plain HTTP works for a laptop, but
phones won't get BLE/GPS without HTTPS.

## Multi-arch notes

- `node:22-alpine` is multi-arch, so the same `Dockerfile` builds natively on a
  Synology (arm64/x86), an ARM EC2 host, or an Apple-silicon laptop.
- To build one host and run on another architecture, use
  `docker buildx build --platform linux/arm64,linux/amd64 …`.

## Environment variables

| Variable           | Default     | Purpose                                              |
| ------------------ | ----------- | ---------------------------------------------------- |
| `PORT`             | `3000`      | Port the Node server listens on.                     |
| `NO_HTTPS`         | (unset)     | `1` forces plain HTTP even if certs are present.     |
| `MECOIL_DOMAIN`    | `localhost` | (compose/Caddy) hostname to serve + request a cert.  |
| `MECOIL_TLS_EMAIL` | (empty)     | (compose/Caddy) ACME contact for Let's Encrypt.      |
