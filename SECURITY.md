# Security policy

## Supported versions

Only the latest published release receives security fixes. The plugin is a
desktop-only cosmetic layer, so older releases are expected to be upgraded
rather than patched.

| Version | Supported |
| --- | --- |
| 0.2.x (latest) | ✅ |
| < 0.2.2 | ❌ |

## Reporting a vulnerability

Please **do not open a public issue** for a security problem. Use GitHub's
private vulnerability reporting instead:

1. Open <https://github.com/diudiu666/dsh-wallpaper/security/advisories/new>.
2. Describe the impact, the affected version, and the smallest reproduction you
   can share. A `/dsh-wallpaper/status` dump is useful; it contains local paths,
   which you may redact.

If private reporting is unavailable, open an issue that only asks for a private
channel and wait for a reply — do not include the details in the issue.

There is no bug bounty and no guaranteed response time; this is a
single-maintainer project. Best effort is usually a few days.

## Scope and threat model

The plugin is installed into a local DSH profile and runs inside the DSH
desktop window. It:

- reads Wallpaper Engine's `config.json`, the selected wallpaper file, and the
  optional `~/.dsh/wallpaper/config.json`;
- serves those local files from the DSH web server under `/dsh-wallpaper/...`
  (the host is localhost-only and owns authentication; the wallpaper routes add
  none of their own);
- starts no outbound network connections, sends no telemetry, and stores no
  credentials;
- unpacks `scene.pkg` files with the bundled `scripts/repkg/RePKG.exe`, and
  extracts video frames with the configured `python` interpreter.

In scope: a route or code path that lets a caller read a file outside the
configured wallpaper paths, command injection through the `pythonCmd` /
`repkgPath` config values, or a malicious `.pkg` / media file that escapes the
RePKG or python child process into the DSH host.

Out of scope: a local user reading their own wallpaper files, denial of service
from a deliberately broken local config, and vulnerabilities in Wallpaper
Engine, Steam, Electron/DSH itself, or the third-party RePKG binary (report
those upstream, and mention them here if the bundled copy is affected).
