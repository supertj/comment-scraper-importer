// Just enough of the obsidian module for the import code to run under Vitest.
export function normalizePath(path: string): string {
	return path.replace(/[\\/]+/g, '/').replace(/^\/|\/$/g, '');
}
