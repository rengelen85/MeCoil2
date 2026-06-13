.PHONY: install dev dev-server dev-client build start test gen-certs phone-test lint fmt

# Install all dependencies and generate certs
init: install-prereqs install gen-certs
	sudo chown -R $$USER:$$USER .

# Install Node.js (Ubuntu/Debian) & mkcert
install-prereqs:
	sudo apt update
	sudo apt install nodejs
	sudo apt install npm
	sudo apt install openssl libssl-dev -y

# Check installed Node.js version
check-prereqs:
	@node -v
	@npm -v
	@openssl version -a

# First-time setup: install all dependencies
install:
	npm install
	npm install --prefix client

uninstall:
	npm uninstall
	npm uninstall --prefix client
	sudo rm -rf client/node_modules node_modules package-lock.json

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

# Run unit tests (Node's built-in test runner; no extra deps)
test:
	npm test

# Generate self-signed HTTPS certs via openssl
gen-certs:
	mkdir -p certs
	openssl req -x509 -nodes -days 365 \
        -newkey rsa:2048 \
        -keyout certs/key.pem \
        -out certs/cert.pem \
        -subj "/CN=localhost" \
        -addext "subjectAltName=DNS:localhost,IP:127.0.0.1,DNS:mecoil.local"

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
