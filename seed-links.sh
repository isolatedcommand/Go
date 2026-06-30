#!/usr/bin/env bash
# Seed the SHORT_URLS KV namespace with the initial Isolated Command links.
# Run after creating the namespace and filling in wrangler.toml.
set -euo pipefail
put() { wrangler kv key put --binding SHORT_URLS "$1" "$2"; }

put "/github"    "https://github.com/isolatedcommand"
put "/linkedin"  "https://www.linkedin.com/company/isolatedcommand"
put "/instagram" "https://instagram.com/isolatedcommand"
put "/site"      "https://isolatedcommand.com"
put "/publisher" "https://publisher.devcomm"
put "/volunteer" "https://volunteermanagementportal.isolatedcommand.com"
echo "Seeded SHORT_URLS."
