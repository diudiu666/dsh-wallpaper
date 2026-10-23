/**
 * The resolution chain: Wallpaper Engine sync -> config `image` -> drop-in
 * `image.png` -> nothing.
 *
 * The chain is evaluated PER REQUEST, so switching wallpapers takes effect on
 * the next refresh. Every step is recorded in `trace`, which powers
 * /dsh-wallpaper/status — "no wallpaper" must always be explainable instead of
 * silently falling back to some path that only exists on the author's machine.
 */
import { readdirSync, statSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import { normalizeConfig, readJsonStrict, wallpaperDir } from "./config.js";
import { extractVideoFrame } from "./frame.js";
import { findWeConfig } from "./locate.js";
import { sceneExtractBackground, sceneSupport } from "./scene.js";

/** extensions the Chromium client can play natively (H.264/VP8/VP9) */
export const PLAYABLE_VIDEO_EXTS = new Set([".mp4", ".webm"]);
/** anything video-ish that can at least be frame-extracted */
export const VIDEO_EXTS = new Set([".mp4", ".webm", ".mov", ".avi", ".mkv", ".m4v"]);
/** Wallpaper Engine scene packages */
export const SCENE_EXTS = new Set([".pkg"]);
/** static image formats served directly */
export const IMAGE_EXTS = new Set([".jpg", ".jpeg", ".png", ".webp", ".bmp", ".gif"]);
/** poster names WE writes next to an item */
export const PREVIEW_NAMES = [
	"preview.jpg",
	"preview.png",
	"preview.jpeg",
	"preview.webp",
	"preview.gif",
	"thumbnail.jpg",
	"thumbnail.png",
];

function isFile(p) {
	try {
		return statSync(p).isFile();
	} catch {
		return false;
	}
}

/**
 * Read WE's per-user wallpaper selection out of its config.json.
 * @param {string} configPath Absolute path of `<...>/wallpaper_engine/config.json`.
 * @returns {object|null} `general.wallpaperconfig`, or null when unreadable.
 */
export function readWeWallpaperConfig(configPath) {
	let parsed;
	try {
		parsed = readJsonStrict(configPath);
	} catch {
		return null;
	}
	// the user key is anything not starting with "?" ("?installdirectory" etc.)
	const userKey = Object.keys(parsed).find((k) => !k.startsWith("?"));
	if (!userKey) return null;
	return parsed[userKey]?.general?.wallpaperconfig ?? null;
}

/** Pick the selected wallpaper file for `monitor` (default: the first one). */
export function pickWeWallpaperFile(weWallpaperConfig, monitor) {
	const sel = weWallpaperConfig?.selectedwallpapers;
	if (!sel) return null;
	if (monitor && typeof sel[monitor]?.file === "string") return sel[monitor].file;
	const first = Object.keys(sel)[0];
	return first && typeof sel[first]?.file === "string" ? sel[first].file : null;
}

/**
 * WE points at `steamapps\workshop\content\431960\<id>\...`, but the payload
 * often only lives in `steamapps\workshop\downloads\431960\<id>`. Try the exact
 * path first, then the downloads twin, then any image inside the item folder.
 * @param {string} rawPath Path as recorded by WE.
 * @returns {string|null}
 */
export function resolveWeFile(rawPath) {
	if (!rawPath) return null;
	if (isFile(rawPath)) return rawPath;

	const m = /^(.*)[/\\]workshop[/\\]content[/\\]431960[/\\](\d+)(?:[/\\](.+))?$/i.exec(rawPath);
	if (!m) return null;
	const [, workspaceRoot, id, fileName] = m;
	const itemDir = join(workspaceRoot, "workshop", "downloads", "431960", id);

	if (fileName && isFile(join(itemDir, fileName))) return join(itemDir, fileName);
	let entries;
	try {
		entries = readdirSync(itemDir);
	} catch {
		return null;
	}
	for (const f of entries) {
		const p = join(itemDir, f);
		if (isFile(p) && IMAGE_EXTS.has(extname(f).toLowerCase())) return p;
	}
	return null;
}

/** Pick a static poster (preview.* / thumb*) from the item folder. */
export function staticImageFor(resolvedFile) {
	if (!resolvedFile) return null;
	const dir = dirname(resolvedFile);
	for (const name of PREVIEW_NAMES) {
		const p = join(dir, name);
		if (isFile(p)) return p;
	}
	let entries;
	try {
		entries = readdirSync(dir);
	} catch {
		return null;
	}
	for (const f of entries) {
		const lower = f.toLowerCase();
		if (lower.startsWith("preview.") || lower.startsWith("thumb")) {
			const p = join(dir, f);
			if (isFile(p) && IMAGE_EXTS.has(extname(f).toLowerCase())) return p;
		}
	}
	return null;
}

/**
 * Resolve the current wallpaper into something the client can display.
 *
 * @param {object} [options]
 * @param {NodeJS.ProcessEnv} [options.env]
 * @param {object} [options.config] Raw plugin config (normalized here).
 * @param {object|null} [options.locateResult] Precomputed findWeConfig() result.
 * @param {Function} [options.findConfig] Injectable locator (tests).
 * @returns {{kind: "video"|"image"|"none", file: string|null,
 *            trace: Array<{step: string, ok: boolean, detail?: string}>}}
 */
export function resolveMedia(options = {}) {
	const { env = process.env, config = {}, locateResult = null, findConfig = findWeConfig } = options;
	const cfg = normalizeConfig(config);
	const trace = [];
	const note = (step, ok, detail) => {
		trace.push(detail === undefined ? { step, ok } : { step, ok, detail });
	};

	if (cfg.weSync) {
		const we = locateResult ?? findConfig({ env, explicitPath: cfg.weConfigPath });
		if (we.explicitMissed) {
			note(
				"config-we-path",
				false,
				`${cfg.weConfigPath ?? "DSH_WALLPAPER_WE_CONFIG"} does not exist; fell back to auto-discovery`,
			);
		}
		note("locate-we", we.found, we.found ? `${we.source}:${we.configPath}` : `${we.tried.length} paths tried`);
		if (we.found) {
			const weCfg = readWeWallpaperConfig(we.configPath);
			note("read-we-config", Boolean(weCfg));
			const raw = weCfg ? pickWeWallpaperFile(weCfg, cfg.monitor) : null;
			note("select-wallpaper", Boolean(raw), raw ?? undefined);
			const resolved = raw ? resolveWeFile(raw) : null;
			note("resolve-file", Boolean(resolved), resolved ?? undefined);

			if (resolved) {
				const ext = extname(resolved).toLowerCase();
				if (PLAYABLE_VIDEO_EXTS.has(ext)) {
					if (cfg.videoLive) return { kind: "video", file: resolved, trace };
					// videoLive:false -> a still frame instead of a live decode
					const frame = extractVideoFrame(resolved, { env, pythonCmd: cfg.pythonCmd });
					note("video-frame", Boolean(frame), frame ?? "python/opencv unavailable");
					if (frame) return { kind: "image", file: frame, trace };
				}
				if (VIDEO_EXTS.has(ext)) {
					const frame = extractVideoFrame(resolved, { env, pythonCmd: cfg.pythonCmd });
					note("video-frame", Boolean(frame), frame ?? "python/opencv unavailable");
					if (frame) return { kind: "image", file: frame, trace };
				}
				if (IMAGE_EXTS.has(ext)) {
					// an image wallpaper is served as-is; 0.1.x fell through to the
					// preview poster here and could show a thumbnail instead
					note("image-file", true, resolved);
					return { kind: "image", file: resolved, trace };
				}
				if (SCENE_EXTS.has(ext)) {
					const support = sceneSupport({ repkgPath: cfg.repkgPath });
					note("scene-support", support.ok, support.reason ?? undefined);
					const bg = sceneExtractBackground(resolved, { env, repkgPath: cfg.repkgPath });
					note("scene-extract", Boolean(bg), bg ?? "unpack failed");
					if (bg) return { kind: "image", file: bg, trace };
				}
				const poster = staticImageFor(resolved);
				note("preview-poster", Boolean(poster), poster ?? undefined);
				if (poster) return { kind: "image", file: poster, trace };
			}
		}
	} else {
		note("locate-we", false, "weSync disabled in config");
	}

	if (cfg.image) {
		note("config-image", true, cfg.image);
		return { kind: "image", file: cfg.image, trace };
	}
	const dropIn = join(wallpaperDir(env), "image.png");
	if (isFile(dropIn)) {
		note("dropin-image", true, dropIn);
		return { kind: "image", file: dropIn, trace };
	}
	note("fallback", false, "no wallpaper: configure config.json image, drop image.png, or let WE sync find one");
	return { kind: "none", file: null, trace };
}
