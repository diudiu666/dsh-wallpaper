/**
 * dsh-wallpaper-diudiu — server half.
 *
 * Serves the wallpaper to the DSH desktop client and explains itself when it
 * cannot. Resolution runs PER REQUEST, so switching wallpapers takes effect on
 * the next refresh.
 *
 * Resolution chain (first hit wins):
 *   1. Wallpaper Engine sync (default ON): locates WE's config.json (registry /
 *      libraryfolders.vdf / well-known paths / macOS & Linux layouts — see
 *      locate.js), picks the active wallpaper for the configured monitor, then
 *        - mp4 / webm -> served AS A VIDEO (the client plays it live)
 *        - mov/avi/mkv/... -> one extracted frame (python + opencv)
 *        - images -> served directly
 *        - scene.pkg -> unpacked via RePKG, best background texture
 *        - exe / anything else -> the item's preview.* poster
 *   2. Manual override: <DSH_HOME>/wallpaper/config.json -> { "image": "..." }
 *   3. Drop-in: <DSH_HOME>/wallpaper/image.png
 *   4. Nothing: the image route 404s, /status says why.
 *
 * Routes:
 *   GET /dsh-wallpaper/wallpaper.type  -> { kind: "video"|"image"|"none", url }
 *   GET /dsh-wallpaper/wallpaper.mp4   -> the video file (Range supported)
 *   GET /dsh-wallpaper/wallpaper.png   -> the static image (or a video frame)
 *   GET /dsh-wallpaper/status          -> diagnostics JSON (paste into issues)
 *
 * Config keys (all optional, in <DSH_HOME>/wallpaper/config.json):
 *   { "weSync": true,          // false -> skip WE, use image / image.png
 *     "weConfigPath": "...",   // override the auto-discovered WE config.json
 *     "monitor": "Monitor0",   // which WE monitor to follow (default: first)
 *     "videoLive": true,       // false -> still frame instead of live decode
 *     "pythonCmd": "python",   // interpreter for frame extraction
 *     "repkgPath": "..." }     // override the bundled RePKG.exe
 */
import { readPluginConfig } from "./config.js";
import { extractVideoFrame } from "./frame.js";
import { resolveMedia } from "./resolve.js";
import { sceneExtractBackground } from "./scene.js";
import { mimeFor, serveFile, serveVideo } from "./serve.js";
import { buildStatus } from "./status.js";

export const name = "dsh-wallpaper";
export const inject = ["webServer"];

export const ROUTE_IMAGE = "/dsh-wallpaper/wallpaper.png";
export const ROUTE_VIDEO = "/dsh-wallpaper/wallpaper.mp4";
export const ROUTE_TYPE = "/dsh-wallpaper/wallpaper.type";
export const ROUTE_STATUS = "/dsh-wallpaper/status";

function sendJson(res, body, status = 200) {
	res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-cache" });
	res.end(JSON.stringify(body));
}

/** Resolve the current wallpaper with fresh config on every call. */
function current() {
	return resolveMedia({ env: process.env, config: readPluginConfig() });
}

/** GET /dsh-wallpaper/wallpaper.type */
export function handleType(req, res) {
	const media = current();
	const url = media.kind === "video" ? ROUTE_VIDEO : ROUTE_IMAGE;
	sendJson(res, { kind: media.kind, url });
}

/** GET /dsh-wallpaper/wallpaper.png */
export function handleImage(req, res) {
	const media = current();
	if (media.kind === "video") {
		// static fallback for a live-video wallpaper (cached frame)
		const frame = extractVideoFrame(media.file, {
			env: process.env,
			pythonCmd: readPluginConfig().pythonCmd,
		});
		if (frame) return serveFile(req, res, frame, "image/jpeg");
		res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
		res.end("no static image for this video wallpaper");
		return;
	}
	if (media.kind === "image") return serveFile(req, res, media.file, mimeFor(media.file));
	res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
	res.end("no wallpaper configured - see /dsh-wallpaper/status");
}

/** GET /dsh-wallpaper/wallpaper.mp4 */
export function handleVideo(req, res) {
	const media = current();
	if (media.kind === "video") return serveVideo(req, res, media.file);
	res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
	res.end("no video wallpaper");
}

/** GET /dsh-wallpaper/status */
export function handleStatus(req, res) {
	sendJson(res, buildStatus({ env: process.env }));
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
						} catch {
							// a wallpaper error must never take the host server down
							try {
								res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
								res.end("wallpaper error");
							} catch {
								// response already gone
							}
						}
					},
				}),
			`dsh-wallpaper: ${path}`,
		);

	registerRoute(ROUTE_TYPE, handleType);
	registerRoute(ROUTE_IMAGE, handleImage);
	registerRoute(ROUTE_VIDEO, handleVideo);
	registerRoute(ROUTE_STATUS, handleStatus);
}

/* Dev self-tests (node lib/index.js):
 *   DSH_WALLPAPER_SELFTEST=1                       -> resolved media + trace
 *   DSH_WALLPAPER_SELFTEST_MONITOR=Monitor1        -> follow a specific monitor
 *   DSH_WALLPAPER_SELFTEST_VIDEO=<path>            -> frame extraction
 *   DSH_WALLPAPER_SELFTEST_SCENE=<path>            -> scene unpacking
 *   DSH_WALLPAPER_SELFTEST_STATUS=1                -> the whole status document
 */
if (process.env.DSH_WALLPAPER_SELFTEST) {
	const media = resolveMedia({
		env: process.env,
		config: { ...readPluginConfig(), monitor: process.env.DSH_WALLPAPER_SELFTEST_MONITOR || undefined },
	});
	console.log("[dsh-wallpaper selftest] media:", JSON.stringify({ kind: media.kind, file: media.file }));
	for (const step of media.trace) console.log("  -", step.step, step.ok ? "ok" : "MISS", step.detail ?? "");
}
if (process.env.DSH_WALLPAPER_SELFTEST_STATUS) {
	console.log("[dsh-wallpaper selftest] status:", JSON.stringify(buildStatus({ env: process.env }), null, 2));
}
if (process.env.DSH_WALLPAPER_SELFTEST_VIDEO) {
	console.log(
		"[dsh-wallpaper selftest-video] frame:",
		extractVideoFrame(process.env.DSH_WALLPAPER_SELFTEST_VIDEO, { env: process.env }),
	);
}
if (process.env.DSH_WALLPAPER_SELFTEST_SCENE) {
	console.log(
		"[dsh-wallpaper selftest-scene] bg:",
		sceneExtractBackground(process.env.DSH_WALLPAPER_SELFTEST_SCENE, { env: process.env }),
	);
}
