window.__ModuleLoader__.load({
	id: "dsh-wallpaper-diudiu",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

		//#region dsh-wallpaper — custom desktop background
		/* Compatibility note (harness >= 0.2):
		 * The desktop shell is a React app whose surfaces use CSS-module class
		 * names (`BynINW_frame`, `_sidebarCol`, `_centerCol`, `_rightbarCol`,
		 * `_overlayLayer` ...), so the old `.dshDesktop*` hooks match nothing.
		 * The AppFrame is found structurally instead — it is the only element
		 * that owns a `[data-rightbar-col]` / `[data-shell-overlay]` child — and
		 * the three columns by their unique class suffix. A bare
		 * `[class*="_frame"]` must NOT be used: 14 unrelated modules ship their
		 * own `*_frame` classes (chat, attachment, subagent, user-questions ...).
		 *
		 * Every theme token the shell paints as a flat background is captured on
		 * <body> (`--dsh-wp-*`) and replaced, inside the frame, by a translucent
		 * `color-mix()` of itself — see the three tiers below. The overlay layer
		 * (menus, dialogs, settings) gets a nearly opaque mix instead, so it stays
		 * readable. Custom properties inherit, so one rule on the frame reaches
		 * every surface inside it; a component that declares a token locally still
		 * wins (its own declaration beats the inherited value). */
		var FRAME = ":is(div:has(> [data-rightbar-col]), div:has(> [data-shell-overlay]))";
		var FRAME_SCOPE = FRAME + ", .dshDesktopFrame, .dshDesktopFrameTitlebar, .dshDesktopSidebarSurface, .dshDesktopConversationSurface, .dshDesktopDetailsSurface";

		/* Tier 1 (panels, 23%): handled by the panel rules below, not by the
		 * generator — the frame, the three columns and the conversation pane all
		 * end up sharing one --dsh-wallpaper-veil, so the image shows through the
		 * whole window at the same strength. */
		var PANEL_TOKENS = [
			"--dsw-alias-bg-base",
			"--dsw-specific-sidebar-fill"
		];

		/* Tier 2 — neutral surfaces that carry content: bubbles, the composer,
		 * code blocks, cards, menus, tooltips, toasts, diff rows. These get
		 * --dsh-wallpaper-surface-tint inside the frame and
		 * --dsh-wallpaper-overlay-tint inside the overlay layer.
		 *
		 * This tier also carries four --dsw-static-neutral-* palette entries.
		 * Some panels (changed-files card, deliverables list, plan cards,
		 * schedule card) declare a *local* fill on the component itself, e.g.
		 *   .kuvljq_card{--changes-fill:var(--dsw-static-neutral-850)}
		 *   .kuvljq_header{background:var(--changes-fill)}
		 * Because a local declaration always beats an inherited value, remapping
		 * --dsw-alias-* cannot reach those fills — but the palette token is
		 * substituted on the component, so overriding the palette token inside
		 * the frame scope makes the local fill resolve to the veil instead.
		 * Only the neutrals used as fills (50/100/800/850) are listed;
		 * --dsw-static-neutral-00 stays untouched because it is also a text /
		 * icon colour and its two background uses are already translucent. */
		var SURFACE_TOKENS = [
			"--dsw-alias-bg-layer-1",
			"--dsw-alias-bg-layer-2",
			"--dsw-alias-bg-layer-3",
			"--dsw-alias-bg-module-platform",
			"--dsw-alias-bg-document-preview",
			"--dsw-alias-bg-overlay",
			"--dsw-alias-settings-card-fill",
			"--dsw-alias-markdown-code-block",
			"--dsw-alias-markdown-code-block-banner",
			"--dsw-alias-markdown-inline-code",
			"--dsw-alias-markdown-tag",
			"--dsw-alias-menu-group-header-fill",
			"--dsw-alias-toast-bg",
			"--dsw-alias-tooltip-bg",
			"--dsw-hovercard-bg",
			"--dsw-alias-button-elevated-fill",
			"--dsw-alias-button-floating-fill",
			"--dsw-alias-button-floating-hover",
			"--dsw-alias-button-ghost-active-fill",
			"--dsw-alias-interactive-bg-hover-solid",
			"--dsw-alias-onboarding-card-fill",
			"--dsw-alias-onboarding-secondary-fill",
			"--dsw-alias-state-warn-tertiary",
			"--dsw-alias-state-business-tertiary",
			"--dsw-alias-state-success-tertiary",
			"--dsw-alias-file-diff-added-bg",
			"--dsw-alias-file-diff-deleted-bg",
			"--dsw-specific-input-major",
			"--dsw-specific-bubble",
			"--dsw-specific-bubble-highlight",
			"--dsw-specific-selector",
			"--dsw-specific-menu",
			"--dsw-specific-sidebar-nav-item-hover",
			"--dsw-specific-sidebar-nav-item-active",
			"--dsw-specific-sidebar-nav-item-active-accent",
			"--dsw-alias-bg-multi-select",
			"--dsw-alias-file-diff-added-gutter",
			"--dsw-alias-file-diff-deleted-gutter",
			"--dsw-alias-scrollbar-bg-l1",
			"--dsw-alias-scrollbar-bg-l2",
			"--dsw-alias-scrollbar-hover-l1",
			"--dsw-alias-scrollbar-hover-l2",
			"--dsw-static-neutral-50",
			"--dsw-static-neutral-100",
			"--dsw-static-neutral-800",
			"--dsw-static-neutral-850"
		];

		/* Tier 3 — accent / affordance fills (CTA buttons, state badges, brand).
		 * Kept solid by default (100% === unchanged); lower
		 * --dsh-wallpaper-solid-tint to make buttons glassy too. Label, border,
		 * mask, skeleton and hover-wash tokens are intentionally not remapped:
		 * they are either text colors or already translucent. The seven tokens
		 * the theme leaves unset (bg-layer-4, bg-l1/l2, fill-l1/l2/tertiary/
		 * tsp-secondary) are not remapped either — their use sites render
		 * transparent today and mixing them would darken those surfaces. */
		var SOLID_TOKENS = [
			"--dsw-alias-button-primary-fill",
			"--dsw-alias-button-primary-hover",
			"--dsw-alias-button-contrast-fill",
			"--dsw-alias-button-info-fill",
			"--dsw-alias-button-info-hover",
			"--dsw-alias-brand-primary",
			"--dsw-alias-state-business-primary",
			"--dsw-alias-state-error-primary",
			"--dsw-alias-state-success-primary",
			"--dsw-alias-state-warn-label",
			"--dsw-alias-switch-thumb"
		];

		function wpName(token) {
			return token.replace(/^--/, "--dsh-wp-");
		}

		/* Builds the token plumbing from the lists above, so the snapshot, the
		 * frame remap, the overlay restore and the no-color-mix fallback can never
		 * drift apart. */
		function tokenCss() {
			var snap = [], frame = [], overlay = [], support = [];
			var tiers = [
				{ list: SURFACE_TOKENS, tint: "surface", overlayTint: true },
				{ list: SOLID_TOKENS, tint: "solid", overlayTint: false }
			];
			for (var t = 0; t < tiers.length; t++) {
				var list = tiers[t].list, tint = "--dsh-wallpaper-" + tiers[t].tint + "-tint";
				for (var i = 0; i < list.length; i++) {
					var token = list[i], name = wpName(token);
					snap.push("  " + name + ": var(" + token + ", var(--dsh-wallpaper-base));");
					snap.push("  " + name + "-veil: color-mix(in srgb, var(" + name + ") var(" + tint + "), transparent);");
					frame.push("  " + token + ": var(" + name + "-veil);");
					support.push("    " + name + "-veil: var(" + name + ");");
					if (!tiers[t].overlayTint) continue;
					// surface tokens are dialled back up (88%) inside the overlay layer
					snap.push("  " + name + "-overlay: color-mix(in srgb, var(" + name + ") var(--dsh-wallpaper-overlay-tint), transparent);");
					overlay.push("  " + token + ": var(" + name + "-overlay);");
					support.push("    " + name + "-overlay: var(" + name + ");");
				}
			}
			for (var s = 0; s < SOLID_TOKENS.length; s++) {
				overlay.push("  " + SOLID_TOKENS[s] + ": var(" + wpName(SOLID_TOKENS[s]) + "-veil);");
			}
			var out = [];
			out.push("/* 2b) surfaces: snapshot every opaque token the shell can paint, then");
			out.push("      re-declare the translucent versions for the frame (tier 2/3) and the");
			out.push("      nearly-opaque versions for the overlay layer (menus/dialogs). */");
			out.push("body {");
			out.push("  --dsh-wallpaper-surface-tint: 55%;");
			out.push("  --dsh-wallpaper-solid-tint: 100%;");
			out.push("  --dsh-wallpaper-overlay-tint: 88%;");
			out.push(snap.join("\n"));
			out.push("}");
			out.push("");
			out.push("/* 2c) inside the frame every captured surface turns translucent */");
			out.push(FRAME_SCOPE + " {");
			out.push(frame.join("\n"));
			out.push("}");
			out.push("");
			out.push("/* 2d) the overlay layer (menus, dialogs, settings, toasts) is a child of the");
			out.push("      frame, so it inherits 2c: restore readability there (88% by default,");
			out.push("      i.e. a hint of wallpaper and still legible text). */");
			out.push("[data-shell-overlay] {");
			out.push("  --dsw-alias-bg-base: color-mix(in srgb, var(--dsh-wallpaper-base) var(--dsh-wallpaper-overlay-tint), transparent);");
			out.push("  --dsw-specific-sidebar-fill: color-mix(in srgb, var(--dsh-wallpaper-sidebar) var(--dsh-wallpaper-overlay-tint), transparent);");
			out.push(overlay.join("\n"));
			out.push("}");
			out.push("");
			out.push("/* 2e) without color-mix() every veil falls back to the captured original */");
			out.push("@supports not (color: color-mix(in srgb, red 50%, transparent)) {");
			out.push("  body {");
			out.push("    --dsh-wallpaper-veil: var(--dsh-wallpaper-base);");
			out.push(support.join("\n"));
			out.push("  }");
			out.push("}");
			return out.join("\n");
		}

		var WALLPAPER_CSS = [
			"/* dsh-wallpaper — DSH Desktop custom background (three-column AppFrame) */",
			"",
			"/* 1) background layer: the page canvas carries the wallpaper image */",
			"html {",
			"  background-color: #0c0e13;",
			"  background-image: url(\"/dsh-wallpaper/wallpaper.png\");",
			"  background-repeat: no-repeat;",
			"  background-position: center;",
			"  background-size: cover;",
			"  background-attachment: fixed;",
			"}",
			"",
			"/* 2) tuning + captured originals.",
			"      --dsh-wallpaper-base / --dsh-wallpaper-sidebar snapshot the theme's opaque",
			"      panel colors; --dsh-wallpaper-veil is what the panels become.",
			"      Lower --dsh-wallpaper-tint => clearer image (less readable text).",
			"      Three knobs: tint (panels 23%), surface-tint (bubbles, composer, code,",
			"      cards - 55%), solid-tint (CTA/accent fills - 100% = untouched). */",
			"body {",
			"  --dsh-wallpaper-base: var(--dsw-alias-bg-base, #151517);",
			"  --dsh-wallpaper-sidebar: var(--dsw-specific-sidebar-fill, var(--dsw-alias-bg-base, #151517));",
			"  --dsh-wallpaper-tint: 23%;",
			"  --dsh-wallpaper-veil: color-mix(in srgb, var(--dsh-wallpaper-base) var(--dsh-wallpaper-tint), transparent);",
			"}",
			"",
			tokenCss(),
			"",
			"/* 3) the shell paints body/#root with the opaque theme color, which would hide",
			"      both the wallpaper and the z-index:-1 <video> layer */",
			"body, #root {",
			"  background: transparent !important;",
			"}",
			"",
			"/* 4) AppFrame + the three columns share ONE translucent fill, so the image shows",
			"      through evenly and inner surfaces that inherit --dsw-alias-bg-base (the",
			"      conversation pane) do too. */",
			FRAME_SCOPE + " {",
			"  --dsw-alias-bg-base: var(--dsh-wallpaper-veil);",
			"  --dsw-specific-sidebar-fill: var(--dsh-wallpaper-veil);",
			"}",
			"",
			"/* 4b) the conversation pane paints --dsw-alias-bg-base a second time, on top of",
			"      the frame; with the veil that would make the chat column darker than the",
			"      sidebar. Clear it, so all three columns show the same image. */",
			"[class*=\"_centerCol\"] > [data-phase] {",
			"  background: transparent !important;",
			"}",
			"",
			"/* 5) belt and braces: the shell paints these surfaces with a background",
			"      shorthand and the Windows titlebar strip is .frame::before, so override",
			"      those directly as well. The three column classes are globally unique",
			"      (core-verified), so no other component can be hit. */",
			":is(" + FRAME + ", [class*=\"_sidebarCol\"], [class*=\"_centerCol\"], [class*=\"_rightbarCol\"]) {",
			"  background: var(--dsh-wallpaper-veil) !important;",
			"}",
			FRAME + ":before {",
			"  background: var(--dsh-wallpaper-veil) !important;",
			"}",
			"",
			"/* 6) macOS builds keep their native translucent window behind the columns */",
			"[data-platform=\"darwin\"] " + FRAME + " {",
			"  background: transparent !important;",
			"}",
			"",
			"/* optional: frosted-glass blur behind the centre column (uncomment to enable) */",
			"/* [class*=\"_centerCol\"] { backdrop-filter: blur(8px); } */"
		].join("\n");

		(function injectWallpaper() {
			if (typeof document === "undefined") return;
			var marker = "dsh-wallpaper/wallpaper";
			// A hot-swapped bundle finds the previous build's <style> element still in
			// the DOM (HMR swaps modules, it does not undo their side effects), so the
			// existing element is refreshed in place instead of being skipped.
			var existing = document.querySelector('style[data-plugin-css="' + marker + '"]');
			if (existing) {
				existing.textContent = WALLPAPER_CSS;
				return;
			}
			var style = document.createElement("style");
			style.setAttribute("data-plugin", "dsh-wallpaper");
			style.setAttribute("data-plugin-css", marker);
			style.textContent = WALLPAPER_CSS;
			document.head.appendChild(style);
		})();

		/* Live video wallpaper: probe the server for the current wallpaper type.
		 *   - video (mp4/webm) -> inject a muted looping <video> behind the UI
		 *   - image            -> nothing to do, the CSS background handles it
		 * If the video cannot play (e.g. unsupported codec), remove it and fall
		 * back to the static image background. */
		(function injectVideoWallpaper() {
			if (typeof document === "undefined") return;
			var marker = "dsh-wallpaper/video";
			if (document.querySelector('[data-plugin-video="' + marker + '"]')) return;
			var probe = new XMLHttpRequest();
			probe.open("GET", "/dsh-wallpaper/wallpaper.type", true);
			probe.onreadystatechange = function () {
				if (probe.readyState !== 4) return;
				if (probe.status !== 200) return;
				var info = null;
				try { info = JSON.parse(probe.responseText); } catch (e) { return; }
				if (!info || info.kind !== "video") return; // image mode: CSS handles it

				var done = false;
				var cleanup = function () {
					if (done) return;
					done = true;
					var el = document.querySelector('[data-plugin-video="' + marker + '"]');
					if (el && el.parentNode) el.parentNode.removeChild(el);
					document.documentElement.style.backgroundImage = ""; // back to CSS image
				};
				var attach = function () {
					var v = document.createElement("video");
					v.setAttribute("data-plugin", "dsh-wallpaper");
					v.setAttribute("data-plugin-video", marker);
					v.src = info.url || "/dsh-wallpaper/wallpaper.mp4";
					v.muted = true;
					v.loop = true;
					v.autoplay = true;
					v.setAttribute("playsinline", "");
					v.setAttribute("preload", "auto");
					v.style.position = "fixed";
					v.style.left = "0";
					v.style.top = "0";
					v.style.width = "100%";
					v.style.height = "100%";
					v.style.objectFit = "cover";
					v.style.zIndex = "-1";
					v.style.pointerEvents = "none";
					v.addEventListener("error", cleanup, { once: true });
					document.body.insertBefore(v, document.body.firstChild);
					document.documentElement.style.backgroundImage = "none"; // let the video show
					var p = v.play();
					if (p && p.catch) p.catch(function () {});
				};
				if (document.body) attach();
				else document.addEventListener("DOMContentLoaded", attach, { once: true });
			};
			probe.send();
		})();
		//#endregion

		exports.name = "dsh-wallpaper";
		exports.inject = [];
		exports.apply = function apply() {
			// CSS is injected at load time; nothing else needed.
		};
		return module.exports;
	}
});
