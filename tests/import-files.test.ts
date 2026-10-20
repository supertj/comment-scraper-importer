import { readFileSync } from 'node:fs';
import type { App } from 'obsidian';
import { describe, expect, it } from 'vitest';
import { importChosenFiles } from '../src/import/import-files';

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');

/**
 * A one-folder vault kept in a Map, with the few App methods the import calls. Like macOS and
 * Windows, it refuses a name that differs from an existing one only in case.
 */
function fakeApp(folderPath: string, existing: string[] = []) {
	const files = new Map<string, string>(existing.map((name) => [name, '']));
	const pathOf = (name: string) => (folderPath === '/' ? name : `${folderPath}/${name}`);
	const app = {
		workspace: { getActiveFile: () => null },
		fileManager: {
			getNewFileParent: () => ({ path: folderPath, children: [...files.keys()].map((name) => ({ name })) }),
		},
		vault: {
			create: async (path: string, data: string) => {
				const name = path.split('/').pop()!;
				if ([...files.keys()].some((taken) => taken.toLowerCase() === name.toLowerCase())) throw new Error('File already exists.');
				files.set(name, data);
				return { path };
			},
		},
	};
	return { app: app as unknown as App, files, pathOf };
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
		expect(files.get('Which CRM do small teams actually like.md')).toContain('platform: "Reddit"');
	});

	it('never overwrites an existing note, even one named in a different case', async () => {
		const { app } = fakeApp('/', ['which crm do small teams actually like.md']);
		const result = await importChosenFiles(app, [
			chosen('notes.txt', 'just some text'),
			chosen('thread.json', fixture('batch-flat.json')),
			chosen('again.json', fixture('batch-flat.json')),
		]);
		expect(result.notes.map((note) => note.path)).toEqual([
			'Which CRM do small teams actually like 1.md',
			'Show HN A tiny thing with quotes slashes.md',
			'Which CRM do small teams actually like 2.md',
			'Show HN A tiny thing with quotes slashes 1.md',
		]);
		expect(result.problems).toEqual(['notes.txt: not a Comment Scraper JSON or CSV export.']);
	});
});
