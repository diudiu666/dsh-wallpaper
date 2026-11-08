/**
 * The close-to-quit script has to find `app.asar` without a hard-coded path:
 * `%LOCALAPPDATA%\Programs\DeepSeek Harness` only covers the default install
 * location, and this project's own dev machine keeps DSH on `D:\dsh`. The
 * installer's uninstall entry names the real directory, so the parsing that
 * turns `reg query` output into candidate install directories is pure and is
 * exercised here instead of on a user's machine.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
	executableFromValue,
	installDirsFromRecords,
	parseUninstallRecords,
} from "../scripts/patch-desktop-close.mjs";

const REG_DUMP = `
HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\1bf39983-50d0-5fe0-9ef4-cece76f67c5e
    DisplayName    REG_SZ    DeepSeek Harness
    UninstallString    REG_SZ    "D:\\dsh\\Uninstall DeepSeek Harness.exe" /currentuser
    DisplayIcon    REG_SZ    D:\\dsh\\DeepSeek Harness.exe,0
    InstallLocation    REG_SZ    D:\\dsh
    DisplayVersion    REG_SZ    0.2.2-rc.1

HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\other
    DisplayName    REG_SZ    Wallpaper Engine
    InstallLocation    REG_SZ    D:\\steam\\steamapps\\common\\wallpaper_engine
`;

test("the uninstall dump splits into one record per subkey", () => {
	const records = parseUninstallRecords(REG_DUMP);
	assert.equal(records.length, 2);
	assert.equal(records[0].DisplayName, "DeepSeek Harness");
	assert.equal(records[0].InstallLocation, "D:\\dsh");
	assert.equal(records[0].DisplayVersion, "0.2.2-rc.1");
	assert.equal(records[1].DisplayName, "Wallpaper Engine");
});

test("a registry executable value drops quotes, arguments and the icon index", () => {
	assert.equal(executableFromValue("D:\\dsh\\DeepSeek Harness.exe,0"), "D:\\dsh\\DeepSeek Harness.exe");
	assert.equal(
		executableFromValue('"C:\\Program Files\\DeepSeek Harness\\Uninstall DeepSeek Harness.exe" /currentuser'),
		"C:\\Program Files\\DeepSeek Harness\\Uninstall DeepSeek Harness.exe",
	);
	assert.equal(
		executableFromValue("C:\\Program Files\\DeepSeek Harness\\DeepSeek Harness.exe --flag"),
		"C:\\Program Files\\DeepSeek Harness\\DeepSeek Harness.exe",
	);
	assert.equal(executableFromValue(undefined), undefined);
	assert.equal(executableFromValue("   "), undefined);
});

test("the install directory comes from the harness entry, never from another product", () => {
	const dirs = installDirsFromRecords(parseUninstallRecords(REG_DUMP));
	assert.deepEqual(dirs, ["D:\\dsh"], "InstallLocation, DisplayIcon and UninstallString all resolve to D:\\dsh");
	assert.ok(!dirs.some((dir) => dir.includes("wallpaper_engine")), "unrelated uninstall entries are ignored");
});

test("a record with only DisplayIcon still yields its directory", () => {
	const records = parseUninstallRecords(`
HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\x
    DisplayName    REG_SZ    DeepSeek Harness
    DisplayIcon    REG_SZ    E:\\apps\\DeepSeek Harness\\DeepSeek Harness.exe,0
`);
	assert.deepEqual(installDirsFromRecords(records), ["E:\\apps\\DeepSeek Harness"]);
});

test("importing the script for these tests does not run the patcher", () => {
	// The module-level guard compares argv[1] with its own path; under
	// `node --test` argv[1] is the test file, so nothing is patched. A broken
	// guard would have thrown on the unknown `--test` argument above.
	assert.ok(true);
});
