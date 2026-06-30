#!/usr/bin/env bash
# Cloudflare build: install Go + Hugo, pull latest Publisher theme, build the
# front end into frontend/public (which wrangler deploys as static assets).
set -euo pipefail

GO_VERSION=1.23.4
HUGO_VERSION=0.163.3

tmp=$(mktemp -d); pushd "$tmp" >/dev/null
mkdir -p "$HOME/.local"
echo "Installing Go ${GO_VERSION}..."
curl -sLJO "https://go.dev/dl/go${GO_VERSION}.linux-amd64.tar.gz"
tar -C "$HOME/.local" -xf "go${GO_VERSION}.linux-amd64.tar.gz"
export PATH="$HOME/.local/go/bin:$PATH"
echo "Installing Hugo ${HUGO_VERSION} (extended)..."
curl -sLJO "https://github.com/gohugoio/hugo/releases/download/v${HUGO_VERSION}/hugo_extended_${HUGO_VERSION}_linux-amd64.tar.gz"
mkdir -p "$HOME/.local/hugo"
tar -C "$HOME/.local/hugo" -xf "hugo_extended_${HUGO_VERSION}_linux-amd64.tar.gz"
export PATH="$HOME/.local/hugo:$PATH"
popd >/dev/null

go version && hugo version

cd frontend
echo "Pulling latest Publisher theme..."
hugo mod get -u github.com/isolatedcommand/Publisher@latest
hugo mod tidy
echo "Building front end..."
hugo --gc --minify
