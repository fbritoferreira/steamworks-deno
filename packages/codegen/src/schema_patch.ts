/**
 * Structs the headers define but `steam_api.json` omits.
 *
 * Each entry names the header it was copied from. Without these the generator either
 * cannot resolve a field type or the runtime has no layout for a struct it must decode.
 */
import type { SteamApiJson, Struct } from "./schema.ts";

const MISSING: Struct[] = [
  // steam_api.h: filled in by SteamAPI_ManualDispatch_GetNextCallback.
  {
    struct: "CallbackMsg_t",
    fields: [
      { fieldname: "m_hSteamUser", fieldtype: "HSteamUser" },
      { fieldname: "m_iCallback", fieldtype: "int" },
      { fieldname: "m_pubParam", fieldtype: "uint8 *" },
      { fieldname: "m_cubParam", fieldtype: "int" },
    ],
  },
  // steamclientpublic.h: the SDK asserts 24 bytes under pack(4) and 32 under pack(8).
  {
    struct: "ValvePackingSentinel_t",
    fields: [
      { fieldname: "m_u32", fieldtype: "uint32" },
      { fieldname: "m_u64", fieldtype: "uint64" },
      { fieldname: "m_u16", fieldtype: "uint16" },
      { fieldname: "m_d", fieldtype: "double" },
    ],
  },
  // isteaminput.h: members of the anonymous union inside SteamInputActionEvent_t.
  // The JSON spells the field type `SteamInputActionEvent_t::AnalogAction_t`; the type
  // mapper falls back to the bare name.
  {
    struct: "AnalogAction_t",
    fields: [
      { fieldname: "actionHandle", fieldtype: "InputAnalogActionHandle_t" },
      { fieldname: "analogActionData", fieldtype: "InputAnalogActionData_t" },
    ],
  },
  {
    struct: "DigitalAction_t",
    fields: [
      { fieldname: "actionHandle", fieldtype: "InputDigitalActionHandle_t" },
      { fieldname: "digitalActionData", fieldtype: "InputDigitalActionData_t" },
    ],
  },
];

/**
 * Add the missing structs to a freshly loaded schema. An existing definition always wins,
 * and a struct is skipped when the schema lacks a type one of its fields needs, so a
 * trimmed schema stays self-consistent.
 */
export function patchSchema(schema: SteamApiJson): SteamApiJson {
  const present = new Set(schema.structs.map((s) => s.struct));
  const known = new Set<string>([
    ...schema.structs.map((s) => s.struct),
    ...schema.callback_structs.map((s) => s.struct),
    ...schema.typedefs.map((t) => t.typedef),
    ...schema.enums.map((e) => e.enumname),
  ]);
  const PRIMITIVE =
    /^(void|bool|char|u?int(8|16|32|64)?|float|double|short|long|unsigned|signed)\b/;
  const resolvable = (fieldtype: string) => {
    const base = fieldtype.replace(/\bconst\b/g, "").replace(/\s*[*&]\s*$/, "")
      .replace(/\s*\[\d+\]$/, "").trim();
    return PRIMITIVE.test(base) || known.has(base);
  };
  for (const s of MISSING) {
    if (present.has(s.struct)) continue;
    if (!s.fields.every((f) => resolvable(f.fieldtype))) continue;
    schema.structs.push(s);
  }
  return schema;
}
