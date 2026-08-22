#!/bin/sh
set -eu

BASE_URL="${CVIS_BASE_URL:-http://127.0.0.1:4173}"
TRACE_FILE="${TMPDIR:-/tmp}/cvis-trace.ndjson"
FUNCTION_TRACE_FILE="${TMPDIR:-/tmp}/cvis-function-trace.ndjson"
RUNTIME_TRACE_FILE="${TMPDIR:-/tmp}/cvis-runtime-trace.ndjson"
FRAME_TRACE_FILE="${TMPDIR:-/tmp}/cvis-frame-trace.ndjson"

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
grep -q '"semanticRuntime":true' "$TRACE_FILE"
grep -q '"runtime":{"available":true' "$TRACE_FILE"
grep -q '"type":"snapshot"' "$TRACE_FILE"
grep -q '"type":"run.completed"' "$TRACE_FILE"
grep -q 'value=2' "$TRACE_FILE"

function_workspace_json=$(curl -fsS \
  -H 'content-type: application/json' \
  -X POST "$BASE_URL/api/workspaces" \
  --data-binary '{"files":[{"path":"function.c","content":"#include <stdio.h>\nvoid show(int value) { printf(\"function=%d\\n\", value); }\n"}]}')

function_workspace_id=$(printf '%s' "$function_workspace_json" | python3 -c 'import json,sys; data=json.load(sys.stdin); assert data["analysis"]["mainCandidates"] == []; assert data["analysis"]["functions"][0]["name"] == "show"; print(data["workspaceId"])')

curl -fsS -N \
  -H 'content-type: application/json' \
  -X POST "$BASE_URL/api/runs" \
  --data-binary "{\"workspaceId\":\"$function_workspace_id\",\"entry\":{\"kind\":\"function\",\"file\":\"function.c\",\"name\":\"show\",\"args\":[\"9\"]}}" \
  > "$FUNCTION_TRACE_FILE"

grep -q '"kind":"function"' "$FUNCTION_TRACE_FILE"
grep -q '"name":"show"' "$FUNCTION_TRACE_FILE"
grep -q '"runtime":{"available":true' "$FUNCTION_TRACE_FILE"
grep -q '"type":"snapshot"' "$FUNCTION_TRACE_FILE"
grep -q '"type":"run.completed"' "$FUNCTION_TRACE_FILE"
grep -q 'function=9' "$FUNCTION_TRACE_FILE"

runtime_workspace_json=$(curl -fsS \
  -H 'content-type: application/json' \
  -X POST "$BASE_URL/api/workspaces" \
  --data-binary '{"files":[{"path":"list.c","content":"typedef struct s_node {\n  int value;\n  struct s_node *next;\n} t_node;\n\nint main(void)\n{\n  t_node second = {8, 0};\n  t_node first = {4, &second};\n  t_node *head = &first;\n  head = head->next;\n  return head->value == 8 ? 0 : 1;\n}\n"}]}')

runtime_workspace_id=$(printf '%s' "$runtime_workspace_json" | python3 -c 'import json,sys; print(json.load(sys.stdin)["workspaceId"])')

curl -fsS -N \
  -H 'content-type: application/json' \
  -X POST "$BASE_URL/api/runs" \
  --data-binary "{\"workspaceId\":\"$runtime_workspace_id\",\"args\":[]}" \
  > "$RUNTIME_TRACE_FILE"

grep -q '"runtime":{"available":true' "$RUNTIME_TRACE_FILE"
grep -q '"type":"struct s_node"' "$RUNTIME_TRACE_FILE"
grep -q '"pointeeType":"struct s_node"' "$RUNTIME_TRACE_FILE"
grep -q '"name":"head"' "$RUNTIME_TRACE_FILE"
grep -q '"storage":"stack"' "$RUNTIME_TRACE_FILE"
grep -q '"type":"run.completed"' "$RUNTIME_TRACE_FILE"

frame_workspace_json=$(curl -fsS \
  -H 'content-type: application/json' \
  -X POST "$BASE_URL/api/workspaces" \
  --data-binary '{"files":[{"path":"frames.c","content":"void touch(char *str)\n{\n  str[0] = '\''H'\'';\n}\n\nint main(void)\n{\n  char greeting[] = \"hi\";\n  touch(greeting);\n  return greeting[0] == '\''H'\'' ? 0 : 1;\n}\n"}]}')

frame_workspace_id=$(printf '%s' "$frame_workspace_json" | python3 -c 'import json,sys; print(json.load(sys.stdin)["workspaceId"])')

curl -fsS -N \
  -H 'content-type: application/json' \
  -X POST "$BASE_URL/api/runs" \
  --data-binary "{\"workspaceId\":\"$frame_workspace_id\",\"args\":[]}" \
  > "$FRAME_TRACE_FILE"

grep -q '"function":"touch"' "$FRAME_TRACE_FILE"
grep -q '"function":"main"' "$FRAME_TRACE_FILE"
grep -q '"name":"greeting"' "$FRAME_TRACE_FILE"
grep -q '"ownerFrame":"frame:1"' "$FRAME_TRACE_FILE"
grep -q '"type":"run.completed"' "$FRAME_TRACE_FILE"

echo "c_vis integration smoke test passed"
