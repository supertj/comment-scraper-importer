import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MAX_NESTING, closeOpenFence, commentsInReplyOrder, formatUtc, noteFileName, threadToNote } from '../src/import/note';
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
				'> Thinking about it.',
				'',
				'## Comments',
				'',
				'> [!quote]+ 41 points · 2026-10-01 08:30 UTC · edited · [link](https://www.reddit.com/r/test/comments/p1/_/a/)',
				'> Text of a',
				'>',
				'> > [!quote]+ 1 point · 2026-10-01 08:30 UTC · OP · [link](https://www.reddit.com/r/test/comments/p1/_/b/)',
				'> > First line',
				'> >',
				'> > Second line',
				'>',
				'> > [!quote]+ score hidden · 2026-10-01 08:30 UTC · [link](https://www.reddit.com/r/test/comments/p1/_/c/)',
				'> > Text of c',
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
		// A heading line in the post stays inside the post's callout.
		expect(note).toContain('> Looking for honest takes.\n> # not a heading');

		// Hacker News has no comment scores, so none are shown.
		const hnNote = threadToNote(hn!);
		expect(hnNote).toContain('platform: "Hacker News"');
		expect(hnNote).not.toContain('subreddit');
		expect(hnNote).toContain('> [!note] Post · 50 points · 2026-09-21 14:13 UTC · [link](https://news.ycombinator.com/item?id=1)\n> https://x.dev');
		expect(hnNote).toContain('> > [!quote]+ 2026-09-21 14:16 UTC · OP · [link](https://news.ycombinator.com/item?id=3)\n> > Thanks');
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

	it('keeps parentheses and spaces in links from ending the link early', () => {
		const note = threadToNote(thread([comment('a', 'p1', { permalink: 'https://example.com/a (b)' })]));
		expect(note).toContain('[link](https://example.com/a%20%28b%29)');
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

describe('closeOpenFence', () => {
	it('closes a fence left open so it cannot swallow the replies below', () => {
		expect(closeOpenFence(['```js', 'let a = 1;'])).toEqual(['```js', 'let a = 1;', '```']);
		expect(closeOpenFence(['~~~~', 'x', '~~~'])).toEqual(['~~~~', 'x', '~~~', '~~~~']);
		expect(closeOpenFence(['```', 'x', '```'])).toEqual(['```', 'x', '```']);
		expect(closeOpenFence(['``` not `a fence`'])).toEqual(['``` not `a fence`']);
	});
});

describe('noteFileName and formatUtc', () => {
	it('drops characters file systems and links reject', () => {
		const name = (title: string) => noteFileName(thread([], { title }));
		expect(name('Show HN: A tiny thing: with "quotes" / slashes?')).toBe('Show HN A tiny thing with quotes slashes');
		expect(name('[Serious] #1 tip | read^this...')).toBe('Serious 1 tip read this');
		expect(name('.hidden')).toBe('hidden');
		expect(name('???')).toBe('Reddit thread p1');
		expect(Array.from(name('😀'.repeat(150)))).toHaveLength(100);
	});

	it('formats times in UTC and leaves unreadable ones alone', () => {
		expect(formatUtc('2026-09-21T14:13:20.000Z')).toBe('2026-09-21 14:13 UTC');
		expect(formatUtc('yesterday')).toBe('yesterday');
	});
});
