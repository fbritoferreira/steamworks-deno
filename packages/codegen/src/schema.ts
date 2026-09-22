/** Types for Valve's `public/steam/steam_api.json` and a validating loader. */

/** A C type alias, such as `AppId_t` for `unsigned int`. */
export interface Typedef {
  /** The alias being defined. */
  typedef: string;
  /** The C type it stands for. */
  type: string;
}

/** A compile-time constant. Its value may be an expression rather than a literal. */
export interface Const {
  /** The constant's name. */
  constname: string;
  /** Its C type, which decides the width used when evaluating the value. */
  consttype: string;
  /** The C expression, for example `0x0`, `128 + 1` or `( Type ) ~ 0`. */
  constval: string;
}

/** One member of an enumeration. */
export interface EnumValue {
  /** The member's name, keeping Valve's `k_E` prefix. */
  name: string;
  /** Its integer value, as written in the header. */
  value: string;
}

/** An enumeration. Some are declared inside an interface or struct rather than at file scope. */
export interface Enum {
  /** The bare name, which is how the type mapper refers to it. */
  enumname: string;
  /** The name qualified by its enclosing type, when it has one. */
  fqname?: string;
  /** Its members, in declaration order. */
  values: EnumValue[];
}

/** One field of a struct. */
export interface Field {
  /** The field's name. */
  fieldname: string;
  /** Its C type, which may be an array such as `char [128]`. */
  fieldtype: string;
  /** True when the header declares it private, so its offset cannot be taken. */
  private?: boolean;
}

/** A plain struct, one that is not delivered as a callback. */
export interface Struct {
  /** The struct's name. */
  struct: string;
  /** Its fields, in declaration order, which is what decides the layout. */
  fields: Field[];
  /** Enumerations declared inside it. */
  enums?: Enum[];
  /** Constants declared inside it. */
  consts?: Const[];
}

/** A struct Steam delivers through the callback queue. */
export interface CallbackStruct extends Struct {
  /** The id that identifies this callback in the queue. */
  callback_id: number;
}

/**
 * One parameter of a flat method. The annotations describe how Steam uses the pointer,
 * and the generator turns them into roles such as an out string or a filled array.
 */
export interface Param {
  /** The parameter's name. */
  paramname: string;
  /** Its C type as declared on the C++ method. */
  paramtype: string;
  /** Its type in the flat API, where classes become plain 64-bit ids. */
  paramtype_flat?: string;
  /** Names the parameter holding the length of an array passed in. */
  array_count?: string;
  /** Names the parameter holding the size of a buffer passed in. */
  buffer_count?: string;
  /** Names the count, the method to call for it, and that method's arguments, comma separated. */
  out_array_call?: string;
  /** Names the parameter or macro giving the capacity of an array Steam fills. */
  out_array_count?: string;
  /** Names the parameter holding the size of a buffer Steam fills. */
  out_buffer_count?: string;
  /** Marks a `char *` that Steam writes into. */
  out_string?: string;
  /** Names the parameter holding the capacity of that string buffer. */
  out_string_count?: string;
  /** Marks a pointer to a struct that Steam fills. */
  out_struct?: string;
  /** Valve's description, present on 17 of 1786 parameters. */
  desc?: string;
}

/** One method on a Steam interface. */
export interface Method {
  /** The C++ method name, which overloads share. */
  methodname: string;
  /** The exported symbol, unique across the whole API. */
  methodname_flat: string;
  /** Its parameters, in order. */
  params: Param[];
  /** The C++ return type. */
  returntype: string;
  /** The return type in the flat API, when it differs. */
  returntype_flat?: string;
  /** The struct this call eventually resolves to, when it returns a `SteamAPICall_t`. */
  callresult?: string;
  /** A callback this method causes, when it names one. */
  callback?: string;
  /** Valve's description, absent from every method in SDK 1.65. */
  desc?: string;
}

/** How Steam hands out an interface. */
export interface Accessor {
  /**
   * Who the interface belongs to. `user` is a game client, `gameserver` a dedicated
   * server, and `global` appears once, on ISteamNetworkingUtils.
   */
  kind: "user" | "gameserver" | "global";
  /** The accessor's name in the C++ API. */
  name: string;
  /** The exported symbol, versioned per SDK release, such as `SteamAPI_SteamUser_v023`. */
  name_flat: string;
}

/** One Steam interface, such as `ISteamUserStats`. */
export interface Interface {
  /** The class name. */
  classname: string;
  /** The version string Steam matches against, such as `STEAMUSERSTATS_INTERFACE_VERSION013`. */
  version_string?: string;
  /** How the interface is obtained. An interface with none is implemented by the caller. */
  accessors?: Accessor[];
  /** Its methods, in declaration order. */
  methods: Method[];
  /** Fields, on the few interfaces that declare them. */
  fields?: Field[];
  /** Enumerations declared inside the interface. */
  enums?: Enum[];
}

/** The whole of Valve's `public/steam/steam_api.json`. */
export interface SteamApiJson {
  /** Type aliases. */
  typedefs: Typedef[];
  /** Compile-time constants. */
  consts: Const[];
  /** Enumerations declared at file scope. */
  enums: Enum[];
  /** Plain structs. */
  structs: Struct[];
  /** Structs delivered through the callback queue, each with its id. */
  callback_structs: CallbackStruct[];
  /** The 34 Steam interfaces. */
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
