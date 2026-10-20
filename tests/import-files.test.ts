import { readFileSync } from 'node:fs';
import type { App } from 'obsidian';
import { describe, expect, it } from 'vitest';
import { importChosenFiles } from '../src/import/import-files';

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');

/** A vault kept in a Map, with the few App methods the import calls. */
function fakeApp(folderPath: string, existing: string[] = []) {
	const files = new Map<string, string>(existing.map((path) => [path, '']));
	const app = {
		workspace: { getActiveFile: () => null },
		fileManager: { getNewFileParent: () => ({ path: folderPath }) },
		vault: {
			getAbstractFileByPath: (path: string) => (files.has(path) ? { path } : null),
			create: async (path: string, data: string) => {
				if (files.has(path)) throw new Error('File already exists.');
				files.set(path, data);
				return { path };
			},
		},
	};
	return { app: app as unknown as App, files };
}

const chosen = (name: string, text: string) => ({ name, text: async () => text });

describe('importChosenFiles', () => {
	it('writes one note per thread into the new-note folder', async () => {
		const { app, files } = fakeApp('Inbox');
		const result = await importChosenFiles(app, [chosen('batch.csv', fixture('batch.csv'))]);
		expect(result.problems).toEqual([]);
		expect(result.notes.map((note) => note.path)).toEqual([
			'Inbox/Which CRM do small teams actually like.md',
			'Inbox/Show HN A tiny thing with quotes slashes.md',
		]);
		expect(files.get('Inbox/Which CRM do small teams actually like.md')).toContain('platform: "Reddit"');
	});

	it('never overwrites an existing note and reports files it cannot read', async () => {
		const { app } = fakeApp('/', ['Which CRM do small teams actually like.md']);
		const result = await importChosenFiles(app, [
			chosen('notes.txt', 'just some text'),
			chosen('thread.json', fixture('batch-flat.json')),
		]);
		expect(result.notes.map((note) => note.path)).toEqual([
			'Which CRM do small teams actually like 1.md',
			'Show HN A tiny thing with quotes slashes.md',
		]);
		expect(result.problems).toEqual(['notes.txt: not a Comment Scraper JSON or CSV export.']);
	});
});
