/**
 * Custom tools exposed to the LLM for controlling cmux programmatically.
 *
 * - cmux_browser: Drive the in-app browser (open, navigate, snapshot, click, fill, eval, etc.)
 * - cmux_workspace: Control workspaces and surfaces (list, create, split, focus, flash, send text)
 * - cmux_notify: Send a notification to the user via cmux
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { truncateTail } from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import type { CmuxClient } from "./cmux-client.js";

/** ToolResult shape expected by pi's agent core. */
type ToolResult = { content: Array<{ type: "text"; text: string }>; details: Record<string, unknown> };

/** Format an error string as a proper ToolResult. */
function errorResult(text: string): ToolResult {
  return { content: [{ type: "text", text }], details: { error: true } };
}

/** Format a cmux response as a proper ToolResult. */
function formatResult(result: any, context?: string): ToolResult {
  let text: string;
  if (result === null || result === undefined) {
    const ctx = context ? ` [${context}]` : "";
    text = `cmux did not respond (socket unavailable or timed out)${ctx}`;
  } else if (typeof result === "string") {
    text = result;
  } else {
    const json = JSON.stringify(result, null, 2);
    // Truncate large responses (snapshots can be huge)
    const truncated = truncateTail(json, { maxBytes: 50_000, maxLines: 2000 });
    text = truncated.content;
  }
  return { content: [{ type: "text", text }], details: {} };
}

/** Check if cmux returned a null/timeout result. */
function isTimeout(result: any): boolean {
  return result === null || result === undefined;
}

export function wireTools(pi: ExtensionAPI, client: CmuxClient): void {
  // --- cmux_browser ---
  pi.registerTool({
    name: "cmux_browser",
    label: "Browser",
    description: [
      "Control cmux in-app browser. Runs inside the terminal — no separate browser needed.",
      "",
      "Navigation: open (split pane), navigate, back, forward, reload",
      "Snapshot:   snapshot (accessibility tree — use compact/selector/max_depth to control size)",
      "Interact:   click, dblclick, fill (replace value), type (keystroke-by-keystroke), select, press, hover, check, uncheck, scroll, scroll_into_view, highlight",
      "Query:      get (text/html/value/attr/count/title/styles), is (visible/enabled/checked), screenshot, wait",
      "Find:       find (by role/text/label/placeholder/testid/title)",
      "Dialogs:    dialog_accept, dialog_dismiss",
      "Tabs:       tab_list, tab_new, tab_switch, tab_close",
      "Cookies:    cookies_get, cookies_set, cookies_clear",
      "Storage:    storage_get, storage_set, storage_clear (localStorage/sessionStorage)",
      "Network:    network (inspect requests)",
      "Inject:     addstyle (inject CSS), addscript (inject JS)",
      "State:      console, errors, eval, download",
      "Frames:     frame (select iframe), frame_main (back to main)",
      "",
      "Safari cookies are automatically available via cmux browser profile import.",
      "Most interaction actions support snapshot_after=true to return the updated accessibility tree in one round-trip.",
    ].join("\n"),
    parameters: Type.Object({
      action: StringEnum([
        // Navigation
        "open", "navigate", "back", "forward", "reload",
        // Snapshot & query
        "snapshot", "screenshot", "get", "wait",
        // Interaction
        "click", "dblclick", "fill", "type", "select", "press",
        "hover", "check", "uncheck", "scroll", "highlight",
        // Find
        "find",
        // Dialogs
        "dialog_accept", "dialog_dismiss",
        // Tabs
        "tab_list", "tab_new", "tab_switch", "tab_close",
        // Query
        "is", "scroll_into_view",
        // Cookies & storage
        "cookies_get", "cookies_set", "cookies_clear",
        "storage_get", "storage_set", "storage_clear",
        // Network
        "network",
        // Inject
        "addstyle", "addscript",
        // State & debug
        "console", "errors", "eval", "download",
        // Frames
        "frame", "frame_main",
      ] as const),
      url: Type.Optional(Type.String({ description: "URL for open/navigate/tab_new" })),
      selector: Type.Optional(Type.String({ description: "CSS selector for interactions, get, wait, scroll, highlight, frame" })),
      text: Type.Optional(Type.String({ description: "Text for fill/type/select/press/dialog_accept, or key name for press" })),
      code: Type.Optional(Type.String({ description: "JavaScript code for eval/addscript action" })),
      css: Type.Optional(Type.String({ description: "CSS code for addstyle action" })),
      // Is action: what to check
      check_type: Type.Optional(StringEnum(
        ["visible", "enabled", "checked"] as const,
        { description: "For is action: what to check" },
      )),
      // Storage
      storage_type: Type.Optional(StringEnum(
        ["local", "session"] as const,
        { description: "For storage actions: localStorage or sessionStorage (default: local)" },
      )),
      key: Type.Optional(Type.String({ description: "For storage_get/set, cookies_set: key/name" })),
      value: Type.Optional(Type.String({ description: "For storage_set, cookies_set: value" })),
      // Cookies set
      domain: Type.Optional(Type.String({ description: "For cookies_set: cookie domain" })),
      path: Type.Optional(Type.String({ description: "For cookies_set/download: cookie path or download path" })),
      secure: Type.Optional(Type.Boolean({ description: "For cookies_set: secure flag" })),
      expires: Type.Optional(Type.Number({ description: "For cookies_set: expiry as unix timestamp" })),
      // Get action: what property to retrieve
      property: Type.Optional(StringEnum(
        ["text", "html", "value", "attr", "count", "title", "styles", "url"] as const,
        { description: "For get action: which property to retrieve" },
      )),
      attr_name: Type.Optional(Type.String({ description: "For get action with property=attr: attribute name" })),
      // Find action
      find_by: Type.Optional(StringEnum(
        ["role", "text", "label", "placeholder", "testid", "title"] as const,
        { description: "For find action: what to search by" },
      )),
      find_value: Type.Optional(Type.String({ description: "For find action: value to search for" })),
      // Snapshot options
      compact: Type.Optional(Type.Boolean({ description: "For snapshot: compact output (less verbose)" })),
      interactive: Type.Optional(Type.Boolean({ description: "For snapshot: only interactive elements" })),
      max_depth: Type.Optional(Type.Number({ description: "For snapshot: max tree depth" })),
      // Scroll
      dx: Type.Optional(Type.Number({ description: "Horizontal scroll amount" })),
      dy: Type.Optional(Type.Number({ description: "Vertical scroll amount" })),
      // Wait
      hidden: Type.Optional(Type.Boolean({ description: "For wait: true to wait until element disappears" })),
      // Tabs
      tab_index: Type.Optional(Type.Number({ description: "For tab_switch/tab_close: tab index" })),
      // Cross-cutting
      snapshot_after: Type.Optional(Type.Boolean({ description: "Return accessibility snapshot after the action (saves a round-trip)" })),
      surface_id: Type.Optional(Type.String({ description: "Target browser surface ID (uses current if omitted)" })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      const sp = params.surface_id ? { surface_id: params.surface_id } : {};
      const snapshotAfter = params.snapshot_after ?? false;

      /** Run a browser action and optionally append a snapshot. */
      async function act(method: string, reqParams: Record<string, any>, fallback: string): Promise<ToolResult> {
        const result = await client.request(method, { ...reqParams, ...sp });
        if (isTimeout(result)) {
          const hint = client.circuitBreakerOpen
            ? " Circuit breaker is OPEN — multiple requests have timed out. The browser is likely stuck. Use tab_list to diagnose, then tab_new or tab_close to recover."
            : "";
          return errorResult(`${method} failed (cmux timeout).${hint}`);
        }
        if (!snapshotAfter) return formatResult(result ?? fallback);
        // Snapshot after action — the action already completed, so DOM should reflect the change.
        // Fire snapshot + url.get in parallel for richer context.
        const [snap, urlResult] = await client.parallel([
          { method: "browser.snapshot", params: sp },
          { method: "browser.url.get", params: sp },
        ]);
        const url = typeof urlResult === "string" ? urlResult : urlResult?.url;
        return formatResult({ action_result: result ?? fallback, snapshot: snap, ...(url ? { url } : {}) });
      }

      switch (params.action) {
        // --- Navigation ---
        case "open": {
          if (!params.url) return errorResult("url is required for open");
          const result = await client.request("browser.open_split", { url: params.url, ...sp });
          if (result === null || result === undefined) {
            return errorResult(
              `Failed to open browser split for ${params.url} (cmux timeout). ` +
              `Check that cmux is running and the socket is available.`
            );
          }
          if (!snapshotAfter) return formatResult(result ?? "Browser split opened");
          // For open, the surface_id comes from the result
          const openSurfaceId = result?.surface_id;
          const snapSp = openSurfaceId ? { surface_id: openSurfaceId } : sp;
          const snap = await client.request("browser.snapshot", snapSp);
          return formatResult({ action_result: result ?? "Browser split opened", snapshot: snap });
        }
        case "navigate": {
          if (!params.url) return errorResult("url is required for navigate");
          const navResult = await client.request("browser.navigate", { url: params.url, ...sp });

          // If navigate timed out, auto-fallback: open in a new tab instead
          if (isTimeout(navResult)) {
            const newTab = await client.request("browser.tab.new", { url: params.url, ...sp });
            if (isTimeout(newTab)) {
              return errorResult(
                `Navigate to ${params.url} failed and tab_new fallback also timed out. ` +
                `The browser may be completely unresponsive. Try closing and reopening it.`
              );
            }
            client.resetCircuitBreaker();
            const fallbackMsg = `Navigate timed out — opened ${params.url} in a new tab instead.`;
            if (!snapshotAfter) return formatResult({ ...newTab, note: fallbackMsg });
            // snapshot in parallel with nothing — just fire it on the new tab
            const fallbackSurfaceId = newTab?.surface_id;
            const fallbackSp = fallbackSurfaceId ? { surface_id: fallbackSurfaceId } : sp;
            const fallbackSnap = await client.request("browser.snapshot", fallbackSp);
            return formatResult({ action_result: fallbackMsg, new_tab: newTab, snapshot: fallbackSnap });
          }

          // Fire url verification and optional snapshot in parallel
          // Both are read-only after navigate completes — no ordering dependency
          const pendingUrl = client.request("browser.url.get", sp);
          const pendingSnap = snapshotAfter ? client.request("browser.snapshot", sp) : null;
          const [urlAfter, navSnap] = await Promise.all([pendingUrl, pendingSnap]);

          const actualUrl = typeof urlAfter === "string" ? urlAfter : urlAfter?.url;
          if (actualUrl && params.url && !actualUrl.startsWith(params.url.replace(/\/$/, ""))) {
            // URL didn't change — try tab_new as fallback
            const recoveryTab = await client.request("browser.tab.new", { url: params.url, ...sp });
            if (!isTimeout(recoveryTab)) {
              client.resetCircuitBreaker();
              const recoveryMsg = `Navigate to ${params.url} didn't take effect (still on ${actualUrl}). Opened in a new tab instead.`;
              if (!snapshotAfter) return formatResult({ ...recoveryTab, note: recoveryMsg });
              const recoverySurfaceId = recoveryTab?.surface_id;
              const recoverySp = recoverySurfaceId ? { surface_id: recoverySurfaceId } : sp;
              const recoverySnap = await client.request("browser.snapshot", recoverySp);
              return formatResult({ action_result: recoveryMsg, new_tab: recoveryTab, snapshot: recoverySnap });
            }
            return errorResult(
              `Navigate to ${params.url} failed — browser is still on ${actualUrl} and tab_new also failed.`
            );
          }

          if (!snapshotAfter) return formatResult(navResult ?? "Navigated");
          return formatResult({ action_result: navResult ?? "Navigated", snapshot: navSnap });
        }
        case "back":    return act("browser.back", {}, "Navigated back");
        case "forward": return act("browser.forward", {}, "Navigated forward");
        case "reload":  return act("browser.reload", {}, "Reloaded");

        // --- Snapshot & query ---
        case "snapshot": {
          const snapParams: Record<string, any> = { ...sp };
          if (params.compact) snapParams.compact = true;
          if (params.interactive) snapParams.interactive = true;
          if (params.max_depth !== undefined) snapParams.max_depth = params.max_depth;
          if (params.selector) snapParams.selector = params.selector;
          const result = await client.request("browser.snapshot", snapParams);
          return formatResult(result);
        }
        case "screenshot": {
          // If snapshot_after requested, fire both in parallel — screenshot and snapshot are independent reads
          if (snapshotAfter) {
            const [ssResult, snapResult] = await client.parallel([
              { method: "browser.screenshot", params: sp },
              { method: "browser.snapshot", params: sp },
            ]);
            if (isTimeout(ssResult)) {
              return errorResult(
                "Screenshot failed (cmux timeout). The browser may be on an error page or unresponsive. " +
                "Try tab_list to check the current URL, or open a new tab with tab_new."
              );
            }
            return formatResult({ screenshot: ssResult, snapshot: snapResult });
          }
          const result = await client.request("browser.screenshot", sp);
          if (isTimeout(result)) {
            return errorResult(
              "Screenshot failed (cmux timeout). The browser may be on an error page or unresponsive. " +
              "Try tab_list to check the current URL, or open a new tab with tab_new."
            );
          }
          return formatResult(result);
        }
        case "get": {
          const prop = params.property;
          if (!prop) return errorResult("property is required for get (text/html/value/attr/count/title/styles/url)");
          if (prop === "url") {
            const result = await client.request("browser.url.get", sp);
            if (result === null || result === undefined) {
              return errorResult(
                "URL fetch failed (cmux timeout). The browser may be unresponsive. " +
                "Try tab_list which also shows URLs."
              );
            }
            return formatResult(result);
          }
          if (prop === "title") {
            const result = await client.request("browser.get.title", sp);
            return formatResult(result);
          }
          if (!params.selector) return errorResult(`selector is required for get ${prop}`);
          const getParams: Record<string, any> = { selector: params.selector, ...sp };
          if (prop === "attr") {
            if (!params.attr_name) return errorResult("attr_name is required for get attr");
            getParams.name = params.attr_name;
          }
          const result = await client.request(`browser.get.${prop}`, getParams);
          return formatResult(result);
        }
        case "wait": {
          if (!params.selector) return errorResult("selector is required for wait");
          const waitParams: Record<string, any> = { selector: params.selector, ...sp };
          if (params.hidden) waitParams.hidden = true;
          const result = await client.request("browser.wait", waitParams);
          if (isTimeout(result)) return errorResult("wait timed out — element not found or page unresponsive.");
          if (!snapshotAfter) return formatResult(result ?? "Element found");
          const snap = await client.request("browser.snapshot", sp);
          return formatResult({ action_result: result ?? "Element found", snapshot: snap });
        }

        // --- Interaction ---
        case "click": {
          if (!params.selector) return errorResult("selector is required for click");
          return act("browser.click", { selector: params.selector }, "Clicked");
        }
        case "dblclick": {
          if (!params.selector) return errorResult("selector is required for dblclick");
          return act("browser.dblclick", { selector: params.selector }, "Double-clicked");
        }
        case "fill": {
          if (!params.selector) return errorResult("selector is required for fill");
          return act("browser.fill", { selector: params.selector, text: params.text ?? "" }, "Filled");
        }
        case "type": {
          if (!params.selector) return errorResult("selector is required for type");
          if (!params.text) return errorResult("text is required for type");
          return act("browser.type", { selector: params.selector, text: params.text }, "Typed");
        }
        case "select": {
          if (!params.selector) return errorResult("selector is required for select");
          if (!params.text) return errorResult("text (option value) is required for select");
          return act("browser.select", { selector: params.selector, value: params.text }, "Selected");
        }
        case "press": {
          if (!params.text) return errorResult("text (key name) is required for press");
          return act("browser.press", { key: params.text }, "Key pressed");
        }
        case "hover": {
          if (!params.selector) return errorResult("selector is required for hover");
          return act("browser.hover", { selector: params.selector }, "Hovered");
        }
        case "check": {
          if (!params.selector) return errorResult("selector is required for check");
          return act("browser.check", { selector: params.selector }, "Checked");
        }
        case "uncheck": {
          if (!params.selector) return errorResult("selector is required for uncheck");
          return act("browser.uncheck", { selector: params.selector }, "Unchecked");
        }
        case "scroll": {
          const scrollParams: Record<string, any> = {};
          if (params.selector) scrollParams.selector = params.selector;
          scrollParams.dx = params.dx ?? 0;
          scrollParams.dy = params.dy ?? 0;
          return act("browser.scroll", scrollParams, "Scrolled");
        }
        case "scroll_into_view": {
          if (!params.selector) return errorResult("selector is required for scroll_into_view");
          return act("browser.scroll_into_view", { selector: params.selector }, "Scrolled into view");
        }
        case "highlight": {
          if (!params.selector) return errorResult("selector is required for highlight");
          const result = await client.request("browser.highlight", { selector: params.selector, ...sp });
          return formatResult(result ?? "Highlighted");
        }

        // --- Query: is ---
        case "is": {
          if (!params.selector) return errorResult("selector is required for is");
          const checkType = params.check_type ?? "visible";
          const result = await client.request(`browser.is.${checkType}`, { selector: params.selector, ...sp });
          return formatResult(result);
        }

        // --- Find ---
        case "find": {
          if (!params.find_by) return errorResult("find_by is required (role/text/label/placeholder/testid/title)");
          if (!params.find_value) return errorResult("find_value is required for find");
          const result = await client.request(`browser.find.${params.find_by}`, {
            [params.find_by]: params.find_value, ...sp,
          });
          return formatResult(result);
        }

        // --- Dialogs ---
        case "dialog_accept": {
          const dialogParams: Record<string, any> = { ...sp };
          if (params.text) dialogParams.text = params.text;
          const result = await client.request("browser.dialog.accept", dialogParams);
          return formatResult(result ?? "Dialog accepted");
        }
        case "dialog_dismiss": {
          const result = await client.request("browser.dialog.dismiss", sp);
          return formatResult(result ?? "Dialog dismissed");
        }

        // --- Tabs ---
        case "tab_list": {
          const result = await client.request("browser.tab.list", sp);
          // Enrich with circuit breaker status so agent knows if browser is stuck
          if (result && typeof result === "object" && client.circuitBreakerOpen) {
            return formatResult({
              ...result,
              _warning: "Circuit breaker is OPEN — multiple recent requests timed out. The browser may be stuck on an error page. Use tab_new to open a fresh tab, or tab_close to close stuck tabs.",
            });
          }
          return formatResult(result);
        }
        case "tab_new": {
          const tabParams: Record<string, any> = { ...sp };
          if (params.url) tabParams.url = params.url;
          const result = await client.request("browser.tab.new", tabParams);
          return formatResult(result);
        }
        case "tab_switch": {
          if (params.tab_index === undefined) return errorResult("tab_index is required for tab_switch");
          const result = await client.request("browser.tab.switch", { index: params.tab_index, ...sp });
          return formatResult(result ?? "Tab switched");
        }
        case "tab_close": {
          const closeParams: Record<string, any> = { ...sp };
          if (params.tab_index !== undefined) closeParams.index = params.tab_index;
          const result = await client.request("browser.tab.close", closeParams);
          return formatResult(result ?? "Tab closed");
        }

        // --- Cookies ---
        case "cookies_get": {
          const cookieParams: Record<string, any> = { ...sp };
          if (params.key) cookieParams.name = params.key;
          if (params.domain) cookieParams.domain = params.domain;
          const result = await client.request("browser.cookies.get", cookieParams);
          return formatResult(result);
        }
        case "cookies_set": {
          if (!params.key) return errorResult("key (cookie name) is required for cookies_set");
          if (params.value === undefined) return errorResult("value is required for cookies_set");
          const cookieParams: Record<string, any> = { name: params.key, value: params.value, ...sp };
          if (params.url) cookieParams.url = params.url;
          if (params.domain) cookieParams.domain = params.domain;
          if (params.path) cookieParams.path = params.path;
          if (params.secure) cookieParams.secure = true;
          if (params.expires !== undefined) cookieParams.expires = params.expires;
          const result = await client.request("browser.cookies.set", cookieParams);
          return formatResult(result ?? "Cookie set");
        }
        case "cookies_clear": {
          const clearParams: Record<string, any> = { ...sp };
          if (params.domain) clearParams.domain = params.domain;
          const result = await client.request("browser.cookies.clear", clearParams);
          return formatResult(result ?? "Cookies cleared");
        }

        // --- Storage ---
        case "storage_get": {
          const storageType = params.storage_type ?? "local";
          const storageParams: Record<string, any> = { type: storageType, ...sp };
          if (params.key) storageParams.key = params.key;
          const result = await client.request("browser.storage.get", storageParams);
          return formatResult(result);
        }
        case "storage_set": {
          if (!params.key) return errorResult("key is required for storage_set");
          if (params.value === undefined) return errorResult("value is required for storage_set");
          const storageType = params.storage_type ?? "local";
          const result = await client.request("browser.storage.set", {
            type: storageType, key: params.key, value: params.value, ...sp,
          });
          return formatResult(result ?? "Storage value set");
        }
        case "storage_clear": {
          const storageType = params.storage_type ?? "local";
          const result = await client.request("browser.storage.clear", { type: storageType, ...sp });
          return formatResult(result ?? "Storage cleared");
        }

        // --- Network ---
        case "network": {
          const result = await client.request("browser.network.requests", sp);
          return formatResult(result);
        }

        // --- Inject ---
        case "addstyle": {
          if (!params.css) return errorResult("css is required for addstyle");
          const result = await client.request("browser.addstyle", { css: params.css, ...sp });
          return formatResult(result ?? "Style injected");
        }
        case "addscript": {
          if (!params.code) return errorResult("code is required for addscript");
          const result = await client.request("browser.addscript", { script: params.code, ...sp });
          return formatResult(result ?? "Script injected");
        }

        // --- State & debug ---
        case "console": {
          const result = await client.request("browser.console.list", sp);
          if (result === null || result === undefined) {
            return errorResult(
              "Console fetch failed (cmux timeout). The browser page may be unresponsive or on an error page. " +
              "Try tab_list to check browser state."
            );
          }
          return formatResult(result);
        }
        case "errors": {
          const result = await client.request("browser.errors.list", sp);
          if (result === null || result === undefined) {
            return errorResult(
              "Errors fetch failed (cmux timeout). The browser page may be unresponsive or on an error page. " +
              "Try tab_list to check browser state."
            );
          }
          return formatResult(result);
        }
        case "eval": {
          if (!params.code) return errorResult("code is required for eval");
          const result = await client.request("browser.eval", { code: params.code, ...sp });
          return formatResult(result);
        }
        case "download": {
          const dlParams: Record<string, any> = { ...sp };
          if (params.path) dlParams.path = params.path;
          const result = await client.request("browser.download.wait", dlParams);
          return formatResult(result);
        }

        // --- Frames ---
        case "frame": {
          if (!params.selector) return errorResult("selector is required for frame");
          const result = await client.request("browser.frame.select", { selector: params.selector, ...sp });
          return formatResult(result ?? "Frame selected");
        }
        case "frame_main": {
          const result = await client.request("browser.frame.main", sp);
          return formatResult(result ?? "Switched to main frame");
        }

        default:
          return errorResult(`Unknown action: ${params.action}`);
      }
    },
  });

  // --- cmux_workspace ---
  pi.registerTool({
    name: "cmux_workspace",
    label: "Workspace",
    description: [
      "Control cmux workspaces and surfaces. List workspaces, create new ones, split panes, focus surfaces, flash surfaces, send text to other terminals, and identify the current context.",
      "",
      "Actions:",
      "- list: List all workspaces and their surfaces",
      "- create: Create a new workspace",
      "- split: Split a surface (direction: right or down)",
      "- focus: Focus a specific surface by ID",
      "- flash: Visually flash a surface to identify it",
      "- identify: Get the current focused context (window, workspace, pane, surface)",
      "- send_text: Send text to a surface (e.g. type a command into another terminal pane)",
      "- send_key: Send a keypress to a surface",
      "- close: Close a surface",
    ].join("\n"),
    parameters: Type.Object({
      action: StringEnum([
        "list", "create", "split", "focus", "flash",
        "identify", "send_text", "send_key", "close",
      ] as const),
      surface_id: Type.Optional(Type.String({ description: "Target surface ID for focus/flash/split/send_text/send_key/close" })),
      workspace_id: Type.Optional(Type.String({ description: "Target workspace ID for create/list operations" })),
      direction: Type.Optional(StringEnum(["right", "down"] as const, { description: "Split direction (default: right)" })),
      text: Type.Optional(Type.String({ description: "Text to send for send_text, or key name for send_key" })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      switch (params.action) {
        case "list": {
          const result = await client.request("workspace.list", {});
          return formatResult(result);
        }
        case "create": {
          const result = await client.request("workspace.create", {});
          return formatResult(result);
        }
        case "split": {
          const splitParams: Record<string, any> = {};
          if (params.surface_id) splitParams.surface_id = params.surface_id;
          if (params.direction) splitParams.direction = params.direction;
          const result = await client.request("surface.split", splitParams);
          return formatResult(result);
        }
        case "focus": {
          if (!params.surface_id) return errorResult("Error: surface_id is required for focus action");
          const result = await client.request("surface.focus", { surface_id: params.surface_id });
          return formatResult(result ?? "Focused");
        }
        case "flash": {
          if (!params.surface_id) return errorResult("Error: surface_id is required for flash action");
          const result = await client.request("surface.trigger_flash", { surface_id: params.surface_id });
          return formatResult(result ?? "Flashed");
        }
        case "identify": {
          const result = await client.request("system.identify", {});
          return formatResult(result);
        }
        case "send_text": {
          if (!params.surface_id) return errorResult("Error: surface_id is required for send_text action");
          if (!params.text) return errorResult("Error: text is required for send_text action");
          const result = await client.request("surface.send_text", { surface_id: params.surface_id, text: params.text });
          return formatResult(result ?? "Text sent");
        }
        case "send_key": {
          if (!params.surface_id) return errorResult("Error: surface_id is required for send_key action");
          if (!params.text) return errorResult("Error: text (key name) is required for send_key action");
          const result = await client.request("surface.send_key", { surface_id: params.surface_id, key: params.text });
          return formatResult(result ?? "Key sent");
        }
        case "close": {
          if (!params.surface_id) return errorResult("Error: surface_id is required for close action");
          const result = await client.request("surface.close", { surface_id: params.surface_id });
          return formatResult(result ?? "Closed");
        }
        default:
          return errorResult(`Unknown action: ${params.action}`);
      }
    },
  });

  // --- cmux_notify ---
  pi.registerTool({
    name: "cmux_notify",
    label: "Notify",
    description: "Send a notification to the user via cmux. Use when you need to explicitly get the user's attention — e.g. a long task finished, something needs review, or you have a question.",
    parameters: Type.Object({
      title: Type.String({ description: "Notification title" }),
      subtitle: Type.Optional(Type.String({ description: "Notification subtitle (shown smaller, below title)" })),
      body: Type.Optional(Type.String({ description: "Notification body text" })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      const surfaceId = process.env.CMUX_SURFACE_ID;

      if (surfaceId) {
        const result = await client.request("notification.create_for_surface", {
          surface_id: surfaceId,
          title: params.title,
          subtitle: params.subtitle ?? "",
          body: params.body ?? "",
        });
        return formatResult(result ?? "Notification sent");
      }

      const result = await client.request("notification.create", {
        title: params.title,
        subtitle: params.subtitle ?? "",
        body: params.body ?? "",
      });
      return formatResult(result ?? "Notification sent");
    },
  });
}
