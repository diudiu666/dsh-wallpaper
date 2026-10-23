/**
 * scene.pkg (Wallpaper Engine scene wallpapers) extraction.
 *
 * WE ships scenes as an encrypted/compressed container; the bundled RePKG
 * utility unpacks it, then the best static background texture is picked from
 * the extracted tree and cached. Scene animations cannot be captured statically
 * (WE renders them with its own engine, no window/DC to grab), so a scene
 * wallpaper shows up as a high-resolution still.
 *
 * RePKG is a Windows x64 binary: on other platforms this reports "unsupported"
 * and the caller falls back to the item's preview poster.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { homeDir, readJsonStrict } from "./config.js";

const HERE = dirname(fileURLToPath(import.meta.url));

/** Bundled RePKG executable. */
export const REPKG_EXE = join(HERE, "..", "scripts", "repkg", "RePKG.exe");

/** filename hints (case-insensitive substring) that mark a texture as the background */
const SCENE_BG_KEYWORDS = ["背景", "bg", "background", "backdrop"];

function isFile(p) {
	try {
		return statSync(p).isFile();
	} catch {
		return false;
	}
}

/** Whether scene extraction can work here (Windows + a readable RePKG binary). */
export function sceneSupport({ platform = process.platform, repkgPath = null } = {}) {
	if (platform !== "win32") return { ok: false, reason: `unsupported-platform:${platform}` };
	if (!existsSync(repkgPath || REPKG_EXE)) return { ok: false, reason: "repkg-missing" };
	return { ok: true, reason: null };
}

/** PNG width/height by parsing the IHDR chunk — no image library needed. */
export function pngDimensions(file) {
	try {
		const buf = readFileSync(file).subarray(0, 24);
		if (buf.length < 24 || buf.readUInt32BE(0) !== 0x89504e47) return null;
		return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
	} catch {
		return null;
	}
}

/** Recursively collect .png files, skipping masks/ and effects/. */
export function listPngs(dir, out = [], depth = 0) {
	if (depth > 5) return out;
	let entries;
	try {
		entries = readdirSync(dir, { withFileTypes: true });
	} catch {
		return out;
	}
	for (const e of entries) {
		const p = join(dir, e.name);
		if (e.isDirectory()) {
			if (e.name === "masks" || e.name === "effects") continue;
			listPngs(p, out, depth + 1);
		} else if (e.name.toLowerCase().endsWith(".png")) {
			out.push(p);
		}
	}
	return out;
}

/** Pick the best static background: name hint first, then largest pixels. */
export function pickSceneBackground(cacheDir) {
	const pngs = listPngs(cacheDir);
	let best = null;
	let bestScore = -1;
	for (const p of pngs) {
		const dim = pngDimensions(p);
		if (!dim) continue;
		const lower = p.toLowerCase();
		const hint = SCENE_BG_KEYWORDS.some((k) => lower.includes(k.toLowerCase())) ? 1 : 0;
		const score = hint * 1e12 + dim.w * dim.h;
		if (score > bestScore) {
			bestScore = score;
			best = p;
		}
	}
	return best;
}

/**
 * Unpack a scene.pkg into the cache and return the best background png.
 * Re-extracts only when the pkg changed. Returns null on any failure.
 * @param {string} pkgPath
 * @param {{env?: NodeJS.ProcessEnv, repkgPath?: string, timeoutMs?: number}} [options]
 */
export function sceneExtractBackground(pkgPath, options = {}) {
	const { env = process.env, timeoutMs = 120000 } = options;
	const repkgPath = options.repkgPath || REPKG_EXE;
	if (!pkgPath || !isFile(pkgPath)) return null;
	if (!sceneSupport({ repkgPath }).ok) return null;

	const hash = createHash("md5").update(pkgPath.toLowerCase()).digest("hex").slice(0, 16);
	const cacheDir = join(homeDir(env), "wallpaper", "cache", `scene_${hash}`);
	const metaPath = join(cacheDir, "meta.json");
	let st;
	try {
		st = statSync(pkgPath);
	} catch {
		return null;
	}
	try {
		const meta = readJsonStrict(metaPath);
		if (meta.pkgMtime === st.mtimeMs && meta.pkgSize === st.size) {
			const cached = pickSceneBackground(cacheDir);
			if (cached) return cached;
		}
	} catch {
		// no meta yet
	}
	try {
		mkdirSync(cacheDir, { recursive: true });
	} catch {
		// unwritable cache: extraction below fails and the caller falls back
	}
	const r = spawnSync(repkgPath, ["extract", "-o", cacheDir, pkgPath], {
		timeout: timeoutMs,
		windowsHide: true,
		stdio: "ignore",
	});
	if (r.error) return null;
	const bg = pickSceneBackground(cacheDir);
	if (bg) {
		try {
			writeFileSync(metaPath, JSON.stringify({ pkgMtime: st.mtimeMs, pkgSize: st.size }));
		} catch {
			// meta write failed -> re-extract next time
		}
		return bg;
	}
	return null;
}
