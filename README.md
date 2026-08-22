# c_vis

Browser-first C Visualizer powered by native GDB.

> Give c_vis C code and it takes care of the rest.

## v0.4 product flow

```text
Open c_vis
   ↓
Drop/select a C file or project folder
   ↓
Browser analyzes files, functions and structures
   ↓
Resolve execution entry automatically
   ├── main() exists → use it
   └── no main() → choose/detect a function + generate disposable runner
   ↓
c_vis creates an isolated build workspace
   ↓
Native compile + GDB execution
   ↓
Execution states stream to the browser
   ↓
First / Previous / Next / Last + timeline replay locally
```

The user does not configure GDB, debug flags, executable paths, Docker mounts, adapter environment variables, or a synthetic `main()` function.

## No `main()` requirement

A normal C program with `main()` runs directly.

For C code that defines functions but has no `main()`, c_vis:

1. detects callable function definitions in the browser and validates them on the backend;
2. selects the only function automatically, or exposes a compact function selector when several are available;
3. pre-fills function arguments with useful C-expression defaults;
4. generates `__cvis_harness.c` only inside the disposable runtime workspace;
5. compiles the generated runner with the uploaded source;
6. starts GDB directly at the selected source function, so the generated runner is not part of the learning surface.

Uploaded source is never modified.

## Browser-owned work

- file/folder ingestion and source storage
- project tree and source browsing
- project analysis in a Web Worker
- `main()` / function / Makefile / profile detection
- semantic entry-function selection
- function-argument defaults
- execution trace history
- timeline cursor and replay
- stdout/operation reconstruction from streamed deltas
- Program / Memory rendering
- client telemetry and diagnostics

## Execution backend

- validates and materializes uploaded projects
- verifies the selected/automatic entry point
- generates a disposable function harness when required
- infers/verifies supported build plans
- builds with debug symbols
- detects the produced executable
- runs the native binary under GDB/MI
- streams execution states as NDJSON
- enforces debugger timeout and trace limits
- emits structured logs, metrics and errors

`push_swap` remains an enhanced profile. Its GDB script and trace-skip policy are outside the generic GDB client.

## Supported v0.4 project shapes

1. Single `.c` file with `main()`.
2. Single `.c` file with one or more function definitions and no `main()`.
3. Simple multi-file C project, with or without `main()`.
4. Makefile application project.
5. `push_swap` with its richer stack visualization.

For mainless projects, c_vis uses its generated-harness debug compiler path. Projects that require unavailable external libraries or custom build-time dependencies can still produce a structured build failure; c_vis does not hand debugger/build configuration back to the user.

Declarations/types without any function body have no runtime execution to trace. Static structure visualization for those inputs is a separate capability from execution visualization.

Binary project assets/dependencies are not uploaded in v0.4. Arbitrary package installation, full CMake/Meson/autotools support, hosted execution and generic heap reconstruction remain outside this version.

## Run

```sh
docker compose up --build
```

Open:

```text
http://localhost:4173
```

No sibling `push_swap` directory or `TARGET_PROJECT` mount is required. Uploaded workspaces live only inside the disposable c_vis container filesystem and disappear with the container.

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

The run request includes semantic entry intent when c_vis is visualizing a function rather than a program entry point. Snapshots do not repeat cumulative stdout/operation arrays. Each event sends only new stdout and operation data; the browser reconstructs cumulative state for replay.

## Observability

Server:

- JSON logs with request/run/workspace correlation IDs
- selected entry kind/function without source contents
- request/workspace/build/run/trace counters
- stage durations
- process memory/uptime
- `GET /api/health`
- `GET /api/diagnostics`

Browser:

- import/analyze/upload/run timings
- selected entry kind/function
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

Entry-point errors include `ENTRYPOINT_REQUIRED`, `ENTRYPOINT_NOT_FOUND`, and `NO_EXECUTABLE_CODE`.

## Configuration

- `CVIS_WORKSPACE_ROOT` — disposable uploaded-project root (default `/workspace/projects`)
- `CVIS_TRACE_LIMIT` — maximum streamed execution states (default `5000`)
- `CVIS_GDB_STOP_TIMEOUT_MS` — maximum wait for one GDB execution stop (default `30000`)
- `CVIS_MAX_UPLOAD_BYTES` — maximum JSON upload request size

The detailed implementation plan is in `docs/v0.4-plan.md`.
