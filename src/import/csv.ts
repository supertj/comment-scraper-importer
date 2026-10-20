/** Splits RFC 4180 CSV into rows of cells. Quoted cells may contain commas, quotes and line breaks. */
export function parseCsvRows(text: string): string[][] {
	const rows: string[][] = [];
	let row: string[] = [];
	let cell = '';
	let quoted = false;
	for (let index = 0; index < text.length; index++) {
		const char = text.charAt(index);
		if (quoted) {
			if (char !== '"') cell += char;
			else if (text.charAt(index + 1) === '"') {
				cell += '"';
				index++;
			} else quoted = false;
		} else if (char === '"') quoted = true;
		else if (char === ',') {
			row.push(cell);
			cell = '';
		} else if (char === '\n' || char === '\r') {
			if (char === '\r' && text.charAt(index + 1) === '\n') index++;
			row.push(cell);
			rows.push(row);
			row = [];
			cell = '';
		} else cell += char;
	}
	if (cell !== '' || row.length > 0) {
		row.push(cell);
		rows.push(row);
	}
	return rows;
}

/**
 * The extension puts a ' in front of text cells that start with = + - @ tab or CR, so a
 * spreadsheet doesn't run them as formulas. Taking it off gives back the original text,
 * for example a comment that starts with a "- " list.
 */
export function removeFormulaGuard(cell: string): string {
	return /^'[=+\-@\t\r]/.test(cell) ? cell.slice(1) : cell;
}
