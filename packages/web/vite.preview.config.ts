import { defineConfig } from "vite";

// The Preview's web build: a single classic (IIFE) script with no Web Worker,
// loaded over `file://` where ES modules and module workers are blocked
// (ADR-0010). `preview/` holds the bare HTML shell, copied in beside it.
export default defineConfig({
	base: "./",
	publicDir: "preview",
	build: {
		outDir: "dist/preview",
		emptyOutDir: false,
		lib: {
			entry: "src/preview.ts",
			name: "HpglPreview",
			formats: ["iife"],
			fileName: () => "preview.js",
		},
	},
});
