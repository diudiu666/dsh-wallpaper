/**
 * Identity consistency: the package name, the cordis bundle row, the server
 * plugin's exported `name`, and the client bundle's `exports.name` must all
 * agree, because a drift between them is exactly what shipped 0.2.0 broken
 * (see the `client.js` regression in test/client.test.js).
 *
 * The HTTP route prefix and the DOM markers are deliberately NOT part of this
 * check: routes are a public API (`/dsh-wallpaper/...`) and the DOM markers are
 * internal selectors that must stay stable across upgrades so the previous
 * build's <style>/<video> can be refreshed in place instead of duplicated.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { name as serverPluginName } from "../lib/index.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (...parts) => readFileSync(join(root, ...parts), "utf8");
const pkg = JSON.parse(read("package.json"));

test("the server plugin exports the package name", () => {
	assert.equal(serverPluginName, pkg.name);
});

test("the client bundle exports the package name", () => {
	const source = read("lib", "client.js");
	const m = /exports\.name\s*=\s*"([^"]+)"/.exec(source);
	assert.ok(m, "lib/client.js must assign exports.name");
	assert.equal(m[1], pkg.name);
});

test("the bundle row names the package and keeps its stable row id", () => {
	const patch = read("cordis.patch.yml");
	const rowName = /^\s*-\s*id:\s*(\S+)\s*\n\s*name:\s*(\S+)/m.exec(patch);
	assert.ok(rowName, "cordis.patch.yml must insert a row with id and name");
	assert.equal(rowName[2], pkg.name, "the row's name is the module specifier, i.e. the package name");
	assert.equal(rowName[1], "dsh-wallpaper", "the row id stays stable so profile patches targeting it keep working");
});

test("the version is a plain semver triple (no channel suffix after release)", () => {
	assert.match(pkg.version, /^\d+\.\d+\.\d+$/);
});

test("the status document reports the package name", () => {
	const status = read("lib", "status.js");
	assert.ok(status.includes(`name: "${pkg.name}"`), "lib/status.js plugin.name must match package.json#name");
});
