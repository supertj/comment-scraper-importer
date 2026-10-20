import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// The obsidian package ships type definitions only, so tests get a small stand-in.
export default defineConfig({
	resolve: {
		alias: { obsidian: fileURLToPath(new URL('./tests/obsidian-stub.ts', import.meta.url)) },
	},
	test: {
		include: ['tests/**/*.test.ts'],
	},
});
