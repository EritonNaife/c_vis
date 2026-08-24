# c_vis

Browser-first C Visualizer.

> Give c_vis C code and it takes care of the rest.

Runtime-capable C is built and executed under native GDB. Mainless functions receive a disposable generated runner. Non-executable/type-only C is visualized statically in the browser without upload, compile, GDB, or timeline.

Mainless functions that accept a conventional file-descriptor parameter such as `int fd` can bind that parameter to a text file from the uploaded project. c_vis opens the selected fixture read-only in the generated runner and starts the trace inside the user's function. This makes projects such as `get_next_line(int fd)` visualizable without adding a permanent test `main()` to the source.

## Run

### Docker

```bash
docker compose up --build
```

Open `http://localhost:4173`.

### Native Linux

Native mode runs the same c_vis backend directly on a Linux host instead of inside Docker.

Requirements:

- Node.js 22+
- npm
- `cc`/GCC
- `make`
- GDB
- Python 3

Then run:

```bash
npm run linux
```

The launcher:

- verifies the native toolchain before startup
- installs JavaScript dependencies when `node_modules` is missing
- builds the browser application
- starts c_vis on `127.0.0.1:4173`
- creates a private temporary execution workspace
- removes that workspace when c_vis exits

Check prerequisites without starting c_vis:

```bash
npm run linux:check
```

Native mode executes uploaded C binaries as your current Linux user. It therefore binds to loopback by default. Docker remains the preferred option when process isolation is required.

For intentional LAN/remote use:

```bash
CVIS_HOST=0.0.0.0 CVIS_ALLOW_REMOTE_NATIVE=1 npm run linux
```

You can provide a persistent workspace explicitly with `CVIS_WORKSPACE_ROOT=/path/to/workspaces`.

See `docs/v0.4-plan.md` for architecture, supported inputs, observability, error handling, and acceptance criteria.
