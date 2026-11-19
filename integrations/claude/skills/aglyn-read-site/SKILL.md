---
name: aglyn-read-site
description: Read a published Aglyn site as clean text - its pages as Markdown, its llms.txt summary, its page list and public details - with no account or connector needed. Use to review or quote what a live Aglyn site says, audit its content, or check a change after publishing.
---

# Reading a published Aglyn site

Every published Aglyn site offers a public, read-only view built for
assistants. None of it needs sign-in, and it works for any Aglyn site.

## From a terminal

The `@aglyn/cli` package does this in one command each:

```bash
npx @aglyn/cli read https://example.com/pricing   # one page as Markdown
npx @aglyn/cli llms example.com                   # what the site is for, and which URL answers what
npx @aglyn/cli pages example.com --json           # every published page
npx @aglyn/cli site example.com                   # the site's public identity
npx @aglyn/cli sitemap example.com                # the sitemap index
npx @aglyn/cli openapi example.com                # the site's public read API
```

Exit code `0` is success, `1` means the site answered an error, `2` means the
command was used wrongly.

## Without a terminal

Fetch the same things directly:

- Add `.md` to any page path for that page as Markdown. The home page is
  `/index.md`.
- `/llms.txt` is the site's own summary for assistants.
- `/openapi.json` describes its public read API.

A site that asks search engines to stay away does not publish `/llms.txt` or
`/openapi.json`. Search results pages have no Markdown version.

## Using it well

- After publishing a change through the connector, read the page back to
  confirm visitors see it. A page can take a short while to refresh.
- To change anything, use the Aglyn connector's tools or the console. This
  view is read-only.
