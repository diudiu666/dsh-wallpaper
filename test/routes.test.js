/**
 * HTTP surface tests: the four routes are exercised through a real HTTP server,
 * with DSH_HOME pointed at a temp directory, so streaming and HEAD/Range
 * behaviour is covered rather than mocked.
 */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { apply } from "../lib/index.js";
import { serveVideo } from "../lib/serve.js";

let server;
let base;
let home;
let savedHome;
let videoServer;
let videoBase;
let videoFile;

const routes = [];

function listen(handler) {
	return new Promise((resolve) => {
		const s = createServer(handler);
		s.listen(0, "127.0.0.1", () => resolve(s));
	});
}

before(async () => {
	savedHome = process.env.DSH_HOME;
	home = mkdtempSync(join(tmpdir(), "dsh-wp-routes-"));
	process.env.DSH_HOME = home;
	mkdirSync(join(home, "wallpaper"), { recursive: true });
	writeFileSync(join(home, "wallpaper", "image.png"), "PNGDATA");
	// pin the chain to the drop-in image: without this the tests would follow the
	// developer machine's real Wallpaper Engine install
	writeFileSync(join(home, "wallpaper", "config.json"), JSON.stringify({ weSync: false }));

	const ctx = {
		effect(fn) {
			return fn();
		},
		webServer: {
			register(route) {
				routes.push(route);
			},
		},
	};
	apply(ctx);

	server = await listen((req, res) => {
		const path = req.url.split("?")[0];
		const route = routes.find((r) => r.path === path);
		if (!route) {
			res.writeHead(404);
			res.end("no route");
			return;
		}
		route.handler(req, res);
	});
	base = `http://127.0.0.1:${server.address().port}`;

	videoFile = join(home, "clip.mp4");
	writeFileSync(videoFile, Buffer.from("0123456789"));
	videoServer = await listen((req, res) => serveVideo(req, res, videoFile));
	videoBase = `http://127.0.0.1:${videoServer.address().port}`;
});

after(() => {
	server?.close();
	videoServer?.close();
	if (savedHome === undefined) delete process.env.DSH_HOME;
	else process.env.DSH_HOME = savedHome;
	rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
});

test("apply() registers the four documented routes", () => {
	assert.deepEqual(routes.map((r) => r.path).sort(), [
		"/dsh-wallpaper/status",
		"/dsh-wallpaper/wallpaper.mp4",
		"/dsh-wallpaper/wallpaper.png",
		"/dsh-wallpaper/wallpaper.type",
	]);
});

test("GET /dsh-wallpaper/wallpaper.png streams the drop-in image", async () => {
	const res = await fetch(`${base}/dsh-wallpaper/wallpaper.png`);
	assert.equal(res.status, 200);
	assert.equal(res.headers.get("content-type"), "image/png");
	assert.equal(await res.text(), "PNGDATA");
});

test("HEAD /dsh-wallpaper/wallpaper.png answers headers only", async () => {
	const res = await fetch(`${base}/dsh-wallpaper/wallpaper.png`, { method: "HEAD" });
	assert.equal(res.status, 200);
	assert.equal(res.headers.get("content-length"), "7");
	assert.equal(await res.text(), "");
});

test("GET /dsh-wallpaper/wallpaper.type reports image mode", async () => {
	const res = await fetch(`${base}/dsh-wallpaper/wallpaper.type`);
	const body = await res.json();
	assert.equal(body.kind, "image");
	assert.equal(body.url, "/dsh-wallpaper/wallpaper.png");
});

test("GET /dsh-wallpaper/status exposes version, WE discovery and the trace", async () => {
	const res = await fetch(`${base}/dsh-wallpaper/status`);
	assert.equal(res.status, 200);
	const status = await res.json();
	const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

	assert.equal(status.plugin.name, "dsh-wallpaper-diudiu");
	assert.equal(status.plugin.version, pkg.version);
	assert.equal(typeof status.we.found, "boolean");
	assert.ok(Array.isArray(status.we.tried));
	assert.ok(Array.isArray(status.trace) && status.trace.length > 0);
	assert.ok(["ok", "missing", "missing-opencv"].includes(status.tools.python));
	assert.ok(["image", "video", "none"].includes(status.selected.kind));
});

test("GET /dsh-wallpaper/wallpaper.mp4 404s when the wallpaper is an image", async () => {
	const res = await fetch(`${base}/dsh-wallpaper/wallpaper.mp4`);
	assert.equal(res.status, 404);
	assert.match(await res.text(), /no video wallpaper/);
});

test("serveVideo answers 206 with a content-range for Range requests", async () => {
	const res = await fetch(videoBase, { headers: { range: "bytes=2-5" } });
	assert.equal(res.status, 206);
	assert.equal(res.headers.get("content-range"), "bytes 2-5/10");
	assert.equal(res.headers.get("accept-ranges"), "bytes");
	assert.equal(await res.text(), "2345");
});

test("serveVideo answers 416 for an unsatisfiable range", async () => {
	const res = await fetch(videoBase, { headers: { range: "bytes=99-120" } });
	assert.equal(res.status, 416);
	assert.equal(res.headers.get("content-range"), "bytes */10");
});

test("no wallpaper configured: type says none and the image route explains itself", async () => {
	rmSync(join(home, "wallpaper", "image.png"));
	writeFileSync(join(home, "wallpaper", "config.json"), JSON.stringify({ weSync: false }));

	const type = await (await fetch(`${base}/dsh-wallpaper/wallpaper.type`)).json();
	assert.equal(type.kind, "none");

	const res = await fetch(`${base}/dsh-wallpaper/wallpaper.png`);
	assert.equal(res.status, 404);
	assert.match(await res.text(), /\/dsh-wallpaper\/status/);
});
