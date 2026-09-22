/**
 * Classifies each flat-API parameter into the role it plays in the generated wrapper.
 * `steam_api.json` annotates many out parameters, but not all, so a naming heuristic
 * covers the rest and `overrides.ts` covers what the heuristic gets wrong.
 */
import type { Method, Param } from "./schema.ts";
import { type MappedType, mapType, type TypeContext } from "./types.ts";
import { OVERRIDES } from "./overrides.ts";

export type ParamRole =
  | { role: "in"; type: MappedType }
  | { role: "in-string" }
  | { role: "in-array"; elem: MappedType; countParam: string }
  | { role: "in-buffer"; countParam: string }
  | { role: "in-struct"; struct: string }
  | { role: "out-string"; countParam: string; defaultSize: number }
  | { role: "out-struct"; struct: string }
  | { role: "out-array"; elem: MappedType; countParam: string; fixedCount?: number }
  | { role: "out-scalar"; type: MappedType }
  | { role: "count"; forParam: string }
  | { role: "opaque"; type: MappedType };

export interface ClassifiedParam {
  name: string;
  c: Param;
  role: ParamRole;
}

export interface ClassifiedMethod {
  method: Method;
  params: ClassifiedParam[];
  returns: MappedType;
  callresult?: string;
}

/** Buffer size used when the caller does not choose one for an out string. */
export const OUT_STRING_DEFAULT = 256;

/**
 * Array sizes that `out_array_count` names as a C macro rather than a parameter.
 * Values read from isteaminput.h and isteamcontroller.h in SDK 1.65.
 */
const ARRAY_SIZE_CONSTANTS: Record<string, number> = {
  STEAM_INPUT_MAX_COUNT: 16,
  STEAM_INPUT_MAX_ACTIVE_LAYERS: 16,
  STEAM_INPUT_MAX_ORIGINS: 8,
  STEAM_INPUT_MAX_ANALOG_ACTIONS: 24,
  STEAM_INPUT_MAX_DIGITAL_ACTIONS: 256,
  STEAM_CONTROLLER_MAX_COUNT: 16,
  STEAM_CONTROLLER_MAX_ACTIVE_LAYERS: 16,
  STEAM_CONTROLLER_MAX_ORIGINS: 8,
  STEAM_CONTROLLER_MAX_ANALOG_ACTIONS: 24,
  STEAM_CONTROLLER_MAX_DIGITAL_ACTIONS: 256,
};

/** Valve's Hungarian prefixes for a count or size parameter. */
const COUNT_RE = /^(cch|cub|cb|cMax|nMax|unMax|cubMax)[A-Z_]?|^(cch|cub|cb)$/;

const isCountName = (n: string) => COUNT_RE.test(n);

function pointee(cType: string): string {
  return cType.replace(/\bconst\b/g, "").trim().replace(/\s*[*&]\s*$/, "").trim();
}

/**
 * Work out how many elements an out array holds.
 * `out_array_call` packs "countParam,MethodToCall,argsToPass", so only its first field names
 * the count. `out_array_count` is usually a parameter, sometimes a C macro, and occasionally
 * another array's name, in which case the method's own size parameter is the real count.
 */
function resolveArrayCount(
  p: Param,
  all: Param[],
): { countParam: string; fixedCount?: number } {
  const raw = (p.out_array_count ?? p.out_array_call ?? "").split(",")[0].trim();
  const names = new Set(all.map((q) => q.paramname));
  if (names.has(raw)) return { countParam: raw };
  if (raw in ARRAY_SIZE_CONSTANTS) {
    return { countParam: String(ARRAY_SIZE_CONSTANTS[raw]), fixedCount: ARRAY_SIZE_CONSTANTS[raw] };
  }
  const sized = all.find((q) => isCountName(q.paramname) || /^un[A-Z]\w*Length$/.test(q.paramname));
  if (sized) return { countParam: sized.paramname };
  return { countParam: raw || "0", fixedCount: 0 };
}

function baseRole(p: Param, next: Param | undefined, ctx: TypeContext, all: Param[]): ParamRole {
  const isPtr = /[*&]\s*$/.test(p.paramtype);
  const isConst = /\bconst\b/.test(p.paramtype);
  const declared = p.paramtype_flat ?? p.paramtype;

  if (!isPtr) return { role: "in", type: mapType(declared, ctx) };

  const inner = pointee(p.paramtype);

  if (inner === "char") {
    if (isConst) return { role: "in-string" };
    const countParam = p.out_string_count ??
      (next && isCountName(next.paramname) ? next.paramname : undefined);
    if (countParam) return { role: "out-string", countParam, defaultSize: OUT_STRING_DEFAULT };
    return { role: "in-string" };
  }
  // out_struct sometimes annotates a pointer to a plain 64-bit id such as CSteamID,
  // which the type mapper treats as a primitive rather than a struct.
  if (p.out_struct !== undefined && ctx.structs.has(inner)) {
    return { role: "out-struct", struct: inner };
  }
  if (p.out_array_count !== undefined || p.out_array_call !== undefined) {
    return { role: "out-array", elem: mapType(inner, ctx), ...resolveArrayCount(p, all) };
  }
  if (p.array_count !== undefined) {
    return { role: "in-array", elem: mapType(inner, ctx), countParam: p.array_count };
  }
  if (p.buffer_count !== undefined || p.out_buffer_count !== undefined) {
    return { role: "in-buffer", countParam: (p.buffer_count ?? p.out_buffer_count)! };
  }
  if (inner === "void") {
    if (next && isCountName(next.paramname)) {
      return { role: "in-buffer", countParam: next.paramname };
    }
    return { role: "opaque", type: mapType(declared, ctx) };
  }
  if (ctx.structs.has(inner)) {
    return isConst ? { role: "in-struct", struct: inner } : { role: "out-struct", struct: inner };
  }

  let innerT: MappedType;
  try {
    innerT = mapType(inner, ctx);
  } catch {
    // A pointer to something the schema does not describe, such as an interface class.
    return { role: "opaque", type: mapType(declared, ctx) };
  }
  if (innerT.kind === "pointer" || innerT.kind === "string") {
    if (next && isCountName(next.paramname)) {
      return { role: "out-array", elem: innerT, countParam: next.paramname };
    }
    return { role: "opaque", type: mapType(declared, ctx) };
  }
  if (isConst) {
    if (next && isCountName(next.paramname)) {
      return { role: "in-array", elem: innerT, countParam: next.paramname };
    }
    return { role: "opaque", type: mapType(declared, ctx) };
  }
  if (next && isCountName(next.paramname)) {
    return { role: "out-array", elem: innerT, countParam: next.paramname };
  }
  return { role: "out-scalar", type: innerT };
}

export function classify(method: Method, ctx: TypeContext): ClassifiedMethod {
  const overrides = OVERRIDES[method.methodname_flat] ?? {};
  const params: ClassifiedParam[] = method.params.map((p, i) => ({
    name: p.paramname,
    c: p,
    role: overrides[p.paramname] ?? baseRole(p, method.params[i + 1], ctx, method.params),
  }));

  // A parameter named as the size of another is supplied by the caller but hidden
  // from the buffer it describes.
  for (const p of params) {
    const r = p.role;
    // A fixed size is a literal, so it hides no parameter.
    if (r.role === "out-array" && r.fixedCount !== undefined) continue;
    const countName = "countParam" in r ? r.countParam : undefined;
    if (!countName) continue;
    const count = params.find((q) => q.name === countName);
    if (count && count.role.role === "in") count.role = { role: "count", forParam: p.name };
  }

  return {
    method,
    params,
    returns: mapType(method.returntype_flat ?? method.returntype, ctx),
    callresult: method.callresult,
  };
}
