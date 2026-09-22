/** Types for Valve's `public/steam/steam_api.json` and a validating loader. */

export interface Typedef {
  typedef: string;
  type: string;
}

export interface Const {
  constname: string;
  consttype: string;
  constval: string;
}

export interface EnumValue {
  name: string;
  value: string;
}

export interface Enum {
  enumname: string;
  fqname?: string;
  values: EnumValue[];
}

export interface Field {
  fieldname: string;
  fieldtype: string;
  private?: boolean;
}

export interface Struct {
  struct: string;
  fields: Field[];
  enums?: Enum[];
  consts?: Const[];
}

export interface CallbackStruct extends Struct {
  callback_id: number;
}

export interface Param {
  paramname: string;
  paramtype: string;
  paramtype_flat?: string;
  array_count?: string;
  buffer_count?: string;
  out_array_call?: string;
  out_array_count?: string;
  out_buffer_count?: string;
  out_string?: string;
  out_string_count?: string;
  out_struct?: string;
  desc?: string;
}

export interface Method {
  methodname: string;
  methodname_flat: string;
  params: Param[];
  returntype: string;
  returntype_flat?: string;
  callresult?: string;
  callback?: string;
  desc?: string;
}

export interface Accessor {
  /** `global` appears once, on ISteamNetworkingUtils. */
  kind: "user" | "gameserver" | "global";
  name: string;
  name_flat: string;
}

export interface Interface {
  classname: string;
  version_string?: string;
  accessors?: Accessor[];
  methods: Method[];
  fields?: Field[];
  enums?: Enum[];
}

export interface SteamApiJson {
  typedefs: Typedef[];
  consts: Const[];
  enums: Enum[];
  structs: Struct[];
  callback_structs: CallbackStruct[];
  interfaces: Interface[];
}

import { patchSchema } from "./schema_patch.ts";

const REQUIRED: (keyof SteamApiJson)[] = [
  "typedefs",
  "consts",
  "enums",
  "structs",
  "callback_structs",
  "interfaces",
];

/**
 * Read and validate a `steam_api.json`, then add the structs the headers define but the
 * JSON omits. Throws naming the first missing top-level array.
 */
export async function loadSchema(path: string): Promise<SteamApiJson> {
  const raw = JSON.parse(await Deno.readTextFile(path)) as Partial<SteamApiJson>;
  for (const key of REQUIRED) {
    if (!Array.isArray(raw[key])) {
      throw new Error(`steam_api.json is missing the "${key}" array (${path})`);
    }
  }
  return patchSchema(raw as SteamApiJson);
}
