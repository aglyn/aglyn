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
  documentPath,
  isActionableViolation,
  parseCspReports,
  violationKey,
  type CspViolation,
} from './csp-report'

/**
 * The CSP collector's value is entirely in what it THROWS AWAY (AGL-523).
 *
 * Browser extensions inject inline scripts into every page they touch and each
 * one is a violation, so an unfiltered endpoint on a logged-in app buries the
 * one report that matters — one of our own scripts running unnonced — under
 * thousands about code we do not ship. The flip to enforcing then stays
 * un-decidable for the same reason it is un-decidable today.
 *
 * The trap these tests exist to pin: an extension's injected script and our
 * own unnonced script report the SAME `blocked-uri: inline`. Only `source-file`
 * separates them, so filtering on the blocked URI alone discards the signal and
 * keeps the noise — precisely backwards.
 */
describe('CSP violation reports (AGL-523)', () => {
  const legacy = (fields: Record<string, unknown>) => ({
    'csp-report': {
      'document-uri': 'https://app.aglyn.com/dashboard',
      'effective-directive': 'script-src-elem',
      'blocked-uri': 'inline',
      disposition: 'report',
      ...fields,
    },
  })

  const modern = (fields: Record<string, unknown>) => [
    {
      type: 'csp-violation',
      body: {
        documentURL: 'https://app.aglyn.com/dashboard',
        effectiveDirective: 'script-src-elem',
        blockedURL: 'inline',
        disposition: 'report',
        ...fields,
      },
    },
  ]

  describe('parsing both wire formats', () => {
    it('reads the legacy report-uri envelope', () => {
      const [violation] = parseCspReports(legacy({ 'source-file': 'https://app.aglyn.com/x.js' }))
      expect(violation).toMatchObject({
        documentPath: '/dashboard',
        effectiveDirective: 'script-src-elem',
        blockedUri: 'inline',
        sourceFile: 'https://app.aglyn.com/x.js',
      })
    })

    it('reads the Reporting API envelope', () => {
      const [violation] = parseCspReports(modern({ sourceFile: 'https://app.aglyn.com/x.js' }))
      expect(violation).toMatchObject({
        documentPath: '/dashboard',
        effectiveDirective: 'script-src-elem',
        blockedUri: 'inline',
        sourceFile: 'https://app.aglyn.com/x.js',
      })
    })

    it("reads Safari's single envelope — the format that was being dropped", () => {
      // AGL-1788. Captured verbatim from Safari 26 against a report-only
      // `img-src 'self'; report-uri /collect; report-to csp` — the console's
      // and tenant's exact directive pair. Safari takes the modern camelCase
      // BODY as soon as `report-to` is present, but posts it bare rather than
      // in the Reporting API's array, so it matched neither branch and every
      // Safari report was discarded before it reached the log.
      const [violation] = parseCspReports({
        type: 'csp-violation',
        url: 'https://app.aglyn.com/dashboard',
        body: {
          documentURL: 'https://app.aglyn.com/dashboard?tab=members',
          disposition: 'report',
          referrer: '',
          effectiveDirective: 'img-src',
          blockedURL: 'https://tracker.example/pixel.png',
          originalPolicy: "img-src 'self'; report-uri /x; report-to csp",
          statusCode: 200,
          sample: '',
          sourceFile: 'https://app.aglyn.com/dashboard',
          lineNumber: 0,
          columnNumber: 1,
        },
      })
      expect(violation).toMatchObject({
        documentPath: '/dashboard',
        effectiveDirective: 'img-src',
        blockedUri: 'https://tracker.example/pixel.png',
        disposition: 'report',
      })
      // And it must survive the filter, or reading it changes nothing.
      expect(isActionableViolation(violation)).toBe(true)
    })

    it('does not treat a bare envelope of another report type as a violation', () => {
      // The single-envelope branch is gated on `type`, so a deprecation report
      // posted alone cannot become a fabricated CSP violation.
      expect(
        parseCspReports({
          type: 'deprecation',
          url: 'https://app.aglyn.com/dashboard',
          body: { id: 'x', sourceFile: 'https://app.aglyn.com/x.js' },
        }),
      ).toEqual([])
    })

    it('ignores other report types sharing the endpoint', () => {
      // The Reporting API multiplexes deprecation and intervention reports
      // through the same group. Treating those as CSP violations would invent
      // problems that do not exist.
      const payload = [
        { type: 'deprecation', body: { id: 'x' } },
        ...modern({}),
        { type: 'intervention', body: { id: 'y' } },
      ]
      expect(parseCspReports(payload)).toHaveLength(1)
    })

    it('falls back to violated-directive when effective-directive is absent', () => {
      // Older browsers send only `violated-directive`, carrying the whole
      // source list. Without the split these would group separately from the
      // identical modern report — one defect appearing as two.
      const [violation] = parseCspReports(
        legacy({
          'effective-directive': undefined,
          'violated-directive': "script-src-elem 'self' 'nonce-abc'",
        }),
      )
      expect(violation.effectiveDirective).toBe('script-src-elem')
    })

    it('survives junk without throwing', () => {
      // Unauthenticated endpoint: every one of these is something a hostile
      // client can post.
      for (const junk of [null, undefined, 0, 'string', [], {}, { 'csp-report': 'nope' }]) {
        expect(parseCspReports(junk)).toEqual([])
      }
    })
  })

  describe('documentPath drops query and fragment', () => {
    it('keeps only the path', () => {
      expect(documentPath('https://app.aglyn.com/orgs/acme/billing?token=secret#x')).toBe(
        '/orgs/acme/billing',
      )
    })

    it('does not echo an unbounded non-URL back into the log', () => {
      expect(documentPath('x'.repeat(5000)).length).toBeLessThanOrEqual(200)
    })
  })

  describe('filtering', () => {
    const violation = (fields: Partial<CspViolation>): CspViolation => ({
      documentPath: '/dashboard',
      effectiveDirective: 'script-src-elem',
      blockedUri: 'inline',
      sourceFile: '',
      sample: '',
      lineNumber: null,
      disposition: 'report',
      ...fields,
    })

    it('keeps OUR unnonced inline script — the whole point', () => {
      expect(
        isActionableViolation(
          violation({ sourceFile: 'https://app.aglyn.com/_next/static/x.js' }),
        ),
      ).toBe(true)
    })

    it('drops extension injections that report the SAME blocked-uri', () => {
      // The discriminating case. Both are `blocked-uri: inline`; only the
      // source separates them. A filter keyed on the blocked URI would keep
      // both or neither.
      for (const scheme of [
        'chrome-extension://abc/inject.js',
        'moz-extension://abc/inject.js',
        'safari-web-extension://abc/inject.js',
        'webkit-masked-url://hidden/',
      ]) {
        expect(isActionableViolation(violation({ sourceFile: scheme }))).toBe(false)
      }
    })

    it('drops a violation whose BLOCKED uri is an extension', () => {
      expect(
        isActionableViolation(violation({ blockedUri: 'chrome-extension://abc/x.js' })),
      ).toBe(false)
    })

    it('drops a report naming no directive', () => {
      expect(isActionableViolation(violation({ effectiveDirective: '' }))).toBe(false)
    })

    it('drops a report with nothing blocked and nothing sampled', () => {
      expect(isActionableViolation(violation({ blockedUri: '', sample: '' }))).toBe(false)
    })
  })

  describe('grouping', () => {
    const base: CspViolation = {
      documentPath: '/dashboard',
      effectiveDirective: 'script-src-elem',
      blockedUri: 'inline',
      sourceFile: 'https://app.aglyn.com/a.js',
      sample: 'window.x=1',
      lineNumber: 12,
      disposition: 'report',
    }

    it('keeps one identity across deploys', () => {
      // A rebuild moves line numbers and can reshape the sample. If either fed
      // the key, the same unfixed defect would look like a new problem after
      // every deploy and no trend would ever be visible.
      expect(
        violationKey({
          ...base,
          lineNumber: 998,
          sample: 'window.x=2',
          sourceFile: 'https://app.aglyn.com/b.js',
        }),
      ).toBe(violationKey(base))
    })

    it('separates different directives, pages and blocked URIs', () => {
      expect(violationKey({ ...base, effectiveDirective: 'style-src' })).not.toBe(
        violationKey(base),
      )
      expect(violationKey({ ...base, documentPath: '/billing' })).not.toBe(
        violationKey(base),
      )
      expect(violationKey({ ...base, blockedUri: 'eval' })).not.toBe(violationKey(base))
    })
  })
})
