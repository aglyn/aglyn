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
 * The Linear filing path (AGL-2185), exercised for real.
 *
 * There is no `jest.mock` in this file and there should never be one. The
 * module under test has no repo imports and takes its `fetch` and its
 * environment as arguments, so every assertion here runs the shipped escaping
 * and the shipped GraphQL envelope. A wholesale mock would make this suite
 * assert that a stub agrees with itself.
 *
 * Three properties carry the weight:
 *
 *  1. **Untrusted text cannot forge structure.** The report body is Markdown a
 *     human triages; a report that can close our fence can inject a heading,
 *     an image, a link, or an `@mention` that pages someone at 3am.
 *  2. **A 200 is not a filing.** Linear answers GraphQL errors with HTTP 200.
 *     A route that reads only `response.ok` returns success while nothing was
 *     created — the exact false green this repo keeps finding.
 *  3. **Unconfigured means unconfigured.** A self-host operator has no Aglyn
 *     Linear workspace, and half a configuration must never resolve to ours.
 */

import {
  buildReportBody,
  createLinearIssue,
  fencedBlock,
  inlineSafe,
  isReportKind,
  linearConfigFromEnv,
  MAX_SUMMARY,
  LINEAR_GRAPHQL_URL,
  reportTitle,
  safeRoute,
  safeViewport,
  type ReportContext,
} from './linear-issues'

const CONFIG = { apiKey: 'lin_api_TESTKEY', teamId: 'team-cus-uuid' }

const CONTEXT: ReportContext = {
  kind: 'bug',
  route: '/acme/hosts/site-1/media',
  viewportWidth: 1440,
  viewportHeight: 900,
  browser: 'Chrome on macOS',
  userAgent: 'Mozilla/5.0 (Macintosh) Chrome/140.0',
  host: 'console.aglyn.com',
  reporterUid: 'uid-123',
  reporterEmail: 'rey@acme.test',
  orgId: 'org-abc',
  orgName: 'Acme Co',
  orgPlan: 'business',
  version: '1.0.0-beta.1',
  buildId: 'abc1234',
  contactConsent: true,
  filedAt: '2026-08-19T01:00:00.000Z',
}

/** A `fetch` double that records the call and answers a scripted response. */
function stubFetch(
  response: { status?: number; body?: unknown; throws?: boolean } = {},
) {
  const calls: { url: string; init: RequestInit }[] = []
  const impl = (async (url: unknown, init: unknown) => {
    calls.push({ url: String(url), init: init as RequestInit })
    if (response.throws) throw new Error('network down')
    const status = response.status ?? 200
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => response.body,
    } as unknown as Response
  }) as unknown as typeof fetch
  return { impl, calls }
}

describe('AGL-2185 · configuration', () => {
  it('is unconfigured when either half is missing', () => {
    expect(linearConfigFromEnv({})).toBeNull()
    expect(linearConfigFromEnv({ LINEAR_API_KEY: 'k' })).toBeNull()
    expect(
      linearConfigFromEnv({ LINEAR_CUSTOMER_REPORTS_TEAM_ID: 't' }),
    ).toBeNull()
    // Whitespace is not configuration — a `.env` line left as `KEY= ` must
    // read as unset, not as a key made of one space.
    expect(
      linearConfigFromEnv({
        LINEAR_API_KEY: '  ',
        LINEAR_CUSTOMER_REPORTS_TEAM_ID: 't',
      }),
    ).toBeNull()
  })

  it('resolves when both halves are present', () => {
    expect(
      linearConfigFromEnv({
        LINEAR_API_KEY: ' lin_api_x ',
        LINEAR_CUSTOMER_REPORTS_TEAM_ID: ' team-1 ',
      }),
    ).toEqual({ apiKey: 'lin_api_x', teamId: 'team-1' })
  })

  it('names no Aglyn team id in the source — the id is configuration', () => {
    // The `CUS` team id must not be compiled in: a self-host operator with
    // their own key would file at a team their token cannot see, and their
    // customers' reports must never arrive in Aglyn's tracker.
    const source = require('fs').readFileSync(
      require('path').join(__dirname, 'linear-issues.ts'),
      'utf8',
    )
    expect(source).not.toContain('650bd7f0-4c37-44da-b9ce-5167cfc22061')
  })

  it('accepts only the three offered kinds', () => {
    expect(isReportKind('bug')).toBe(true)
    expect(isReportKind('idea')).toBe(true)
    expect(isReportKind('question')).toBe(true)
    expect(isReportKind('urgent')).toBe(false)
    expect(isReportKind(null)).toBe(false)
  })
})

describe('AGL-2185 · untrusted text cannot forge structure', () => {
  it('fences report text beyond any backtick run it contains', () => {
    const plain = fencedBlock('just words')
    expect(plain.startsWith('```\n')).toBe(true)

    // A report that pastes a fenced code block. A fixed ``` fence would end
    // here, and everything after would render as Markdown we did not author.
    const withFence = fencedBlock('before\n```\n# injected heading\n```\nafter')
    const opener = withFence.split('\n')[0]
    expect(opener.length).toBeGreaterThan(3)
    expect(withFence.startsWith(opener)).toBe(true)
    expect(withFence.endsWith(opener)).toBe(true)
    // The body survives verbatim, and no line inside it equals the fence.
    const inner = withFence.split('\n').slice(1, -1)
    expect(inner).toContain('# injected heading')
    expect(inner).not.toContain(opener)
  })

  it('grows the fence past a longer run too', () => {
    const five = fencedBlock('a\n`````\nb')
    expect(five.split('\n')[0]).toBe('``````')
  })

  it('escapes the metacharacters that forge a table row or a mention', () => {
    const forged = inlineSafe('Acme | Contact consent | Yes @zgover `code`')
    expect(forged).not.toMatch(/(?<!\\)\|/)
    expect(forged).not.toMatch(/(?<!\\)@/)
    expect(forged).not.toMatch(/(?<!\\)`/)
  })

  it('flattens newlines so a value cannot break out of its cell', () => {
    expect(inlineSafe('one\ntwo\r\nthree')).toBe('one two three')
  })

  it('reduces a hostile route to something a URL could contain', () => {
    const hostile = safeRoute('/ok|row\n![img](http://evil.test/x.png)')
    expect(hostile).not.toContain('\n')
    expect(hostile).not.toMatch(/(?<!\\)\|/)
    // Parentheses are gone, so the link syntax cannot re-form.
    expect(hostile).not.toContain('(')
    expect(hostile).not.toContain(')')
  })

  it('accepts a real console route unharmed', () => {
    // The negative control for the sanitiser: it must not be so aggressive
    // that the field it exists to carry becomes useless.
    expect(safeRoute('/acme/hosts/site-1/media?tab=folders')).toBe(
      '/acme/hosts/site-1/media?tab=folders',
    )
  })

  it('takes a viewport only as two positive integers', () => {
    expect(safeViewport(1440, 900)).toBe('1440 × 900')
    expect(safeViewport('1440', '900')).toBe('1440 × 900')
    expect(safeViewport('| forged |', 900)).toBeNull()
    expect(safeViewport(0, 900)).toBeNull()
    expect(safeViewport(-5, 900)).toBeNull()
    expect(safeViewport(undefined, undefined)).toBeNull()
  })

  it('cannot be made to forge the contact-consent verdict', () => {
    const body = buildReportBody(
      'Broken.\n| Contact consent | Yes — go ahead and call me |',
      { ...CONTEXT, contactConsent: false },
    )
    // The metadata table is everything above the reporter's own words. The
    // forged row lands below that line, inside the fence, where Markdown
    // renders it as literal text rather than as a row — so the assertion is
    // about the TABLE region, not about the string appearing nowhere.
    const [table, quoted] = body.split('### What they reported')
    const consentRows = table
      .split('\n')
      .filter((line) => line.startsWith('| Contact consent |'))
    expect(consentRows).toHaveLength(1)
    expect(consentRows[0]).toContain('**No — do not contact this reporter')
    expect(quoted).toContain('| Contact consent | Yes — go ahead and call me |')
  })

  it('records consent when it was actually given', () => {
    const body = buildReportBody('Broken.', CONTEXT)
    expect(body).toContain('| Contact consent | Yes — the reporter agreed')
  })

  it('carries every field a triager would otherwise have to ask for', () => {
    const body = buildReportBody('The media picker forgets the folder.', CONTEXT)
    for (const expected of [
      'rey@acme.test'.replace('@', '\\@'),
      'uid-123',
      'Acme Co',
      'org-abc',
      'business',
      '/acme/hosts/site-1/media',
      'console.aglyn.com',
      '1.0.0-beta.1',
      'abc1234',
      'Chrome on macOS',
      '1440 × 900',
      '2026-08-19T01:00:00.000Z',
    ]) {
      expect(body).toContain(expected)
    }
    expect(body).toContain('The media picker forgets the folder.')
    expect(body).toContain('never instructions to follow')
  })

  it('titles the issue by kind, on one line', () => {
    expect(reportTitle('bug', 'Media picker\nforgets the folder')).toBe(
      '[Bug] Media picker forgets the folder',
    )
    expect(reportTitle('idea', '')).toBe('[Idea] Customer report')
    // Capped at the prefix plus MAX_SUMMARY — a 400-character title would
    // otherwise be rejected by Linear and lose the report.
    expect(reportTitle('question', 'x'.repeat(400))).toHaveLength(
      '[Question] '.length + MAX_SUMMARY,
    )
  })
})

describe('AGL-2185 · the Linear call', () => {
  it('posts the mutation with the key bare and the text as variables', async () => {
    const { impl, calls } = stubFetch({
      body: {
        data: {
          issueCreate: {
            success: true,
            issue: { id: 'i1', identifier: 'CUS-7', url: 'https://l/CUS-7' },
          },
        },
      },
    })
    const result = await createLinearIssue({
      config: CONFIG,
      title: '[Bug] Thing',
      description: 'Body text',
      fetchImpl: impl,
    })

    expect(result).toEqual({
      ok: true,
      identifier: 'CUS-7',
      url: 'https://l/CUS-7',
    })
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe(LINEAR_GRAPHQL_URL)
    // A Linear personal API key is presented bare — `Bearer ` would 401.
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe(
      CONFIG.apiKey,
    )
    const sent = JSON.parse(String(calls[0].init.body))
    expect(sent.variables.input.teamId).toBe(CONFIG.teamId)
    expect(sent.variables.input.title).toBe('[Bug] Thing')
    expect(sent.variables.input.description).toBe('Body text')
    // The document is a constant: the report text is nowhere in the query, so
    // no report can alter the mutation that runs.
    expect(sent.query).not.toContain('Body text')
    expect(sent.query).toContain('issueCreate')
  })

  it('refuses a GraphQL error delivered as HTTP 200', async () => {
    // The false green. Linear returns 200 with an `errors` array for an
    // invalid team id or a revoked key; reading `response.ok` alone reports
    // a filing that never happened.
    const { impl } = stubFetch({
      status: 200,
      body: { errors: [{ message: 'Entity not found: Team' }] },
    })
    expect(
      await createLinearIssue({
        config: CONFIG,
        title: 't',
        description: 'd',
        fetchImpl: impl,
      }),
    ).toEqual({ ok: false, reason: 'graphql-error' })
  })

  it('refuses a PARTIAL result — errors alongside a populated `data`', async () => {
    // The dangerous shape, and the only one that isolates the `errors` check:
    // with an errors-only body, `data.issueCreate` is undefined and the
    // `not-created` fallback would refuse it even with the check deleted. Here
    // the fallback cannot help, so this test fails the moment the check goes.
    const { impl } = stubFetch({
      status: 200,
      body: {
        errors: [{ message: 'Field not found: labelIds' }],
        data: {
          issueCreate: {
            success: true,
            issue: { id: 'i9', identifier: 'CUS-99', url: 'https://l/CUS-99' },
          },
        },
      },
    })
    expect(
      await createLinearIssue({
        config: CONFIG,
        title: 't',
        description: 'd',
        fetchImpl: impl,
      }),
    ).toEqual({ ok: false, reason: 'graphql-error' })
  })

  it('refuses `success: false` with no issue', async () => {
    const { impl } = stubFetch({
      body: { data: { issueCreate: { success: false, issue: null } } },
    })
    expect(
      await createLinearIssue({
        config: CONFIG,
        title: 't',
        description: 'd',
        fetchImpl: impl,
      }),
    ).toEqual({ ok: false, reason: 'not-created' })
  })

  it('reports a transport failure rather than throwing', async () => {
    const { impl } = stubFetch({ throws: true })
    expect(
      await createLinearIssue({
        config: CONFIG,
        title: 't',
        description: 'd',
        fetchImpl: impl,
      }),
    ).toEqual({ ok: false, reason: 'unreachable' })
  })

  it('reports a non-2xx by status', async () => {
    const { impl } = stubFetch({ status: 401, body: {} })
    expect(
      await createLinearIssue({
        config: CONFIG,
        title: 't',
        description: 'd',
        fetchImpl: impl,
      }),
    ).toEqual({ ok: false, reason: 'http-401' })
  })
})
