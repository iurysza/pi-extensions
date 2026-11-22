import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

export type Op = [method: string, args?: unknown[], kwargs?: Record<string, unknown>];

export interface RenderParams {
  name: string;
  style?: string;
  rc?: Record<string, unknown>;
  grid?: { rows: number; cols: number; width_ratios?: number[]; height_ratios?: number[]; sharex?: boolean | string; sharey?: boolean | string };
  ops: Op[];
  scale?: number;
  dpi?: number;
}

export type RenderResult =
  | { image: string; pngPath: string; width: number; height: number }
  | { error: string };

const FIGURE_OPS = new Set(["suptitle", "tight_layout"]);
const FORBIDDEN = new Set(["constructor", "prototype", "__proto__", "toString", "valueOf", "hasOwnProperty"]);

/** `{$dates: [...]}` / `{$date: "..."}` anywhere in the value become Date objects (UTC). */
export function decode(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(decode);
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if ("$dates" in record) {
      if (!Array.isArray(record.$dates)) throw new Error("$dates must be an array of ISO strings");
      return record.$dates.map(parseDate);
    }
    if ("$date" in record) return parseDate(record.$date);
    return Object.fromEntries(Object.entries(record).map(([k, v]) => [k, decode(v)]));
  }
  return value;
}

function parseDate(value: unknown): Date {
  if (typeof value !== "string") throw new Error(`bad $date ${JSON.stringify(value)}: expected an ISO string`);
  const m = /^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}:\d{2})(?::(\d{2})(?:\.(\d+))?)?)?Z?$/.exec(value);
  if (!m) throw new Error(`bad $date ${JSON.stringify(value)}: expected ISO like 2026-10-19 or 2026-10-19T14:30`);
  const iso = `${m[1]}T${m[2] ?? "00:00"}:${m[3] ?? "00"}.${(m[4] ?? "0").slice(0, 3).padEnd(3, "0")}Z`;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) throw new Error(`bad $date ${JSON.stringify(value)}: not a real date`);
  return date;
}

function safeName(name: string): string {
  return name.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "chart";
}

function pngSize(png: Uint8Array): { width: number; height: number } {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

type Dyn = Record<string, (...args: unknown[]) => unknown>;

export async function renderChart(params: RenderParams, outDir = path.join(tmpdir(), "pi-mpl")): Promise<RenderResult> {
  let step = "setup";
  try {
    if (!params || typeof params.name !== "string" || !params.name) throw new Error("name is required");
    if (!Array.isArray(params.ops)) throw new Error("ops must be an array");
    const mpl = await import("../vendor/mpl/browser/index.js");
    const fonts = await import("../vendor/mpl/browser/fonts/all.js");
    mpl.registerFonts(...Object.values(fonts.allFonts));

    const grid = params.grid;
    const options = { style: params.style ?? "pro-slate", rc: params.rc ?? {} } as Record<string, unknown>;
    let fig: any;
    let axes: any[];
    if (grid) {
      const made = (mpl.subplots as any)(grid.rows, grid.cols, {
        ...options,
        squeeze: false,
        ...(grid.width_ratios || grid.height_ratios
          ? { gridspec_kw: { ...(grid.width_ratios ? { width_ratios: grid.width_ratios } : {}), ...(grid.height_ratios ? { height_ratios: grid.height_ratios } : {}) } }
          : {}),
        ...(grid.sharex !== undefined ? { sharex: grid.sharex } : {}),
        ...(grid.sharey !== undefined ? { sharey: grid.sharey } : {}),
      });
      fig = made[0];
      axes = (made[1] as any[][]).flat();
    } else {
      const made = (mpl.subplots as any)(options);
      fig = made[0];
      axes = [made[1]];
    }
    let ax = axes[0];

    for (let i = 0; i < params.ops.length; i++) {
      const op = params.ops[i];
      step = `op ${i}`;
      if (!Array.isArray(op) || typeof op[0] !== "string") throw new Error("must be [method, args[], kwargs?]");
      const [method, rawArgs = [], rawKwargs] = op;
      step = `op ${i} '${method}'`;
      if (!Array.isArray(rawArgs)) throw new Error("args must be an array");
      if (method.startsWith("_") || FORBIDDEN.has(method)) throw new Error(`method not allowed`);
      const args = rawArgs.map(decode);
      const kwargs = rawKwargs && Object.keys(rawKwargs).length ? [decode(rawKwargs)] : [];

      if (method === "sca") {
        const index = args[0];
        if (!Number.isInteger(index) || (index as number) < 0 || (index as number) >= axes.length) {
          throw new Error(`axes index ${String(index)} out of range (have ${axes.length})`);
        }
        ax = axes[index as number];
        continue;
      }
      if (method === "$concise_x" || method === "$concise_y") {
        const axis = method === "$concise_x" ? ax.xaxis : ax.yaxis;
        const locator = new mpl.AutoDateLocator();
        axis.set_major_locator(locator);
        axis.set_major_formatter(new mpl.ConciseDateFormatter(locator, {}));
        continue;
      }
      if (FIGURE_OPS.has(method)) {
        (fig as Dyn)[method]?.(...args, ...kwargs);
        continue;
      }
      if (typeof (ax as Dyn)[method] !== "function" || !(method in Object.getPrototypeOf(ax))) {
        throw new Error("unknown Axes method");
      }
      (ax as Dyn)[method](...args, ...kwargs);
    }

    step = "render";
    fig.tight_layout();
    const pngOptions: Record<string, unknown> = { scale: params.scale ?? 2 };
    if (params.dpi !== undefined) pngOptions.dpi = params.dpi;
    const png: Uint8Array = fig.toPNGSync(pngOptions);
    const { width, height } = pngSize(png);
    await mkdir(outDir, { recursive: true });
    const pngPath = path.join(outDir, `${safeName(params.name)}-${Date.now()}.png`);
    await writeFile(pngPath, png);
    return { image: `data:image/png;base64,${Buffer.from(png).toString("base64")}`, pngPath, width, height };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { error: `${step}: ${message}` };
  }
}

const opSchema = {
  type: "array",
  minItems: 1,
  maxItems: 3,
  description: "[method, args[], kwargs?]",
};

export default function piMplChart(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "mpl_render",
    label: "mpl render",
    description:
      "Render a matplotlib-style chart to PNG with mpljs. Input is a figure spec and a list of Axes calls [method, args[], kwargs?] replayed in order. " +
      'Use ["sca",[i]] to switch axes (flat index), {"$dates":[iso...]} / {"$date":"iso"} for date values, and ["$concise_x",[]] for a compact date axis. ' +
      "Returns { image (data URL), pngPath, width, height } or { error }. Call from codemode: `const r = await tools.mpl_render({...}); image(r.image)`.",
    promptSnippet: "mpl_render — render a matplotlib-style chart (mpljs) to PNG",
    promptGuidelines: [
      "Use mpl_render to draw charts; prefer calling it from codemode so you can compute data in JavaScript first.",
      "mpl_render ops mirror matplotlib Axes methods (plot, fill_between, barh, set_title, legend, ...); styles: pro-slate (default), pro-dark, pro-mono, pro-ember.",
      "After mpl_render, call image(r.image) and look at the chart: fix clipped labels, overlaps or wrong scales and re-render before replying.",
      "Give the user the chart's pngPath in your reply; when the work reports through the Plannotator Inbox, embed the PNG there too.",
    ],
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", minLength: 1, description: "Short chart name, used in the PNG file name." },
        style: { type: "string", description: "Style sheet: pro-slate (default), pro-dark, pro-mono, pro-ember, or a bundled matplotlib style." },
        rc: { type: "object", description: 'rc overrides, e.g. {"figure.figsize":[9,4.2]}.' },
        grid: {
          type: "object",
          properties: {
            rows: { type: "integer", minimum: 1 },
            cols: { type: "integer", minimum: 1 },
            width_ratios: { type: "array", items: { type: "number" } },
            height_ratios: { type: "array", items: { type: "number" } },
            sharex: { type: ["boolean", "string"] },
            sharey: { type: ["boolean", "string"] },
          },
          required: ["rows", "cols"],
          additionalProperties: false,
        },
        ops: { type: "array", items: opSchema, description: "Axes calls replayed in order on the current axes." },
        scale: { type: "number", minimum: 0.5, maximum: 4, description: "Pixel scale (default 2)." },
        dpi: { type: "number", minimum: 20, maximum: 600 },
      },
      required: ["name", "ops"],
      additionalProperties: false,
    } as any,
    outputSchema: {
      type: "object",
      properties: {
        image: { type: "string", description: "PNG data URL" },
        pngPath: { type: "string" },
        width: { type: "number" },
        height: { type: "number" },
        error: { type: "string" },
      },
      additionalProperties: false,
    } as any,
    async execute(_toolCallId: string, params: unknown) {
      const result = await renderChart(params as RenderParams);
      if ("error" in result) {
        return {
          content: [{ type: "text" as const, text: `mpl_render failed: ${result.error}` }],
          structuredContent: result,
          details: result,
          isError: true,
        };
      }
      const base64 = result.image.slice(result.image.indexOf(",") + 1);
      return {
        content: [
          { type: "text" as const, text: `Rendered ${result.width}x${result.height} chart: ${result.pngPath}` },
          { type: "image" as const, data: base64, mimeType: "image/png" },
        ],
        structuredContent: result,
        details: { pngPath: result.pngPath, width: result.width, height: result.height },
      };
    },
  } as any);
}
