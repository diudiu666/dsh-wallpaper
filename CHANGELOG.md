# Changelog

All notable changes to this project are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.1] — 2026-10-24

### Fixed

- **Enabling the plugin could fail the whole DSH boot.** `lib/client.js`
  registered the browser bundle as `dsh-wallpaper` — the cordis row id — while
  the harness keys each client module row by the *package* name
  (`dsh-wallpaper-diudiu`). The row was therefore never answered, the loader
  replayed the bundle, and the replay hit the module system's
  duplicate-registration guard, so the entry was reported as
  `web boot: 1 entry did not activate`
  (`duplicate factory registration for "dsh-wallpaper"`). The bundle now
  registers under the package name, and a regression test keeps the two from
  drifting apart again.

## [0.2.0] — 2026-10-23

The open-source-readiness release: the plugin now works on a machine that is
not the author's, and it explains itself when it does not.

### Added

- **Automatic Wallpaper Engine discovery** (`lib/locate.js`). The WE
  `config.json` is found through, in order: explicit `weConfigPath`, the
  `DSH_WALLPAPER_WE_CONFIG` environment variable, the Windows registry
  (`HKCU\Software\Valve\Steam\SteamPath`, `HKLM\...\Valve\Steam\InstallPath`),
  every Steam library listed in `steamapps/libraryfolders.vdf` (the multi-drive
  case), well-known default locations, and the macOS/Linux Steam layouts.
- **`GET /dsh-wallpaper/status`** — a diagnostics document: discovered WE path
  and its source, the Steam libraries seen, the resolution trace (which step
  succeeded or why it did not), and whether the optional `python`/opencv and
  RePKG tooling is available.
- **Steam-library aware workshop fallback**: the `workshop/content/<id>` →
  `workshop/downloads/<id>` twin is now resolved with `path.join`, so it works
  with any separator and any library root.
- Unit tests (`node --test`, 25 cases) covering VDF parsing, locator ordering,
  the resolution chain, and the HTTP routes (including HEAD and Range).
- `scripts/check-pack.mjs` fails the build when `npm pack` would omit a
  runtime file — `files` is easy to break and the breakage is invisible.
- `LICENSE` (BSD-3-Clause), `.gitattributes`, CI workflow, issue template.

### Changed

- **Package renamed to `dsh-wallpaper-diudiu`** to stop colliding with the
  unrelated `dsh-wallpaper` package on npm. The cordis row id stays
  `dsh-wallpaper`, so existing profile patches keep working.
- An image wallpaper is now served as the image itself. 0.1.x fell through to
  the `preview.*` poster, so a flat image wallpaper could show a thumbnail.
- A stale/mistyped `weConfigPath` is no longer silent: discovery continues, and
  the status trace records `config-we-path: MISS`.

### Removed

- The hard-coded fallback image at `C:\Users\diu\Pictures\...`. When nothing
  resolves, the image route now answers 404 with a pointer to `/status` instead
  of serving a path that only exists on the author's machine.
- The duplicated self-test block that ran frame extraction twice.

## [0.1.3] — 2026-08-19

- Translucent tier for the "edited N files" card and the deliverable list: the
  upstream palette tokens (`--dsw-static-neutral-50/100/800/850`) are remapped
  inside the frame scope so component-local fills follow the veil.
- Adds multi-select rows, diff gutters, and scrollbar thumb tokens to the
  surface tier.

## [0.1.2] — 2026-08-18

- Structural anchors instead of `[class*="_frame"]` (which matched 14 unrelated
  modules); three-tier translucency (panel / surface / overlay) plus accent fill.

## [0.1.1] — 2026-08-17

- Hooks that survive CSS-module hashing: `:is(div:has(> [data-rightbar-col]),
  div:has(> [data-shell-overlay]))` plus class-suffix matching.

## [0.1.0] — 2026-08-17

- First working build: Wallpaper Engine sync (video / image / scene), the
  static image route, and the client-side translucent CSS.
