# c_vis

Local C execution visualizer powered by GDB.

The first product slice is built for `push_swap`: step through the real C program while seeing the active source line, locals, call stack, stack A/B, strategy state, and emitted operations.

## Run with push_swap

Expected layout:

```text
parent/
  push_swap/
  c_vis/
```

From `c_vis`:

```sh
docker compose up --build
```

Open `http://localhost:4173`.

If the repos are not siblings:

```sh
TARGET_PROJECT=/absolute/path/to/push_swap docker compose up --build
```

The target is copied into an isolated runtime directory and built with debug symbols:

```sh
make re CFLAGS="-Wall -Wextra -Werror -g -O0"
```

Your mounted `push_swap` source remains read-only.

## v0.1

- Real execution under GDB; no source-code simulation.
- Step in, step over, finish, continue, restart.
- Current file/line highlighting.
- Locals and call stack.
- Target stdout and push_swap operation history.
- `push_swap` adapter reads `t_context` and linked-list `t_node` state directly from debugger memory.
- Stack A/B, strategy, disorder, and operation counters.

Keyboard: `F7` step in, `F8` step over.

## Architecture

```text
Browser
  |
  | HTTP
  v
Node local server
  |
  | GDB/MI2
  v
GDB ---> debug build of target C project
  |
  +-- frame / locals / call stack
  +-- target stdout
  +-- push_swap adapter ---> t_context / stack A / stack B
```

## Generic C mode

The debugger core is not tied to push_swap. Disable the adapter and point it at another C project:

```sh
TARGET_PROJECT=/path/to/project \
CVIS_EXECUTABLE=./my_program \
CVIS_BUILD_COMMAND='make CFLAGS="-g -O0"' \
CVIS_ADAPTER=none \
docker compose up --build
```

Generic mode provides source stepping, locals, frames, and stdout. Domain-specific memory visualization is adapter-driven.

## Tests

```sh
npm test
```

## Deliberately outside v0.1

- arbitrary heap/pointer graph visualization
- breakpoint UI
- watch-expression UI
- in-browser editing
- LLDB backend
- cloud execution
