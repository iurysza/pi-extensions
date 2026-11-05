import { expect, it } from "vitest";
import { createRenderContext } from "./helpers/render-fixtures.js";

it("provides Pi 1.5 keybinding hints without assuming host bindings", () => {
	const context = createRenderContext();
	expect(context.keyText("app.tools.expand")).toBe("");
	expect(context.keyHint("app.tools.expand", "to expand")).toBe("to expand");

	const configured = createRenderContext({
		keyText: () => "ctrl+o",
		keyHint: (_keybinding, description) => `ctrl+o ${description}`,
	});
	expect(configured.keyText("app.tools.expand")).toBe("ctrl+o");
	expect(configured.keyHint("app.tools.expand", "to expand")).toBe("ctrl+o to expand");
});
