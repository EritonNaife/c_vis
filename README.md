# c_vis

Visual execution for C programs.

`c_vis` runs the real compiled program under GDB, captures source-level execution states, and renders those states as a visual explanation of what the program is doing.

The first adapter is built around `push_swap`.

## Product model

The debugger is infrastructure. The user experience is:

```text
C source
   ↕
execution history
   ↕
visual program state
```

Primary navigation is deliberately simple:

```text
First  ←  Previous  ←  current state  →  Next  →  Last
```

`Next` follows the next source-level execution state. `Previous` and `First` navigate snapshots already observed. `Last` traces forward until program exit or the configured trace limit.

## Default view

**Program** is the default view. It favors human-readable program state over debugger internals.

For `push_swap`, it renders:

- stack A and stack B as visual stacks
- node values and normalized indexes
- changed/new nodes highlighted between execution states
- current function and local variables
- selected strategy, disorder, and operation count
- the latest emitted push_swap operation
- clickable nodes that reveal address and `next` pointer details

**Memory** is the progressive-detail view. It exposes:

- pointer values
- linked-node addresses
- raw local values
- call stack frames

## Architecture

```text
Svelte 5 + Vite
      ↓ HTTP
Node debugger service
      ↓ GDB/MI2
real compiled C process
      ↓
push_swap adapter (GDB Python)
```

GDB remains the execution engine. The frontend does not expose GDB's step-in/step-over/finish model as the primary UX.

## Run with push_swap

Expected local layout:

```text
parent/
├── c_vis/
└── push_swap/
```

From `c_vis`:

```sh
docker compose up --build
```

Open:

```text
http://localhost:4173
```

The target project is mounted read-only. `c_vis` copies it into a disposable runtime directory and builds the debug binary with `-g -O0`, so your normal `push_swap` build artifacts are not modified.

## Configuration

Environment variables:

- `CVIS_SOURCE_DIR` — mounted source project
- `CVIS_RUNTIME_DIR` — disposable debug workspace
- `CVIS_EXECUTABLE` — compiled target executable
- `CVIS_BUILD_COMMAND` — target debug build command
- `CVIS_ADAPTER` — `push_swap` or `none`
- `CVIS_TRACE_LIMIT` — maximum captured states when tracing to Last (default `1500`)

## Current scope

v0.2 intentionally focuses on understanding execution:

- source line tracking
- First / Previous / Next / Last
- execution history timeline
- program-state visualization
- push_swap stack visualization
- progressive memory inspection

Not yet included:

- arbitrary breakpoints
- watches
- source editing
- generic heap graph reconstruction
- LLDB backend
- cloud execution
