# @aglyn/cli

Read and script any site built on [Aglyn](https://aglyn.com) — pages as
Markdown, `llms.txt`, OpenAPI, and the REST API.

```bash
npm install -g @aglyn/cli
```

## Most of it needs no account

Every Aglyn site publishes a public, anonymous surface. These commands work
against **any** Aglyn site — including one you do not own — with no key, no
plan and no sign-in:

```bash
aglyn read https://example.com/pricing   # the page as Markdown, chrome removed
aglyn llms example.com                   # what the site is for, and which URL answers what
aglyn openapi example.com                # its OpenAPI 3.1 description
aglyn site example.com                   # its public identity, as JSON
aglyn pages example.com                  # every published page, following the cursor
aglyn sitemap example.com                # the sitemap index
```

`aglyn read` is the one to reach for from a script or an agent. It asks the
site for `text/markdown`, so what comes back is the prose — no navigation, no
styling, no `<div>` soup to parse and guess at.

```bash
aglyn read https://example.com/blog/hello | wc -w
aglyn pages example.com --json | jq -r '.[].slug'
```

## The REST API

`aglyn api` is the only command that authenticates. Create a key in the console
under **Settings → API keys**, then:

```bash
export AGLYN_API_KEY=aglyn_sk_...
aglyn api GET /sites
aglyn auth status          # says whether a key is set; never prints it
```

The CLI does **not** write your key to disk. It reads `AGLYN_API_KEY` from the
environment so the key lives wherever you already keep secrets.

## Exit codes

| code | meaning |
| ---- | ------- |
| `0`  | it worked (`--help` included) |
| `1`  | the request failed, or the site answered an error |
| `2`  | the command was used wrongly |

## Options

| flag | effect |
| ---- | ------ |
| `--json` | JSON instead of a table, where both make sense |
| `--limit <n>` | page size for list commands (default 50, max 100) |
| `--base <url>` | API base for `api` (default `AGLYN_API_URL`) |
| `-h`, `--help` | usage |
| `-V`, `--version` | version |

## Licence

Apache-2.0
