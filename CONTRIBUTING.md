# Contributing

Thanks for helping. This plugin runs inside the DSH desktop shell, so a change
that "works on my machine" is only half done — the other half is making the
failure visible and testable.

## Ground rules

1. **Zero runtime dependencies.** `package.json` has no `dependencies` and new
   ones need a very good reason: this package is installed into a user's DSH
   profile, and every dependency is a download, a supply-chain surface, and a
   version conflict.
2. **Never hard-code a user path.** Any location that differs between machines
   (Steam, Wallpaper Engine, python, RePKG) belongs in `lib/locate.js` or in
   `lib/config.js`, so it can be overridden and reported by
   `/dsh-wallpaper/status`.
3. **Every resolution step must be explainable.** When you add a branch to
   `resolveMedia`, add a `trace` note for both the success and the failure path;
   `/status` is what bug reports are triaged from.
4. **Degrade, do not throw.** Missing python, missing RePKG, an unsupported
   platform, a malformed WE config: the wallpaper route answers 404 and the
   status document says why. It must never take the host HTTP server down.
5. **`lib/client.js` is not ES module code.** It is loaded by the harness module
   loader; keep the `window.__ModuleLoader__.load({ id, factory })` wrapper and
   treat it as ES5-ish (no `import`/`export`).

## Before opening a PR

```bash
npm test            # must pass (locator, resolution chain, HTTP routes)
npm run pack:check  # must pass (tarball contains every runtime file)
```

- New platform or layout support: add a fixture/test under `test/` instead of
  asserting "works locally".
- Changing `package.json#files` requires `npm run pack:check` — that guard exists
  because `scripts/` was once omitted from the published tarball, which silently
  broke scene unpacking and frame extraction for every packed install.
- Keep the CHANGELOG updated (`Added` / `Changed` / `Removed`, user-visible
  wording, no commit hashes).
- Commit messages: `feat:`, `fix:`, `test:`, `docs:`, `chore:` — one logical
  change per commit.

## Reporting a bug

Open an issue and include the output of:

```bash
curl http://127.0.0.1:<DSH port>/dsh-wallpaper/status
```

That document already contains the platform, the DSH home, the discovered
Wallpaper Engine path and its source, the resolution trace, and the optional
tool status — without it a "no wallpaper" report is mostly guesswork.
