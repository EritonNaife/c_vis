# c_vis

Browser-first C Visualizer powered by native GDB when execution exists, and browser-side structural analysis when it does not.

> Give c_vis C code and it takes care of the rest.

## v0.4 product flow

```text
Open c_vis
   ↓
Drop/select a C file or project folder
   ↓
Browser analyzes files, functions and declarations
   ↓
Can the code execute?
   ├── main() exists → run normally
   ├── function definitions exist → generate disposable runner
   └── no executable behavior → visualize source structure in browser
```

The user does not configure GDB, debug flags, executable paths, Docker mounts, adapter environment variables, or a synthetic `main()` function.

## Runtime visualization

A normal C program with `main()` runs directly.

For C code that defines functions but has no `main()`, c_vis:

1. detects callable function definitions in the browser and validates them on the backend;
2. selects the only function automatically, or preselects one and exposes a compact function selector when several are available;
3. pre-fills function arguments with useful C-expression defaults;
4. generates `__cvis_harness.c` only inside the disposable runtime workspace;
5. compiles the generated runner with the uploaded source;
6. starts GDB directly at the selected source function, so the generated runner is not part of the learning surface.

Uploaded source is never modified. c_vis asks only for semantic intent it cannot infer safely, such as which function to inspect or which input values matter.

## Static visualization

C source does not need executable behavior to be useful to c_vis.

If no `main()` or runnable function body exists, c_vis automatically switches to a browser-only static source model. No workspace upload, compile, executable, GDB session, or timeline is required.

The current static model visualizes:

- structs and fields
- self-referential pointer relationships / linked-structure candidates
- enums and members
- simple typedef aliases
- object-like `#define` constants
- source locations for each detected declaration

The source/code pane remains available, and clicking a visual declaration navigates back to its source file.

## Browser-owned work

- file/folder ingestion and source storage
- project tree and source browsing
- project analysis in a Web Worker
- `main()` / function / Makefile / profile detection
- struct / enum / typedef / constant extraction
- automatic runtime-vs-static mode selection
- semantic entry-function selection
- function-argument defaults
- static source visualization
- execution trace history
- timeline cursor and replay
- stdout/operation reconstruction from streamed deltas
- Program / Memory rendering
- client telemetry and diagnostics

## Execution backend

Used only when runtime execution is required:

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

## Supported v0.4 inputs

1. Single `.c` file with `main()`.
2. Single `.c` file with function definitions and no `main()`.
3. Simple multi-file C project, with or without `main()`.
4. Header/type-only C source for static structural visualization.
5. Makefile application project.
6. `push_swap` with its richer stack visualization.

Projects that require unavailable external libraries or custom build-time dependencies can still produce a structured build failure. c_vis does not hand debugger/build configuration back to the user.

Binary project assets/dependencies are not uploaded in v0.4. Arbitrary package installation, full CMake/Meson/autotools support, hosted execution and generic heap reconstruction remain outside this version.

## Run

```sh
docker compose up --build
```

Open:

```text
http://localhost:4173
```

No sibling `push_swap` directory or `TARGET_PROJECT` mount is required. Runtime workspaces live only inside the disposable c_vis container filesystem and disappear with the container. Static-only visualization stays in the browser.

## Execution protocol

Runtime runs use `POST /api/runs` and an NDJSON stream:

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

Snapshots send only new stdout/operation data; the browser reconstructs cumulative state for replay.

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
- runtime/static mode selection
- selected entry kind/function
- static declaration counts
- bounded event/error buffer
- global error and unhandled-rejection capture
- trace counters
- diagnostics drawer
- error forwarding without source contents

## Error contract

Operational runtime errors expose:

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

Entry-point errors include `ENTRYPOINT_REQUIRED` and `ENTRYPOINT_NOT_FOUND`. Code with no executable entry is not an error; it becomes a static visualization.

## Configuration

- `CVIS_WORKSPACE_ROOT` — disposable runtime-project root (default `/workspace/projects`)
- `CVIS_TRACE_LIMIT` — maximum streamed execution states (default `5000`)
- `CVIS_GDB_STOP_TIMEOUT_MS` — maximum wait for one GDB execution stop (default `30000`)
- `CVIS_MAX_UPLOAD_BYTES` — maximum JSON upload request size

The detailed implementation plan is in `docs/v0.4-plan.md`.
