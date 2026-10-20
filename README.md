# Comment Scraper Importer

Turns Reddit and Hacker News threads you exported with Comment Scraper into Obsidian notes. Each thread becomes one note: the post at the top, then every comment in a callout nested under the comment it replies to, with its score, the time it was posted and a link back to the original.

The export files come from the Comment Scraper browser extension (https://comment-scraper.com), which saves a whole thread as CSV, JSON or Markdown. This plugin reads the CSV and JSON files.

## Usage

1. In the extension, export a thread as **CSV**, **JSON, one row per comment** or **JSON, replies nested**. Batch exports with several threads in one file work too.
2. In Obsidian, open the command palette and run **Comment Scraper Importer: Import exported threads**.
3. Pick one or more export files.

You get one note per thread, in the folder you use for new notes (**Settings → Files and links → Default location for new notes**). Existing notes are never overwritten. If you import the same thread twice, the second note gets a number after its name.

## What a note looks like

```markdown
---
title: "Which CRM do small teams actually like?"
source: "https://www.reddit.com/r/smallbusiness/comments/1abcxyz/which_crm/"
platform: "Reddit"
subreddit: "smallbusiness"
exported: "2026-10-20T15:33:04.869Z"
comments: 48
---

> [!note] Post · 321 points · 2026-09-20 14:13 UTC · [link](https://www.reddit.com/r/...)
> Five of us, mostly email and a shared spreadsheet. What did you switch to?

## Comments

> [!quote]+ 57 points · 2026-09-20 15:02 UTC · [link](https://www.reddit.com/r/...)
> We tried three. The one that stuck was the one people opened without being asked.
>
> > [!quote]+ 12 points · 2026-09-20 15:40 UTC · OP · [link](https://www.reddit.com/r/...)
> > Which one was it?
```

A few details:

- Comment callouts can be folded, so you can collapse a long branch.
- Times are in UTC. `exported` is when the extension fetched the thread, and `comments` is how many comments the file has. If the export stopped early, for example at a rate limit, the thread itself may have more.
- Hacker News doesn't publish comment scores, so HN comments show none. A Reddit comment whose score was still hidden shows "score hidden".
- Replies more than six levels deep stay at the sixth level and say which comment they answer, so long back-and-forths stay readable.
- Deleted and removed comments keep their place in the thread, marked *(deleted)* or *(removed)*.
- There are no usernames. The extension doesn't export them, so they can't end up in your notes.

The Markdown export isn't supported because it doesn't include links to the comments. It's already Markdown, though, so you can put it in your vault as it is.

## Network and file access

The plugin makes no network requests. Outside your vault it only reads the files you pick in the file dialog, and inside the vault it only creates new notes.

## Building from source

```sh
npm install
npm run build   # writes main.js
npm test
```

To try a build, copy `main.js` and `manifest.json` into `<vault>/.obsidian/plugins/comment-scraper-importer/` and turn the plugin on under **Settings → Community plugins**.

## License

[MIT](LICENSE)
