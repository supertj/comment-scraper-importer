import { readFileSync } from 'node:fs';
import MarkdownIt from 'markdown-it';
import { describe, expect, it } from 'vitest';
import { MAX_NESTING, commentsInReplyOrder, fencedText, formatUtc, markdownLink, noteFileName, threadToNote } from '../src/import/note';
import { parseExport } from '../src/import/parse';
import type { ExportRecord, Thread } from '../src/import/types';

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');

const post: ExportRecord = {
	source: 'reddit',
	record_type: 'post',
	thread_id: 'p1',
	thread_title: 'Is it worth it?',
	subreddit: 'test',
	comment_id: null,
	parent_id: null,
	parent_missing: false,
	score: 120,
	score_hidden: false,
	created_utc: '2026-10-01T08:30:00.000Z',
	edited_utc: null,
	is_op: true,
	body: 'Thinking about it.',
	permalink: 'https://www.reddit.com/r/test/comments/p1/is_it_worth_it/',
	comment_state: 'normal',
};

const comment = (id: string, parent: string, extra: Partial<ExportRecord> = {}): ExportRecord => ({
	...post,
	record_type: 'comment',
	comment_id: id,
	parent_id: parent,
	score: 1,
	is_op: false,
	body: `Text of ${id}`,
	permalink: `https://www.reddit.com/r/test/comments/p1/_/${id}/`,
	...extra,
});

const thread = (comments: ExportRecord[], extra: Partial<Thread> = {}): Thread => ({
	source: 'reddit',
	threadId: 'p1',
	title: post.thread_title,
	url: post.permalink,
	subreddit: 'test',
	exportedAt: '2026-10-02T00:00:00.000Z',
	post,
	comments,
	...extra,
});

describe('threadToNote', () => {
	it('writes properties, the post and nested comment callouts', () => {
		const note = threadToNote(
			thread([
				comment('a', 'p1', { score: 41, edited_utc: '2026-10-01T10:00:00.000Z' }),
				comment('b', 'a', { is_op: true, body: 'First line\n\nSecond line' }),
				comment('c', 'a', { score: null, score_hidden: true }),
				comment('d', 'p1', { comment_state: 'deleted', body: '' }),
			]),
		);
		expect(note).toBe(
			[
				'---',
				'title: "Is it worth it?"',
				'source: "https://www.reddit.com/r/test/comments/p1/is_it_worth_it/"',
				'platform: "Reddit"',
				'subreddit: "test"',
				'exported: "2026-10-02T00:00:00.000Z"',
				'comments: 4',
				'---',
				'',
				'> [!note] Post · 120 points · 2026-10-01 08:30 UTC · [link](https://www.reddit.com/r/test/comments/p1/is_it_worth_it/)',
				'> ```',
				'> Thinking about it.',
				'> ```',
				'',
				'## Comments',
				'',
				'> [!quote]+ 41 points · 2026-10-01 08:30 UTC · edited · [link](https://www.reddit.com/r/test/comments/p1/_/a/)',
				'> ```',
				'> Text of a',
				'> ```',
				'>',
				'> > [!quote]+ 1 point · 2026-10-01 08:30 UTC · OP · [link](https://www.reddit.com/r/test/comments/p1/_/b/)',
				'> > ```',
				'> > First line',
				'> >',
				'> > Second line',
				'> > ```',
				'>',
				'> > [!quote]+ score hidden · 2026-10-01 08:30 UTC · [link](https://www.reddit.com/r/test/comments/p1/_/c/)',
				'> > ```',
				'> > Text of c',
				'> > ```',
				'',
				'> [!quote]+ 1 point · 2026-10-01 08:30 UTC · [link](https://www.reddit.com/r/test/comments/p1/_/d/)',
				'> *(deleted)*',
				'',
			].join('\n'),
		);
	});

	it('never writes an author, since exports have none', () => {
		for (const name of ['batch-flat.json', 'batch.csv']) {
			for (const parsed of parseExport(fixture(name)).threads) {
				expect(threadToNote(parsed)).not.toMatch(/author/i);
			}
		}
	});

	it('nests the extension test thread by reply depth', () => {
		const [reddit, hn] = parseExport(fixture('batch-nested.json')).threads;
		const note = threadToNote(reddit!);
		expect(note).toContain('comments: 11\n');
		expect(note).toContain('> [!quote]+ 10 points · 2026-09-21 14:13 UTC · [link](https://www.reddit.com/r/testsub/comments/1abcxyz/title/c1/)');
		expect(note).toContain('> > [!quote]+ 10 points · 2026-09-21 14:14 UTC · OP · edited · [link](https://www.reddit.com/r/testsub/comments/1abcxyz/title/c2/)');
		expect(note).toContain('> > > > [!quote]+ 10 points · 2026-09-21 14:15 UTC · [link](https://www.reddit.com/r/testsub/comments/1abcxyz/title/c11/)');
		expect(note).toContain('> [!quote]+ 10 points · 2026-09-21 14:13 UTC · [link](https://www.reddit.com/r/testsub/comments/1abcxyz/title/c6/)\n> *(removed)*');
		// A heading line in the post stays plain text inside the post's code block.
		expect(note).toContain('> ```\n> Looking for honest takes.\n> # not a heading\n> ```');

		// Hacker News has no comment scores, so none are shown.
		const hnNote = threadToNote(hn!);
		expect(hnNote).toContain('platform: "Hacker News"');
		expect(hnNote).not.toContain('subreddit');
		expect(hnNote).toContain('> [!note] Post · 50 points · 2026-09-21 14:13 UTC · [link](https://news.ycombinator.com/item?id=1)\n> ```\n> https://x.dev');
		expect(hnNote).toContain('> > [!quote]+ 2026-09-21 14:16 UTC · OP · [link](https://news.ycombinator.com/item?id=3)\n> > ```\n> > Thanks');
	});

	it('produces the same note from flat JSON, nested JSON and CSV', () => {
		const notes = ['batch-flat.json', 'batch-nested.json', 'batch.csv'].map((name) =>
			parseExport(fixture(name)).threads.map(threadToNote),
		);
		expect(notes[1]).toEqual(notes[0]);
		expect(notes[2]).toEqual(notes[0]);
	});

	it('marks replies whose parent was not exported', () => {
		const note = threadToNote(thread([comment('x', 'missing', { parent_missing: true })]));
		expect(note).toContain('> [!quote]+ reply to a comment not in the export · 1 point');
	});

	it('quotes property values that would otherwise break the YAML', () => {
		const note = threadToNote(thread([], { title: 'Say "no": a #thread\nwith a break' }));
		expect(note).toContain('title: "Say \\"no\\": a #thread\\nwith a break"');
		expect(note).not.toContain('## Comments');
	});

	it('keeps leading spaces on the first line of a comment', () => {
		const note = threadToNote(thread([comment('a', 'p1', { body: '\n\n    indented code\nprose' })]));
		expect(note).toContain('> ```\n>     indented code\n> prose\n> ```');
	});
});

// Comment text comes from strangers. Whatever it contains, it must reach the note as plain text
// that neither Obsidian nor a plugin acts on. The note is parsed as CommonMark to check that.
describe('untrusted text', () => {
	const markdown = new MarkdownIt({ html: true });
	interface Token {
		type: string;
		info: string;
		content: string;
		children: Token[] | null;
		attrGet(name: string): string | null;
	}
	const tokensOf = (note: string): Token[] => {
		const all: Token[] = [];
		const visit = (tokens: Token[]) => {
			for (const token of tokens) {
				all.push(token);
				if (token.children) visit(token.children);
			}
		};
		visit(markdown.parse(note.replace(/^---\n[\s\S]*?\n---\n/, ''), {}) as Token[]);
		return all;
	};
	/** Anything in the rendered note that does more than show text. */
	const activeParts = (note: string): string[] =>
		tokensOf(note).flatMap((token) => {
			if (token.type === 'html_block' || token.type === 'html_inline') return [`html ${token.content}`];
			if (token.type === 'image') return ['image'];
			if (token.type === 'code_inline') return [`inline code ${token.content}`];
			if (token.type === 'fence' && token.info !== '') return [`fence info ${token.info}`];
			if (token.type === 'link_open' && !/^https?:\/\//.test(token.attrGet('href') ?? '')) return [`link ${token.attrGet('href')}`];
			if (token.type === 'text' && /\[\[|<%/.test(token.content)) return [`text ${token.content}`];
			return [];
		});
	const codeBlocks = (note: string) => tokensOf(note).filter((token) => token.type === 'fence').map((token) => token.content);

	const attacks = {
		dataviewjs: "```dataviewjs\ndv.paragraph('pwned')\n```",
		dataview: '```dataview\nTABLE file.name FROM ""\n```',
		tasks: '```tasks\nnot done\n```',
		longerFence: '````\nclosing early?\n````\n```dataviewjs\nstill code\n```',
		tildeFence: '~~~dataviewjs\ndv.paragraph(1)\n~~~',
		inlineQueries: 'Look: `$= dv.current().file.name` and `= this.file.name`',
		templater: "<% tp.system.prompt('name') %> then <%* await app.vault.adapter.remove('x') %>",
		html: '<script>alert(1)</script>\n<iframe src="https://evil.example/"></iframe>\n<img src=x onerror=alert(1)>',
		embeds: '![[Private note]] and [[Another note]] and ![tracker](https://tracker.example/p.png)',
	};

	for (const [name, body] of Object.entries(attacks)) {
		it(`keeps ${name} text plain`, () => {
			const note = threadToNote(
				thread([comment('a', 'p1'), comment('b', 'a'), comment('c', 'b', { body })], {
					post: { ...post, body },
				}),
			);
			expect(activeParts(note)).toEqual([]);
			expect(note).not.toContain('<%');
			const shown = body.replace(/<%/g, '<​%');
			// The post and the deepest reply each sit whole in their own code block.
			expect(codeBlocks(note).filter((content) => content === `${shown}\n`)).toHaveLength(2);
			// The reply still nests where it belongs, so nothing broke out of the block above it.
			expect(note).toContain(`> > > [!quote]+ 1 point`);
		});
	}

	it('uses a fence longer than any backtick run in the text', () => {
		expect(fencedText('a ``` b')[0]).toBe('````');
		expect(fencedText('`````')[0]).toBe('``````');
		expect(fencedText('plain')[0]).toBe('```');
	});

	it('keeps Templater commands out of the properties', () => {
		const note = threadToNote(thread([], { title: "<%* app.vault.adapter.remove('x') %>", subreddit: '<% x %>' }));
		expect(note).not.toContain('<%');
		expect(note).toContain('title: "\\u003c%* app.vault.adapter.remove(\'x\') %>"');
	});

	it('only links to web addresses, and an address cannot start new lines', () => {
		expect(markdownLink('link', 'javascript:alert(1)')).toBeNull();
		expect(markdownLink('link', 'file:///etc/passwd')).toBeNull();
		expect(markdownLink('link', 'https://a.example/x (y)\n```dataviewjs\n[z]<%')).toBe(
			'[link](https://a.example/x%20%28y%29%0A%60%60%60dataviewjs%0A%5Bz%5D%3C%)',
		);
		const note = threadToNote(
			thread([comment('a', 'p1', { permalink: 'https://a.example/\n```dataviewjs\nx', created_utc: '2026\n```dataviewjs' })]),
		);
		expect(activeParts(note)).toEqual([]);
		expect(note).toContain('> [!quote]+ 1 point · [link](https://a.example/%0A%60%60%60dataviewjs%0Ax)\n');
	});
});

describe('commentsInReplyOrder', () => {
	it('follows parent_id even when rows are out of order', () => {
		const placed = commentsInReplyOrder(thread([comment('b', 'a'), comment('c', 'p1'), comment('a', 'p1')]));
		expect(placed.map(({ record, level }) => `${record.comment_id}:${level}`)).toEqual(['c:1', 'a:1', 'b:2']);
	});

	it(`stops nesting at level ${MAX_NESTING} and links deeper replies to their parent`, () => {
		const chain = Array.from({ length: 9 }, (_, index) => comment(`n${index}`, index === 0 ? 'p1' : `n${index - 1}`));
		const placed = commentsInReplyOrder(thread(chain));
		expect(placed.map(({ level }) => level)).toEqual([1, 2, 3, 4, 5, 6, 6, 6, 6]);
		expect(placed[5]!.parentUrl).toBeNull();
		expect(placed[6]!.parentUrl).toBe('https://www.reddit.com/r/test/comments/p1/_/n5/');
		const note = threadToNote(thread(chain));
		expect(note).toContain(`${'> '.repeat(MAX_NESTING)}[!quote]+ reply to [this comment](https://www.reddit.com/r/test/comments/p1/_/n5/) · 1 point`);
		expect(note).not.toContain('> '.repeat(MAX_NESTING + 1));
	});

	it('handles a chain thousands deep and a parent loop without losing comments', () => {
		const chain = Array.from({ length: 20_000 }, (_, index) => comment(`n${index}`, index === 0 ? 'p1' : `n${index - 1}`));
		expect(commentsInReplyOrder(thread(chain))).toHaveLength(20_000);
		const loop = commentsInReplyOrder(thread([comment('x', 'y'), comment('y', 'x'), comment('z', 'z')]));
		expect(loop.map(({ record }) => record.comment_id).sort()).toEqual(['x', 'y', 'z']);
	});
});

describe('noteFileName and formatUtc', () => {
	const name = (title: string, extra: Partial<Thread> = {}) => noteFileName(thread([], { title, ...extra }));

	it('drops characters file systems and links reject', () => {
		expect(name('Show HN: A tiny thing: with "quotes" / slashes?')).toBe('Show HN A tiny thing with quotes slashes');
		expect(name('[Serious] #1 tip | read^this...')).toBe('Serious 1 tip read this');
		expect(name('.hidden')).toBe('hidden');
		expect(name('???')).toBe('Reddit thread p1');
	});

	it('keeps a fallback name inside the folder', () => {
		expect(name('', { threadId: '../../.obsidian/plugins/x' })).toBe('Reddit thread .. .. .obsidian plugins x');
		expect(name('', { threadId: '..' })).toBe('Reddit thread');
	});

	it('stays under 200 bytes without splitting a character', () => {
		const long = name('😀'.repeat(150));
		expect(new TextEncoder().encode(long).length).toBeLessThanOrEqual(200);
		expect(Array.from(long).every((char) => char === '😀')).toBe(true);
		expect(new TextEncoder().encode(name('é'.repeat(300))).length).toBeLessThanOrEqual(200);
	});

	it('avoids names Windows reserves', () => {
		expect(name('CON')).toBe('_CON');
		expect(name('nul.txt')).toBe('_nul.txt');
		expect(name('COM1')).toBe('_COM1');
		expect(name('COM1: ports')).toBe('COM1 ports');
		expect(name('Console wars')).toBe('Console wars');
	});

	it('formats times in UTC and drops unreadable ones', () => {
		expect(formatUtc('2026-09-21T14:13:20.000Z')).toBe('2026-09-21 14:13 UTC');
		expect(formatUtc('yesterday')).toBeNull();
		expect(formatUtc('2026')).toBeNull();
	});
});
