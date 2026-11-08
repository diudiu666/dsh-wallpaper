#!/usr/bin/env node
/**
 * Make the DSH Desktop title-bar close button quit the application instead of
 * hiding the window in the system tray.
 *
 * DSH Desktop ships `resources/app.asar` with `lib/main.js`, whose main window
 * has a `close` handler that always calls `event.preventDefault()` and hides
 * the window (first run: a one-time "running tasks continue in the tray"
 * notice). There is no setting and no plugin hook for that decision — the
 * client half of this plugin runs in the page and the Host half runs in a
 * child process, neither can reach `BrowserWindow`. So this script rewrites
 * that one statement inside the archive.
 *
 * The rewrite is a same-length, in-place byte patch:
 *   - the Electron asar header (offsets, sizes, SHA-256 integrity entries) is
 *     left untouched, so nothing needs re-packing and the archive stays valid;
 *   - `EnableEmbeddedAsarIntegrityValidation` is disabled in this build and is
 *     a macOS-only fuse anyway, so Windows does not verify the edited bytes;
 *   - a pristine copy of the original `lib/main.js` is kept under
 *     `<DSH_HOME>/wallpaper/desktop-close-backup/` for `--revert`.
 *
 * The patched handler calls `app.quit()`: no running tasks => the app exits
 * immediately, running tasks => the normal quit confirmation is shown. That is
 * the same path as the "Exit" menu entry, minus the tray detour.
 *
 * Usage:
 *   node scripts/patch-desktop-close.mjs            # patch (idempotent)
 *   node scripts/patch-desktop-close.mjs --status   # report current state
 *   node scripts/patch-desktop-close.mjs --revert   # restore the original
 *   node scripts/patch-desktop-close.mjs --asar <path\to\app.asar>
 *
 * Without `--asar` the archive is located through the uninstall entry the
 * installer writes (`InstallLocation`, then `DisplayIcon` / `UninstallString`),
 * so an install on any drive — `D:\dsh` included — is found without a per-drive
 * path list; conventional install directories are only the fallback.
 * `DSH_DESKTOP_ASAR` overrides the whole search.
 *
 * A DSH Desktop update replaces `app.asar`, so re-run this script afterwards.
 */
import { execFileSync } from "node:child_process";
import {
	closeSync,
	existsSync,
	mkdirSync,
	openSync,
	readSync,
	writeSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const ENTRY_PATH = "lib/main.js";
const MARKER = "/* dsh-wallpaper:close-quit */";

/** Original block (tabs + newlines exactly as shipped in 0.2.x desktop builds). */
const ORIGINAL = [
	"\t\t\tconst hide = () => {",
	"\t\t\t\tif (!quitting && !shellInstallerOwnsQuit && !sessionEnding && !window.isDestroyed()) hideMainWindow(window);",
	"\t\t\t};",
	"\t\t\tif (backgroundNotice === void 0) hide();",
	"\t\t\telse backgroundNotice.close(hide);",
].join("\n");

const PATCHED = "\t\t\t" + MARKER + "app.quit();";

/* ------------------------------------------------------------------ asar I/O */

function readAsar(asar) {
	const fd = openSync(asar, "r+");
	const head = Buffer.alloc(16);
	readSync(fd, head, 0, 16, 0);
	const headerSize = head.readUInt32LE(4);
	const jsonSize = head.readUInt32LE(12);
	const json = Buffer.alloc(jsonSize);
	readSync(fd, json, 0, jsonSize, 16);
	const tree = JSON.parse(json.toString("utf8"));
	return { fd, tree, dataStart: 8 + headerSize };
}

function findEntry(node, prefix, wanted) {
	for (const [name, entry] of Object.entries(node.files ?? {})) {
		const path = prefix === "" ? name : prefix + "/" + name;
		if (entry.files !== undefined) {
			const hit = findEntry(entry, path, wanted);
			if (hit !== undefined) return hit;
			continue;
		}
		if (path === wanted) return { path, offset: Number(entry.offset), size: entry.size };
	}
	return undefined;
}

function readEntry(fd, dataStart, entry) {
	const buffer = Buffer.alloc(entry.size);
	readSync(fd, buffer, 0, entry.size, dataStart + entry.offset);
	return buffer;
}

/* ------------------------------------------------------------------ helpers */

function dshHome() {
	return process.env.DSH_HOME ?? join(process.env.USERPROFILE ?? process.env.HOME ?? ".", ".dsh");
}

/* --------------------------------------------------.app.asar discovery (win) */

/** Uninstall keys electron-builder writes: per-user first, then per-machine. */
const UNINSTALL_KEYS = [
	"HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall",
	"HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall",
	"HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall",
];

const PRODUCT_NAME = "DeepSeek Harness";

/** `reg query <args>`, or undefined when reg is unavailable or the key is absent. */
function regQuery(args) {
	try {
		return execFileSync("reg", args, {
			encoding: "utf8",
			stdio: ["ignore", "pipe", "ignore"],
			windowsHide: true,
			maxBuffer: 16 * 1024 * 1024,
		});
	} catch {
		return undefined;
	}
}

/**
 * Turn `reg query <uninstall key> /s` output into one record per subkey.
 * A `HKEY_...` line starts a record; value lines read
 * `    DisplayName    REG_SZ    DeepSeek Harness`.
 */
export function parseUninstallRecords(text) {
	const records = [];
	let current;
	for (const raw of text.split(/\r?\n/u)) {
		const line = raw.trim();
		if (line === "") continue;
		if (line.startsWith("HKEY_")) {
			current = { key: line };
			records.push(current);
			continue;
		}
		if (current === undefined) continue;
		const match = /^(\S+)\s+REG_[A-Z_]+\s+(.*)$/u.exec(line);
		if (match !== null) current[match[1]] = match[2].trim();
	}
	return records;
}

/** The executable a registry value names: no quotes, no arguments, no `,0` icon index. */
export function executableFromValue(value) {
	if (typeof value !== "string") return undefined;
	let text = value.trim().replace(/,\s*-?\d+$/u, "");
	if (text.startsWith('"')) {
		const end = text.indexOf('"', 1);
		text = end > 0 ? text.slice(1, end) : text.slice(1);
	} else {
		const executable = /^.*?\.exe\b/iu.exec(text);
		if (executable !== null) text = executable[0];
	}
	const trimmed = text.trim();
	return trimmed === "" ? undefined : trimmed;
}

/** Install directories a product's uninstall records name, most direct first. */
export function installDirsFromRecords(records, product = PRODUCT_NAME) {
	const dirs = [];
	for (const record of records) {
		if (typeof record.DisplayName !== "string" || !record.DisplayName.includes(product)) continue;
		const location = record.InstallLocation?.trim();
		if (location !== undefined && location !== "") dirs.push(location);
		for (const value of [record.DisplayIcon, record.UninstallString]) {
			const executable = executableFromValue(value);
			if (executable !== undefined) dirs.push(dirname(executable));
		}
	}
	return dirs.filter((dir, index) => dirs.indexOf(dir) === index);
}

/**
 * Candidate install directories, most authoritative first: the uninstall entry
 * the installer writes (works on any drive), then the conventional locations.
 * A generator so the search stops at the first archive that exists instead of
 * querying every key.
 */
export function* installDirCandidates() {
	if (process.platform === "win32") {
		for (const key of UNINSTALL_KEYS) {
			const text = regQuery(["query", key, "/s"]);
			if (text === undefined) continue;
			yield* installDirsFromRecords(parseUninstallRecords(text));
		}
	}
	const local = process.env.LOCALAPPDATA ?? join(process.env.USERPROFILE ?? ".", "AppData", "Local");
	yield join(local, "Programs", PRODUCT_NAME);
	yield join(process.env.ProgramFiles ?? "C:\\Program Files", PRODUCT_NAME);
	if (process.env["ProgramFiles(x86)"] !== undefined) {
		yield join(process.env["ProgramFiles(x86)"], PRODUCT_NAME);
	}
}

function defaultAsar() {
	const explicit = process.env.DSH_DESKTOP_ASAR?.trim();
	if (explicit !== undefined && explicit !== "") return explicit;
	for (const dir of installDirCandidates()) {
		const candidate = join(dir, "resources", "app.asar");
		if (existsSync(candidate)) return candidate;
	}
	return undefined;
}

function backupPath() {
	return join(dshHome(), "wallpaper", "desktop-close-backup", "lib-main.js");
}

/** Replacement of exactly `length` bytes: the patched statement plus padding. */
function padTo(text, length) {
	if (text.length > length) throw new Error(`补丁文本比原语句长：${text.length} > ${length}`);
	return text + " ".repeat(length - text.length);
}

/* --------------------------------------------------------------------- main */

function parseArgs(argv) {
	const options = { action: "apply", asar: undefined };
	for (let i = 0; i < argv.length; i += 1) {
		const arg = argv[i];
		if (arg === "--status") options.action = "status";
		else if (arg === "--revert") options.action = "revert";
		else if (arg === "--apply") options.action = "apply";
		else if (arg === "--asar") options.asar = argv[++i];
		else if (arg === "--help" || arg === "-h") options.action = "help";
		else throw new Error(`未知参数：${arg}`);
	}
	return options;
}

function main() {
	const options = parseArgs(process.argv.slice(2));
	if (options.action === "help") {
		console.log("用法: node scripts/patch-desktop-close.mjs [--apply|--status|--revert] [--asar <app.asar>]");
		console.log("不给 --asar 时按卸载注册表项定位 app.asar；也可用 DSH_DESKTOP_ASAR 直接指定。");
		return 0;
	}
	const asarArg = options.asar ?? defaultAsar();
	if (asarArg === undefined) {
		console.error(
			"找不到 DSH Desktop 的 app.asar：注册表卸载项里没有 DeepSeek Harness，常见安装目录也没有命中。\n" +
				"用 --asar <路径> 指定，或设置 DSH_DESKTOP_ASAR，例如：\n" +
				'  node scripts/patch-desktop-close.mjs --asar "D:\\dsh\\resources\\app.asar"',
		);
		return 1;
	}
	const asar = resolve(asarArg);
	if (!existsSync(asar)) {
		console.error(`找不到 app.asar：${asar}`);
		return 1;
	}

	const { fd, tree, dataStart } = readAsar(asar);
	try {
		const entry = findEntry(tree, "", ENTRY_PATH);
		if (entry === undefined) {
			console.error(`app.asar 里没有 ${ENTRY_PATH}：${asar}`);
			return 1;
		}
		const buffer = readEntry(fd, dataStart, entry);
		const originalBuffer = Buffer.from(ORIGINAL, "utf8");
		const markerBuffer = Buffer.from(MARKER, "utf8");
		// Byte offsets: main.js carries non-ASCII locale strings, so a decoded
		// string index would not match the file offset.
		const originalAt = buffer.indexOf(originalBuffer);
		const markerAt = buffer.indexOf(markerBuffer);
		const isPatched = markerAt >= 0;

		if (options.action === "status") {
			console.log(`app.asar: ${asar}`);
			console.log(`入口: ${ENTRY_PATH} (${entry.size} 字节)`);
			console.log(`状态: ${isPatched ? "已改为「关闭=退出」" : originalAt >= 0 ? "原始「关闭=最小化到托盘」" : "无法识别（DSH 版本已变更）"}`);
			return 0;
		}

		if (options.action === "revert") {
			if (!isPatched) {
				console.log("当前未打补丁，无需还原。");
				return 0;
			}
			// The patched block is exactly ORIGINAL.length bytes, so it can be
			// swapped back without touching any other offset.
			const blockStart = markerAt - "\t\t\t".length;
			writeSync(fd, originalBuffer, 0, originalBuffer.length, dataStart + entry.offset + blockStart);
			const check = readEntry(fd, dataStart, entry);
			if (check.indexOf(originalBuffer) < 0) {
				console.error("还原后校验失败，文件可能已损坏。请用备份恢复：" + backupPath());
				return 1;
			}
			console.log("已还原：关闭按钮恢复为「最小化到托盘」。");
			return 0;
		}

		if (isPatched) {
			console.log("已经是「关闭=退出」，无需重复打补丁。");
			return 0;
		}
		if (originalAt < 0) {
			console.error(`当前 app.asar 的 ${ENTRY_PATH} 里找不到预期语句（DSH Desktop 版本可能已变更），未做任何修改。`);
			return 1;
		}

		const backup = backupPath();
		mkdirSync(dirname(backup), { recursive: true });
		if (!existsSync(backup)) {
			const backupFd = openSync(backup, "w");
			try {
				writeSync(backupFd, buffer, 0, buffer.length);
			} finally {
				closeSync(backupFd);
			}
		}

		const replacement = Buffer.from(padTo(PATCHED, originalBuffer.length), "utf8");
		writeSync(fd, replacement, 0, replacement.length, dataStart + entry.offset + originalAt);

		const check = readEntry(fd, dataStart, entry);
		if (check.indexOf(markerBuffer) < 0 || check.indexOf(originalBuffer) >= 0) {
			console.error("打补丁后校验失败，正在写回备份…");
			writeSync(fd, buffer, 0, buffer.length, dataStart + entry.offset);
			return 1;
		}
		console.log(`已改为「关闭=退出」：${asar}`);
		console.log(`原文件备份：${backup}`);
		console.log("完全退出 DSH Desktop 再打开（托盘图标右键 → 退出）后生效；应用更新会覆盖这一步，届时重跑本脚本。");
		return 0;
	} finally {
		closeSync(fd);
	}
}

const invokedDirectly =
	process.argv[1] !== undefined &&
	resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase();

if (invokedDirectly) {
	try {
		process.exitCode = main();
	} catch (error) {
		console.error(String(error?.stack ?? error));
		process.exitCode = 1;
	}
}
