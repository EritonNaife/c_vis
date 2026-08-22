import gdb
import json
import math


_OP_NAMES = ["sa", "sb", "ss", "pa", "pb", "ra", "rb", "rr", "rra", "rrb", "rrr"]
_last_state = None


def _int(value):
    return int(value)


def _deref_context(value):
    value_type = value.type.strip_typedefs()
    if value_type.code == gdb.TYPE_CODE_PTR:
        if _int(value) == 0:
            return None
        return value.dereference()
    return value


def _stack(node):
    values = []
    seen = set()
    for _ in range(1000):
        address = _int(node)
        if address == 0 or address in seen:
            break
        seen.add(address)
        current = node.dereference()
        next_node = current["next"]
        values.append({
            "value": _int(current["value"]),
            "index": _int(current["index"]),
            "address": hex(address),
            "next": hex(_int(next_node)),
        })
        node = next_node
    return values


def _find_context():
    frame = gdb.newest_frame()
    while frame is not None:
        try:
            value = frame.read_var("ctx")
            return _deref_context(value)
        except (gdb.error, ValueError):
            frame = frame.older()
    return None


def _looks_initialized(ctx):
    try:
        strategy = _int(ctx["strategy"])
        disorder = float(ctx["disorder"])
        bench = _int(ctx["bench"])
        quiet = _int(ctx["quiet"])
        ops = ctx["ops"]
        operation_counts = [_int(ops[name]) for name in _OP_NAMES]
        total = _int(ops["total"])
    except Exception:
        return False

    if strategy not in (0, 1, 2, 3):
        return False
    if bench not in (0, 1) or quiet not in (0, 1):
        return False
    if not math.isfinite(disorder) or disorder < 0.0 or disorder > 1.0:
        return False
    if total < 0 or any(count < 0 for count in operation_counts):
        return False
    if sum(operation_counts) != total:
        return False
    return True


def _payload_from_context(ctx, final=False):
    global _last_state

    if ctx is None:
        return {"available": False, "initialized": False, "reason": "ctx is not in scope yet"}

    if not _looks_initialized(ctx):
        return {
            "available": True,
            "initialized": False,
            "reason": "ctx has not been initialized yet",
            "a": None,
            "b": None,
            "strategy": None,
            "disorder": None,
            "ops": None,
        }

    ops = ctx["ops"]
    payload = {
        "available": True,
        "initialized": True,
        "final": bool(final),
        "a": _stack(ctx["a"]),
        "b": _stack(ctx["b"]),
        "strategy": _int(ctx["strategy"]),
        "disorder": float(ctx["disorder"]),
        "bench": bool(_int(ctx["bench"])),
        "quiet": bool(_int(ctx["quiet"])),
        "ops": {
            name: _int(ops[name])
            for name in _OP_NAMES + ["total"]
        },
    }
    _last_state = payload
    return payload


class CVisFinalStateBreakpoint(gdb.Breakpoint):
    def __init__(self):
        super(CVisFinalStateBreakpoint, self).__init__("free_context", internal=True)

    def stop(self):
        global _last_state
        try:
            ctx = _deref_context(gdb.newest_frame().read_var("ctx"))
            payload = _payload_from_context(ctx, final=True)
            if payload.get("initialized"):
                _last_state = payload
        except Exception:
            pass
        return False


class CVisPushSwapState(gdb.Command):
    def __init__(self):
        super(CVisPushSwapState, self).__init__("cvis-push-swap-state", gdb.COMMAND_USER)

    def invoke(self, arg, from_tty):
        global _last_state
        try:
            ctx = _find_context()
            if ctx is None and _last_state is not None:
                payload = dict(_last_state)
                payload["final"] = True
            else:
                payload = _payload_from_context(ctx)
        except Exception as exc:
            if _last_state is not None:
                payload = dict(_last_state)
                payload["final"] = True
            else:
                payload = {"available": False, "initialized": False, "reason": str(exc)}
        gdb.write("CVIS_PUSH_SWAP_STATE " + json.dumps(payload, separators=(",", ":")) + "\n")


CVisFinalStateBreakpoint()
CVisPushSwapState()
