/**
 * Browser-bundle identity: the harness serves one client module row per
 * package, keyed by the package name, and `lib/client.js` answers that row by
 * registering the factory under the `id` it passes to
 * `window.__ModuleLoader__.load`. When the two disagree the row is never
 * answered, the loader replays the script, and the replay trips the module
 * system's duplicate-registration guard — which fails the whole entry at boot
 * (`web boot: 1 entry did not activate`). A one-line mistake with a total
 * failure mode, so it is asserted here instead of on a user's machine.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const source = readFileSync(join(root, "lib", "client.js"), "utf8");

const LOAD_CALL = /window\.__ModuleLoader__\.load\(\s*\{\s*id:\s*"([^"]+)"/g;

test("the client bundle registers under the package name", () => {
	const ids = [...source.matchAll(LOAD_CALL)].map((match) => match[1]);
	assert.equal(ids.length, 1, "lib/client.js must register exactly one factory");
	assert.equal(
		ids[0],
		pkg.name,
		"the harness keys the module row by the package name, so the bundle must register that exact id",
	);
});

test("the package points the harness at the bundle that registers", () => {
	assert.equal(pkg.dsh?.client?.platform, "web", "a client plugin declares dsh.client.platform");
	assert.deepEqual(
		pkg.exports?.["./client"],
		{ default: "./lib/client.js" },
		"the ./client export must resolve to lib/client.js, the file asserted above",
	);
});
