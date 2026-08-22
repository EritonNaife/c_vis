#!/bin/sh
set -eu

BASE_URL="${CVIS_BASE_URL:-http://127.0.0.1:4173}"
TRACE_FILE="${TMPDIR:-/tmp}/cvis-trace.ndjson"

ready=0
for _ in $(seq 1 30); do
  if curl -fsS "$BASE_URL/api/health" >/dev/null 2>&1; then
    ready=1
    break
  fi
  sleep 1
done

if [ "$ready" -ne 1 ]; then
  echo "c_vis server did not become healthy" >&2
  exit 1
fi

workspace_json=$(curl -fsS \
  -H 'content-type: application/json' \
  -X POST "$BASE_URL/api/workspaces" \
  --data-binary '{"files":[{"path":"main.c","content":"#include <stdio.h>\nint main(void) { int value = 1; value += 1; printf(\"value=%d\\n\", value); return 0; }\n"}]}')

workspace_id=$(printf '%s' "$workspace_json" | python3 -c 'import json,sys; print(json.load(sys.stdin)["workspaceId"])')

curl -fsS -N \
  -H 'content-type: application/json' \
  -X POST "$BASE_URL/api/runs" \
  --data-binary "{\"workspaceId\":\"$workspace_id\",\"args\":[]}" \
  > "$TRACE_FILE"

grep -q '"type":"build.completed"' "$TRACE_FILE"
grep -q '"type":"debugger.started"' "$TRACE_FILE"
grep -q '"type":"snapshot"' "$TRACE_FILE"
grep -q '"type":"run.completed"' "$TRACE_FILE"
grep -q 'value=2' "$TRACE_FILE"

echo "c_vis integration smoke test passed"
