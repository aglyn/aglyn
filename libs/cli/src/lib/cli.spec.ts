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

import {
  EXIT_FAILED,
  EXIT_OK,
  EXIT_USAGE,
  parseArgs,
  runCli,
  siteOrigin,
  type CliContext,
} from './cli'

/** One recorded request, so a test can assert on the URL and the headers. */
interface Call {
  url: string
  method: string
  accept: string
  authorization: string
  userAgent: string
}

/** A stub `fetch` plus the streams, so no command touches a real process. */
function harness(
  responder: (
    url: string,
    call: Call,
  ) => { status?: number; body?: string; contentType?: string },
  env: Record<string, string | undefined> = {},
) {
  const calls: Call[] = []
  const out: string[] = []
  const err: string[] = []
  const context: CliContext = {
    env,
    out: (text) => out.push(text),
    err: (text) => err.push(text),
    fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const headers = new Headers(init?.headers)
      const call: Call = {
        url,
        method: init?.method ?? 'GET',
        accept: headers.get('Accept') ?? '',
        authorization: headers.get('Authorization') ?? '',
        userAgent: headers.get('User-Agent') ?? '',
      }
      calls.push(call)
      const { status = 200, body = '', contentType } = responder(url, call)
      return new Response(body, {
        status,
        headers: contentType ? { 'Content-Type': contentType } : undefined,
      })
    }) as typeof globalThis.fetch,
  }
  return { context, calls, out: () => out.join(''), err: () => err.join('') }
}

describe('siteOrigin', () => {
  it('accepts the four things somebody actually has in their clipboard', () => {
    expect(siteOrigin('example.com')).toBe('https://example.com')
    expect(siteOrigin('https://example.com')).toBe('https://example.com')
    expect(siteOrigin('example.com/')).toBe('https://example.com')
    expect(siteOrigin('https://example.com/pricing?q=1')).toBe('https://example.com')
  })

  it('assumes HTTPS for a bare name', () => {
    // Downgrading silently would put an API key on the wire in the clear on the
    // one command that carries one.
    expect(siteOrigin('example.com')?.startsWith('https://')).toBe(true)
  })

  it('keeps an explicit http origin as written', () => {
    expect(siteOrigin('http://localhost:4500')).toBe('http://localhost:4500')
  })

  it('refuses what is not a site', () => {
    expect(siteOrigin('')).toBeNull()
    expect(siteOrigin('   ')).toBeNull()
    expect(siteOrigin('not a host')).toBeNull()
    expect(siteOrigin('nodot')).toBeNull()
  })
})

describe('parseArgs', () => {
  it('reads the command, its positionals and the flags', () => {
    expect(parseArgs(['pages', 'example.com', '--json', '--limit', '10'])).toMatchObject({
      command: 'pages',
      positional: ['example.com'],
      json: true,
      limit: 10,
    })
  })

  it('takes flags before the command too', () => {
    expect(parseArgs(['--json', 'pages', 'example.com'])).toMatchObject({
      command: 'pages',
      positional: ['example.com'],
      json: true,
    })
  })

  it('stops parsing options at `--`', () => {
    // So a path beginning with a dash can still reach `api`.
    expect(parseArgs(['api', 'GET', '--', '--weird'])).toMatchObject({
      command: 'api',
      positional: ['GET', '--weird'],
      json: false,
    })
  })

  it('recognises both spellings of help and version', () => {
    expect(parseArgs(['-h']).help).toBe(true)
    expect(parseArgs(['--help']).help).toBe(true)
    expect(parseArgs(['-V']).version).toBe(true)
    expect(parseArgs(['--version']).version).toBe(true)
  })
})

describe('runCli — help and version', () => {
  it('prints help and SUCCEEDS', async () => {
    // A non-zero `--help` fails a shell script that runs `set -e`.
    const h = harness(() => ({}))
    expect(await runCli(['--help'], h.context)).toBe(EXIT_OK)
    expect(h.out()).toContain('USAGE')
    expect(h.calls).toHaveLength(0)
  })

  it('prints help for no arguments at all', async () => {
    const h = harness(() => ({}))
    expect(await runCli([], h.context)).toBe(EXIT_OK)
    expect(h.out()).toContain('READ COMMANDS')
  })

  it('prints the version it was given', async () => {
    const h = harness(() => ({}))
    expect(await runCli(['--version'], h.context, '1.2.3')).toBe(EXIT_OK)
    // The newline matters: without it the version runs into the next line of
    // output, which a locally installed binary showed immediately.
    expect(h.out()).toBe('1.2.3\n')
  })

  it('refuses an unknown command with a usage code, and shows help', async () => {
    const h = harness(() => ({}))
    expect(await runCli(['frobnicate'], h.context)).toBe(EXIT_USAGE)
    expect(h.err()).toContain('unknown command: frobnicate')
  })
})

describe('runCli — read', () => {
  it('asks for Markdown, which is the whole point', async () => {
    const h = harness(() => ({
      body: '# Pricing\n\nPlans.\n',
      contentType: 'text/markdown; charset=utf-8',
    }))
    expect(await runCli(['read', 'https://example.com/pricing'], h.context)).toBe(EXIT_OK)
    expect(h.calls[0].accept).toBe('text/markdown')
    expect(h.calls[0].url).toBe('https://example.com/pricing')
    expect(h.out()).toBe('# Pricing\n\nPlans.\n')
  })

  it('accepts a bare host and assumes https', async () => {
    const h = harness(() => ({ body: 'ok' }))
    await runCli(['read', 'example.com/about'], h.context)
    expect(h.calls[0].url).toBe('https://example.com/about')
  })

  it('explains a 406 rather than printing the refusal as content', async () => {
    const h = harness(() => ({
      status: 406,
      body: 'This resource is available in:\n- text/html\n',
    }))
    expect(await runCli(['read', 'example.com/x'], h.context)).toBe(EXIT_FAILED)
    expect(h.err()).toContain('does not serve Markdown')
    expect(h.out()).toBe('')
  })

  it('reports an unreachable host with the underlying reason', async () => {
    const h = harness(() => {
      throw new Error('getaddrinfo ENOTFOUND nope.invalid')
    })
    expect(await runCli(['read', 'nope.invalid'], h.context)).toBe(EXIT_FAILED)
    expect(h.err()).toContain('ENOTFOUND')
  })

  it('needs something to read', async () => {
    const h = harness(() => ({}))
    expect(await runCli(['read'], h.context)).toBe(EXIT_USAGE)
    expect(h.calls).toHaveLength(0)
  })
})

describe('runCli — the discovery files', () => {
  it.each([
    ['llms', '/llms.txt'],
    ['openapi', '/openapi.json'],
    ['sitemap', '/sitemap.xml'],
  ])('%s fetches %s from the site root', async (command, path) => {
    const h = harness(() => ({ body: 'content' }))
    expect(await runCli([command, 'example.com/some/page'], h.context)).toBe(EXIT_OK)
    expect(h.calls[0].url).toBe(`https://example.com${path}`)
    expect(h.out()).toBe('content')
  })

  it('says what a 404 means rather than just the number', async () => {
    const h = harness(() => ({ status: 404, body: '' }))
    expect(await runCli(['llms', 'example.com'], h.context)).toBe(EXIT_FAILED)
    expect(h.err()).toContain('may not be an Aglyn site')
    expect(h.err()).toContain('search discouraged')
  })

  it('refuses something that is not a site', async () => {
    const h = harness(() => ({}))
    expect(await runCli(['llms', 'nonsense'], h.context)).toBe(EXIT_USAGE)
    expect(h.calls).toHaveLength(0)
  })
})

describe('runCli — site', () => {
  it('unwraps the platform envelope', async () => {
    const h = harness(() => ({
      body: JSON.stringify({ status: 'success', data: { host: { displayName: 'Acme' } } }),
    }))
    expect(await runCli(['site', 'example.com'], h.context)).toBe(EXIT_OK)
    expect(JSON.parse(h.out())).toEqual({ displayName: 'Acme' })
  })

  it('fails when the answer carries no identity', async () => {
    const h = harness(() => ({ body: JSON.stringify({ status: 'success', data: { host: null } }) }))
    expect(await runCli(['site', 'example.com'], h.context)).toBe(EXIT_FAILED)
  })
})

describe('runCli — pages', () => {
  /** Three pages across two cursor hops, then an empty token. */
  const paged = (url: string) => {
    const token = new URL(url).searchParams.get('nextPageToken')
    if (!token) {
      return {
        body: JSON.stringify({
          status: 'success',
          data: {
            screens: [{ $id: 'a', slug: 'home', displayName: 'Home' }],
            nextPageToken: 'a',
          },
        }),
      }
    }
    if (token === 'a') {
      return {
        body: JSON.stringify({
          status: 'success',
          data: {
            screens: [{ $id: 'b', slug: 'pricing', displayName: 'Pricing' }],
            nextPageToken: 'b',
          },
        }),
      }
    }
    return {
      body: JSON.stringify({
        status: 'success',
        data: { screens: [{ $id: 'c', slug: 'about', displayName: 'About' }], nextPageToken: '' },
      }),
    }
  }

  it('FOLLOWS THE CURSOR to the end', async () => {
    // "List the pages" means all of them. Stopping at the first page is the
    // defect that made the endpoint undescribable in the first place.
    const h = harness(paged)
    expect(await runCli(['pages', 'example.com', '--json'], h.context)).toBe(EXIT_OK)
    expect(JSON.parse(h.out()).map((s: { slug: string }) => s.slug)).toEqual([
      'home',
      'pricing',
      'about',
    ])
    expect(h.calls).toHaveLength(3)
  })

  it('prints the composed PATH, not the one-segment slug (AGL-2719)', async () => {
    /*
      Measured against production: a page at `/use-cases/portfolios` printed
      as `portfolios`. A listing whose left column cannot be pasted into a
      browser is not a listing of addresses, and two sections sharing a leaf
      name printed the same string twice.
    */
    const h = harness(() => ({
      body: JSON.stringify({
        status: 'success',
        data: {
          screens: [
            { $id: 'p', path: '/use-cases/portfolios', slug: 'portfolios', displayName: 'Portfolios' },
          ],
          nextPageToken: '',
        },
      }),
    }))
    await runCli(['pages', 'example.com'], h.context)
    expect(h.out()).toContain('/use-cases/portfolios')
    expect(h.out().split('  ')[0]).not.toBe('portfolios')
  })

  it('falls back to the slug when a server does not send a path', async () => {
    // A tenant that has not taken the AGL-2719 deploy yet still lists.
    const h = harness(paged)
    await runCli(['pages', 'example.com'], h.context)
    expect(h.out()).toContain('home')
    expect(h.out()).toContain('pricing')
  })

  it('prints an aligned table by default', async () => {
    const h = harness(paged)
    await runCli(['pages', 'example.com'], h.context)
    const lines = h.out().trimEnd().split('\n')
    expect(lines).toHaveLength(3)
    // Every name starts in the same column.
    const columns = lines.map((l) => l.indexOf(l.trim().split(/\s{2,}/)[1]))
    expect(new Set(columns).size).toBe(1)
  })

  it('passes a limit through', async () => {
    const h = harness(() => ({
      body: JSON.stringify({ status: 'success', data: { screens: [], nextPageToken: '' } }),
    }))
    await runCli(['pages', 'example.com', '--limit', '10'], h.context)
    expect(h.calls[0].url).toContain('limit=10')
  })

  it('is not an error when a site has no published pages', async () => {
    const h = harness(() => ({
      body: JSON.stringify({ status: 'success', data: { screens: [], nextPageToken: '' } }),
    }))
    expect(await runCli(['pages', 'example.com'], h.context)).toBe(EXIT_OK)
  })
})

describe('runCli — auth', () => {
  it('says a key is set WITHOUT printing any of it', async () => {
    // A printed prefix teaches people that pasting the output is safe.
    const h = harness(() => ({}), { AGLYN_API_KEY: 'aglyn_sk_supersecretvalue' })
    expect(await runCli(['auth', 'status'], h.context)).toBe(EXIT_OK)
    expect(h.out()).toBe('AGLYN_API_KEY is set\n')
    expect(h.out()).not.toContain('aglyn_sk')
    expect(h.out()).not.toContain('super')
  })

  it('fails when no key is configured', async () => {
    const h = harness(() => ({}))
    expect(await runCli(['auth', 'status'], h.context)).toBe(EXIT_FAILED)
  })

  it('refuses a login subcommand it deliberately does not have', async () => {
    const h = harness(() => ({}))
    expect(await runCli(['auth', 'login'], h.context)).toBe(EXIT_USAGE)
    expect(h.err()).toContain('does not write your key to disk')
  })
})

describe('runCli — api', () => {
  it('sends the key as a bearer token to the configured base', async () => {
    const h = harness(() => ({ body: '{"ok":true}' }), {
      AGLYN_API_KEY: 'aglyn_sk_k',
      AGLYN_API_URL: 'https://api.example.test/v1',
    })
    expect(await runCli(['api', 'get', '/sites'], h.context)).toBe(EXIT_OK)
    expect(h.calls[0].url).toBe('https://api.example.test/v1/sites')
    expect(h.calls[0].method).toBe('GET')
    expect(h.calls[0].authorization).toBe('Bearer aglyn_sk_k')
  })

  it('lets --base win over the environment', async () => {
    const h = harness(() => ({ body: '{}' }), {
      AGLYN_API_KEY: 'k',
      AGLYN_API_URL: 'https://env.example.test/v1',
    })
    await runCli(['api', 'GET', 'sites', '--base', 'https://flag.example.test/v1'], h.context)
    expect(h.calls[0].url).toBe('https://flag.example.test/v1/sites')
  })

  it('points at the console rather than just refusing, when no key is set', async () => {
    const h = harness(() => ({}))
    expect(await runCli(['api', 'GET', '/sites'], h.context)).toBe(EXIT_USAGE)
    expect(h.err()).toContain('Settings → API keys')
    expect(h.err()).toContain('Every other command here needs no key')
    expect(h.calls).toHaveLength(0)
  })

  it('prints the body on a refusal too, and still fails', async () => {
    // The API answers refusals with an envelope naming the reason; swallowing
    // it leaves the caller with a status code and no way to find out why.
    const h = harness(() => ({ status: 403, body: '{"error":{"message":"scope"}}' }), {
      AGLYN_API_KEY: 'k',
    })
    expect(await runCli(['api', 'GET', '/sites'], h.context)).toBe(EXIT_FAILED)
    expect(h.out()).toContain('scope')
  })

  it('needs a method and a path', async () => {
    const h = harness(() => ({}), { AGLYN_API_KEY: 'k' })
    expect(await runCli(['api'], h.context)).toBe(EXIT_USAGE)
    expect(await runCli(['api', 'GET'], h.context)).toBe(EXIT_USAGE)
  })
})

describe('runCli — the read commands need no key', () => {
  it.each([
    ['read', 'https://example.com/x'],
    ['llms', 'example.com'],
    ['openapi', 'example.com'],
    ['site', 'example.com'],
    ['sitemap', 'example.com'],
  ])('%s sends no Authorization header', async (command, target) => {
    /*
      The property the whole design rests on: the REST API is entitlement-gated,
      so a CLI that needed a key for these would tell most customers on first
      run that they cannot use it — and would be useless against a site you do
      not own, which is the case an agent is actually in.
    */
    const h = harness(
      () => ({ body: JSON.stringify({ status: 'success', data: { host: {} } }) }),
      { AGLYN_API_KEY: 'aglyn_sk_should_not_be_sent' },
    )
    await runCli([command, target], h.context)
    expect(h.calls[0].authorization).toBe('')
  })
})

describe('runCli — the client names itself', () => {
  it('sends a User-Agent carrying the version and a contact URL', async () => {
    /*
      A tool that fetches other people's sites and refuses to say what it is
      leaves the operator with an unattributable request and nobody to ask
      about it. Naming it also gives a site a token to match on, which is what
      lets them admit or refuse this CLI specifically.
    */
    const h = harness(() => ({ body: 'ok' }))
    await runCli(['read', 'example.com'], h.context, '2.3.4')
    expect(h.calls[0].userAgent).toBe('aglyn-cli/2.3.4 (+https://aglyn.com)')
  })

  it('names itself on the authenticated call too', async () => {
    const h = harness(() => ({ body: '{}' }), { AGLYN_API_KEY: 'k' })
    await runCli(['api', 'GET', '/sites'], h.context, '2.3.4')
    expect(h.calls[0].userAgent).toContain('aglyn-cli/2.3.4')
  })
})

describe('runCli — read says so when the site ignored the negotiation', () => {
  it('warns on STDERR when the answer is HTML, and still prints the body', async () => {
    /*
      A server that does not negotiate answers `200 text/html`. Printing that
      unremarked is the silent fallback acceptmarkdown.com warns about:
      `aglyn read url > page.md` writes HTML into a file named `.md` and
      nothing says so. MEASURED against production before the negotiation
      shipped — the CLI printed a full HTML document as if it were Markdown.
    */
    const h = harness(() => ({ body: '<!DOCTYPE html><p>hi', contentType: 'text/html; charset=utf-8' }))
    expect(await runCli(['read', 'example.com'], h.context)).toBe(EXIT_OK)
    expect(h.err()).toContain('answered text/html')
    expect(h.err()).toContain('not a Markdown rendering')
    // The body still reaches stdout, so a pipe keeps working.
    expect(h.out()).toBe('<!DOCTYPE html><p>hi')
  })

  it('stays quiet when the answer really is Markdown', async () => {
    const h = harness(() => ({ body: '# Real', contentType: 'text/markdown; charset=utf-8' }))
    await runCli(['read', 'example.com'], h.context)
    expect(h.err()).toBe('')
  })

  it('names whatever type came back, rather than assuming HTML', async () => {
    // A site answering `application/json` is equally not negotiating, and a
    // warning that calls a JSON body "its HTML" is one the reader stops
    // trusting.
    const h = harness(() => ({ body: '{}', contentType: 'application/json' }))
    await runCli(['read', 'example.com'], h.context)
    expect(h.err()).toContain('answered application/json')
    expect(h.err()).not.toContain('HTML')
  })
})
