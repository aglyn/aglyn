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
 * Pins the apps/docs phone-home check (AGL-2124).
 *
 *   node --test tools/scripts/lib/docs-self-host.test.mjs
 *
 * The first version of this check reported GREEN over the exact literal it
 * exists to catch: its comment stripper was `//.*$`, which eats everything
 * after the `//` in `https://`. That was found only by running the check
 * against the pre-fix files on purpose. The three literal cases below are
 * written from that direction — each is the real line from the real file.
 */

import { strict as assert } from 'node:assert'
import { describe, it } from 'node:test'

import {
  evaluateDocsSelfHost,
  formatDocsSelfHostFailure,
} from './docs-self-host.mjs'

const scan = (source, path = 'apps/docs/src/thing.ts') =>
  evaluateDocsSelfHost([{ path, source }])

describe('evaluateDocsSelfHost', () => {
  it('catches the compiled-in GA4 measurement id', () => {
    const result = scan("        gtag: { trackingID: 'G-YW5PG16YTM' },")
    assert.equal(result.ok, false)
    assert.match(result.findings[0].what, /GA4/)
  })

  it('catches the error beacon endpoint THROUGH the // in https://', () => {
    // THE REGRESSION. A naive line-comment strip makes this line invisible,
    // and the check then passes over the defect while looking healthy.
    const result = scan(
      "const ENDPOINT = 'https://app.aglyn.com/api/errors'",
      'apps/docs/src/error-beacon.ts',
    )
    assert.equal(result.ok, false)
    assert.equal(result.findings.length, 1)
    assert.equal(result.findings[0].line, 1)
  })

  it('catches the status page probing our production origins', () => {
    const result = scan(
      ["    base: 'https://app.aglyn.com',", "    base: 'https://demo.aglyn.com',"].join(
        '\n',
      ),
      'apps/docs/src/pages/status.tsx',
    )
    assert.equal(result.ok, false)
    assert.equal(result.findings.length, 2)
    assert.deepEqual(
      result.findings.map((f) => f.line),
      [1, 2],
    )
  })

  it('a comment ABOUT the defect is not the defect', () => {
    // Every fix in this area leaves an explanation behind. A check that
    // cannot tell prose from code gets deleted rather than obeyed.
    const result = scan(
      [
        '/**',
        " * This was a bare 'https://app.aglyn.com/api/errors' (AGL-2124).",
        ' */',
        '// and it used to be G-YW5PG16YTM',
        "const ENDPOINT = read('DOCS_ERROR_BEACON_ENDPOINT')",
      ].join('\n'),
    )
    assert.equal(result.ok, true)
  })

  it('the configured shape passes', () => {
    // POSITIVE CONTROL: without it the suite is satisfied by a checker that
    // rejects everything.
    const result = scan(
      "const docsGaTrackingId = env('DOCS_GA_TRACKING_ID')",
      'apps/docs/docusaurus.config.ts',
    )
    assert.equal(result.ok, true)
    assert.equal(result.checked, 1)
  })

  it('names the file, the line and the fix', () => {
    const message = formatDocsSelfHostFailure(
      scan("  base: 'https://demo.aglyn.com',", 'apps/docs/src/pages/status.tsx'),
    )
    assert.match(message, /apps\/docs\/src\/pages\/status\.tsx:1/)
    assert.match(message, /DOCS_STATUS_TARGETS/)
    assert.match(message, /never ours/)
  })
})
