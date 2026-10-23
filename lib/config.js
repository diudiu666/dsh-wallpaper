/**
 * Plugin configuration: read <DSH_HOME>/wallpaper/config.json and normalize it.
 *
 * Every key is optional. This module never throws on a missing or malformed
 * config — a broken config must not take the wallpaper (or the host) down;
 * diagnostics report it through /dsh-wallpaper/status instead.
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** Defaults for every supported key. */
export const CONFIG_DEFAULTS = {
	weSync: true,
	videoLive: true,
	monitor: null,
	weConfigPath: null,
	pythonCmd: "python",
	repkgPath: null,
};

/** `<DSH_HOME>` — honours DSH_HOME, falls back to ~/.dsh. */
export function homeDir(env = process.env) {
	return env.DSH_HOME && env.DSH_HOME.length > 0 ? env.DSH_HOME : join(homedir(), ".dsh");
}

/** `<DSH_HOME>/wallpaper` — where config.json, image.png and cache/ live. */
export function wallpaperDir(env = process.env) {
	return join(homeDir(env), "wallpaper");
}

/** Parse JSON, tolerating a UTF-8 BOM. Throws on malformed input. */
export function readJsonStrict(file) {
	return JSON.parse(readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
}

/** Raw config object, or {} when the file is absent/unreadable/invalid. */
export function readPluginConfig(env = process.env) {
	try {
		const raw = readJsonStrict(join(wallpaperDir(env), "config.json"));
		return raw !== null && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
	} catch {
		return {};
	}
}

const isNonEmptyString = (v) => typeof v === "string" && v.trim().length > 0;

/** Apply defaults and drop values of the wrong type. */
export function normalizeConfig(raw = {}) {
	const out = { ...CONFIG_DEFAULTS };
	if (typeof raw.weSync === "boolean") out.weSync = raw.weSync;
	if (typeof raw.videoLive === "boolean") out.videoLive = raw.videoLive;
	if (isNonEmptyString(raw.monitor)) out.monitor = raw.monitor.trim();
	if (isNonEmptyString(raw.weConfigPath)) out.weConfigPath = raw.weConfigPath.trim();
	if (isNonEmptyString(raw.pythonCmd)) out.pythonCmd = raw.pythonCmd.trim();
	if (isNonEmptyString(raw.repkgPath)) out.repkgPath = raw.repkgPath.trim();
	if (isNonEmptyString(raw.image)) out.image = raw.image.trim();
	return out;
}
