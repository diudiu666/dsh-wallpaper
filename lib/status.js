/**
 * Diagnostics behind GET /dsh-wallpaper/status.
 *
 * Open-source reality: most "wallpaper does not show up" reports come from a
 * Wallpaper Engine install or a python that is not where the code assumed.
 * The status document states exactly what was found, what was tried, and which
 * optional tool is missing, so a bug report can be triaged from one paste.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { homeDir, normalizeConfig, readPluginConfig, wallpaperDir } from "./config.js";
import { findWeConfig } from "./locate.js";
import { resolveMedia } from "./resolve.js";
import { sceneSupport } from "./scene.js";

const HERE = dirname(fileURLToPath(import.meta.url));

/** Plugin version, read from the package manifest. */
export function pluginVersion() {
	try {
		return JSON.parse(readFileSync(join(HERE, "..", "package.json"), "utf8")).version ?? "0.0.0";
	} catch {
		return "0.0.0";
	}
}

const pythonCache = new Map();

/**
 * Probe `pythonCmd` for opencv once per process.
 * @returns {"ok"|"missing"|"missing-opencv"}
 */
export function checkPython(pythonCmd = "python", { timeoutMs = 8000 } = {}) {
	if (pythonCache.has(pythonCmd)) return pythonCache.get(pythonCmd);
	let result = "missing";
	try {
		const r = spawnSync(pythonCmd, ["-c", "import cv2"], {
			windowsHide: true,
			timeout: timeoutMs,
			stdio: "ignore",
		});
		if (!r.error && r.status === 0) result = "ok";
		else if (!r.error) result = "missing-opencv";
	} catch {
		result = "missing";
	}
	pythonCache.set(pythonCmd, result);
	return result;
}

/**
 * Build the status document.
 * @param {{env?: NodeJS.ProcessEnv, platform?: string, version?: string}} [options]
 */
export function buildStatus(options = {}) {
	const { env = process.env, platform = process.platform } = options;
	const rawConfig = readPluginConfig(env);
	const config = normalizeConfig(rawConfig);
	const configPath = join(wallpaperDir(env), "config.json");
	const locateResult = findWeConfig({ env, platform, explicitPath: config.weConfigPath });
	const media = resolveMedia({ env, config: rawConfig, locateResult });

	return {
		plugin: {
			name: "dsh-wallpaper-diudiu",
			version: options.version ?? pluginVersion(),
			platform,
			dshHome: homeDir(env),
		},
		config: {
			path: configPath,
			exists: existsSync(configPath),
			effective: config,
		},
		we: {
			found: locateResult.found,
			source: locateResult.source,
			configPath: locateResult.configPath,
			installDir: locateResult.installDir,
			libraries: locateResult.libraries,
			explicitMissed: Boolean(locateResult.explicitMissed),
			triedCount: locateResult.tried.length,
			tried: locateResult.tried.slice(0, 12),
		},
		selected: {
			kind: media.kind,
			file: media.file,
			monitor: config.monitor,
		},
		tools: {
			python: checkPython(config.pythonCmd),
			scene: sceneSupport({ platform, repkgPath: config.repkgPath }),
		},
		trace: media.trace,
	};
}
