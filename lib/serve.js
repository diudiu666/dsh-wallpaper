/**
 * HTTP file serving for the wallpaper routes: plain files (images) and media
 * with HTTP Range support (the <video> element needs it for seeking and for
 * Chromium to stream large files incrementally).
 */
import { createReadStream, statSync } from "node:fs";
import { extname } from "node:path";

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

/** Content type for a static image path. */
export function mimeFor(file) {
	return MIME_BY_EXT[extname(file).toLowerCase()] || "image/png";
}

function notFound(res, message = "wallpaper not found") {
	res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
	res.end(message);
}

/** Serve a static file with HEAD support and no caching. */
export function serveFile(req, res, file, contentType = mimeFor(file)) {
	let stat;
	try {
		stat = statSync(file);
	} catch {
		// handled below
	}
	if (!stat?.isFile()) return notFound(res);
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

/** Serve a video file with byte-range support. */
export function serveVideo(req, res, file) {
	let stat;
	try {
		stat = statSync(file);
	} catch {
		// handled below
	}
	if (!stat?.isFile()) return notFound(res);
	const mime = VIDEO_MIME_BY_EXT[extname(file).toLowerCase()] || "video/mp4";
	const total = stat.size;
	const range = typeof req.headers?.range === "string" ? req.headers.range : null;

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
