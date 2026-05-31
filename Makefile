.PHONY: install dev dev-server dev-client build start gen-certs

# First-time setup: install all dependencies
install:
	npm install
	npm install --prefix client

# Run server + Vite client together (requires concurrently)
dev:
	npm run dev

# Server only (no HTTPS, dev mode)
dev-server:
	NO_HTTPS=1 node --watch server/index.js

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
	mkcert -install
	mkcert -cert-file certs/cert.pem -key-file certs/key.pem localhost 127.0.0.1 mecoil.local
