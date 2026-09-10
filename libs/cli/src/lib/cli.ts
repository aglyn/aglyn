/**
 * @license
 * Copyright 2026 Aglyn LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * `@aglyn/cli` — the command surface (AGL-2717).
 *
 * ## Everything is in ONE PURE FUNCTION
 *
 * {@link runCli} takes its `fetch`, its environment and its output streams as
 * arguments and returns an exit code. It reads no globals and touches no
 * process state, so every command is exercised by a unit test with a stub
 * `fetch` rather than by a human running it and looking.
 *
 * A CLI that can only be verified by running it is a CLI nobody verifies. The
 * bin is twenty lines of plumbing around this.
 *
 * ## Most of it needs no key, and that is the design
 *
 * The customer REST API is entitlement-gated (Business & Advanced). A CLI whose
 * first run tells most customers they cannot use it is a poor front door — so
 * every read command here works against the ANONYMOUS surface every Aglyn site
 * publishes: `/llms.txt`, `/openapi.json`, a Markdown rendering of any page,
 * the sitemap, the feeds, `/api/host` and `/api/screen`. No key, no plan, no
 * account. `aglyn api` is the only command that authenticates.
 *
 * That also makes the CLI useful against a site you do not own, which is the
 * case an agent is actually in.
 *
 * ## `aglyn read` is the reason this exists
 *
 * It fetches any page of any Aglyn site as Markdown by sending
 * `Accept: text/markdown`. An agent scripting against a site wants the prose,
 * not the DOM, and this is one command instead of a fetch plus an HTML parse
 * plus a guess about which `<div>` was the content.
 */

/** Everything the CLI touches that is not pure computation. */
export interface CliContext {
  fetch: typeof globalThis.fetch
  env: Record<string, string | undefined>
  /** Written to on success. */
  out: (text: string) => void
  /** Written to for errors and diagnostics; never mixed into piped output. */
  err: (text: string) => void
}

/** Exit codes. `2` is reserved for "the CLI was used wrongly". */
export const EXIT_OK = 0
export const EXIT_FAILED = 1
export const EXIT_USAGE = 2

/** The package's own name, used in help output. */
export const CLI_NAME = 'aglyn'

const HELP = `${CLI_NAME} — read and script any site built on Aglyn

USAGE
  ${CLI_NAME} <command> [arguments] [options]

READ COMMANDS (no account, no API key — these work against any Aglyn site)
  read <url>              print a page as Markdown, chrome and scripts removed
  llms <site>             print the site's /llms.txt — what it is for
  openapi <site>          print the site's OpenAPI 3.1 description
  site <site>             print the site's public identity as JSON
  pages <site>            list the site's published pages
  sitemap <site>          print the sitemap index

AUTHENTICATED
  api <METHOD> <path>     call the Aglyn REST API v1 with your key
  auth status             say whether a key is configured, without printing it

OPTIONS
  --json                  print JSON rather than a table, where both make sense
  --limit <n>             page size for list commands (default 50, max 100)
  --base <url>            override the API base for \`api\` (default from env)
  -h, --help              this text
  -V, --version           print the version

ENVIRONMENT
  AGLYN_API_KEY           key for \`api\`; create one in Settings → API keys
  AGLYN_API_URL           API base for \`api\`

EXAMPLES
  ${CLI_NAME} read https://example.com/pricing
  ${CLI_NAME} llms example.com
  ${CLI_NAME} pages example.com --json
  ${CLI_NAME} api GET /sites
`

/**
 * Turn what a person typed into an absolute origin.
 *
 * Accepts `example.com`, `https://example.com`, `example.com/` and a full page
 * URL, because all four are things somebody has in their clipboard. HTTPS is
 * assumed for a bare name — a CLI that silently downgraded to HTTP would be
 * sending an API key over the wire in the clear on the one command that has
 * one.
 */
export function siteOrigin(input: string): string | null {
  const raw = String(input ?? '').trim()
  if (!raw) return null
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`
  try {
    const url = new URL(withScheme)
    if (!url.hostname.includes('.') && url.hostname !== 'localhost') return null
    return url.origin
  } catch {
    return null
  }
}

/** Parsed argv: the words, and the flags that modify them. */
export interface ParsedArgs {
  command: string
  positional: string[]
  json: boolean
  help: boolean
  version: boolean
  limit?: number
  base?: string
}

/**
 * Parse argv.
 *
 * Hand-written rather than a dependency: the surface is nine commands and five
 * flags, and a CLI that an agent installs should not pull a parser and its
 * transitive tree to read `--json`.
 *
 * `--` ends option parsing, so a path that begins with a dash can still be
 * passed to `api`.
 */
export function parseArgs(argv: readonly string[]): ParsedArgs {
  const parsed: ParsedArgs = {
    command: '',
    positional: [],
    json: false,
    help: false,
    version: false,
  }
  let optionsEnded = false
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    if (optionsEnded) {
      parsed.positional.push(token)
      continue
    }
    if (token === '--') {
      optionsEnded = true
      continue
    }
    if (token === '-h' || token === '--help') {
      parsed.help = true
      continue
    }
    if (token === '-V' || token === '--version') {
      parsed.version = true
      continue
    }
    if (token === '--json') {
      parsed.json = true
      continue
    }
    if (token === '--limit') {
      parsed.limit = Number(argv[index + 1])
      index += 1
      continue
    }
    if (token === '--base') {
      parsed.base = argv[index + 1]
      index += 1
      continue
    }
    if (parsed.command === '') parsed.command = token
    else parsed.positional.push(token)
  }
  return parsed
}

/**
 * How this client names itself.
 *
 * A tool that fetches other people's sites and refuses to say what it is
 * leaves the operator of those sites with an unattributable request in their
 * logs and no way to contact anyone about it. Naming it also means a site that
 * wants to admit — or refuse — this CLI specifically has a token to match on,
 * which an unnamed client denies them.
 */
export const userAgent = (version: string): string =>
  `aglyn-cli/${version} (+https://aglyn.com)`

/** One fetch, with the errors a person can act on. */
async function get(
  context: CliContext,
  url: string,
  accept: string,
  version: string,
): Promise<{
  ok: boolean
  status: number
  body: string
  /**
   * What the server said it sent. Read by the caller to tell a site that
   * ignored `Accept` from one that answered it, so it belongs on the type
   * rather than only on the two returns that happen to set it.
   */
  contentType: string
}> {
  let response: Response
  try {
    response = await context.fetch(url, {
      headers: { Accept: accept, 'User-Agent': userAgent(version) },
    })
  } catch (error) {
    return {
      ok: false,
      status: 0,
      contentType: '',
      // The message a DNS failure or a refused connection produces is the most
      // useful thing there is here, so it is passed through rather than
      // replaced with "request failed".
      body: `could not reach ${url}: ${(error as Error)?.message ?? error}`,
    }
  }
  const body = await response.text()
  return {
    ok: response.ok,
    status: response.status,
    body,
    contentType: response.headers.get('Content-Type') ?? '',
  }
}

/** `data` out of the platform's JSON envelope, or null. */
function envelopeData(body: string): unknown {
  try {
    const parsed = JSON.parse(body) as { status?: string; data?: unknown }
    return parsed?.data ?? null
  } catch {
    return null
  }
}

/** Right-pad, for the table output. */
const pad = (value: string, width: number): string =>
  value.length >= width ? value : value + ' '.repeat(width - value.length)

/**
 * Run one command.
 *
 * Returns an exit code rather than calling `process.exit`, so a test can assert
 * on it and so a future embedding (a `--watch`, an MCP server) can call this in
 * a loop.
 */
export async function runCli(
  argv: readonly string[],
  context: CliContext,
  version = '0.0.0',
): Promise<number> {
  const args = parseArgs(argv)

  if (args.version) {
    // WITH the newline. Without it the version runs into whatever the shell
    // prints next, and `aglyn --version >> file` produces a line that swallows
    // the following one. `$(aglyn --version)` strips it either way.
    context.out(`${version}\n`)
    return EXIT_OK
  }
  if (args.help || args.command === '' || args.command === 'help') {
    context.out(HELP)
    // Asking for help is a SUCCESS. A CLI that exits non-zero on `--help`
    // fails a shell script that runs `set -e` and checks its own usage.
    return EXIT_OK
  }

  const needsSite = ['read', 'llms', 'openapi', 'site', 'pages', 'sitemap']
  if (needsSite.includes(args.command) && args.positional.length === 0) {
    context.err(`${CLI_NAME} ${args.command}: give me a site or a URL\n`)
    return EXIT_USAGE
  }

  switch (args.command) {
    case 'read': {
      const target = args.positional[0]
      const asUrl = /^https?:\/\//i.test(target) ? target : `https://${target}`
      const result = await get(context, asUrl, 'text/markdown', version)
      if (!result.ok) {
        context.err(
          result.status === 406
            ? `${asUrl} does not serve Markdown.\n${result.body}`
            : result.status
              ? `${asUrl} answered ${result.status}\n`
              : `${result.body}\n`,
        )
        return EXIT_FAILED
      }
      /*
        SAY SO WHEN THE SITE IGNORED THE NEGOTIATION.

        A server that does not negotiate answers `200 text/html` to
        `Accept: text/markdown`, and printing that to stdout unremarked is the
        silent fallback acceptmarkdown.com warns about: `aglyn read url >
        page.md` writes HTML into a file named `.md` and nothing ever says so.

        The warning goes to STDERR and the body still goes to stdout, so a
        pipe keeps working and a person watching the terminal learns the truth.
        Exit stays 0 — content did come back, and failing here would break
        `set -e` scripts over a server-side shortcoming.
      */
      if (!/^text\/markdown\b/i.test(result.contentType)) {
        // Names the type it DID send rather than assuming HTML — a site that
        // answers `text/plain` or `application/json` here is equally not
        // negotiating, and a message that says "this is its HTML" about a JSON
        // body is a message the reader stops trusting.
        context.err(
          `warning: ${asUrl} answered ${result.contentType || 'no content type'}, ` +
            'not text/markdown — this is not a Markdown rendering of the page.\n',
        )
      }
      context.out(result.body)
      return EXIT_OK
    }

    case 'llms':
    case 'openapi':
    case 'sitemap': {
      const origin = siteOrigin(args.positional[0])
      if (!origin) {
        context.err(`not a site: ${args.positional[0]}\n`)
        return EXIT_USAGE
      }
      const path =
        args.command === 'llms'
          ? '/llms.txt'
          : args.command === 'openapi'
            ? '/openapi.json'
            : '/sitemap.xml'
      const result = await get(context, `${origin}${path}`, '*/*', version)
      if (!result.ok) {
        context.err(
          result.status === 404
            ? `${origin} publishes no ${path} — it may not be an Aglyn site, or it has search discouraged.\n`
            : result.status
              ? `${origin}${path} answered ${result.status}\n`
              : `${result.body}\n`,
        )
        return EXIT_FAILED
      }
      context.out(result.body)
      return EXIT_OK
    }

    case 'site': {
      const origin = siteOrigin(args.positional[0])
      if (!origin) {
        context.err(`not a site: ${args.positional[0]}\n`)
        return EXIT_USAGE
      }
      const result = await get(
        context,
        `${origin}/api/host`,
        'application/json',
        version,
      )
      const data = result.ok ? (envelopeData(result.body) as { host?: unknown }) : null
      if (!result.ok || !data?.host) {
        context.err(`${origin} did not answer with a site identity\n`)
        return EXIT_FAILED
      }
      context.out(`${JSON.stringify(data.host, null, 2)}\n`)
      return EXIT_OK
    }

    case 'pages': {
      const origin = siteOrigin(args.positional[0])
      if (!origin) {
        context.err(`not a site: ${args.positional[0]}\n`)
        return EXIT_USAGE
      }
      /*
        FOLLOWS THE CURSOR to the end. `/api/screen` pages at 50, and a person
        asking a CLI to list the pages of a site means all of them — stopping at
        the first page would be the defect that made the endpoint undescribable
        in the first place.
      */
      const collected: Array<Record<string, unknown>> = []
      let token = ''
      for (let request = 0; request < 100; request += 1) {
        const query = new URLSearchParams()
        if (token) query.set('cursor', token)
        if (args.limit) query.set('limit', String(args.limit))
        const result = await get(
          context,
          `${origin}/api/screen${query.size ? `?${query}` : ''}`,
          'application/json',
          version,
        )
        if (!result.ok) {
          context.err(`${origin}/api/screen answered ${result.status || result.body}\n`)
          return EXIT_FAILED
        }
        const data = envelopeData(result.body) as {
          screens?: Array<Record<string, unknown>>
          cursor?: string
          nextPageToken?: string
        } | null
        for (const screen of data?.screens ?? []) collected.push(screen)
        /*
          `cursor` is the documented field (AGL-2751). The older
          `nextPageToken` is read as a fallback so a build of this CLI keeps
          working against a self-hosted instance that has not deployed the
          rename — the alias costs nothing and the alternative is a client
          that silently returns one page.
        */
        token = String(data?.cursor ?? data?.nextPageToken ?? '')
        if (!token) break
      }
      if (args.json) {
        context.out(`${JSON.stringify(collected, null, 2)}\n`)
        return EXIT_OK
      }
      if (collected.length === 0) {
        context.err('no published pages\n')
        return EXIT_OK
      }
      /*
        `path` over `slug` (AGL-2719). `slug` is ONE segment, so a page at
        `/use-cases/portfolios` printed as `portfolios` — a listing whose
        left column could not be pasted into a browser, and which collides
        whenever two sections share a leaf name. The routing map carries the
        composed path and the endpoint now returns it; `slug` stays the
        fallback for a server that predates it.
      */
      const addressOf = (screen: Record<string, unknown>) =>
        String(screen['path'] ?? screen['slug'] ?? '')
      const width = Math.max(...collected.map((s) => addressOf(s).length), 4)
      for (const screen of collected) {
        context.out(
          `${pad(addressOf(screen), width)}  ${String(
            screen['displayName'] ?? '',
          )}\n`,
        )
      }
      return EXIT_OK
    }

    case 'auth': {
      const sub = args.positional[0] ?? 'status'
      if (sub !== 'status') {
        context.err(
          'auth: only `status` is available. Set AGLYN_API_KEY in your environment;\n' +
            'the CLI deliberately does not write your key to disk.\n',
        )
        return EXIT_USAGE
      }
      const key = context.env['AGLYN_API_KEY']
      if (!key) {
        context.err('no AGLYN_API_KEY set\n')
        return EXIT_FAILED
      }
      /*
        The key is NEVER printed, not even partially. A CLI that echoes a
        prefix teaches people it is safe to paste that output into an issue,
        and a prefix plus a screenshot is most of a key.
      */
      context.out('AGLYN_API_KEY is set\n')
      return EXIT_OK
    }

    case 'api': {
      const method = String(args.positional[0] ?? '').toUpperCase()
      const path = args.positional[1]
      if (!method || !path) {
        context.err(`usage: ${CLI_NAME} api <METHOD> <path>\n`)
        return EXIT_USAGE
      }
      const key = context.env['AGLYN_API_KEY']
      if (!key) {
        context.err(
          'api: set AGLYN_API_KEY. Create a key in the console under\n' +
            'Settings → API keys. Every other command here needs no key.\n',
        )
        return EXIT_USAGE
      }
      const base = (
        args.base ??
        context.env['AGLYN_API_URL'] ??
        'https://app.aglyn.com/api/v1'
      ).replace(/\/+$/, '')
      let response: Response
      try {
        response = await context.fetch(`${base}/${path.replace(/^\/+/, '')}`, {
          method,
          headers: {
            Authorization: `Bearer ${key}`,
            Accept: 'application/json',
            'User-Agent': userAgent(version),
          },
        })
      } catch (error) {
        context.err(`could not reach ${base}: ${(error as Error)?.message ?? error}\n`)
        return EXIT_FAILED
      }
      const body = await response.text()
      // The BODY goes to stdout on failure too: the API answers refusals with a
      // JSON envelope naming the reason, and swallowing it would leave a caller
      // with a status code and no way to find out why.
      context.out(body.endsWith('\n') ? body : `${body}\n`)
      return response.ok ? EXIT_OK : EXIT_FAILED
    }

    default:
      context.err(`unknown command: ${args.command}\n\n${HELP}`)
      return EXIT_USAGE
  }
}
