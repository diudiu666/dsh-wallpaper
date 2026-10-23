/**
 * Video frame extraction for wallpapers Chromium cannot play (mov/avi/mkv/...).
 * Delegates to scripts/frame.py (python + opencv), caching the frame next to
 * the other wallpaper state so repeated requests do not re-decode the video.
 *
 * Optional by design: without python/opencv this returns null and the caller
 * falls back to the item's preview poster.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { homeDir } from "./config.js";

const HERE = dirname(fileURLToPath(import.meta.url));
export const FRAME_SCRIPT = join(HERE, "..", "scripts", "frame.py");

/** Stable cache filename for a video path. */
export function videoFrameCachePath(videoPath, env = process.env) {
	const hash = createHash("md5").update(videoPath.toLowerCase()).digest("hex").slice(0, 16);
	return join(homeDir(env), "wallpaper", "cache", `frame_${hash}.jpg`);
}

function isFile(p) {
	try {
		return statSync(p).isFile();
	} catch {
		return false;
	}
}

/**
 * Extract one frame from `videoPath` into the cache and return its path.
 * @param {string} videoPath
 * @param {{env?: NodeJS.ProcessEnv, pythonCmd?: string, timeoutMs?: number}} [options]
 * @returns {string|null} Path of the cached frame, or null on failure.
 */
export function extractVideoFrame(videoPath, options = {}) {
	const { env = process.env, pythonCmd = "python", timeoutMs = 20000 } = options;
	if (!videoPath || !isFile(videoPath)) return null;
	const out = videoFrameCachePath(videoPath, env);
	try {
		if (isFile(out) && statSync(out).mtimeMs >= statSync(videoPath).mtimeMs) return out;
	} catch {
		// no cache entry yet
	}
	const r = spawnSync(pythonCmd, [FRAME_SCRIPT, videoPath, out], {
		encoding: "utf8",
		timeout: timeoutMs,
		windowsHide: true,
		stdio: "ignore",
	});
	if (r.status === 0 && isFile(out)) return out;
	return null;
}
