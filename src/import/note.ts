import type { ExportRecord, Thread } from './types';

// Turns one exported thread into a note: properties first, then the post, then every comment
// as a callout nested inside the one it replies to.

/**
 * Deeper replies stay at this level. Past six or so, nested callouts get too narrow to read,
 * and Reddit chains can go hundreds of replies deep.
 */
export const MAX_NESTING = 6;

const PLATFORM_NAMES: Record<string, string> = { reddit: 'Reddit', hn: 'Hacker News' };

export function platformName(source: string): string {
	return PLATFORM_NAMES[source] ?? source;
}

/** A file name Obsidian accepts on every platform and that doesn't break [[links]]. */
export function noteFileName(thread: Thread): string {
	const cleaned = thread.title
		.replace(/[\\/:*?"<>|#^[\]]/g, ' ')
		.replace(/\p{Cc}/gu, ' ')
		.replace(/\s+/g, ' ')
		.trim()
		.replace(/^[.\s]+/, '');
	// Count code points, not UTF-16 units, so an emoji is never cut in half.
	const shortened = Array.from(cleaned).slice(0, 100).join('').replace(/[.\s]+$/, '');
	return shortened || `${platformName(thread.source)} thread ${thread.threadId}`;
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

/** Points, time, OP and edited markers, and the link to the original. */
function recordFacts(record: ExportRecord): string[] {
	const facts: string[] = [];
	if (record.score !== null) facts.push(`${record.score} ${Math.abs(record.score) === 1 ? 'point' : 'points'}`);
	else if (record.score_hidden) facts.push('score hidden');
	facts.push(formatUtc(record.created_utc));
	if (record.record_type === 'comment' && record.is_op) facts.push('OP');
	if (record.edited_utc) facts.push('edited');
	if (record.permalink) facts.push(markdownLink('link', record.permalink));
	return facts;
}

function bodyLines(record: ExportRecord): string[] {
	if (record.comment_state !== 'normal') return [`*(${record.comment_state})*`];
	const body = record.body.replace(/\r\n?/g, '\n').trim();
	return body ? closeOpenFence(body.split('\n')) : [];
}

/**
 * A code fence left open in one comment would swallow every reply nested under it, so an
 * unclosed fence gets closed at the end of its comment.
 */
export function closeOpenFence(lines: string[]): string[] {
	let open: { marker: string; length: number } | null = null;
	for (const line of lines) {
		const match = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
		if (!match) continue;
		const fence = match[1]!;
		const rest = match[2]!;
		const marker = fence.charAt(0);
		if (!open) {
			// A backtick fence can't have backticks after it; that line is inline code instead.
			if (marker === '`' && rest.includes('`')) continue;
			open = { marker, length: fence.length };
		} else if (marker === open.marker && fence.length >= open.length && rest.trim() === '') {
			open = null;
		}
	}
	return open ? [...lines, open.marker.repeat(open.length)] : lines;
}

function quotePrefix(level: number): string {
	return '> '.repeat(level);
}

/** "2026-09-21 14:13 UTC". Kept in UTC so the note reads the same in every time zone. */
export function formatUtc(iso: string): string {
	const date = new Date(iso);
	if (Number.isNaN(date.getTime())) return iso;
	return `${date.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}

function markdownLink(text: string, url: string): string {
	// Spaces and parentheses would end a Markdown link early.
	const safeUrl = url.replace(/[ ()<>]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
	return `[${text}](${safeUrl})`;
}

/** A JSON string is also a valid double-quoted YAML string, escapes included. */
function yamlString(value: string): string {
	return JSON.stringify(value);
}
