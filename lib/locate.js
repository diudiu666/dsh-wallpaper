/**
 * Locate the Wallpaper Engine installation.
 *
 * A plain `C:\Program Files (x86)\Steam\...` constant is wrong on most real
 * machines: Steam may sit on another drive, WE may live in a secondary Steam
 * library, and macOS/Linux use entirely different layouts. This module builds
 * an ordered candidate list from facts the OS already knows, then returns the
 * first `config.json` that exists together with WHERE it was found.
 *
 * Order (first hit wins):
 *   1. explicit `weConfigPath` from <DSH_HOME>/wallpaper/config.json
 *   2. DSH_WALLPAPER_WE_CONFIG environment variable
 *   3. Windows registry: HKCU SteamPath, HKLM InstallPath (WOW6432Node first)
 *   4. Steam library roots parsed from every root's steamapps/libraryfolders.vdf
 *   5. Well-known default locations (Program Files, per-drive Steam/Library)
 *   6. macOS / Linux default locations
 *
 * Everything is injectable so the resolution order is unit-testable without a
 * Steam install (`exists`, `readFile`, `regQuery`, `platform`, `env`, `home`).
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

/** Steam app id of Wallpaper Engine. */
export const WE_APP_ID = "431960";

const STEAM_APP_DIR = ["steamapps", "common", "wallpaper_engine"];
const WE_CONFIG_FILE = "config.json";

/** Registry value names that hold a Steam root, most reliable first. */
const REG_KEYS = [
	{ key: "HKCU\\Software\\Valve\\Steam", value: "SteamPath" },
	{ key: "HKLM\\SOFTWARE\\WOW6432Node\\Valve\\Steam", value: "InstallPath" },
	{ key: "HKLM\\SOFTWARE\\Valve\\Steam", value: "InstallPath" },
];

const DRIVE_LETTERS = ["c", "d", "e", "f", "g"];
const ROOT_SUBDIRS = [
	"Steam",
	"SteamLibrary",
	"SteamLibrary2",
	"SteamLibrary3",
	"Games\\Steam",
	"Games\\SteamLibrary",
];

/** Normalize a registry/steam path (`c:/program files (x86)/steam`). */
export function normalizePath(value) {
	if (typeof value !== "string") return null;
	const trimmed = value.trim().replace(/^"|"$/g, "");
	if (trimmed.length === 0) return null;
	return process.platform === "win32" ? trimmed.replace(/\//g, "\\") : trimmed;
}

/**
 * Extract every `"path" "<value>"` from a libraryfolders.vdf. Covers both the
 * new (`"path" "D:\\SteamLibrary"`) and old (`"1" "D:\\SteamLibrary"`) shapes
 * by taking the `path` key when present and any drive-looking value otherwise.
 * @param {string} text Raw VDF contents.
 * @returns {string[]} Absolute library roots, de-duplicated, in file order.
 */
export function parseVdfPaths(text) {
	const found = [];
	const push = (raw) => {
		const value = raw.replace(/\\\\/g, "\\").replace(/\\"/g, '"');
		if (value.length > 1 && !found.includes(value)) found.push(value);
	};
	for (const m of String(text).matchAll(/"path"\s+"((?:[^"\\]|\\.)*)"/gi)) push(m[1]);
	if (found.length > 0) return found;
	// older layout: "1" "D:\\SteamLibrary" (numbered keys, no "path")
	for (const m of String(text).matchAll(/"\d+"\s+"((?:[^"\\]|\\.)*)"/g)) {
		const value = m[1].replace(/\\\\/g, "\\");
		if (/^[a-zA-Z]:[\\/]/.test(value) || value.startsWith("/")) push(m[1]);
	}
	return found;
}

/** Query a Windows registry value through `reg query`; null when absent. */
export function defaultRegQuery(key, valueName) {
	if (process.platform !== "win32") return null;
	const r = spawnSync("reg", ["query", key, "/v", valueName], {
		encoding: "utf8",
		windowsHide: true,
		timeout: 5000,
	});
	if (r.status !== 0 || !r.stdout) return null;
	const m = /REG_SZ\s+(.+?)\s*$/m.exec(r.stdout);
	return m ? m[1].trim() : null;
}

/** Well-known Steam roots for the current platform (unguessable ones excluded). */
export function defaultSteamRoots({ platform = process.platform, env = process.env } = {}) {
	const roots = [];
	if (platform === "win32") {
		const pf = env.ProgramFiles || "C:\\Program Files";
		const pf86 = env["ProgramFiles(x86)"] || "C:\\Program Files (x86)";
		for (const base of [pf86, pf]) roots.push(join(base, "Steam"));
		for (const letter of DRIVE_LETTERS) {
			for (const sub of ROOT_SUBDIRS) roots.push(`${letter.toUpperCase()}:\\${sub}`);
		}
	} else if (platform === "darwin") {
		roots.push(join(homedir(), "Library", "Application Support", "Steam"));
	} else {
		roots.push(join(homedir(), ".steam", "steam"));
		roots.push(join(homedir(), ".local", "share", "Steam"));
	}
	return roots;
}

/**
 * Find the Wallpaper Engine config.json.
 *
 * @param {object} [options]
 * @param {NodeJS.ProcessEnv} [options.env]
 * @param {string} [options.platform]
 * @param {string|null} [options.explicitPath] `weConfigPath` from the plugin config.
 * @param {string} [options.home]
 * @param {(p: string) => boolean} [options.exists]
 * @param {(p: string) => string} [options.readFile]
 * @param {(key: string, value: string) => (string|null)} [options.regQuery]
 * @param {string[]|null} [options.extraRoots] Additional roots (tests, callers).
 * @returns {{found: boolean, configPath: string|null, source: string|null,
 *            installDir: string|null, libraries: string[], tried: string[]}}
 */
export function findWeConfig(options = {}) {
	const {
		env = process.env,
		platform = process.platform,
		explicitPath = null,
		exists = (p) => existsSync(p),
		readFile = (p) => readFileSync(p, "utf8"),
		regQuery = defaultRegQuery,
		extraRoots = null,
	} = options;
	const isFile =
		options.isFile ??
		((p) => {
			try {
				return statSync(p).isFile();
			} catch {
				return false;
			}
		});
	const tried = [];
	const libraries = [];
	let explicitMissed = false;

	const configIn = (root) => join(root, ...STEAM_APP_DIR, WE_CONFIG_FILE);

	const hit = (configPath, source) => ({
		found: true,
		configPath,
		source,
		installDir: dirname(configPath),
		libraries,
		tried,
		explicitMissed,
	});
	const check = (configPath, source) => {
		if (tried.includes(configPath)) return null;
		tried.push(configPath);
		return isFile(configPath) ? hit(configPath, source) : null;
	};

	// 1) explicit path, 2) environment override — accept either the config.json
	// itself or the Wallpaper Engine install directory that holds it. A miss is
	// recorded rather than fatal: a stale path (Steam moved) falls back to
	// discovery, and /status reports that the configured path did not resolve.
	const explicit = normalizePath(explicitPath);
	if (explicit) {
		const found = check(explicit, "config") || check(join(explicit, ...STEAM_APP_DIR, WE_CONFIG_FILE), "config");
		if (found) return found;
		explicitMissed = true;
	}
	const fromEnv = normalizePath(env.DSH_WALLPAPER_WE_CONFIG);
	if (fromEnv) {
		const found = check(fromEnv, "env") || check(join(fromEnv, ...STEAM_APP_DIR, WE_CONFIG_FILE), "env");
		if (found) return found;
		explicitMissed = true;
	}

	// 3) registry roots, 4) default roots -> expand each into Steam libraries
	const roots = [];
	for (const { key, value } of REG_KEYS) {
		let raw = null;
		try {
			raw = regQuery(key, value);
		} catch {
			raw = null;
		}
		const root = normalizePath(raw);
		if (root && !roots.includes(root)) roots.push(root);
	}
	for (const raw of [...defaultSteamRoots({ platform, env }), ...(extraRoots ?? [])]) {
		const root = normalizePath(raw);
		if (root && !roots.includes(root)) roots.push(root);
	}

	for (const root of roots) {
		if (exists(root) && !libraries.includes(root)) libraries.push(root);
		const vdf = join(root, "steamapps", "libraryfolders.vdf");
		try {
			if (exists(vdf)) {
				for (const lib of parseVdfPaths(readFile(vdf))) {
					if (lib && !libraries.includes(lib)) libraries.push(lib);
				}
			}
		} catch {
			// unreadable VDF: the root itself is still a candidate below
		}
	}

	for (const lib of libraries) {
		const found = check(configIn(lib), "library");
		if (found) return found;
	}
	// roots that do not exist yet are still worth a direct probe (cheap, useful
	// when the VDF could not be read)
	for (const root of roots) {
		const found = check(configIn(root), "default");
		if (found) return found;
	}

	return {
		found: false,
		configPath: null,
		source: null,
		installDir: null,
		libraries,
		tried,
		explicitMissed,
	};
}
