/**
 * dsh-wallpaper — server half.
 *
 * Serves the wallpaper to the desktop client. Resolution is done PER REQUEST,
 * so switching wallpapers takes effect on the next refresh.
 *
 * Resolution chain (first hit wins):
 *   1. Wallpaper Engine sync (default ON): reads <WE install>\config.json,
 *      picks the active wallpaper for the configured monitor, then
 *        - mp4 / webm  -> served AS A VIDEO (the client plays it live)
 *        - other videos (mov/avi/mkv/...) -> one extracted frame via python
 *          + opencv, cached in <DSH_HOME>\wallpaper\cache\
 *        - images      -> served directly
 *        - scene.pkg / exe -> the item's preview.* poster image
 *   2. Manual override:  <DSH_HOME>\wallpaper\config.json -> { "image": "..." }
 *   3. Drop-in:          <DSH_HOME>\wallpaper\image.png
 *   4. Built-in default picture
 *
 * Routes:
 *   GET /dsh-wallpaper/wallpaper.type  -> { kind: "video"|"image", url }
 *   GET /dsh-wallpaper/wallpaper.mp4   -> the video file (Range supported)
 *   GET /dsh-wallpaper/wallpaper.png   -> the static image (or a video frame)
 *
 * Plugin config keys (all optional, in <DSH_HOME>\wallpaper\config.json):
 *   { "weSync": true,            // false 关闭 Wallpaper Engine 同步
 *     "weConfigPath": "...",     // 覆盖 WE config.json 的路径
 *     "monitor": "Monitor0",     // 跟随 WE 的哪个显示器（缺省取第一个）
 *     "pythonCmd": "python" }    // 非 mp4/webm 视频抽帧用的 python 解释器
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const name = "dsh-wallpaper";
export const inject = ["webServer"];

const DEFAULT_IMAGE = "C:\\Users\\diu\\Pictures\\111111\\3ff502b2-0755-446e-8f47-aec55342648a.png";
const ROUTE_IMAGE = "/dsh-wallpaper/wallpaper.png";
const ROUTE_VIDEO = "/dsh-wallpaper/wallpaper.mp4";
const ROUTE_TYPE = "/dsh-wallpaper/wallpaper.type";
const WE_CONFIG_DEFAULT = "C:\\Program Files (x86)\\Steam\\steamapps\\common\\wallpaper_engine\\config.json";

/** extensions the Chromium client can play natively (H.264/VP8/VP9) */
const PLAYABLE_VIDEO_EXTS = new Set([".mp4", ".webm"]);
/** anything video-ish that can at least be frame-extracted */
const VIDEO_EXTS = new Set([".mp4", ".webm", ".mov", ".avi", ".mkv", ".m4v"]);
/** Wallpaper Engine scene packages (encrypted containers, extractable via RePKG) */
const SCENE_EXTS = new Set([".pkg"]);
const IMAGE_EXTS = new Set([".jpg", ".jpeg", ".png", ".webp", ".bmp", ".gif"]);
const PREVIEW_NAMES = [
	"preview.jpg", "preview.png", "preview.jpeg", "preview.webp", "preview.gif",
	"thumbnail.jpg", "thumbnail.png",
];
/** filename hints (case-insensitive substring) that mark a texture as the scene background */
const SCENE_BG_KEYWORDS = ["背景", "bg", "background", "backdrop"];
const MIME_BY_EXT = {
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".webp": "image/webp",
	".gif": "image/gif",
	".bmp": "image/bmp",
};
const VIDEO_MIME_BY_EXT = {
	".mp4": "video/mp4",
	".webm": "video/webm",
};

const FRAME_SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "..", "scripts", "frame.py");
const REPKG_EXE = join(dirname(fileURLToPath(import.meta.url)), "..", "scripts", "repkg", "RePKG.exe");

function homeDir() {
	return process.env.DSH_HOME || join(homedir(), ".dsh");
}

function readJsonStrict(file) {
	const text = readFileSync(file, "utf8").replace(/^\uFEFF/, ""); // strip BOM if present
	return JSON.parse(text);
}

function readPluginConfig() {
	try {
		return readJsonStrict(join(homeDir(), "wallpaper", "config.json"));
	} catch {
		return {};
	}
}

function isFile(p) {
	try {
		return statSync(p).isFile();
	} catch {
		return false;
	}
}

/* ---------------- Wallpaper Engine sync ---------------- */

function readWeWallpaperConfig(cfg) {
	const wePath =
		typeof cfg?.weConfigPath === "string" && cfg.weConfigPath.length > 0
			? cfg.weConfigPath
			: WE_CONFIG_DEFAULT;
	let parsed;
	try {
		parsed = readJsonStrict(wePath);
	} catch {
		return null; // WE not installed / config not written yet -> manual mode
	}
	// user key: anything not starting with "?" ("?installdirectory" etc.)
	const userKey = Object.keys(parsed).find((k) => !k.startsWith("?"));
	if (!userKey) return null;
	return parsed[userKey]?.general?.wallpaperconfig ?? null;
}

function pickWeWallpaperFile(weWallpaperConfig, monitor) {
	const sel = weWallpaperConfig?.selectedwallpapers;
	if (!sel) return null;
	if (monitor && typeof sel[monitor]?.file === "string") return sel[monitor].file;
	const first = Object.keys(sel)[0];
	return first && typeof sel[first].file === "string" ? sel[first].file : null;
}

/**
 * WE's config.json points at workshop\content\... but the file often lives in
 * workshop\downloads\... -> try the exact path, then the downloads twin, then
 * locate the item folder by id and pick any image inside it.
 */
function resolveWeFile(rawPath) {
	if (!rawPath) return null;
	if (isFile(rawPath)) return rawPath;

	const idMatch = rawPath.match(/431960[/\\](\d+)([/\\][^/\\]+)?$/);
	if (idMatch) {
		const id = idMatch[1];
		const name = idMatch[2] ? idMatch[2].slice(1) : null;
		const steamRoot = rawPath.split(/workshop[/\\]content[/\\]431960[/\\]/)[0];
		if (steamRoot) {
			const itemDir = steamRoot + "\\workshop\\downloads\\431960\\" + id;
			if (name && isFile(join(itemDir, name))) return join(itemDir, name);
			try {
				for (const f of readdirSync(itemDir)) {
					const p = join(itemDir, f);
					if (isFile(p) && IMAGE_EXTS.has(extname(f).toLowerCase())) return p;
				}
			} catch {
				// item dir missing
			}
		}
	}
	return null;
}

/* ---------------- video frame extraction (non-playable videos) ---------------- */

function videoFrameCachePath(videoPath) {
	const hash = createHash("md5").update(videoPath.toLowerCase()).digest("hex").slice(0, 16);
	return join(homeDir(), "wallpaper", "cache", "frame_" + hash + ".jpg");
}

/**
 * Extract one frame from a video (mov/avi/mkv/...) via python + opencv and cache
 * it. mp4/webm are served live instead and never go through here.
 */
function extractVideoFrame(videoPath) {
	if (!isFile(videoPath)) return null;
	const out = videoFrameCachePath(videoPath);
	try {
		if (isFile(out) && statSync(out).mtimeMs >= statSync(videoPath).mtimeMs) {
			return out; // cache is fresh
		}
	} catch {
		// no cache yet
	}
	const cfg = readPluginConfig();
	const python = typeof cfg?.pythonCmd === "string" && cfg.pythonCmd.length > 0 ? cfg.pythonCmd : "python";
	const r = spawnSync(python, [FRAME_SCRIPT, videoPath, out], {
		encoding: "utf8",
		timeout: 20000,
		windowsHide: true,
		stdio: "ignore",
	});
	if (r.status === 0 && isFile(out)) return out;
	return null;
}

/* ---------------- scene.pkg extraction (3D/2D scene wallpapers) ---------------- */

/** PNG width/height by parsing the IHDR chunk — no image library needed. */
function pngDimensions(file) {
	try {
		const buf = readFileSync(file).subarray(0, 24);
		if (buf.length < 24 || buf.readUInt32BE(0) !== 0x89504e47) return null; // not a png
		return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
	} catch {
		return null;
	}
}

function listPngs(dir, out = [], depth = 0) {
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
			// masks/effects are not candidate backgrounds
			if (e.name === "masks" || e.name === "effects") continue;
			listPngs(p, out, depth + 1);
		} else if (e.name.toLowerCase().endsWith(".png")) {
			out.push(p);
		}
	}
	return out;
}

/**
 * Pick the best static background out of a freshly extracted scene folder:
 * prefers textures whose name hints "background", otherwise the largest one.
 */
function pickSceneBackground(cacheDir) {
	const pngs = listPngs(cacheDir);
	if (pngs.length === 0) return null;
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
 * Extract a scene.pkg (via the bundled RePKG.exe) into a cache dir and return
 * the best background texture as a png. Re-extracts only when the pkg changes.
 * Returns null on failure (caller falls back to preview.* posters).
 */
export function sceneExtractBackground(pkgPath) {
	if (!isFile(pkgPath)) return null;
	const hash = createHash("md5").update(pkgPath.toLowerCase()).digest("hex").slice(0, 16);
	const cacheDir = join(homeDir(), "wallpaper", "cache", "scene_" + hash);
	const metaPath = join(cacheDir, "meta.json");
	let st;
	try {
		st = statSync(pkgPath);
	} catch {
		return null;
	}
	// cache valid when the pkg hasn't changed since extraction
	let valid = false;
	try {
		const meta = readJsonStrict(metaPath);
		valid = meta.pkgMtime === st.mtimeMs && meta.pkgSize === st.size;
	} catch {
		// no meta yet
	}
	if (valid) {
		const cached = pickSceneBackground(cacheDir);
		if (cached) return cached;
	}
	try {
		mkdirSync(cacheDir, { recursive: true });
	} catch {
		// cache dir unwritable -> extraction will fail below anyway
	}
	const r = spawnSync(REPKG_EXE, ["extract", "-o", cacheDir, pkgPath], {
		timeout: 120000,
		windowsHide: true,
		stdio: "ignore",
	});
	if (r.error) return null;
	const bg = pickSceneBackground(cacheDir);
	if (bg) {
		try {
			writeFileSync(metaPath, JSON.stringify({ pkgMtime: st.mtimeMs, pkgSize: st.size }));
		} catch {
			// meta write failed -> just re-extract next time
		}
		return bg;
	}
	return null;
}

/** Pick a static image (preview.* poster) for a non-image, non-video file. */
function staticImageFor(resolvedFile) {
	if (!resolvedFile) return null;
	const dir = dirname(resolvedFile);
	for (const name of PREVIEW_NAMES) {
		const p = join(dir, name);
		if (isFile(p)) return p;
	}
	// any preview.* / thumb* file in the item folder
	try {
		for (const f of readdirSync(dir)) {
			const lower = f.toLowerCase();
			if (lower.startsWith("preview.") || lower.startsWith("thumb")) {
				const p = join(dir, f);
				if (isFile(p) && IMAGE_EXTS.has(extname(f).toLowerCase())) return p;
			}
		}
	} catch {
		// no dir
	}
	return null;
}

/* ---------------- resolution chain ---------------- */

/**
 * Resolve the current wallpaper into something the client can display:
 *   { kind: "video", file }  — playable video (mp4/webm)
 *   { kind: "image", file }  — any static image
 */
export function resolveMedia(monitorOverride) {
	const cfg = readPluginConfig();
	const monitor = monitorOverride || cfg?.monitor;

	if (cfg?.weSync !== false) {
		try {
			const weCfg = readWeWallpaperConfig(cfg);
			const weFile = weCfg ? pickWeWallpaperFile(weCfg, monitor) : null;
			const resolved = weFile ? resolveWeFile(weFile) : null;
			if (resolved) {
				const ext = extname(resolved).toLowerCase();
				if (PLAYABLE_VIDEO_EXTS.has(ext)) {
					if (cfg?.videoLive !== false) {
						return { kind: "video", file: resolved };
					}
					// videoLive:false -> 不实时播放（省 GPU/显存，防闪退），抽帧当高清静态图
					const frame = extractVideoFrame(resolved);
					if (frame) return { kind: "image", file: frame };
				}
				if (VIDEO_EXTS.has(ext)) {
					const frame = extractVideoFrame(resolved); // mov/avi/mkv/... -> frame
					if (frame) return { kind: "image", file: frame };
				}
				if (SCENE_EXTS.has(ext)) {
					// scene.pkg -> unpack via RePKG and serve the best background texture
					const bg = sceneExtractBackground(resolved);
					if (bg) return { kind: "image", file: bg };
				}
				const image = staticImageFor(resolved);
				if (image) return { kind: "image", file: image };
			}
		} catch {
			// WE sync is best-effort; fall through to manual mode
		}
	}

	if (typeof cfg?.image === "string" && cfg.image.length > 0) return { kind: "image", file: cfg.image };
	const dropIn = join(homeDir(), "wallpaper", "image.png");
	if (isFile(dropIn)) return { kind: "image", file: dropIn };
	return { kind: "image", file: DEFAULT_IMAGE };
}

function mimeFor(file) {
	return MIME_BY_EXT[extname(file).toLowerCase()] || "image/png";
}

/* ---------------- HTTP serving ---------------- */

function serveFile(req, res, file, contentType) {
	let stat;
	try {
		stat = statSync(file);
	} catch {
		// not found below
	}
	if (!stat?.isFile()) {
		res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
		res.end("wallpaper not found");
		return;
	}
	if (req.method === "HEAD") {
		res.writeHead(200, {
			"content-type": contentType,
			"content-length": String(stat.size),
			"cache-control": "no-cache",
		});
		res.end();
		return;
	}
	res.writeHead(200, {
		"content-type": contentType,
		"content-length": String(stat.size),
		"cache-control": "no-cache",
	});
	const stream = createReadStream(file);
	stream.on("error", () => res.destroy());
	stream.pipe(res);
}

/** Serve a video with HTTP Range support (required for <video> seeking). */
export function serveVideo(req, res, file) {
	let stat;
	try {
		stat = statSync(file);
	} catch {
		// not found below
	}
	if (!stat?.isFile()) {
		res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
		res.end("wallpaper not found");
		return;
	}
	const mime = VIDEO_MIME_BY_EXT[extname(file).toLowerCase()] || "video/mp4";
	const total = stat.size;
	const range = typeof req.headers.range === "string" ? req.headers.range : null;

	if (range) {
		const m = /bytes=(\d*)-(\d*)/.exec(range);
		let start = m && m[1] !== "" ? parseInt(m[1], 10) : 0;
		let end = m && m[2] !== "" ? parseInt(m[2], 10) : total - 1;
		if (!Number.isFinite(start) || start < 0) start = 0;
		if (!Number.isFinite(end) || end >= total) end = total - 1;
		if (start > end || start >= total) {
			res.writeHead(416, { "content-range": `bytes */${total}` });
			res.end();
			return;
		}
		res.writeHead(206, {
			"content-type": mime,
			"content-range": `bytes ${start}-${end}/${total}`,
			"content-length": String(end - start + 1),
			"accept-ranges": "bytes",
			"cache-control": "no-cache",
		});
		if (req.method === "HEAD") {
			res.end();
			return;
		}
		const stream = createReadStream(file, { start, end });
		stream.on("error", () => res.destroy());
		stream.pipe(res);
		return;
	}

	if (req.method === "HEAD") {
		res.writeHead(200, {
			"content-type": mime,
			"content-length": String(total),
			"accept-ranges": "bytes",
			"cache-control": "no-cache",
		});
		res.end();
		return;
	}
	res.writeHead(200, {
		"content-type": mime,
		"content-length": String(total),
		"accept-ranges": "bytes",
		"cache-control": "no-cache",
	});
	const stream = createReadStream(file);
	stream.on("error", () => res.destroy());
	stream.pipe(res);
}

export function apply(ctx) {
	const registerRoute = (path, handler) =>
		ctx.effect(
			() =>
				ctx.webServer.register({
					kind: "exact",
					path,
					handler: async (req, res) => {
						try {
							await handler(req, res);
						} catch (err) {
							// never let a wallpaper error crash the server
							try {
								res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
								res.end("wallpaper error");
							} catch {
								// res already gone
							}
						}
					},
				}),
			`dsh-wallpaper: ${path}`,
		);

	// type probe: tells the client whether to build a <video> or keep the CSS image
	registerRoute(ROUTE_TYPE, (req, res) => {
		const media = resolveMedia();
		const url = media.kind === "video" ? ROUTE_VIDEO : ROUTE_IMAGE;
		res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-cache" });
		res.end(JSON.stringify({ kind: media.kind, url }));
	});

	// live video wallpaper
	registerRoute(ROUTE_VIDEO, (req, res) => {
		const media = resolveMedia();
		if (media.kind === "video") return serveVideo(req, res, media.file);
		res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
		res.end("no video wallpaper");
	});

	// static image (or a video frame when the current wallpaper is a video)
	registerRoute(ROUTE_IMAGE, (req, res) => {
		const media = resolveMedia();
		if (media.kind === "video") {
			const frame = extractVideoFrame(media.file); // cached frame fallback
			if (frame) return serveFile(req, res, frame, "image/jpeg");
			res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
			res.end("no image wallpaper");
			return;
		}
		serveFile(req, res, media.file, mimeFor(media.file));
	});
}

// Dev self-tests:
//   DSH_WALLPAPER_SELFTEST=1 node <this file>                      -> resolved media
//   DSH_WALLPAPER_SELFTEST=1 DSH_WALLPAPER_SELFTEST_MONITOR=Monitor1 node ...  -> video branch
//   DSH_WALLPAPER_SELFTEST_VIDEO=<video path> node <this file>     -> frame extraction
//   DSH_WALLPAPER_SELFTEST_SCENE=<scene.pkg path> node <this file> -> scene unpacking
if (process.env.DSH_WALLPAPER_SELFTEST) {
	console.log(
		"[dsh-wallpaper selftest] media:",
		JSON.stringify(resolveMedia(process.env.DSH_WALLPAPER_SELFTEST_MONITOR)),
	);
}
if (process.env.DSH_WALLPAPER_SELFTEST_VIDEO) {
	console.log("[dsh-wallpaper selftest-video] frame:", extractVideoFrame(process.env.DSH_WALLPAPER_SELFTEST_VIDEO));
}
if (process.env.DSH_WALLPAPER_SELFTEST_SCENE) {
	console.log("[dsh-wallpaper selftest-scene] bg:", sceneExtractBackground(process.env.DSH_WALLPAPER_SELFTEST_SCENE));
}
if (process.env.DSH_WALLPAPER_SELFTEST_VIDEO) {
	console.log("[dsh-wallpaper selftest-video] frame:", extractVideoFrame(process.env.DSH_WALLPAPER_SELFTEST_VIDEO));
}
