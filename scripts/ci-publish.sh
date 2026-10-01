#!/usr/bin/env bash
# Run the Changesets publish and, when it fails, leave the registry output on
# the commit. Actions logs for this repo are not readable without a sign-in.
set -uo pipefail

log="$(mktemp)"
trap 'rm -f "$log"' EXIT

set +e
set -o pipefail
npm run release 2>&1 | tee "$log"
code=$?
set +o pipefail
set -e

if [[ "$code" -ne 0 && -n "${GITHUB_TOKEN:-}" && -n "${GITHUB_REPOSITORY:-}" && -n "${GITHUB_SHA:-}" ]]; then
  body="$(python3 - "$log" <<'PY'
import json
import re
import sys

text = open(sys.argv[1], encoding="utf-8", errors="replace").read()
text = re.sub(r"(?i)(_authToken=)\S+", r"\1[redacted]", text)
text = re.sub(r"npm_[A-Za-z0-9]+", "npm_[redacted]", text)
text = re.sub(r"(?i)(bearer\s+)\S+", r"\1[redacted]", text)
tail = text[-50000:]
print(
    json.dumps(
        {
            "body": "The Release workflow could not publish to npm.\n\n```\n"
            + tail
            + "\n```"
        }
    )
)
PY
)"
  curl -fsS -X POST \
    -H "Authorization: Bearer ${GITHUB_TOKEN}" \
    -H "Accept: application/vnd.github+json" \
    -H "Content-Type: application/json" \
    -H "X-GitHub-Api-Version: 2022-11-28" \
    -d "$body" \
    "https://api.github.com/repos/${GITHUB_REPOSITORY}/commits/${GITHUB_SHA}/comments" \
    >/dev/null || true
fi

exit "$code"
