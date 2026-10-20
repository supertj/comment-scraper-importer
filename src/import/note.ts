import type { ExportRecord, Thread } from './types';

// Turns one exported thread into a note: properties first, then the post, then every comment
// as a callout nested inside the one it replies to.
//
// Everything in an export file comes from strangers on Reddit or Hacker News, and a note is
// more than text once plugins are installed: Dataview runs ```dataviewjs blocks and `$=` inline
// queries when the note renders, Templater can run <% %> commands in any newly created file,
// and Markdown alone allows raw HTML and ![[embeds]]. So post and comment bodies go into code
// blocks they can't close, `<%` is broken up everywhere, and links and times are rebuilt from
// checked values instead of copied.

/**
 * Deeper replies stay at this level. Past six or so, nested callouts get too narrow to read,
 * and Reddit chains can go hundreds of replies deep.
 */
export const MAX_NESTING = 6;

export function platformName(source: Thread['source']): string {
	return source === 'reddit' ? 'Reddit' : 'Hacker News';
}

/** A file name Obsidian accepts on every platform, that can't leave the folder and doesn't break [[links]]. */
export function noteFileName(thread: Thread): string {
	return cleanFileName(thread.title) || cleanFileName(`${platformName(thread.source)} thread ${thread.threadId}`) || 'Thread';
}

/**
 * Room for the name itself. Most file systems allow 255 bytes per name; the rest is left for
 * " 12" when the name is taken and for ".md".
 */
const MAX_NAME_BYTES = 200;

function cleanFileName(text: string): string {
	const cleaned = text
		.replace(/[\\/:*?"<>|#^[\]]/g, ' ')
		.replace(/\p{Cc}/gu, ' ')
		.replace(/\s+/g, ' ')
		.trim()
		.replace(/^[.\s]+/, '');
	// Cut by UTF-8 bytes, one whole code point at a time, so an emoji is never split.
	const encoder = new TextEncoder();
	let name = '';
	let bytes = 0;
	for (const char of cleaned) {
		bytes += encoder.encode(char).length;
		if (bytes > MAX_NAME_BYTES) break;
		name += char;
	}
	name = name.replace(/[.\s]+$/, '');
	// Windows refuses CON, NUL, COM1 and the like as a name, with or without an extension.
	return /^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i.test(name) ? `_${name}` : name;
}

export function threadToNote(thread: Thread): string {
	const lines = [
		'---',
		`title: ${yamlString(thread.title)}`,
		`source: ${yamlString(thread.url)}`,
		`platform: ${yamlString(platformName(thread.source))}`,
	];
	if (thread.subreddit) lines.push(`subreddit: ${yamlString(thread.subreddit)}`);
	lines.push(`exported: ${yamlString(thread.exportedAt)}`, `comments: ${thread.comments.length}`, '---', '');

	lines.push(...calloutLines(thread.post, 1, '[!note]', ['Post', ...recordFacts(thread.post)]));
	if (thread.comments.length > 0) lines.push('', '## Comments', '');
	let first = true;
	for (const { record, level, parentUrl } of commentsInReplyOrder(thread)) {
		// A line one level up ends the previous callout, so this one opens as its sibling
		// inside the same parent instead of running on inside the previous comment.
		if (!first) lines.push(quotePrefix(level - 1).trimEnd());
		first = false;
		const facts = recordFacts(record);
		if (parentUrl) facts.unshift(`reply to ${markdownLink('this comment', parentUrl)}`);
		else if (level === 1 && record.parent_missing) facts.unshift('reply to a comment not in the export');
		// "+" makes the callout foldable but open, so a long reply chain can be collapsed.
		lines.push(...calloutLines(record, level, '[!quote]+', facts));
	}
	return lines.join('\n') + '\n';
}

interface PlacedComment {
	record: ExportRecord;
	level: number;
	/** Set when the comment is shown flatter than its real depth, so the reply link stays clear. */
	parentUrl: string | null;
}

/**
 * Comments in reading order: each one followed by its replies. Built from parent_id rather than
 * trusting the file's row order, and walked with a stack because chains can be thousands deep.
 * A comment whose parent isn't in the export starts at the top level.
 */
export function commentsInReplyOrder(thread: Thread): PlacedComment[] {
	const byId = new Map<string, ExportRecord>();
	for (const comment of thread.comments) if (comment.comment_id) byId.set(comment.comment_id, comment);
	const roots: ExportRecord[] = [];
	const replies = new Map<string, ExportRecord[]>();
	for (const comment of thread.comments) {
		const parentId = comment.parent_id;
		if (parentId && parentId !== comment.comment_id && byId.has(parentId)) {
			const siblings = replies.get(parentId) ?? [];
			siblings.push(comment);
			replies.set(parentId, siblings);
		} else roots.push(comment);
	}

	const placed: PlacedComment[] = [];
	const visited = new Set<ExportRecord>();
	const stack: { record: ExportRecord; depth: number }[] = roots.map((record) => ({ record, depth: 1 })).reverse();
	while (stack.length > 0) {
		const { record, depth } = stack.pop()!;
		if (visited.has(record)) continue;
		visited.add(record);
		const level = Math.min(depth, MAX_NESTING);
		const parent = depth > MAX_NESTING && record.parent_id ? byId.get(record.parent_id) : undefined;
		placed.push({ record, level, parentUrl: parent?.permalink || null });
		const children = record.comment_id ? (replies.get(record.comment_id) ?? []) : [];
		for (let index = children.length - 1; index >= 0; index--) stack.push({ record: children[index]!, depth: depth + 1 });
	}
	// Comments caught in a parent loop (only in a hand-edited file) are never reached from a
	// root; list them at the top level rather than dropping them.
	for (const comment of thread.comments) {
		if (!visited.has(comment)) placed.push({ record: comment, level: 1, parentUrl: null });
	}
	return placed;
}

function calloutLines(record: ExportRecord, level: number, marker: string, facts: string[]): string[] {
	const prefix = quotePrefix(level);
	const lines = [`${prefix}${marker} ${facts.join(' · ')}`];
	for (const line of bodyLines(record)) lines.push(line === '' ? prefix.trimEnd() : prefix + line);
	return lines;
}

/** Points, time, OP and edited markers, and the link to the original. Only fixed words, numbers and checked links. */
function recordFacts(record: ExportRecord): string[] {
	const facts: string[] = [];
	if (record.score !== null) facts.push(`${record.score} ${Math.abs(record.score) === 1 ? 'point' : 'points'}`);
	else if (record.score_hidden) facts.push('score hidden');
	const time = formatUtc(record.created_utc);
	if (time) facts.push(time);
	if (record.record_type === 'comment' && record.is_op) facts.push('OP');
	if (record.edited_utc) facts.push('edited');
	const link = markdownLink('link', record.permalink);
	if (link) facts.push(link);
	return facts;
}

function bodyLines(record: ExportRecord): string[] {
	if (record.comment_state === 'deleted') return ['*(deleted)*'];
	if (record.comment_state === 'removed') return ['*(removed)*'];
	// Only blank lines are trimmed: leading spaces on the first line can matter, as in code.
	const body = record.body.replace(/\r\n?/g, '\n').replace(/^(?:[ \t]*\n)+/, '').trimEnd();
	return body ? fencedText(body) : [];
}

/**
 * The text as a plain code block it can't break out of: the fence is longer than any run of
 * backticks inside, and it has no language for a plugin to hook onto. Inside, Obsidian shows
 * the text as it is, with no HTML, links, embeds, tags or queries. The cost is that Reddit's
 * own formatting (bold, lists, links) shows as plain text.
 */
export function fencedText(text: string): string[] {
	let longestRun = 0;
	for (const run of text.match(/`+/g) ?? []) longestRun = Math.max(longestRun, run.length);
	const fence = '`'.repeat(Math.max(3, longestRun + 1));
	return [fence, ...breakTemplaterTags(text).split('\n'), fence];
}

/**
 * Templater reads raw text, code blocks included, and with "Trigger Templater on new file
 * creation" turned on it runs every <% %> command in a file a plugin creates. A zero-width
 * space between < and % stops that without changing what the text looks like.
 */
export function breakTemplaterTags(text: string): string {
	return text.replace(/<%/g, '<\u200B%');
}

function quotePrefix(level: number): string {
	return '> '.repeat(level);
}

/** "2026-09-21 14:13 UTC", or null when the value isn't a date. Kept in UTC so the note reads the same in every time zone. */
export function formatUtc(iso: string): string | null {
	// Only the ISO 8601 form the extension writes; Date() alone would guess at almost anything.
	if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/.test(iso)) return null;
	const date = new Date(iso);
	if (Number.isNaN(date.getTime())) return null;
	return `${date.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}

/**
 * A Markdown link to an http(s) address, or null for anything else (javascript: and the like).
 * Every character that could end the link, start a new line or open a tag is percent-encoded.
 */
export function markdownLink(text: string, url: string): string | null {
	if (!/^https?:\/\//i.test(url)) return null;
	const encoded = url.replace(/[^\w\-.~:/?#@!$&'*+,;=%]/gu, (char) => {
		// encodeURIComponent leaves ( and ) alone, so ASCII is encoded by hand.
		const code = char.codePointAt(0)!;
		if (code < 0x80) return `%${code.toString(16).toUpperCase().padStart(2, '0')}`;
		try {
			return encodeURIComponent(char);
		} catch {
			// A lone surrogate half can't be encoded.
			return '%EF%BF%BD';
		}
	});
	return `[${text}](${encoded})`;
}

/**
 * A JSON string is also a valid double-quoted YAML string, escapes included. `<` is written as
 * \u003c so a title can't carry a Templater command into the properties.
 */
function yamlString(value: string): string {
	return JSON.stringify(value).replace(/</g, '\\u003c');
}
