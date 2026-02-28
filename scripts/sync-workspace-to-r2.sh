#!/bin/bash
# Sync client workspace files from git repo to R2 bucket.
#
# Usage:
#   ./scripts/sync-workspace-to-r2.sh <client-slug> <r2-bucket-name>
#
# Example:
#   ./scripts/sync-workspace-to-r2.sh lowe-neuropsych hardshell-prod-client-lowe
#
# Prerequisites:
#   - wrangler CLI authenticated
#   - Client workspace exists at clients/<client-slug>/
#
# This script uploads all .md files from the client workspace to R2
# under the workspace/ prefix, where loadClientWorkspace() expects them.

set -e

CLIENT_SLUG="${1:?Usage: $0 <client-slug> <r2-bucket-name>}"
BUCKET_NAME="${2:?Usage: $0 <client-slug> <r2-bucket-name>}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"
CLIENT_DIR="$REPO_ROOT/clients/$CLIENT_SLUG"

if [ ! -d "$CLIENT_DIR" ]; then
    echo "ERROR: Client workspace not found at $CLIENT_DIR"
    echo "Available clients:"
    ls -1 "$REPO_ROOT/clients/" 2>/dev/null || echo "  (none)"
    exit 1
fi

echo "Syncing workspace for client: $CLIENT_SLUG"
echo "  Source: $CLIENT_DIR"
echo "  Target: r2://$BUCKET_NAME/workspace/"
echo ""

FILES_SYNCED=0
for md_file in "$CLIENT_DIR"/*.md; do
    if [ -f "$md_file" ]; then
        fname=$(basename "$md_file")
        echo "  Uploading: workspace/$fname"
        bunx wrangler r2 object put "$BUCKET_NAME/workspace/$fname" \
            --file="$md_file" \
            --content-type="text/markdown" \
            2>&1 | grep -v "^$" || true
        FILES_SYNCED=$((FILES_SYNCED + 1))
    fi
done

echo ""
echo "✅ Synced $FILES_SYNCED workspace files to r2://$BUCKET_NAME/workspace/"
echo ""
echo "The client container will load these files from R2 at boot time."
echo "No image rebuild is needed for workspace changes."
