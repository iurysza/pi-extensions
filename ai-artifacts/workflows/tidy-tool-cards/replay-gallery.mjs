// Offline replay only. /chill is a local command; never submit a model prompt.
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const home = homedir();
const gallery = process.env.TOOL_CARDS_GALLERY ?? join(home, "dev/personal/tools/agents2/ai-artifacts/tool-ui-inventory/gallery");
const replay = "/tmp/tool-cards-v2-gallery";
const isolatedHome = "/tmp/tool-cards-v2-home";
const agentDir = join(isolatedHome, ".pi/agent");
const tools = join(home, ".local/share/agents2/tools");
const pi = "/tmp/pi104-tool-cards-run/node_modules/.bin/pi";
const extensions = [
  join(root, "packages/pi-ext/extensions/tool-presentation/index.ts"),
  join(tools, "tintinweb-pi-subagents/0.19.0/node_modules/@tintinweb/pi-subagents/src/index.ts"),
  join(tools, "pi-web-access/0.35.0/node_modules/pi-web-access/dist/index.js"),
  join(tools, "pi-ask-user/0.15.1/node_modules/pi-ask-user/index.ts"),
  join(tools, "visual-artifact-pi/079d4fc350173d3b43fa82ea06443abcc223b17a/pi-extension/visual-artifact.ts"),
];
mkdirSync(agentDir, { recursive: true });
writeFileSync(join(agentDir, "settings.json"), JSON.stringify({ packages: [], quietStartup: true, theme: "tokyo-night", checkForUpdates: false, enableSkillCommands: false, telemetry: { enabled: false } }));
writeFileSync(join(agentDir, "pi-tidy-tools.json"), JSON.stringify({ enabled: true, chill: false }));
execFileSync("node", [join(gallery, "make-session-real.mjs"), replay], { env: { ...process.env, TOOL_CARDS_WORKTREE: root }, stdio: "inherit" });
const tc = (...args) => execFileSync("termctrl", args, { env: { ...process.env, TERMCTRL_RUNTIME_DIR: "/tmp/tc" }, encoding: "utf8" });
for (let page = 1; page <= 5; page++) {
  const name = `tc-v2-gallery-${page}`;
  tc("start", name, "--cols", "120", "--rows", "80", "--cwd", replay, "--", "env",
    `HOME=${isolatedHome}`, `PI_CODING_AGENT_DIR=${agentDir}`, "PI_OFFLINE=1", "PI_TELEMETRY=0", "PI_TIDY_TOOLS=on", pi,
    "--no-extensions", "--no-context-files", "--no-skills", "--no-prompt-templates", "--no-themes", "--no-mcp", "--no-approve",
    "--theme", join(tools, "pi-themes/1.0.1/node_modules/pi-themes/themes/tokyo-night.json"), "--use-theme", "tokyo-night",
    "--session", join(replay, `gallery-${page}.jsonl`), "--session-dir", replay, ...extensions.flatMap((entry) => ["-e", entry]));
  const capture = (mode) => {
    console.log(tc("show", name));
    console.log(tc("save", name, "--format", "png", "--out", join(gallery, `v2-${mode}-${page}.png`), "--font-family", "IoskeleyMonoTerm Nerd Font Mono", "--hide-cursor").trim());
  };
  try {
    tc("wait", name, "Could not restore model", "--timeout", "15000");
    capture("collapsed");
    tc("send", name, "ctrl-o"); tc("wait", name, "Tool output: expanded", "--timeout", "5000");
    capture("expanded");
    if (page === 2 || page === 4) {
      tc("send", name, "page-up", "page-up"); tc("wait", name, "Replay only.", "--timeout", "5000");
      capture("expanded-top");
      tc("send", name, "page-down", "page-down");
    }
    tc("send", name, "ctrl-o", "text:/chill", "enter"); tc("wait", name, "Chill mode on", "--timeout", "5000");
    capture("chill");
  } finally { tc("stop", name); }
}
