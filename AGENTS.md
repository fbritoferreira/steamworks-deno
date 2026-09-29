# Working in this repository

Deno 2.3+ workspace. The Steamworks SDK is NOT in the repo and must never be committed — it is
licensed, not redistributable. Download it yourself from
<https://partner.steamgames.com/downloads/steamworks_sdk.zip> and unzip it so `./sdk/public` and
`./sdk/redistributable_bin` exist (`sdk/` is gitignored).

## Commands

```sh
deno task check        # type-check the workspace
deno task lint         # deno lint + fmt --check
deno task test         # unit tests; SDK-gated tests run only with STEAMWORKS_SDK_PATH set
deno task gen          # regenerate packages/steamworks/gen from the local SDK (needs the SDK)
deno task gen:check    # gen + fail if the committed output differs (binding drift check)
deno task verify       # full live verification; needs the SDK, clang++, and a logged-in Steam client
deno task verify --offline   # layout + library checks; SDK and compiler only, no Steam
deno task verify --dedicated  # dedicated-server path; SDK + standalone steamclient, ports 27015-27016 free
deno task demo         # CLI demo against AppID 480 (Spacewar), needs Steam running
deno task game         # raylib Pong demo, needs raylib + Steam running
```

Run check, lint and test before pushing. CI runs them on Linux, macOS and Windows.

## CI and the SDK

- `ci.yml`: check/lint/test/dry-run publish, plus a diff of README.md against
  packages/steamworks/README.md (the JSR-facing copy — edit the root, never the copy).
- `sdk-verify.yml`: downloads the SDK from Valve every push using the `STEAMWORKS_PARTNER_COOKIE`
  repo secret (the Cookie header a logged-in browser sends to partner.steamgames.com; it expires
  roughly daily — a stale or missing cookie skips SDK checks with a notice, red means bindings).
  Runs `gen:check`, `verify --offline` on all three OSes, and `verify --dedicated` on Linux and
  Windows with a standalone steamclient fetched anonymously via steamcmd. A daily cron run does the
  same so a new Steamworks SDK release is caught within a day; schema drift auto-opens a
  `[sdk-drift]` issue.
- `publish.yml`: pushing a `v*` tag publishes both packages to JSR via OIDC. The tag must match the
  version in both deno.json files, and the tag must be created only after the release PR merges.

## Conventions

- Generated code under `packages/steamworks/gen/` is never hand-edited: change the generator under
  `packages/codegen/src/` and run `deno task gen`.
- Commits: Conventional Commits, subject under 50 chars, body only when the why is non-obvious.
- No AI attribution lines in commits or PRs.
- Docs live beside what they describe; the README tells exactly what is and is not verified, and
  edits should keep it that way.
