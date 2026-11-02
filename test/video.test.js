/**
 * Client video-wallpaper behaviour, exercised by running the real
 * `lib/client.js` bundle against a tiny fake DOM.
 *
 * Why this exists: the desktop window is created hidden and shown after the
 * page has loaded. Starting a <video> while hidden left Chromium's media
 * pipeline wedged — `paused === false`, the file fully buffered, `currentTime`
 * frozen and `play()` never settling — so the wallpaper showed one frame
 * forever. The bundle now waits for a visible document and runs a watchdog
 * that nudges `currentTime` when playback stops advancing. These tests pin
 * both behaviours down instead of relying on "looks animated on my machine".
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const SOURCE = readFileSync(fileURLToPath(new URL("../lib/client.js", import.meta.url)), "utf8");
const VIDEO_MARKER = "dsh-wallpaper/video";

function makeElement(tagName) {
	const el = {
		tagName: tagName.toUpperCase(),
		style: {},
		attrs: {},
		children: [],
		parentNode: null,
		listeners: {},
		setAttribute(name, value) {
			this.attrs[name] = String(value);
		},
		addEventListener(type, fn) {
			(this.listeners[type] ??= []).push(fn);
		},
		removeEventListener(type, fn) {
			const list = this.listeners[type];
			const index = list ? list.indexOf(fn) : -1;
			if (index >= 0) list.splice(index, 1);
		},
		appendChild(node) {
			node.parentNode = this;
			this.children.push(node);
			return node;
		},
		insertBefore(node, ref) {
			node.parentNode = this;
			const index = ref ? this.children.indexOf(ref) : 0;
			if (index < 0) this.children.push(node);
			else this.children.splice(index, 0, node);
			return node;
		},
		removeChild(node) {
			const index = this.children.indexOf(node);
			if (index >= 0) this.children.splice(index, 1);
			node.parentNode = null;
			return node;
		},
		contains(node) {
			return node === this || this.children.some((child) => child.contains(node));
		},
	};
	Object.defineProperty(el, "firstChild", { get() { return this.children[0] ?? null; } });
	return el;
}

function makeVideo() {
	const video = makeElement("video");
	video.currentTime = 0;
	video.duration = 21;
	video.readyState = 4;
	video.paused = false;
	video.playCalls = 0;
	video.play = function play() {
		this.playCalls += 1;
		return Promise.resolve();
	};
	return video;
}

function makeDocument({ hidden }) {
	const doc = {
		hidden,
		listeners: {},
		documentElement: makeElement("html"),
		head: makeElement("head"),
		body: makeElement("body"),
		createElement(tagName) {
			return tagName === "video" ? makeVideo() : makeElement(tagName);
		},
		addEventListener(type, fn) {
			(this.listeners[type] ??= []).push(fn);
		},
		removeEventListener(type, fn) {
			const list = this.listeners[type];
			const index = list ? list.indexOf(fn) : -1;
			if (index >= 0) list.splice(index, 1);
		},
		querySelector(selector) {
			if (selector.startsWith("style[")) {
				return this.head.children.find((el) => el.attrs["data-plugin-css"] === "dsh-wallpaper/wallpaper") ?? null;
			}
			if (selector.startsWith("[data-plugin-video=")) {
				return this.body.children.find((el) => el.attrs["data-plugin-video"] === VIDEO_MARKER) ?? null;
			}
			return null;
		},
	};
	doc.documentElement.contains = (node) => doc.body.contains(node);
	return doc;
}

class FakeXHR {
	open(_method, url) {
		this.url = url;
	}
	send() {
		this.readyState = 4;
		this.status = 200;
		this.responseText = JSON.stringify({ kind: "video", url: "/dsh-wallpaper/wallpaper.mp4" });
		if (this.onreadystatechange) this.onreadystatechange();
	}
}

/**
 * Run the bundle in an isolated VM context.
 * @param {{hidden: boolean}} options
 * @returns {{document: object, intervals: Array<{fn: Function, cleared: boolean}>, exports: object}}
 */
function loadClient({ hidden }) {
	const document = makeDocument({ hidden });
	const intervals = [];
	let exports = null;
	const sandbox = {
		window: {
			__ModuleLoader__: {
				load({ factory }) {
					exports = factory(() => {});
				},
			},
		},
		document,
		XMLHttpRequest: FakeXHR,
		setInterval(fn) {
			const handle = { fn, cleared: false };
			intervals.push(handle);
			return handle;
		},
		clearInterval(handle) {
			if (handle) handle.cleared = true;
		},
		isFinite,
		console,
	};
	vm.createContext(sandbox);
	vm.runInContext(SOURCE, sandbox, { filename: "lib/client.js" });
	return { document, intervals, exports };
}

function fire(target, type) {
	for (const fn of [...(target.listeners[type] ?? [])]) fn();
}

function videos(document) {
	return document.body.children.filter((el) => el.tagName === "VIDEO");
}

test("a hidden document defers the video until it becomes visible", () => {
	const { document, intervals } = loadClient({ hidden: true });

	assert.equal(videos(document).length, 0, "no <video> while the desktop window is hidden");
	assert.equal(intervals.length, 0, "the watchdog must not start before the video exists");

	document.hidden = false;
	fire(document, "visibilitychange");

	const video = videos(document)[0];
	assert.ok(video, "the video is attached once visible");
	assert.equal(video.playCalls, 1, "playback starts on the first visible moment");
	assert.equal(document.documentElement.style.backgroundImage, "none", "the static image steps aside");
	assert.equal(intervals.length, 1, "the stall watchdog starts with the video");
});

test("a visible document attaches immediately", () => {
	const { document } = loadClient({ hidden: false });

	assert.equal(videos(document).length, 1);
	assert.equal(document.documentElement.style.backgroundImage, "none");
});

test("the watchdog nudges a stalled video and resumes playback", () => {
	const { document, intervals } = loadClient({ hidden: false });
	const video = videos(document)[0];
	const playsBefore = video.playCalls;

	// The wedged state observed on a real desktop: playing, fully buffered,
	// currentTime frozen. readyState stays at HAVE_CURRENT_DATA/HAVE_FUTURE_DATA.
	video.paused = false;
	video.readyState = 4;
	video.currentTime = 4.117333;

	// One tick records the new position, then three equal readings trip recovery.
	for (let i = 0; i < 4; i += 1) intervals[0].fn();

	assert.ok(video.currentTime > 4.117333, "currentTime was nudged forward");
	assert.equal(video.playCalls, playsBefore + 1, "play() was called again as part of recovery");
});

test("a media error removes the video, restores the image and stops the watchdog", () => {
	const { document, intervals } = loadClient({ hidden: false });
	const video = videos(document)[0];

	video.listeners.error[0]();

	assert.equal(videos(document).length, 0);
	assert.equal(document.documentElement.style.backgroundImage, "", "the static frame is restored");
	assert.equal(intervals[0].cleared, true, "the watchdog is cleared");
});
