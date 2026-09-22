/**
 * A one-screen game that talks to Steam while it runs.
 *
 *   STEAMWORKS_SDK_PATH=./sdk deno task game
 *
 * Two native libraries share this process: raylib draws, and libsteam_api talks to the
 * Steam client. Steam's callbacks are pumped once per frame from the same loop that draws,
 * which is how a real game does it, rather than on a timer as a script would.
 *
 * Score a point and the demo unlocks ACH_WIN_ONE_GAME on Valve's Spacewar test app. The
 * confirmation arrives as a callback a frame or two later and appears on screen.
 */
import { embeddedLibraryPath, SteamClient } from "@steamworks/deno";
import {
  BLACK,
  DARKBLUE,
  GOLD,
  GREEN,
  KEY,
  LIGHTGRAY,
  MAROON,
  Raylib,
  RAYWHITE,
  WHITE,
} from "./raylib.ts";

const WIDTH = 900;
const HEIGHT = 520;
const PADDLE_W = 14;
const PADDLE_H = 96;
const ACHIEVEMENT = "ACH_WIN_ONE_GAME";

const ray = Raylib.openFirstAvailable(import.meta.url);

/**
 * Open Steam from the library beside this module, which is where `deno compile --include`
 * unpacks it, and fall back to the usual resolution when running uncompiled.
 *
 * The embedded file cannot be stat'ed, only opened, so this tries rather than checks.
 */
function openSteam() {
  try {
    return SteamClient.init({ appId: 480, libraryPath: embeddedLibraryPath(import.meta.url) });
  } catch {
    return SteamClient.init({ appId: 480 });
  }
}

const steam = openSteam();

// What the Steam panel shows. Filled once, then kept current by callbacks.
const persona = steam.friends.getPersonaName();
const steamId = steam.user.getSteamID().toString();
let achievementUnlocked = steam.userStats.getAchievement(ACHIEVEMENT).pbAchieved;
let lastCallback = "waiting for a callback";
let overlayOpen = false;

// Steam delivers these while the game loop runs. Nothing polls; the loop pumps.
steam.onCallback("UserAchievementStored", (data) => {
  achievementUnlocked = true;
  lastCallback = `UserAchievementStored_t  ${data.m_rgchAchievementName}`;
});
steam.onCallback("UserStatsStored", (data) => {
  lastCallback = `UserStatsStored_t  result ${data.m_eResult}`;
});
steam.onCallback("GameOverlayActivated", (data) => {
  // Valve declares m_bActive as uint8 rather than bool, so it decodes to a number.
  overlayOpen = data.m_bActive !== 0;
  lastCallback = `GameOverlayActivated_t  ${overlayOpen ? "opened" : "closed"}`;
});

let paddleY = HEIGHT / 2 - PADDLE_H / 2;
let ballX = WIDTH / 2;
let ballY = HEIGHT / 2;
let ballVx = -330;
let ballVy = 210;
let score = 0;
let misses = 0;

ray.initWindow(WIDTH, HEIGHT, "Steamworks for Deno");
ray.setTargetFps(60);

try {
  while (!ray.shouldClose()) {
    // One frame: read Steam's queue, advance the game, draw.
    steam.runCallbacks();

    const dt = ray.frameTime();
    if (!overlayOpen) {
      if (ray.isKeyDown(KEY.UP) || ray.isKeyDown(KEY.W)) paddleY -= 460 * dt;
      if (ray.isKeyDown(KEY.DOWN) || ray.isKeyDown(KEY.S)) paddleY += 460 * dt;
      paddleY = Math.max(0, Math.min(HEIGHT - PADDLE_H, paddleY));

      ballX += ballVx * dt;
      ballY += ballVy * dt;
      if (ballY < 10 || ballY > HEIGHT - 10) ballVy = -ballVy;
      if (ballX > WIDTH - 10) ballVx = -ballVx;

      const hitPaddle = ballX < 40 + PADDLE_W && ballY > paddleY && ballY < paddleY + PADDLE_H;
      if (hitPaddle && ballVx < 0) {
        ballVx = -ballVx * 1.04;
        score++;
        // The first point unlocks the achievement. Steam confirms by callback.
        if (score === 1 && !achievementUnlocked) {
          steam.userStats.setAchievement(ACHIEVEMENT);
          steam.userStats.storeStats();
        }
      }
      if (ballX < 0) {
        misses++;
        ballX = WIDTH / 2;
        ballY = HEIGHT / 2;
        ballVx = -330;
        ballVy = 210;
      }
    }

    ray.beginDrawing();
    ray.clearBackground(DARKBLUE);

    ray.drawRectangle(40, Math.round(paddleY), PADDLE_W, PADDLE_H, RAYWHITE);
    ray.drawCircle(Math.round(ballX), Math.round(ballY), 9, GOLD);
    ray.drawText(`${score}`, WIDTH / 2 - 14, 24, 48, WHITE);
    ray.drawText(`misses ${misses}`, WIDTH / 2 - 40, 78, 18, LIGHTGRAY);

    // The Steam panel.
    const panelY = HEIGHT - 132;
    ray.drawRectangle(0, panelY, WIDTH, 132, BLACK);
    ray.drawText(`Steam  ${persona}  ${steamId}`, 20, panelY + 14, 20, WHITE);
    ray.drawText(
      achievementUnlocked ? `${ACHIEVEMENT}  unlocked` : `${ACHIEVEMENT}  score a point`,
      20,
      panelY + 44,
      20,
      achievementUnlocked ? GREEN : LIGHTGRAY,
    );
    ray.drawText(lastCallback, 20, panelY + 72, 18, GOLD);
    ray.drawText(
      steam.isConnected ? "connected" : "disconnected",
      20,
      panelY + 98,
      18,
      steam.isConnected ? GREEN : MAROON,
    );
    ray.drawText("W and S move, Escape quits", WIDTH - 270, panelY + 98, 18, LIGHTGRAY);

    ray.endDrawing();
  }
} finally {
  // Clear the achievement so the demo can be run again, then close both libraries.
  if (achievementUnlocked) {
    steam.userStats.clearAchievement(ACHIEVEMENT);
    steam.userStats.storeStats();
    for (let i = 0; i < 30; i++) steam.runCallbacks();
  }
  ray.closeWindow();
  ray.close();
  steam.shutdown();
  console.log(`Final score ${score}, ${misses} missed.`);
}
