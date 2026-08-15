/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it is
 * silently ignored and the suite runs on jsdom.
 *
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
 * The console collector's per-POST budget (AGL-1785).
 *
 * `MAX_REPORTS_PER_REQUEST` is 10, and the console now runs TWO report-only
 * directives through one endpoint: `img-src` (AGL-1685, the data AGL-1702 is
 * gated on) and `script-src` (AGL-1785). They share the budget, so how the cap
 * counts stopped being an implementation detail.
 *
 * It used to slice first and dedupe second, which made it a budget of ten
 * REPORTS rather than ten PROBLEMS. That matters because the `report-to` wire
 * format batches many violations into a single POST: one offender pulling a
 * dozen chunks off one CDN — precisely AGL-1779's Monaco loader — filled the
 * whole budget by itself and truncated everything behind it, silently. The
 * new directive would then have blinded the existing one, which is the one
 * outcome this work must not produce.
 *
 * The first case below is the guard and fails against the previous ordering.
 * The rest pin properties that already held and must survive the reordering.
 */

/** One modern (`report-to`) envelope. */
const violation = (
  blocked: string,
  directive = 'script-src-elem',
  url = 'https://app.aglyn.com/e2e-bakery/hosts/demo/screens/x/besigner',
) => ({
  type: 'csp-violation',
  body: {
    documentURL: url,
    effectiveDirective: directive,
    blockedURL: blocked,
    disposition: 'report',
  },
})

const post = async (payload: unknown) => {
  const { POST } = await import('../app/api/csp-report/route')
  return POST(
    new Request('https://app.aglyn.com/api/csp-report', {
      method: 'POST',
      headers: { 'content-type': 'application/reports+json' },
      body: JSON.stringify(payload),
    }),
  )
}

const logged = (warn: jest.SpyInstance) =>
  warn.mock.calls.map(([line]) => JSON.parse(String(line)))

describe('console csp-report budget (AGL-1785)', () => {
  let warn: jest.SpyInstance

  beforeEach(() => {
    warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined)
  })
  afterEach(() => warn.mockRestore())

  it('a noisy script-src offender does NOT crowd out the img-src stream', async () => {
    // THE GUARD. Twelve script violations from one CDN — the AGL-1779 shape,
    // where a loader pulls its bundle in many pieces — followed by one image
    // violation, all in a single batched POST. Under the old slice-then-dedupe
    // ordering the twelve consumed the entire budget and the image report was
    // never logged: the new directive would have blinded AGL-1702's.
    const chunks = Array.from({ length: 12 }, (_, i) =>
      violation(`https://cdn.jsdelivr.net/npm/monaco-editor/min/vs/chunk${i}.js`),
    )
    await post([
      ...chunks,
      violation('https://tracker.example/pixel.gif', 'img-src'),
    ])
    const lines = logged(warn)
    expect(lines.map((l) => l.directive)).toContain('img-src')
    expect(lines.find((l) => l.directive === 'img-src').blocked).toBe(
      'https://tracker.example/pixel.gif',
    )
  })

  it('repeats of ONE problem cost one slot, not one each', async () => {
    // The same offending URL twenty times — a loader retrying, or one script
    // requested from several places on the page. This is what makes the budget
    // a count of problems.
    const same = Array.from({ length: 20 }, () =>
      violation('https://cdn.jsdelivr.net/npm/monaco-editor/min/vs/loader.js'),
    )
    await post(same)
    expect(logged(warn)).toHaveLength(1)
  })

  it('still bounds a hostile POST to ten lines', async () => {
    // The property the cap exists for, unchanged by the reordering. This route
    // is unauthenticated by necessity, so anyone can post anything; DISTINCT
    // violations must still not become an unbounded log flood.
    const many = Array.from({ length: 60 }, (_, i) =>
      violation(`https://evil.example/${i}.js`),
    )
    await post(many)
    expect(logged(warn)).toHaveLength(10)
  })

  it('still distinguishes different offenders rather than collapsing them', async () => {
    // The dedup must not be so blunt that a second defect hides behind a first.
    // Same directive, same page, different blocked host.
    await post([
      violation('https://one.example/a.js'),
      violation('https://two.example/b.js'),
    ])
    expect(logged(warn).map((l) => l.blocked).sort()).toEqual([
      'https://one.example/a.js',
      'https://two.example/b.js',
    ])
  })

  it('keeps the key on every line, so the streams stay separable', async () => {
    // The log query is how anyone reads this. `directive` + `disposition` are
    // what separate the script-src report-only stream from the img-src one and
    // from the ENFORCING script-src violations, all of which share this tag.
    await post([violation('https://cdn.jsdelivr.net/x.js')])
    const [line] = logged(warn)
    expect(line.tag).toBe('AGL-523:csp-violation')
    expect(line.directive).toBe('script-src-elem')
    expect(line.disposition).toBe('report')
    expect(line.key).toContain('https://cdn.jsdelivr.net/x.js')
  })
})
