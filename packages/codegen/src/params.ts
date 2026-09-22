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
  | { role: "out-array"; elem: MappedType; countParam: string }
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

/** Valve's Hungarian prefixes for a count or size parameter. */
const COUNT_RE = /^(cch|cub|cb|cMax|nMax|unMax|cubMax)[A-Z_]?|^(cch|cub|cb)$/;

const isCountName = (n: string) => COUNT_RE.test(n);

function pointee(cType: string): string {
  return cType.replace(/\bconst\b/g, "").trim().replace(/\s*[*&]\s*$/, "").trim();
}

function baseRole(p: Param, next: Param | undefined, ctx: TypeContext): ParamRole {
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
  if (p.out_struct !== undefined) return { role: "out-struct", struct: inner };
  if (p.out_array_count !== undefined || p.out_array_call !== undefined) {
    return {
      role: "out-array",
      elem: mapType(inner, ctx),
      countParam: (p.out_array_count ?? p.out_array_call)!,
    };
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
    role: overrides[p.paramname] ?? baseRole(p, method.params[i + 1], ctx),
  }));

  // A parameter named as the size of another is supplied by the caller but hidden
  // from the buffer it describes.
  for (const p of params) {
    const r = p.role;
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
