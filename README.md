# c_vis

Browser-first C Visualizer.

> Give c_vis C code and it takes care of the rest.

Runtime-capable C is built and executed under native GDB. Mainless functions receive a disposable generated runner. Non-executable/type-only C is visualized statically in the browser without upload, compile, GDB, or timeline.

See `docs/v0.4-plan.md` for architecture, supported inputs, observability, error handling, and acceptance criteria.
