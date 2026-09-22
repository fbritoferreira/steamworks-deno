/**
 * Decoders for the callback structs this package understands.
 *
 * Offsets below hold on every platform for these particular structs: the only
 * Windows (`#pragma pack(8)`) vs macOS/Linux (`pack(4)`) difference for them is
 * trailing padding, which we never read. The generated bindings will compute
 * layouts per platform; do not assume this shortcut generalises.
 */
import { readFixedString } from "./cstring.ts";

export const CallbackId = {
  GameOverlayActivated: 331,
  SteamAPICallCompleted: 703,
  UserStatsStored: 1102,
  UserAchievementStored: 1103,
  GlobalAchievementPercentagesReady: 1110,
} as const;

/** `CallbackMsg_t` as filled in by `SteamAPI_ManualDispatch_GetNextCallback`. */
export interface CallbackMsg {
  steamUser: number;
  callbackId: number;
  paramPtr: Deno.PointerValue;
  paramSize: number;
}

/** Size to allocate for a `CallbackMsg_t` out-buffer (24 covers pack(8); pack(4) is 20). */
export const CALLBACK_MSG_SIZE = 24;

export function decodeCallbackMsg(bytes: Uint8Array): CallbackMsg {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return {
    steamUser: view.getInt32(0, true),
    callbackId: view.getInt32(4, true),
    paramPtr: Deno.UnsafePointer.create(view.getBigUint64(8, true)),
    paramSize: view.getInt32(16, true),
  };
}

export interface SteamAPICallCompleted {
  asyncCall: bigint;
  callbackId: number;
  paramSize: number;
}

export function decodeSteamAPICallCompleted(bytes: Uint8Array): SteamAPICallCompleted {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return {
    asyncCall: view.getBigUint64(0, true),
    callbackId: view.getInt32(8, true),
    paramSize: view.getUint32(12, true),
  };
}

export interface UserStatsStored {
  gameId: bigint;
  result: number;
}

export function decodeUserStatsStored(bytes: Uint8Array): UserStatsStored {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { gameId: view.getBigUint64(0, true), result: view.getInt32(8, true) };
}

export interface UserAchievementStored {
  gameId: bigint;
  groupAchievement: boolean;
  achievementName: string;
  curProgress: number;
  maxProgress: number;
}

export function decodeUserAchievementStored(bytes: Uint8Array): UserAchievementStored {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return {
    gameId: view.getBigUint64(0, true),
    groupAchievement: bytes[8] !== 0,
    achievementName: readFixedString(bytes, 9, 128),
    curProgress: view.getUint32(140, true),
    maxProgress: view.getUint32(144, true),
  };
}

export interface GlobalAchievementPercentagesReady {
  gameId: bigint;
  result: number;
}

export function decodeGlobalAchievementPercentagesReady(
  bytes: Uint8Array,
): GlobalAchievementPercentagesReady {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { gameId: view.getBigUint64(0, true), result: view.getInt32(8, true) };
}

export interface GameOverlayActivated {
  active: boolean;
  userInitiated: boolean;
  appId: number;
  overlayPid: number;
}

export function decodeGameOverlayActivated(bytes: Uint8Array): GameOverlayActivated {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return {
    active: bytes[0] !== 0,
    userInitiated: bytes[1] !== 0,
    appId: view.getUint32(4, true),
    overlayPid: view.getUint32(8, true),
  };
}
