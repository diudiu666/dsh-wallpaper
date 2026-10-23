/**
 * Locator tests: VDF parsing and candidate ordering.
 *
 * These run on Windows and Linux in CI, so every expectation is built with
 * `path.join` instead of hardcoded separators.
 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { findWeConfig, normalizePath, parseVdfPaths } from "../lib/locate.js";

const WE_CONFIG = ["steamapps", "common", "wallpaper_engine", "config.json"];
const cleanups = [];
after(() => {
	for (const dir of cleanups) rmSync(dir, { recursive: true, force: true });
});

function tempDir() {
	const dir = mkdtempSync(join(tmpdir(), "dsh-wp-"));
	cleanups.push(dir);
	return dir;
}

test("parseVdfPaths reads the modern `path` keys", () => {
	const vdf = `
"libraryfolders"
{
	"0"
	{
		"path"		"C:\\\\Program Files (x86)\\\\Steam"
		"label"		""
	}
	"1"
	{
		"path"		"D:\\\\SteamLibrary"
	}
}`;
	assert.deepEqual(parseVdfPaths(vdf), ["C:\\Program Files (x86)\\Steam", "D:\\SteamLibrary"]);
});

test("parseVdfPaths falls back to numbered keys and de-duplicates", () => {
	const vdf = `"libraryfolders" { "1" "D:\\\\SteamLibrary" "2" "E:\\\\Games" "3" "D:\\\\SteamLibrary" }`;
	assert.deepEqual(parseVdfPaths(vdf), ["D:\\SteamLibrary", "E:\\Games"]);
});

test("parseVdfPaths keeps POSIX library paths intact", () => {
	const vdf = `"libraryfolders" { "0" { "path" "/home/x/.steam/steam" } }`;
	assert.deepEqual(parseVdfPaths(vdf), ["/home/x/.steam/steam"]);
});

test("findWeConfig honours an explicit weConfigPath first", () => {
	const root = tempDir();
	const configPath = join(root, ...WE_CONFIG);
	mkdirSync(join(configPath, ".."), { recursive: true });
	writeFileSync(configPath, "{}");

	const found = findWeConfig({
		platform: "win32",
		env: {},
		explicitPath: root,
		regQuery: () => null,
		extraRoots: [],
	});
	assert.equal(found.found, true);
	assert.equal(found.source, "config");
	assert.equal(found.configPath, configPath);
});

test("findWeConfig reports a Steam library listed in libraryfolders.vdf", () => {
	const steamRoot = tempDir();
	const libraryRoot = tempDir();
	mkdirSync(join(steamRoot, "steamapps"), { recursive: true });
	writeFileSync(
		join(steamRoot, "steamapps", "libraryfolders.vdf"),
		`"libraryfolders" { "0" { "path" "${steamRoot.replace(/\\/g, "\\\\")}" } "1" { "path" "${libraryRoot.replace(/\\/g, "\\\\")}" } }`,
	);
	// WE only lives in the second library — the classic "Steam on D:" case
	const configPath = join(libraryRoot, ...WE_CONFIG);
	mkdirSync(join(configPath, ".."), { recursive: true });
	writeFileSync(configPath, "{}");

	const found = findWeConfig({
		// linux keeps the host's real Windows default paths out of the candidate
		// list, so this test cannot accidentally match a developer machine
		platform: "linux",
		env: {},
		explicitPath: null,
		regQuery: () => null,
		extraRoots: [steamRoot],
	});
	assert.equal(found.found, true);
	assert.equal(found.configPath, configPath);
	assert.ok(found.libraries.some((lib) => lib === libraryRoot), "library roots include the VDF entry");
});

test("findWeConfig uses the registry root when it exists", () => {
	const root = tempDir();
	const configPath = join(root, ...WE_CONFIG);
	mkdirSync(join(configPath, ".."), { recursive: true });
	writeFileSync(configPath, "{}");

	const found = findWeConfig({
		platform: "win32",
		env: {},
		regQuery: (key, value) => (value === "SteamPath" ? root : null),
		extraRoots: [],
	});
	assert.equal(found.found, true);
	assert.equal(found.configPath, configPath);
});

test("findWeConfig reports not-found with the attempted paths instead of guessing", () => {
	const found = findWeConfig({
		platform: "linux",
		env: {},
		explicitPath: null,
		regQuery: () => null,
		extraRoots: [join(tmpdir(), "definitely-not-there")],
	});
	assert.equal(found.found, false);
	assert.equal(found.configPath, null);
	assert.equal(found.installDir, null);
	assert.ok(found.tried.length > 0, "failed probes are listed for /status");
});

test("normalizePath trims quotes and rejects empty values", () => {
	assert.equal(normalizePath(null), null);
	assert.equal(normalizePath("   "), null);
	assert.equal(normalizePath('"D:\\Steam"'), "D:\\Steam");
});
