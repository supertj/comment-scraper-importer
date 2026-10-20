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
	// Lower-cased, because macOS and Windows treat "Thread.md" and "thread.md" as the same file
	// while the vault lookup by path doesn't.
	const taken = new Set(folder.children.map((child) => child.name.toLowerCase()));
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
				const fileName = freeFileName(taken, name);
				notes.push(await app.vault.create(normalizePath(`${folder.path}/${fileName}`), threadToNote(thread)));
				taken.add(fileName.toLowerCase());
			} catch (error) {
				problems.push(`${name}: ${errorText(error)}.`);
			}
		}
	}
	return { notes, folderPath: folder.path, problems };
}

function freeFileName(taken: Set<string>, name: string): string {
	for (let copy = 0; ; copy++) {
		const fileName = `${copy === 0 ? name : `${name} ${copy}`}.md`;
		if (!taken.has(fileName.toLowerCase())) return fileName;
	}
}

function errorText(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
