// Model access for distilling and naps. The real runner spawns
// `pi -p --no-extensions` with PI_OPTMEM_SUBAGENT=1 (so a child never wakes or
// writes memory). PI_OPTMEM_MODEL_CMD swaps in any executable for tests: it gets
// the model id as its only argument and the prompt on stdin.
import { spawn } from "node:child_process";
import { capTranscript, type Extracted } from "./sessions.ts";

export type ModelResult = { code: number; stdout: string; stderr: string };
export type ModelCall = (prompt: string, model: string | undefined) => Promise<ModelResult>;

export const PI_DEFAULT_MODEL = "(pi default)";
const CALL_TIMEOUT_MS = 10 * 60_000;

function spawnCapture(command: string, args: string[], input: string, env: NodeJS.ProcessEnv): Promise<ModelResult> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { env, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => child.kill("SIGTERM"), CALL_TIMEOUT_MS);
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ code: 127, stdout, stderr: `${stderr}${error.message}` });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? 1, stdout, stderr });
    });
    child.stdin.on("error", () => {});
    child.stdin.end(input);
  });
}

export function modelCall(env: NodeJS.ProcessEnv = process.env): ModelCall {
  const childEnv = { ...env, PI_OPTMEM_SUBAGENT: "1" };
  const fake = env.PI_OPTMEM_MODEL_CMD;
  if (fake) return (prompt, model) => spawnCapture(fake, [model ?? PI_DEFAULT_MODEL], prompt, childEnv);
  const pi = env.PI_OPTMEM_PI || "pi";
  return (prompt, model) =>
    spawnCapture(
      pi,
      [
        "-p",
        ...(model ? ["--model", model] : []),
        "--no-session",
        "--no-tools",
        "--no-extensions",
        "--no-skills",
        "--no-context-files",
        "--thinking",
        "low",
        "Follow the instructions in the text above exactly. Output only what they ask for.",
      ],
      prompt,
      childEnv,
    );
}

/** Errors where retrying the same model is pointless: try Pi's default once instead. */
export function isModelSetupError(result: ModelResult): boolean {
  return result.code !== 0 && /unknown (model|option)|model .*not found|no models? (match|available)|not authenticated|unauthori[sz]ed|api key|log ?in|401|403/i.test(`${result.stderr}\n${result.stdout}`);
}

export type ModelClientOptions = {
  readonly call: ModelCall;
  readonly model: string;
  readonly concurrency?: number;
  readonly retries?: number;
  readonly backoffMs?: number;
  readonly log?: (message: string) => void;
  readonly onCall?: () => void;
};

/** Bounded concurrency, retry with backoff, one-shot fallback to Pi's default model. */
export class ModelClient {
  private active = 0;
  private queue: (() => void)[] = [];
  private model: string | undefined;
  private fellBack = false;
  /** Settles after the first call; later calls wait so a bad model falls back once, before the fan-out. */
  private gate: Promise<unknown> | undefined;

  private readonly options: ModelClientOptions;

  constructor(options: ModelClientOptions) {
    this.options = options;
    this.model = options.model;
  }

  get modelUsed(): string {
    return this.model ?? PI_DEFAULT_MODEL;
  }

  private async slot<T>(fn: () => Promise<T>): Promise<T> {
    const limit = this.options.concurrency ?? 4;
    if (this.active >= limit) await new Promise<void>((resolve) => this.queue.push(resolve));
    this.active++;
    try {
      return await fn();
    } finally {
      this.active--;
      this.queue.shift()?.();
    }
  }

  private async once(prompt: string): Promise<ModelResult> {
    this.options.onCall?.();
    return this.options.call(prompt, this.model);
  }

  async complete(prompt: string): Promise<string> {
    if (!this.gate) {
      const first = this.slot(() => this.attempt(prompt));
      this.gate = first.catch(() => undefined);
      return first;
    }
    await this.gate;
    return this.slot(() => this.attempt(prompt));
  }

  private async attempt(prompt: string): Promise<string> {
    const retries = this.options.retries ?? 3;
    const backoff = this.options.backoffMs ?? 2_000;
    let last: ModelResult | undefined;
    for (let attempt = 0; attempt <= retries; attempt++) {
      const result = await this.once(prompt);
      if (result.code === 0 && result.stdout.trim()) return result.stdout;
      last = result;
      if (!this.fellBack && isModelSetupError(result)) {
        this.fellBack = true;
        this.options.log?.(`model ${this.model} failed (${firstLine(result)}); retrying with Pi's default model`);
        this.model = undefined;
        continue;
      }
      if (attempt < retries) await sleep(backoff * 2 ** attempt);
    }
    throw new Error(`model call failed: ${last ? firstLine(last) : "no result"}`);
  }
}

function firstLine(result: ModelResult): string {
  const text = (result.stderr || result.stdout).split("\n").find((l) => l.trim() && !/^Warning:/.test(l)) ?? `exit ${result.code}`;
  return text.trim().slice(0, 200);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------- distil

export const BATCH_CHARS = 48_000;
export const BATCH_SESSIONS = 8;

export type Batch = { readonly items: readonly Extracted[]; readonly transcripts: readonly string[] };

/** Greedy batches by size and count, in input order. Deterministic. */
export function makeBatches(items: readonly Extracted[], maxChars = BATCH_CHARS, maxSessions = BATCH_SESSIONS): Batch[] {
  const batches: Batch[] = [];
  let current: { items: Extracted[]; transcripts: string[]; size: number } = { items: [], transcripts: [], size: 0 };
  for (const item of items) {
    const transcript = capTranscript(item.turns);
    if (current.items.length && (current.items.length >= maxSessions || current.size + transcript.length > maxChars)) {
      batches.push(current);
      current = { items: [], transcripts: [], size: 0 };
    }
    current.items.push(item);
    current.transcripts.push(transcript);
    current.size += transcript.length;
  }
  if (current.items.length) batches.push(current);
  return batches;
}

export const DISTIL_RULES = `You distil past chat sessions between Iury (the user) and his coding agent into long-term memory lines.

For each session below, write 0 to 5 lines worth remembering for years. Most sessions deserve 0 or 1.

Keep only durable things:
- decisions and the reason for them
- preferences and working style
- where things live: repos, tools, vault notes, services
- ongoing projects and their state
- people and their roles

Never write:
- task chatter, debugging steps, tool output, file contents
- passport, ID, tax or bank numbers, phone numbers, street addresses, emails
- tokens, keys, passwords or other secrets
- amounts of money

Prefer pointers to copied facts, e.g. "Divorce docs: vault knowledge-base/relationships/divorce".

Format, one memory per line, nothing else:
YYYY-MM-DD <memory>
- Use the session's date from its header.
- English, one line, at most 280 bytes, no bullets, no quotes.
- Write NONE if no session has anything durable.`;

export function distilPrompt(batch: Batch): string {
  const sessions = batch.items.map((item, i) => `=== Session ${i + 1} | date ${item.date} | cwd ${item.session.cwd} ===\n${batch.transcripts[i]}`);
  return `${DISTIL_RULES}\n\n${sessions.join("\n\n")}\n\n=== End of sessions ===\nNow write the memory lines.`;
}

/** Raw lines from a distil reply, with dates outside the batch dropped as format errors by the filter. */
export function distilLines(output: string, batch: Batch): string[] {
  const dates = new Set(batch.items.map((item) => item.date));
  return output
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const date = /^(\d{4}-\d{2}-\d{2}) /.exec(line.replace(/^[-*•]\s+/, ""))?.[1];
      return date && !dates.has(date) ? `bad-date ${line}` : line;
    })
    .slice(0, batch.items.length * 5);
}

// ---------------------------------------------------------------- naps

export type NapRequest = { readonly lo: number; readonly hi: number; readonly input: readonly string[] };

export function napPrompt(requests: readonly NapRequest[]): string {
  const blocks = requests.map((r, i) => `[B${i + 1}] memories #${r.lo}-${r.hi - 1}:\n${r.input.map((l) => `  ${l}`).join("\n")}`);
  return `Compress each block of memories below into one line of at most 280 bytes.
Keep what has lasting effect, drop what does not. Invent nothing. English. No secrets, numbers of documents or amounts of money.

Answer with exactly one line per block, in this format and nothing else:
B<n> <your line>

${blocks.join("\n\n")}`;
}

/** Block index (0-based) to summary line. */
export function parseNaps(output: string, count: number): Map<number, string> {
  const out = new Map<number, string>();
  for (const raw of output.split("\n")) {
    const match = /^\s*\[?B(\d+)\]?[:.)]?\s+(.+)$/.exec(raw);
    if (!match) continue;
    const index = Number(match[1]) - 1;
    const text = match[2]!.replace(/\s+/g, " ").trim();
    if (index >= 0 && index < count && text && Buffer.byteLength(text, "utf8") <= 280 && !out.has(index)) out.set(index, text);
  }
  return out;
}

/** Last resort when the model keeps failing a block: a truncated join of its inputs. */
export function fallbackSummary(input: readonly string[]): string {
  const text = input.map((l) => l.replace(/^#[\d-]+ (\d{4}-\d{2}-\d{2} )?/, "")).join("; ");
  let out = text;
  while (Buffer.byteLength(out, "utf8") > 279) out = out.slice(0, -1);
  return out.length < text.length ? `${out.slice(0, -1)}…` : out;
}
