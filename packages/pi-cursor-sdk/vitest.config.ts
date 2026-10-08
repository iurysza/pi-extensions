import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		maxWorkers: 4,
		include: ["test/**/*.test.ts"],
		exclude: ["test/**/*.compile.test.ts"],
	},
});
