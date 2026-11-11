// Loader. The extension lives in ./main.ts; see ./prebundle.ts.
import { loadPrebundled } from "./prebundle.js";

const mod = await loadPrebundled<typeof import("./main.js")>(
	new URL("../.prebundle/pi-token-tank/", import.meta.url),
	() => import("./main.js"),
);
export default mod.default;
