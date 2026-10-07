import { defineConfig } from "vite";

// Relative base works for GitHub project pages and for an embedded web view (ADR-0003).
export default defineConfig({ base: "./" });
