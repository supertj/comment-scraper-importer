# Comment Scraper Importer

Turns Reddit and Hacker News threads you exported with Comment Scraper into Obsidian notes. Each thread becomes one note: the post at the top, then every comment in a callout nested under the comment it replies to, with the time it was posted, a link back to the original and its score when the site shows one.

The export files come from the Comment Scraper browser extension (https://comment-scraper.com), which saves a whole thread as CSV, JSON or Markdown. This plugin reads the CSV and JSON files.

## Usage

1. In the extension, export a thread as **CSV**, **JSON, one row per comment** or **JSON, replies nested**. Batch exports with several threads in one file work too.
2. In Obsidian, open the command palette and run **Comment Scraper Importer: Import exported threads**.
3. Pick one or more export files.

You get one note per thread, in the folder you use for new notes (**Settings → Files and links → Default location for new notes**). Existing notes are never overwritten. If you import the same thread twice, the second note gets a number after its name.

## What a note looks like

````markdown
---
title: "Which CRM do small teams actually like?"
source: "https://www.reddit.com/r/smallbusiness/comments/1abcxyz/which_crm/"
platform: "Reddit"
subreddit: "smallbusiness"
exported: "2026-10-20T15:33:04.869Z"
comments: 48
---

> [!note] Post · 321 points · 2026-09-20 14:13 UTC · [link](https://www.reddit.com/r/...)
> ```
> Five of us, mostly email and a shared spreadsheet. What did you switch to?
> ```

## Comments

> [!quote]+ 57 points · 2026-09-20 15:02 UTC · [link](https://www.reddit.com/r/...)
> ```
> We tried three. The one that stuck was the one people opened without being asked.
> ```
>
> > [!quote]+ 12 points · 2026-09-20 15:40 UTC · OP · [link](https://www.reddit.com/r/...)
> > ```
> > Which one was it?
> > ```
````

A few details:

- Comment callouts can be folded, so you can collapse a long branch.
- Times are in UTC. `exported` is when the extension fetched the thread, and `comments` is how many comments the file has. If the export stopped early, for example at a rate limit, the thread itself may have more.
- Hacker News doesn't publish comment scores, so HN comments show none. A Reddit comment whose score was still hidden shows "score hidden".
- Replies more than six levels deep stay at the sixth level and say which comment they answer, so long back-and-forths stay readable.
- Deleted and removed comments keep their place in the thread, marked *(deleted)* or *(removed)*.
- Author names aren't included, because the extension doesn't export them. A username someone typed into their comment stays in the text.
- JSON keeps comment text exactly. In CSV, the extension puts a ' in front of text that starts with =, +, - or @ so spreadsheets don't treat it as a formula, and the plugin takes it off again. A comment that really did start with something like '- loses that apostrophe, so use JSON if that matters.

The Markdown export isn't supported: it has no links to individual comments, and its times are relative ("3d ago"). It's already Markdown, though, so you can put it in your vault as it is.

## Why comment text is in code blocks

Anyone can write anything in a comment, including a Dataview query, a Templater command, HTML or an `![[embed]]`. In an ordinary note, some of those run or load as soon as you open it. Inside a code block they're only text, so the plugin puts every post and comment body in one. The downside is that Reddit formatting such as bold, lists and links shows up exactly as it was typed.

Templater also reads code blocks, so wherever a comment contains `<%`, the plugin puts a zero-width space between the two characters. You won't see it, but Templater won't treat the text as a command.

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
