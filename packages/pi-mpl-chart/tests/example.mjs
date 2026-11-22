export function latencyDashboard() {
  const days = Array.from({ length: 30 }, (_, i) => `2026-10-${String(i + 1).padStart(2, "0")}`);
  let s = 7; const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
  const p50 = days.map((_, i) => 42 + 6 * Math.sin(i / 4) + rnd() * 4);
  const p95 = p50.map((v) => v * 1.9 + rnd() * 10);
  const p99 = p95.map((v, i) => v * 1.4 + (i === 18 ? 90 : rnd() * 15));
  const services = ["api", "auth", "db", "cache", "queue"];
  return { name: "latency-dashboard", rc: { "figure.figsize": [9, 4.2] },
    grid: { rows: 1, cols: 2, width_ratios: [2.2, 1] },
    ops: [
      ["fill_between", [{ $dates: days }, p50, p95], { alpha: 0.18, color: "C0", lw: 0 }],
      ["plot", [{ $dates: days }, p50], { label: "p50" }],
      ["plot", [{ $dates: days }, p95], { label: "p95" }],
      ["plot", [{ $dates: days }, p99], { label: "p99", color: "#f5a97f" }],
      ["axhline", [250], { color: "#ed8796", ls: "--", lw: 1, label: "SLO" }],
      ["axvline", [{ $date: "2026-10-19" }], { color: "#eed49f", lw: 0.8, alpha: 0.6 }],
      ["$concise_x", []], ["set_ylabel", ["ms"]], ["set_title", ["Request latency, October"]],
      ["legend", [], { loc: "upper left", ncols: 4 }], ["set_ylim", [0, 300]],
      ["sca", [1]],
      ["barh", [services, [118, 64, 210, 12, 87]], { color: ["C0", "C1", "C4", "C2", "C3"], height: 0.6 }],
      ["invert_yaxis", []], ["grid", [false], { axis: "y" }], ["grid", [true], { axis: "x" }],
      ["set_xlabel", ["p95 ms"]], ["set_title", ["By service"]],
    ] };
}
