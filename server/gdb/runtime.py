import json
import math
import gdb

PREFIX = "CVIS_RUNTIME_STATE "
MAX_DEPTH = 5
MAX_OBJECTS = 128
MAX_ARRAY_ELEMENTS = 64
MAX_STRING_LENGTH = 256


def _type_name(value_type):
    try:
        return str(value_type)
    except Exception:
        return "?"


def _strip(value_type):
    try:
        return value_type.strip_typedefs()
    except Exception:
        return value_type


def _address(value):
    try:
        if value.address is None:
            return None
        return hex(int(value.address))
    except Exception:
        return None


def _pointer_address(value):
    try:
        raw = int(value)
        return None if raw == 0 else hex(raw)
    except Exception:
        text = str(value)
        if "0x0" in text:
            return None
        marker = text.find("0x")
        if marker >= 0:
            end = marker + 2
            while end < len(text) and text[end].lower() in "0123456789abcdef":
                end += 1
            return text[marker:end]
        return None


def _is_char_type(value_type):
    stripped = _strip(value_type)
    try:
        return stripped.code == gdb.TYPE_CODE_INT and stripped.sizeof == 1 and "char" in _type_name(stripped)
    except Exception:
        return False


def _safe_scalar(value, stripped):
    try:
        if stripped.code == gdb.TYPE_CODE_FLT:
            numeric = float(value)
            if math.isfinite(numeric):
                return numeric
        if stripped.code in (gdb.TYPE_CODE_INT, gdb.TYPE_CODE_BOOL, gdb.TYPE_CODE_ENUM):
            return int(value)
    except Exception:
        pass
    try:
        return value.format_string(raw=True)
    except Exception:
        return str(value)


def _visible_symbols(frame):
    seen = set()
    block = frame.block()
    while block is not None:
        for symbol in block:
            name = symbol.name
            if not name or name in seen:
                continue
            try:
                is_argument = bool(symbol.is_argument)
                is_variable = bool(symbol.is_variable)
            except Exception:
                continue
            if not is_argument and not is_variable:
                continue
            try:
                value = symbol.value(frame)
            except Exception:
                try:
                    value = frame.read_var(symbol)
                except Exception:
                    continue
            seen.add(name)
            yield {
                "name": name,
                "role": "argument" if is_argument else "local",
                "value": value,
            }
        try:
            block = block.superblock
        except Exception:
            break


class RuntimeState:
    def __init__(self):
        self.objects = {}
        self.order = []
        self.truncated = False
        self.errors = []

    def add_error(self, message):
        if len(self.errors) < 16:
            self.errors.append(str(message))

    def object_for(self, value, depth, forced_address=None):
        if depth > MAX_DEPTH:
            self.truncated = True
            return None
        object_id = forced_address or _address(value)
        if not object_id:
            return None
        if object_id in self.objects:
            return object_id
        if len(self.objects) >= MAX_OBJECTS:
            self.truncated = True
            return object_id

        value_type = value.type
        stripped = _strip(value_type)
        node = {
            "id": object_id,
            "address": object_id,
            "type": _type_name(value_type),
            "kind": "unknown",
        }
        self.objects[object_id] = node
        self.order.append(object_id)

        try:
            if stripped.code in (gdb.TYPE_CODE_STRUCT, gdb.TYPE_CODE_UNION):
                node["kind"] = "union" if stripped.code == gdb.TYPE_CODE_UNION else "struct"
                node["fields"] = []
                for field in stripped.fields():
                    if not field.name:
                        continue
                    try:
                        child = value[field.name]
                        encoded = self.encode(child, depth + 1)
                    except Exception as error:
                        encoded = {
                            "kind": "unavailable",
                            "reason": str(error),
                            "type": _type_name(field.type),
                        }
                    node["fields"].append({
                        "name": field.name,
                        "type": _type_name(field.type),
                        "value": encoded,
                    })
                return object_id

            if stripped.code == gdb.TYPE_CODE_ARRAY:
                node["kind"] = "array"
                node["elements"] = []
                try:
                    low, high = stripped.range()
                    length = max(0, high - low + 1)
                except Exception:
                    low, length = 0, 0
                node["length"] = length
                visible = min(length, MAX_ARRAY_ELEMENTS)
                if length > visible:
                    self.truncated = True
                for offset in range(visible):
                    index = low + offset
                    try:
                        encoded = self.encode(value[index], depth + 1)
                    except Exception as error:
                        encoded = {"kind": "unavailable", "reason": str(error)}
                    node["elements"].append({"index": index, "value": encoded})
                return object_id

            node["kind"] = "scalar"
            node["value"] = _safe_scalar(value, stripped)
            return object_id
        except Exception as error:
            node["kind"] = "unavailable"
            node["reason"] = str(error)
            self.add_error(error)
            return object_id

    def encode(self, value, depth=0):
        value_type = value.type
        stripped = _strip(value_type)
        type_name = _type_name(value_type)

        try:
            code = stripped.code
        except Exception:
            code = None

        if code == gdb.TYPE_CODE_PTR:
            target = _pointer_address(value)
            descriptor = {
                "kind": "pointer",
                "type": type_name,
                "target": target,
                "null": target is None,
            }
            try:
                target_type = _strip(stripped.target())
                descriptor["pointeeType"] = _type_name(stripped.target())
            except Exception:
                target_type = None

            if target is None:
                return descriptor

            if target_type is not None and _is_char_type(target_type):
                try:
                    descriptor["string"] = value.string(length=MAX_STRING_LENGTH)
                except Exception:
                    pass

            if depth >= MAX_DEPTH:
                self.truncated = True
                return descriptor

            if target_type is not None:
                try:
                    if target_type.code in (
                        gdb.TYPE_CODE_STRUCT,
                        gdb.TYPE_CODE_UNION,
                        gdb.TYPE_CODE_ARRAY,
                        gdb.TYPE_CODE_INT,
                        gdb.TYPE_CODE_FLT,
                        gdb.TYPE_CODE_BOOL,
                        gdb.TYPE_CODE_ENUM,
                    ):
                        pointee = value.dereference()
                        object_id = self.object_for(pointee, depth + 1, target)
                        if object_id:
                            descriptor["object"] = object_id
                except Exception as error:
                    descriptor["unreadable"] = True
                    descriptor["reason"] = str(error)
            return descriptor

        if code in (gdb.TYPE_CODE_STRUCT, gdb.TYPE_CODE_UNION, gdb.TYPE_CODE_ARRAY):
            object_id = self.object_for(value, depth)
            if object_id:
                return {"kind": "reference", "type": type_name, "target": object_id}

        if code == gdb.TYPE_CODE_ENUM:
            return {
                "kind": "enum",
                "type": type_name,
                "value": _safe_scalar(value, stripped),
                "label": str(value),
            }

        if code in (gdb.TYPE_CODE_INT, gdb.TYPE_CODE_BOOL, gdb.TYPE_CODE_FLT):
            descriptor = {
                "kind": "scalar",
                "type": type_name,
                "value": _safe_scalar(value, stripped),
            }
            if _is_char_type(stripped):
                try:
                    numeric = int(value)
                    if 0 <= numeric <= 255:
                        descriptor["character"] = chr(numeric)
                except Exception:
                    pass
            return descriptor

        if code == gdb.TYPE_CODE_FUNC:
            return {"kind": "function", "type": type_name, "value": str(value)}

        try:
            return {"kind": "scalar", "type": type_name, "value": value.format_string(raw=True)}
        except Exception:
            return {"kind": "scalar", "type": type_name, "value": str(value)}

    def payload(self):
        try:
            frame = gdb.selected_frame()
        except Exception as error:
            return {"available": False, "reason": str(error)}

        roots = []
        try:
            for item in _visible_symbols(frame):
                try:
                    encoded = self.encode(item["value"], 0)
                except Exception as error:
                    encoded = {
                        "kind": "unavailable",
                        "type": _type_name(item["value"].type),
                        "reason": str(error),
                    }
                    self.add_error(error)
                roots.append({
                    "name": item["name"],
                    "role": item["role"],
                    "type": _type_name(item["value"].type),
                    "value": encoded,
                })
        except Exception as error:
            self.add_error(error)

        return {
            "available": True,
            "frame": {"function": frame.name() or "?"},
            "roots": roots,
            "objects": [self.objects[object_id] for object_id in self.order if object_id in self.objects],
            "truncated": self.truncated,
            "errors": self.errors,
            "limits": {
                "depth": MAX_DEPTH,
                "objects": MAX_OBJECTS,
                "arrayElements": MAX_ARRAY_ELEMENTS,
                "stringLength": MAX_STRING_LENGTH,
            },
        }


class CVisRuntimeStateCommand(gdb.Command):
    def __init__(self):
        super().__init__("cvis-runtime-state", gdb.COMMAND_DATA)

    def invoke(self, arg, from_tty):
        del arg, from_tty
        state = RuntimeState().payload()
        print(PREFIX + json.dumps(state, separators=(",", ":"), ensure_ascii=False))


CVisRuntimeStateCommand()
