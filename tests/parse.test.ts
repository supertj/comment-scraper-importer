import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseCsvRows, removeFormulaGuard } from '../src/import/csv';
import { NotAnExportError, parseExport } from '../src/import/parse';
import type { ExportRecord } from '../src/import/types';

// The fixtures were written by the extension's own export code from its synthetic test thread
// (a Reddit thread with 11 comments and a Hacker News thread with 3), in one batch file per format.
const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');

const summary = (records: ExportRecord[]) =>
	records.map(({ comment_id, parent_id, score, score_hidden, created_utc, edited_utc, is_op, body, permalink, comment_state }) => ({
		comment_id, parent_id, score, score_hidden, created_utc, edited_utc, is_op, body, permalink, comment_state,
	}));

describe('parseExport', () => {
	it('reads a flat JSON export', () => {
		const { threads, skipped } = parseExport(fixture('batch-flat.json'));
		expect(skipped).toBe(0);
		expect(threads).toHaveLength(2);
		const [reddit, hn] = threads;
		expect(reddit).toMatchObject({
			source: 'reddit',
			threadId: '1abcxyz',
			title: 'Which CRM do small teams actually like?',
			url: 'https://www.reddit.com/r/testsub/comments/1abcxyz/title/',
			subreddit: 'testsub',
			exportedAt: '2026-10-20T15:33:04.869Z',
		});
		expect(reddit!.comments).toHaveLength(11);
		expect(reddit!.post.body).toBe('Looking for honest takes.\n# not a heading');
		expect(hn).toMatchObject({ source: 'hn', subreddit: null, url: 'https://news.ycombinator.com/item?id=1' });
		expect(hn!.comments).toHaveLength(3);
	});

	it('reads the nested JSON export into the same comments as the flat one', () => {
		const flat = parseExport(fixture('batch-flat.json')).threads;
		const nested = parseExport(fixture('batch-nested.json')).threads;
		expect(nested.map((thread) => thread.title)).toEqual(flat.map((thread) => thread.title));
		for (const [index, thread] of nested.entries()) {
			expect(summary(thread.comments)).toEqual(summary(flat[index]!.comments));
			expect(thread.exportedAt).toBe(flat[index]!.exportedAt);
		}
	});

	it('reads the CSV export into the same comments as the JSON one', () => {
		const flat = parseExport(fixture('batch-flat.json')).threads;
		const csv = parseExport(fixture('batch.csv')).threads;
		expect(csv).toHaveLength(2);
		for (const [index, thread] of csv.entries()) {
			expect(thread.title).toBe(flat[index]!.title);
			expect(thread.url).toBe(flat[index]!.url);
			expect(thread.exportedAt).toBe(flat[index]!.exportedAt);
			expect(summary(thread.comments)).toEqual(summary(flat[index]!.comments));
		}
		// Hidden score, deleted comment, OP reply and an edited comment survive the round trip.
		const reddit = csv[0]!.comments;
		expect(reddit.find((c) => c.comment_id === 'abcdefghijklm')).toMatchObject({ score: null, score_hidden: true });
		expect(reddit.find((c) => c.comment_id === 'c3')).toMatchObject({ comment_state: 'deleted', body: '' });
		expect(reddit.find((c) => c.comment_id === 'c2')).toMatchObject({ is_op: true, edited_utc: '2026-09-21T14:13:10.000Z' });
		expect(csv[1]!.title).toBe('Show HN: A tiny thing: with "quotes" / slashes?');
	});

	it('takes the formula guard off CSV text cells and keeps negative scores', () => {
		const header = 'schema_version,source,record_type,thread_id,thread_title,subreddit,comment_id,parent_id,parent_missing,depth,score,score_hidden,created_utc,edited_utc,is_op,comment_state,body,permalink,task_state,fetch_path,fetched_at';
		const csv = [
			header,
			"1,reddit,post,p1,'=Title,sub,,,false,,5,false,2026-01-01T00:00:00.000Z,,true,normal,,https://www.reddit.com/r/sub/comments/p1/,partial,dom,2026-01-02T00:00:00.000Z",
			"1,reddit,comment,p1,'=Title,sub,a,p1,false,0,-5,false,2026-01-01T01:00:00.000Z,,false,normal,\"'- first\n- second\",https://www.reddit.com/r/sub/comments/p1/_/a/,partial,dom,2026-01-02T00:00:00.000Z",
			"1,reddit,comment,p1,'=Title,sub,b,gone,true,1,3,false,2026-01-01T02:00:00.000Z,,false,normal,'quoted on purpose,https://www.reddit.com/r/sub/comments/p1/_/b/,partial,dom,2026-01-02T00:00:00.000Z",
		].join('\n');
		const [thread] = parseExport(csv).threads;
		expect(thread!.title).toBe('=Title');
		expect(thread!.comments[0]).toMatchObject({ score: -5, body: '- first\n- second' });
		expect(thread!.comments[1]).toMatchObject({ body: "'quoted on purpose", parent_missing: true });
	});

	it('rejects files that are not Comment Scraper exports', () => {
		expect(() => parseExport('{"threads": []}')).toThrow(NotAnExportError);
		expect(() => parseExport('{"generator": "Comment Scraper", "threads": [')).toThrow(NotAnExportError);
		expect(() => parseExport('name,email\nAda,ada@example.com\n')).toThrow(NotAnExportError);
		expect(() => parseExport('record_type,body\npost,hi\n')).toThrow(NotAnExportError);
		expect(() => parseExport('# A Markdown export\n')).toThrow(NotAnExportError);
	});

	it('skips damaged threads and keeps the rest', () => {
		const data = JSON.parse(fixture('batch-flat.json'));
		delete data.threads[0].records[3].body;
		const { threads, skipped } = parseExport(JSON.stringify(data));
		expect(skipped).toBe(1);
		expect(threads.map((thread) => thread.source)).toEqual(['hn']);

		const nested = JSON.parse(fixture('batch-nested.json'));
		nested.threads[1].comments[0].replies = 'oops';
		expect(parseExport(JSON.stringify(nested)).skipped).toBe(1);
	});

	it('flattens a nested reply chain thousands deep without running out of stack', () => {
		const data = JSON.parse(fixture('batch-nested.json'));
		const thread = data.threads[1];
		const template = thread.comments[0];
		let deepest = { ...template, replies: [] };
		for (let index = 0; index < 20_000; index++) {
			deepest = { ...template, comment_id: `d${index}`, replies: [deepest] };
		}
		thread.comments = [deepest];
		expect(parseExport(JSON.stringify(data)).threads[1]!.comments).toHaveLength(20_001);
	});
});

describe('CSV helpers', () => {
	it('splits quoted cells with commas, quotes and line breaks', () => {
		expect(parseCsvRows('a,"b, ""c""\r\nd",e\r\nf,,\r\n')).toEqual([
			['a', 'b, "c"\r\nd', 'e'],
			['f', '', ''],
		]);
		expect(parseCsvRows('x,y')).toEqual([['x', 'y']]);
	});

	it('only removes a guard the extension could have added', () => {
		expect(removeFormulaGuard("'=SUM(A1)")).toBe('=SUM(A1)');
		expect(removeFormulaGuard("'@here")).toBe('@here');
		expect(removeFormulaGuard("'+1")).toBe('+1');
		expect(removeFormulaGuard("'\tTabbed")).toBe('\tTabbed');
		expect(removeFormulaGuard("'tis the season")).toBe("'tis the season");
		expect(removeFormulaGuard('-5')).toBe('-5');
	});
});
