#!/usr/bin/env node
// Stand-in for `pi -p`. Arg: model id. Stdin: prompt.
// FAKE_MODEL_FAIL=<id> exits 1 with "unknown model" for that id.
// FAKE_MODEL_LOG=<file> appends one line per call: "<model> distil|nap".
import { appendFileSync, readFileSync } from "node:fs";

const model = process.argv[2];
const prompt = readFileSync(0, "utf8");
if (process.env.FAKE_MODEL_FAIL && process.env.FAKE_MODEL_FAIL === model) {
  process.stderr.write(`Error: unknown model ${model}\n`);
  process.exit(1);
}
const kind = prompt.includes("=== Session ") ? "distil" : "nap";
if (process.env.FAKE_MODEL_LOG) appendFileSync(process.env.FAKE_MODEL_LOG, `${model} ${kind}\n`);

if (kind === "distil") {
  const out = [];
  for (const match of prompt.matchAll(/=== Session (\d+) \| date (\S+) \| cwd (\S*) ===\n([\s\S]*?)(?=\n\n=== )/g)) {
    const [, n, date, cwd, body] = match;
    const first = /U: (.*)/.exec(body)?.[1] ?? "";
    out.push(`${date} Session ${n} in ${cwd}: ${first.slice(0, 60)}`);
    if (body.includes("SECRET")) out.push(`${date} Passport number is X1234567`, `${date} Mail me at a@b.co`);
  }
  console.log(out.length ? out.join("\n") : "NONE");
} else {
  const blocks = [...prompt.matchAll(/\[B(\d+)\] memories #(\d+)-(\d+)/g)];
  console.log(blocks.map(([, n, lo, hi]) => `B${n} summary of ${lo}-${hi}`).join("\n"));
}
