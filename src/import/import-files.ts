import { normalizePath, type App, type TFile } from 'obsidian';
import { noteFileName, threadToNote } from './note';
import { parseExport } from './parse';

/** A file from the file picker. Only what the import needs, so tests can pass a stand-in. */
export interface ChosenFile {
	name: string;
	text(): Promise<string>;
}

export interface ImportResult {
	notes: TFile[];
	folderPath: string;
	problems: string[];
}

/**
 * Writes one note per thread into the folder Obsidian uses for new notes. Existing notes are
 * never overwritten: a second import of the same thread gets a numbered name. A file or thread
 * that fails is reported in `problems` and the rest still go in.
 */
export async function importChosenFiles(app: App, files: ChosenFile[]): Promise<ImportResult> {
	const folder = app.fileManager.getNewFileParent(app.workspace.getActiveFile()?.path ?? '');
	const notes: TFile[] = [];
	const problems: string[] = [];
	for (const file of files) {
		let parsed;
		try {
			parsed = parseExport(await file.text());
		} catch (error) {
			problems.push(`${file.name}: ${errorText(error)}.`);
			continue;
		}
		if (parsed.skipped > 0) {
			problems.push(`${file.name}: skipped ${parsed.skipped} damaged ${parsed.skipped === 1 ? 'thread' : 'threads'}.`);
		}
		for (const thread of parsed.threads) {
			const name = noteFileName(thread);
			try {
				notes.push(await app.vault.create(freePath(app, folder.path, name), threadToNote(thread)));
			} catch (error) {
				problems.push(`${name}: ${errorText(error)}.`);
			}
		}
	}
	return { notes, folderPath: folder.path, problems };
}

function freePath(app: App, folderPath: string, name: string): string {
	for (let copy = 0; ; copy++) {
		const path = normalizePath(`${folderPath}/${copy === 0 ? name : `${name} ${copy}`}.md`);
		if (!app.vault.getAbstractFileByPath(path)) return path;
	}
}

function errorText(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
