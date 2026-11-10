// Loader. The extension lives in ./main.ts; see ../shared/prebundle.ts.
import { loadPrebundled } from "../shared/prebundle.js";

const mod = await loadPrebundled<typeof import("./main.js")>(
	new URL("../../.prebundle/session-snap/", import.meta.url),
	() => import("./main.js"),
);
export default mod.default;
