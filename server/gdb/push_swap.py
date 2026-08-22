import gdb
import json


def _int(value):
    return int(value)


def _stack(node):
    values = []
    seen = set()
    for _ in range(1000):
        address = _int(node)
        if address == 0 or address in seen:
            break
        seen.add(address)
        current = node.dereference()
        values.append({
            "value": _int(current["value"]),
            "index": _int(current["index"]),
            "address": hex(address),
        })
        node = current["next"]
    return values


def _find_context():
    frame = gdb.newest_frame()
    while frame is not None:
        try:
            value = frame.read_var("ctx")
            value_type = value.type.strip_typedefs()
            if value_type.code == gdb.TYPE_CODE_PTR:
                if _int(value) == 0:
                    return None
                value = value.dereference()
            return value
        except (gdb.error, ValueError):
            frame = frame.older()
    return None


class CVisPushSwapState(gdb.Command):
    def __init__(self):
        super(CVisPushSwapState, self).__init__("cvis-push-swap-state", gdb.COMMAND_USER)

    def invoke(self, arg, from_tty):
        payload = {"available": False}
        try:
            ctx = _find_context()
            if ctx is None:
                payload["reason"] = "ctx is not in scope yet"
            else:
                ops = ctx["ops"]
                payload = {
                    "available": True,
                    "a": _stack(ctx["a"]),
                    "b": _stack(ctx["b"]),
                    "strategy": _int(ctx["strategy"]),
                    "disorder": float(ctx["disorder"]),
                    "bench": bool(_int(ctx["bench"])),
                    "quiet": bool(_int(ctx["quiet"])),
                    "ops": {
                        name: _int(ops[name])
                        for name in ["sa", "sb", "ss", "pa", "pb", "ra", "rb", "rr", "rra", "rrb", "rrr", "total"]
                    },
                }
        except Exception as exc:
            payload = {"available": False, "reason": str(exc)}
        gdb.write("CVIS_PUSH_SWAP_STATE " + json.dumps(payload, separators=(",", ":")) + "\n")


CVisPushSwapState()
