.PHONY: install dev dev-server dev-client build start gen-certs phone-test lint fmt

# First-time setup: install all dependencies
install:
	npm install
	npm install --prefix client
	mkdir -p certs

# Run server + Vite client together (requires concurrently)
dev:
	npm run dev

# Server only (auto-detects HTTPS if certs/ exists).
# --watch-path=certs means the server auto-restarts when gen-certs creates cert files.
dev-server:
	node --watch --watch-path=certs server/index.js

# Vite client only
dev-client:
	npm run dev --prefix client

# Build the Svelte client for production
build:
	npm run build --prefix client

# Run production server (requires certs — see gen-certs)
start:
	node server/index.js

# Generate locally-trusted HTTPS certs via mkcert
# Install mkcert first: winget install mkcert  (Windows)
#                       brew install mkcert     (macOS)
#                       apt install mkcert      (Linux)
gen-certs:
	mkdir -p certs
	mkcert -install
	mkcert -cert-file certs/cert.pem -key-file certs/key.pem localhost 127.0.0.1 mecoil.local

# Lint all JS/TS/Svelte sources (Biome)
lint:
	uv run --with rumdl \
	rumdl check --disable MD013
	npx biome format .
	npx biome check .

# Auto-format all JS/TS/Svelte sources (Biome primary).
# Svelte fallback: npx prettier --write "client/src/**/*.svelte"
fmt:
	uv run --with rumdl \
	rumdl check --fix --disable MD013
	npx biome format --write .
	npx biome check --write .

# Build + start HTTPS server for real-phone testing (Web Bluetooth requires HTTPS).
# After running, open the Network URL shown in the terminal on your phone.
# Phones need the mkcert root CA installed once — see mkcert docs.
phone-test: gen-certs build
	node server/index.js
