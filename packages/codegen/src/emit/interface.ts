/**
 * Emits, per Steam interface, a Deno FFI symbol table and a wrapper class whose methods
 * hide the out parameters, buffers and size arguments the flat C API requires.
 */
import type { Interface, Method } from "../schema.ts";
import { type MappedType, mapType, type TypeContext } from "../types.ts";
import type { LayoutResolver } from "../layout.ts";
import { type ClassifiedMethod, type ClassifiedParam, classify } from "../params.ts";
import type { DocIndex } from "../docscan.ts";
import { jsdoc } from "./jsdoc.ts";

const lcFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

/** Method name in TypeScript, using the flat suffix to separate C++ overloads. */
export function tsMethodName(m: Method, all: Method[]): string {
  const sameName = all.filter((o) => o.methodname === m.methodname);
  if (sameName.length === 1) return lcFirst(m.methodname);
  const prefix = /^SteamAPI_[A-Za-z]+_/.exec(m.methodname_flat)?.[0] ?? "";
  return lcFirst(m.methodname_flat.slice(prefix.length));
}

function tsType(t: MappedType): string {
  if (t.kind === "array" && t.elem) {
    return t.elem.native === "u8" ? "string" : `${tsType(t.elem)}[]`;
  }
  return t.ts;
}

/** The FFI parameter type for one classified parameter. */
function nativeParam(p: ClassifiedParam, ctx: TypeContext, resolver: LayoutResolver): string {
  switch (p.role.role) {
    case "in":
      if (p.role.type.kind === "struct") return structDescriptor(p.role.type.ts, resolver);
      return `"${p.role.type.native}"`;
    case "opaque":
      return `"${p.role.type.native}"`;
    case "count":
      return `"${mapType(p.c.paramtype_flat ?? p.c.paramtype, ctx).native}"`;
    default:
      // Everything else travels as a buffer Steam reads or writes.
      return `"buffer"`;
  }
}

/** A Deno FFI descriptor for a struct passed or returned by value, as flat scalar fields. */
function structDescriptor(structName: string, resolver: LayoutResolver): string {
  const flat: string[] = [];
  const walk = (name: string) => {
    for (const f of resolver.layout(name, 4).fields) {
      if (f.type.kind === "struct") {
        walk(f.type.ts);
      } else if (f.type.kind === "array" && f.type.elem) {
        for (let i = 0; i < (f.type.count ?? 0); i++) flat.push(`"${f.type.elem.native ?? "u8"}"`);
      } else {
        flat.push(`"${f.type.native}"`);
      }
    }
  };
  walk(structName);
  return `{ struct: [${flat.join(", ")}] }`;
}

function symbolLine(cm: ClassifiedMethod, ctx: TypeContext, resolver: LayoutResolver): string {
  const params = [`"pointer"`, ...cm.params.map((p) => nativeParam(p, ctx, resolver))].join(", ");
  const r = cm.returns;
  const result = r.kind === "struct" ? structDescriptor(r.ts, resolver) : `"${r.native}"`;
  return `  ${cm.method.methodname_flat}: { parameters: [${params}], result: ${result} },`;
}

interface Emitted {
  signature: string;
  body: string;
  uses: Set<string>;
}

function methodBody(
  cm: ClassifiedMethod,
  name: string,
  resolver: LayoutResolver,
): Emitted {
  const uses = new Set<string>();
  const sig: string[] = [];
  const pre: string[] = [];
  const args: string[] = ["this.self"];
  const outs: { name: string; expr: string; ts: string }[] = [];
  let outStruct: { name: string; struct: string } | undefined;
  let outArray: { name: string; elem: MappedType; count: string } | undefined;

  for (const p of cm.params) {
    const r = p.role;
    switch (r.role) {
      case "in":
        sig.push(`${p.name}: ${tsType(r.type)}`);
        if (r.type.kind === "struct") {
          args.push(`encode${r.type.ts}(${p.name})`);
          uses.add(`encode${r.type.ts}`).add(r.type.ts);
        } else {
          args.push(p.name);
          if (r.type.kind === "enum") uses.add(r.type.ts);
        }
        break;
      case "opaque":
        sig.push(`${p.name}: Deno.PointerValue`);
        args.push(p.name);
        break;
      case "inout-count":
        // Steam reads the capacity from this pointer and writes the real count back.
        sig.push(`${p.name}: ${tsType(r.type)}`);
        pre.push(`const ${p.name}_buf = scalarOut("${r.type.native}");`);
        pre.push(`write.${r.type.native}(${p.name}_buf, 0, ${p.name});`);
        args.push(`${p.name}_buf`);
        uses.add("scalarOut").add("write");
        break;
      case "count": {
        const owner = cm.params.find((q) => q.name === r.forParam);
        if (owner?.role.role === "out-string") {
          sig.push(`${p.name} = ${owner.role.defaultSize}`);
        } else {
          sig.push(`${p.name}: number`);
        }
        args.push(p.name);
        break;
      }
      case "in-string":
        sig.push(`${p.name}: string`);
        args.push(`cstrArg(${p.name})`);
        uses.add("cstrArg");
        break;
      case "in-buffer":
        sig.push(`${p.name}: Uint8Array`);
        args.push(p.name);
        break;
      case "in-struct":
        sig.push(`${p.name}: ${r.struct}`);
        args.push(`encode${r.struct}(${p.name})`);
        uses.add(`encode${r.struct}`);
        uses.add(r.struct);
        break;
      case "in-array":
        if (r.elem.kind === "enum") uses.add(r.elem.ts);
        sig.push(`${p.name}: ${tsType(r.elem)}[]`);
        args.push(`writeScalarArray("${r.elem.native}", ${p.name})`);
        uses.add("writeScalarArray");
        break;
      case "out-string":
        pre.push(`const ${p.name}_buf = outString(${r.countParam});`);
        args.push(`${p.name}_buf`);
        outs.push({ name: p.name, expr: `readOutString(${p.name}_buf)`, ts: "string" });
        uses.add("outString").add("readOutString");
        break;
      case "out-scalar":
        if (r.type.kind === "enum") uses.add(r.type.ts);
        pre.push(`const ${p.name}_buf = scalarOut("${r.type.native}");`);
        args.push(`${p.name}_buf`);
        outs.push({
          name: p.name,
          expr: `readScalar(${p.name}_buf, "${r.type.native}") as ${tsType(r.type)}`,
          ts: tsType(r.type),
        });
        uses.add("scalarOut").add("readScalar");
        break;
      case "out-struct":
        pre.push(`const ${p.name}_buf = new Uint8Array(${r.struct}_layout[PACK].size);`);
        args.push(`${p.name}_buf`);
        outStruct = { name: p.name, struct: r.struct };
        uses.add("PACK").add(`${r.struct}_layout`).add(`decode${r.struct}`).add(r.struct);
        break;
      case "out-array":
        if (r.elem.kind === "enum") uses.add(r.elem.ts);
        if (r.elem.kind === "struct") {
          pre.push(
            `const ${p.name}_buf = new Uint8Array(${r.elem.ts}_layout[PACK].size * ${r.countParam});`,
          );
          uses.add("PACK").add(`${r.elem.ts}_layout`).add(`decode${r.elem.ts}`).add(r.elem.ts)
            .add("readArray");
        } else {
          pre.push(`const ${p.name}_buf = arrayOut("${r.elem.native}", ${r.countParam});`);
          uses.add("arrayOut").add("readScalarArray");
        }
        args.push(`${p.name}_buf`);
        outArray = { name: p.name, elem: r.elem, count: r.countParam };
        break;
    }
  }

  const call = `this.s.${cm.method.methodname_flat}(${args.join(", ")})`;
  const ret = cm.returns;
  const preamble = pre.length ? pre.map((l) => `    ${l}`).join("\n") + "\n" : "";

  if (cm.callresult) {
    const id = resolver.callbackId(cm.callresult);
    uses.add(`decode${cm.callresult}`).add(cm.callresult);
    return {
      signature: `${name}(${sig.join(", ")}): Promise<${cm.callresult}>`,
      body: `${preamble}    const call = ${call};\n` +
        `    return this.host.callResult(call, ${id}, decode${cm.callresult});`,
      uses,
    };
  }

  if (outStruct) {
    if (ret.kind === "bool") {
      return {
        signature: `${name}(${sig.join(", ")}): ${outStruct.struct} | null`,
        body: `${preamble}    if (!${call}) return null;\n` +
          `    return decode${outStruct.struct}(${outStruct.name}_buf);`,
        uses,
      };
    }
    return {
      signature: `${name}(${sig.join(", ")}): ${outStruct.struct}`,
      body: `${preamble}    ${call};\n    return decode${outStruct.struct}(${outStruct.name}_buf);`,
      uses,
    };
  }

  if (outArray) {
    const elemTs = tsType(outArray.elem);
    const countParam = cm.params.find((q) => q.name === outArray.count);
    const countValue =
      countParam?.role.role === "inout-count" && countParam.role.type.kind === "bigint"
        ? `Number(${outArray.count})`
        : outArray.count;
    const countExpr = ret.kind === "int"
      ? `    const n = ${call};`
      : `    ${call};\n    const n = ${countValue};`;
    const size = `${outArray.elem.ts}_layout[PACK].size`;
    const read = outArray.elem.kind === "struct"
      ? `readArray(${outArray.name}_buf, 0, n, ${size}, (b, o) => decode${outArray.elem.ts}(b.subarray(o, o + ${size})))`
      : `readScalarArray(${outArray.name}_buf, "${outArray.elem.native}", n) as ${elemTs}[]`;
    return {
      signature: `${name}(${sig.join(", ")}): ${elemTs}[]`,
      body: `${preamble}${countExpr}\n    return ${read};`,
      uses,
    };
  }

  if (outs.length) {
    const fields = outs.map((o) => `${o.name}: ${o.ts}`).join("; ");
    const values = outs.map((o) => `${o.name}: ${o.expr}`).join(", ");
    if (ret.kind === "void") {
      return {
        signature: `${name}(${sig.join(", ")}): { ${fields} }`,
        body: `${preamble}    ${call};\n    return { ${values} };`,
        uses,
      };
    }
    const retName = ret.kind === "bool" ? "ok" : "result";
    const retTs = ret.kind === "bool" ? "ok: boolean" : `result: ${tsType(ret)}`;
    if (ret.kind === "enum") uses.add(ret.ts);
    if (ret.kind === "string") uses.add("readCString");
    // A `const char *` return alongside out parameters still has to be copied.
    const retExpr = ret.kind === "string"
      ? `readCString(${call})`
      : ret.kind === "enum"
      ? `${call} as ${ret.ts}`
      : call;
    return {
      signature: `${name}(${sig.join(", ")}): { ${retTs}; ${fields} }`,
      body: `${preamble}    const ${retName} = ${retExpr};\n    return { ${retName}, ${values} };`,
      uses,
    };
  }

  if (ret.kind === "string") {
    uses.add("readCString");
    return {
      signature: `${name}(${sig.join(", ")}): string`,
      body: `${preamble}    return readCString(${call});`,
      uses,
    };
  }

  if (ret.kind === "struct") {
    // Deno returns a by-value struct as its raw bytes.
    uses.add(`decode${ret.ts}`).add(ret.ts);
    return {
      signature: `${name}(${sig.join(", ")}): ${ret.ts}`,
      body: `${preamble}    return decode${ret.ts}(${call} as Uint8Array);`,
      uses,
    };
  }

  if (ret.kind === "void") {
    return {
      signature: `${name}(${sig.join(", ")}): void`,
      body: `${preamble}    ${call};`,
      uses,
    };
  }

  const cast = ret.kind === "enum" ? ` as ${ret.ts}` : "";
  if (ret.kind === "enum") uses.add(ret.ts);
  return {
    signature: `${name}(${sig.join(", ")}): ${tsType(ret)}`,
    body: `${preamble}    return ${call}${cast};`,
    uses,
  };
}

const LAYOUT_HELPERS = new Set(["PACK", "readArray", "write"]);

const MARSHAL_HELPERS = new Set([
  "cstrArg",
  "outString",
  "readOutString",
  "scalarOut",
  "readScalar",
  "arrayOut",
  "readScalarArray",
  "writeScalarArray",
]);

export function emitInterface(
  iface: Interface,
  ctx: TypeContext,
  resolver: LayoutResolver,
  docs?: DocIndex,
): string {
  const accessor = iface.accessors?.find((a) => a.kind === "user") ?? iface.accessors?.[0];

  const emitted = iface.methods.map((m) => {
    const cm = classify(m, ctx);
    const name = tsMethodName(m, iface.methods);
    return { cm, name, out: methodBody(cm, name, resolver) };
  });

  // Derive imports from the text actually emitted, so they can never drift from usage.
  const body = emitted.map((e) => `${e.out.signature}${e.out.body}`).join("\n");
  const uses = new Set<string>();
  for (const e of emitted) {
    for (const u of e.out.uses) {
      if (new RegExp(`\\b${u}\\b`).test(body)) uses.add(u);
    }
  }

  const symbols = emitted.map((e) => symbolLine(e.cm, ctx, resolver));
  if (accessor) {
    symbols.push(
      `  ${accessor.name_flat}: { parameters: [], result: "pointer", optional: true },`,
    );
  }

  const structNames = [...uses].filter((u) =>
    !MARSHAL_HELPERS.has(u) && !LAYOUT_HELPERS.has(u) && u !== "readCString"
  );
  const fromStructs = structNames.filter((u) => !ctx.enums.has(u)).sort();
  const fromEnums = structNames.filter((u) => ctx.enums.has(u)).sort();
  const marshal = [...uses].filter((u) => MARSHAL_HELPERS.has(u)).sort();

  let out = "";
  const layout = [...uses].filter((u) => LAYOUT_HELPERS.has(u)).sort();
  if (layout.length) out += `import { ${layout.join(", ")} } from "../../src/layout.ts";\n`;
  if (uses.has("readCString")) out += `import { readCString } from "../../src/cstring.ts";\n`;
  out += `import type { CallResultHost } from "../../src/marshal.ts";\n`;
  if (marshal.length) out += `import { ${marshal.join(", ")} } from "../../src/marshal.ts";\n`;
  if (fromStructs.length) out += `import { ${fromStructs.join(", ")} } from "../structs.ts";\n`;
  if (fromEnums.length) out += `import type { ${fromEnums.join(", ")} } from "../enums.ts";\n`;

  out += "\n" + jsdoc(
    `Deno FFI symbol table for \`${iface.classname}\`: every flat method, plus the versioned\n` +
      `accessor Steam uses to hand out the interface.`,
  );
  out += `export const ${iface.classname}_symbols = {\n${symbols.join("\n")}\n` +
    `} as const satisfies Deno.ForeignLibraryInterface;\n\n`;

  const classDoc = docs?.methods.get(`${iface.classname}.__class__`) ??
    `Steam's \`${iface.classname}\` interface. Reach it from \`SteamClient\`; the constructor is\n` +
      `for the client to call.`;
  out += jsdoc(classDoc);
  out += `export class ${iface.classname} {\n`;
  if (accessor) {
    out += jsdoc(
      `The versioned export Steam uses to hand out this interface, for SDK ${"$"}{version}.`
        .replace("${version}", "1.65"),
      "  ",
    );
    out += `  static readonly accessor = "${accessor.name_flat}";\n\n`;
  }
  out += `  constructor(\n` +
    `    private readonly s: Deno.DynamicLibrary<typeof ${iface.classname}_symbols>["symbols"],\n` +
    `    private readonly self: Deno.PointerValue,\n` +
    `    private readonly host: CallResultHost,\n` +
    `  ) {}\n`;
  for (const e of emitted) {
    const doc = docs?.methods.get(`${iface.classname}.${e.cm.method.methodname}`);
    out += `\n${jsdoc(doc, "  ")}  ${e.out.signature} {\n${e.out.body}\n  }\n`;
  }
  out += `}\n`;
  return out;
}
