/**
 * Packaging guard: the published tarball must contain every file the plugin
 * needs at runtime. `files` in package.json once omitted `scripts/`, which
 * silently broke scene unpacking and frame extraction for everyone who
 * installed a packed copy — this check exists so that cannot regress.
 *
 * Run: node scripts/check-pack.mjs
 */
import { execFileSync } from "node:child_process";

const REQUIRED = [
	"package.json",
	"cordis.patch.yml",
	"README.md",
	"lib/index.js",
	"lib/client.js",
	"lib/config.js",
	"lib/locate.js",
	"lib/resolve.js",
	"lib/scene.js",
	"lib/frame.js",
	"lib/serve.js",
	"lib/status.js",
	"scripts/frame.py",
	"scripts/repkg/RePKG.exe",
	"scripts/repkg/THIRD-PARTY-NOTICES.txt",
];

const npmArgs = ["pack", "--dry-run", "--json"];
// Node refuses to spawn a .cmd directly (EINVAL) on Windows since the
// CVE-2024-27980 fix, and `shell: true` triggers DEP0190 — so go through cmd.exe.
const raw =
	process.platform === "win32"
		? execFileSync(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", "npm pack --dry-run --json"], {
				encoding: "utf8",
			})
		: execFileSync("npm", npmArgs, { encoding: "utf8" });
const files = new Set(JSON.parse(raw)[0].files.map((f) => f.path));

const missing = REQUIRED.filter((p) => !files.has(p));
if (missing.length > 0) {
	console.error("check-pack: files missing from the tarball:\n  " + missing.join("\n  "));
	console.error("\nFix package.json `files` so every runtime file is packed.");
	process.exit(1);
}

const stray = [...files].filter((p) => p.startsWith("test/") || p.startsWith(".github/"));
if (stray.length > 0) {
	console.error(`check-pack: dev-only files leaked into the tarball: ${stray.join(", ")}`);
	process.exit(1);
}

console.log(`check-pack: ok (${files.size} files, all ${REQUIRED.length} required entries present)`);
