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

For C code that defines functions but has no `main()`, c_vis detects callable functions, infers defaults, generates a disposable runner in the runtime workspace, compiles it, and starts GDB directly at the selected source function. Uploaded source is never modified.

## Static visualization

If no `main()` or runnable function body exists, c_vis automatically switches to a browser-only static source model. Static-only source stays local to the browser: there is no backend workspace step, compile, executable, GDB session, or timeline.

The static model visualizes structs and fields, self-referential pointer relationships, enums, simple typedef aliases, object-like `#define` constants, and source locations.

## Runtime backend

Used only when execution is required: workspace validation, entry-point verification, disposable harness generation, debug build, executable detection, native GDB/MI execution, NDJSON trace streaming, timeouts, observability, and structured errors.

## Supported v0.4 inputs

1. `.c` with `main()`.
2. `.c` with function definitions and no `main()`.
3. Simple multi-file C projects.
4. Header/type-only C source for static structural visualization.
5. Makefile application projects.
6. `push_swap` with richer stack visualization.

## Run

```sh
docker compose up --build
```

Open `http://localhost:4173` and provide C source. No sibling repository mount or user-supplied GDB/build configuration is required.

See `docs/v0.4-plan.md` for the detailed architecture, observability, error model, boundaries, and acceptance criteria.
