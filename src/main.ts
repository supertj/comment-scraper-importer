import { Notice, Plugin } from 'obsidian';
import { importChosenFiles } from './import/import-files';

export default class CommentScraperImporter extends Plugin {
	onload(): void {
		this.addCommand({
			id: 'import-threads',
			name: 'Import exported threads',
			callback: () => this.chooseFiles(),
		});
	}

	/** The only file outside the vault the plugin ever reads is the one picked here. */
	private chooseFiles(): void {
		const input = createEl('input', { type: 'file', attr: { accept: '.json,.csv', multiple: true } });
		input.addEventListener('change', () => {
			void this.importFiles(Array.from(input.files ?? []));
		});
		input.click();
	}

	private async importFiles(files: File[]): Promise<void> {
		if (files.length === 0) return;
		const { notes, folderPath, problems } = await importChosenFiles(this.app, files);
		if (problems.length > 0) new Notice(`Not everything was imported:\n${problems.join('\n')}`, 10000);
		const first = notes[0];
		if (!first) {
			if (problems.length === 0) new Notice('No threads found in the chosen files.');
			return;
		}
		const where = folderPath === '/' ? 'the vault root' : folderPath;
		new Notice(`Imported ${notes.length} ${notes.length === 1 ? 'thread' : 'threads'} into ${where}.`);
		await this.app.workspace.getLeaf('tab').openFile(first);
	}
}
