# c_vis

Visual execution for C programs.

`c_vis` runs the real compiled program under GDB, captures execution states, and renders those states as a visual explanation of what the C program is doing.

The first domain adapter is built around `push_swap`.

## Product model

The debugger is infrastructure. The primary user experience is:

```text
C source
   ↕
execution history
   ↕
visual program state
```

Primary navigation stays deliberately simple:

```text
First  ←  Previous  ←  current state  →  Next  →  Last
```

`Next` follows the next source-level execution state. `Previous` and `First` navigate states already observed. `Last` traces forward until program exit or the configured trace limit.

Long traces are resumable. While `Last` is running, c_vis reports observed-state progress and exposes Cancel. A timeout, cancellation, or trace-limit stop keeps the partial history usable; use `Resume` or `Next` rather than restarting the whole session.

## v0.3 interface

v0.3 combines the useful workspace density of v0.1 with the visual-execution model of v0.2:

```text
┌───────────────────────────────────────────────────────────────┐
│ c_vis      arguments / rebuild       status / power controls │
├──────────────┬───────────────────────┬────────────────────────┤
│ Project      │ Executing C source    │ Program / Memory       │
│ explorer     │                       │ visualization          │
├──────────────┴───────────────────────┴────────────────────────┤
│ First   Previous       execution timeline       Next   Last   │
└───────────────────────────────────────────────────────────────┘
```

### Program view

The default view favors human-readable program state over debugger internals.

For `push_swap`, it renders:

- stack A and stack B as interactive visual stacks
- node values and normalized indexes
- changed/new nodes highlighted between execution states
- current function and local variables
- selected strategy, disorder, and operation count
- clickable nodes that reveal address and `next` pointer details
- a preserved final stack/metric summary after process exit

The adapter does not interpret `t_context` metrics until the context satisfies its initialized-state invariants, so early stack frames show those values as unavailable rather than presenting uninitialized memory as real data.

### Memory view

Progressive detail for when the C representation matters:

- pointer values
- linked-node addresses
- raw local values
- call stack frames
- preserved final linked-node state after process exit

### Secondary debugger controls

The header includes Restart, Step in, Step over, Finish, and Continue as optional power controls. They are intentionally secondary to the execution timeline and can be hidden from Settings.

`Rebuild & start` recompiles the target. `Restart` restarts the existing debug build without recompiling.

### Project and output tools

- Project explorer keeps the complete source tree available without making it the main interaction model.
- Source files can be browsed independently; stepping returns focus to the executing source file and keeps the active line visible.
- The terminal button exposes program stdout and the captured push_swap operation stream, including partial output during a paused trace.

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

The target project is mounted read-only. `c_vis` copies it into a disposable runtime directory and builds the debug binary with `-g -O0`, so normal `push_swap` build artifacts are not modified.

## Configuration

- `CVIS_SOURCE_DIR` — mounted source project
- `CVIS_RUNTIME_DIR` — disposable debug workspace
- `CVIS_EXECUTABLE` — compiled target executable
- `CVIS_BUILD_COMMAND` — target debug build command
- `CVIS_ADAPTER` — `push_swap` or `none`
- `CVIS_TRACE_LIMIT` — maximum captured states when tracing to Last (default `1500`)
- `CVIS_GDB_STOP_TIMEOUT_MS` — maximum wait for a single GDB execution command before c_vis interrupts and preserves a resumable partial trace (default `30000`)

## Current boundary

v0.3 focuses on understanding real execution. It does not yet include arbitrary breakpoint management, watch expressions, source editing, generic heap graph reconstruction, an LLDB backend, or cloud execution.
