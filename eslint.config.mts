import obsidianmd from 'eslint-plugin-obsidianmd';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import { globalIgnores, defineConfig } from 'eslint/config';

export default defineConfig(
	globalIgnores([
		'node_modules',
		'dist',
		'tests',
		'esbuild.config.mjs',
		'version-bump.mjs',
		'vitest.config.mts',
		'versions.json',
		'main.js',
		'package.json',
		'package-lock.json',
		'tsconfig.json',
	]),
	{
		languageOptions: {
			globals: {
				...globals.browser,
			},
			parserOptions: {
				projectService: {
					allowDefaultProject: ['eslint.config.mts', 'manifest.json'],
				},
				tsconfigRootDir: import.meta.dirname,
				extraFileExtensions: ['.json'],
			},
		},
	},
	...obsidianmd.configs.recommended,
	// The recommended set doesn't match .json files, so the manifest check is switched on here.
	{
		files: ['manifest.json'],
		plugins: { obsidianmd },
		languageOptions: { parser: tseslint.parser },
		rules: { 'obsidianmd/validate-manifest': 'error' },
	},
);
