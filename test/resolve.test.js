/**
 * Resolution-chain tests: WE config parsing, workshop/downloads fallback, and
 * the "no wallpaper" outcome (which must be `none`, never a machine-specific
 * absolute path).
 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import {
	pickWeWallpaperFile,
	readWeWallpaperConfig,
	resolveMedia,
	resolveWeFile,
} from "../lib/resolve.js";

const cleanups = [];
after(() => {
	for (const dir of cleanups) rmSync(dir, { recursive: true, force: true });
});

function tempDir() {
	const dir = mkdtempSync(join(tmpdir(), "dsh-wp-resolve-"));
	cleanups.push(dir);
	return dir;
}

function writeWeConfig(dir, wallpaperFile) {
	const path = join(dir, "config.json");
	writeFileSync(
		path,
		JSON.stringify({
			"?installdirectory": dir,
			"76561197960287930": {
				general: {
					wallpaperconfig: {
						selectedwallpapers: {
							Monitor0: { file: wallpaperFile },
							Monitor1: { file: `${wallpaperFile}#m1` },
						},
					},
				},
			},
		}),
	);
	return path;
}

test("readWeWallpaperConfig ignores the ? metadata keys", () => {
	const weDir = tempDir();
	const configPath = writeWeConfig(weDir, "D:\\wall\\a.mp4");
	const cfg = readWeWallpaperConfig(configPath);
	assert.equal(cfg.selectedwallpapers.Monitor0.file, "D:\\wall\\a.mp4");
});

test("readWeWallpaperConfig tolerates a BOM and returns null on garbage", () => {
	const weDir = tempDir();
	const path = join(weDir, "config.json");
	writeFileSync(path, "\uFEFF" + JSON.stringify({ "1": { general: { wallpaperconfig: { selectedwallpapers: { Monitor0: { file: "x.png" } } } } } }));
	assert.equal(readWeWallpaperConfig(path).selectedwallpapers.Monitor0.file, "x.png");

	const broken = join(weDir, "broken.json");
	writeFileSync(broken, "{not json");
	assert.equal(readWeWallpaperConfig(broken), null);
});

test("pickWeWallpaperFile follows the configured monitor then falls back", () => {
	const cfg = { selectedwallpapers: { Monitor0: { file: "a.mp4" }, Monitor1: { file: "b.mp4" } } };
	assert.equal(pickWeWallpaperFile(cfg, "Monitor1"), "b.mp4");
	assert.equal(pickWeWallpaperFile(cfg, "Monitor9"), "a.mp4");
	assert.equal(pickWeWallpaperFile({}, "Monitor0"), null);
	assert.equal(pickWeWallpaperFile(null, null), null);
});

test("resolveWeFile falls back to workshop/downloads/<id>", () => {
	const steamApps = tempDir();
	const itemDir = join(steamApps, "workshop", "downloads", "431960", "123456");
	mkdirSync(itemDir, { recursive: true });
	const image = join(itemDir, "preview.png");
	writeFileSync(image, "png");

	const raw = join(steamApps, "workshop", "content", "431960", "123456", "scene.pkg");
	assert.equal(resolveWeFile(raw), image);
});

test("resolveWeFile returns the exact path when it exists", () => {
	const steamApps = tempDir();
	const itemDir = join(steamApps, "workshop", "content", "431960", "777");
	mkdirSync(itemDir, { recursive: true });
	const video = join(itemDir, "wallpaper.mp4");
	writeFileSync(video, "mp4");
	assert.equal(resolveWeFile(video), video);
});

test("resolveMedia falls back to config.image and reports the step", () => {
	const env = { DSH_HOME: tempDir() };
	const image = join(tempDir(), "wall.png");
	writeFileSync(image, "png");

	const media = resolveMedia({
		env,
		config: { weSync: false, image },
		locateResult: { found: false, configPath: null, source: null, installDir: null, libraries: [], tried: [] },
	});
	assert.equal(media.kind, "image");
	assert.equal(media.file, image);
	assert.ok(media.trace.some((s) => s.step === "config-image" && s.ok === true));
});

test("resolveMedia returns kind none when nothing is configured", () => {
	const env = { DSH_HOME: tempDir() };
	const media = resolveMedia({
		env,
		config: { weSync: false },
		locateResult: { found: false, configPath: null, source: null, installDir: null, libraries: [], tried: [] },
	});
	assert.equal(media.kind, "none");
	assert.equal(media.file, null);
	const fallback = media.trace.find((s) => s.step === "fallback");
	assert.equal(fallback.ok, false);
});

test("resolveMedia resolves a WE image wallpaper end to end", () => {
	const weDir = tempDir();
	const pictures = tempDir();
	const wallpaper = join(pictures, "a.png");
	writeFileSync(wallpaper, "png");
	const configPath = writeWeConfig(weDir, wallpaper);

	const media = resolveMedia({
		env: { DSH_HOME: tempDir() },
		config: {},
		locateResult: { found: true, configPath, source: "library", installDir: weDir, libraries: [weDir], tried: [configPath] },
	});
	assert.equal(media.kind, "image");
	assert.equal(media.file, wallpaper);
	assert.ok(media.trace.some((s) => s.step === "locate-we" && s.ok === true));
});
