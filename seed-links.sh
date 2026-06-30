#!/usr/bin/env bash
# Seed the SHORT_URLS KV namespace with the initial Isolated Command links.
# Run after creating the namespace and filling in wrangler.toml.
set -euo pipefail
# --remote writes to the real Cloudflare KV (not the local dev store);
# --preview false targets the production namespace (not the preview one).
put() { wrangler kv key put --binding SHORT_URLS --remote --preview false "$1" "$2"; }

put "/github"    "https://github.com/isolatedcommand"
put "/linkedin"  "https://www.linkedin.com/company/isolatedcommand"
put "/instagram" "https://instagram.com/isolatedcommand"
put "/site"      "https://isolatedcommand.com"
put "/publisher" "https://publisher.devcomm"
put "/volunteer" "https://volunteermanagementportal.isolatedcommand.com"
echo "Seeded SHORT_URLS."
