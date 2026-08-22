# c_vis

Browser-first C Visualizer powered by native GDB.

## v0.4 product flow

```text
Open c_vis
   ↓
Drop/select a C file or project folder
   ↓
Browser analyzes the project
   ↓
c_vis creates an isolated build workspace
   ↓
Native compile + GDB execution
   ↓
Execution states stream to the browser
   ↓
First / Previous / Next / Last + timeline replay locally
```

The user does not configure GDB, debug flags, executable paths, Docker mounts, or adapter environment variables.

## Browser-owned work

- file/folder ingestion and source storage
- project tree and source browsing
- project analysis in a Web Worker
- `main()` / Makefile / profile detection hints
- execution trace history
- timeline cursor and replay
- stdout/operation reconstruction from streamed deltas
- Program / Memory rendering
- client telemetry and diagnostics

## Execution backend

- validates and materializes uploaded projects
- infers/verifies supported build plans
- builds with debug symbols
- detects the produced executable
- runs the native binary under GDB/MI
- streams execution states as NDJSON
- enforces debugger timeout and trace limits
- emits structured logs, metrics and errors

`push_swap` remains an enhanced profile. Its GDB script and trace-skip policy are outside the generic GDB client.

## Supported v0.4 project shapes

1. Single `.c` file.
2. Simple multi-file C project.
3. Makefile project.
4. `push_swap` with its richer stack visualization.

Binary project assets/dependencies are not uploaded in v0.4. Arbitrary package installation, full CMake/Meson/autotools support, hosted execution and generic heap reconstruction remain outside this version.

## Run

```sh
docker compose up --build
```

Open:

```text
http://localhost:4173
```

No sibling `push_swap` directory or `TARGET_PROJECT` mount is required. Uploaded workspaces live in disposable container tmpfs.

## Execution protocol

`POST /api/runs` returns an NDJSON stream:

```text
run.started
build.started
build.completed
debugger.started
snapshot
snapshot
...
run.completed | trace.limit | run.cancelled | error
```

Snapshots do not repeat cumulative stdout/operation arrays. Each event sends only new stdout and operation data; the browser reconstructs cumulative state for replay.

## Observability

Server:

- JSON logs with request/run/workspace correlation IDs
- request/workspace/build/run/trace counters
- stage durations
- process memory/uptime
- `GET /api/health`
- `GET /api/diagnostics`

Browser:

- import/analyze/upload/run timings
- bounded event/error buffer
- global error and unhandled-rejection capture
- trace counters
- diagnostics drawer
- error forwarding without source contents

## Error contract

Operational errors expose:

```text
code
stage
message
retryable
requestId
runId
details
```

Expected stages: `ingest`, `workspace`, `build`, `debugger`, `trace`, `client`, `server`.

## Configuration

- `CVIS_WORKSPACE_ROOT` — disposable uploaded-project root (default `/workspace/projects`)
- `CVIS_TRACE_LIMIT` — maximum streamed execution states (default `5000`)
- `CVIS_GDB_STOP_TIMEOUT_MS` — maximum wait for one GDB execution stop (default `30000`)
- `CVIS_MAX_UPLOAD_BYTES` — maximum JSON upload request size

The detailed implementation plan is in `docs/v0.4-plan.md`.
