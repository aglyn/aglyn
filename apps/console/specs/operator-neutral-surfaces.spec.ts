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
 * The surfaces that must name NO operator, held case-insensitively
 * (AGL-2350).
 *
 * `status-screen-plain.component.tsx` states the rule these share, and states
 * it well: these boundaries fire precisely when host data is unavailable, so
 * there is nothing to distinguish a white-label agency's site from our own.
 * *"Naming nobody is the only answer that is correct in every case."*
 *
 * Both files broke it, and neither break was reachable by any gate the repo
 * had:
 *
 *  - the status screen's root element shipped `class="aglyn-status-screen"`,
 *    three lines below that docblock, and repeated it four more times inside
 *    the injected `<style>` — on the 404 and crash pages of a white-label
 *    customer's own domain;
 *  - the console's offline fallback shipped `<title>You're offline · Aglyn</title>`,
 *    a sentence naming the platform, and the platform's initial drawn on an
 *    accent tile.
 *
 * ## Why `check:brand-literals` could never see either
 *
 * Two independent blind spots, and it is worth being precise about which,
 * because neither is a bug in that gate:
 *
 *  1. **Case.** `BRAND_WORD` is the capitalised `Aglyn`, on the sound
 *     reasoning that a lowercase one is nearly always a hostname, package
 *     scope, cookie name or CSS class — none of which are copy. A CSS class
 *     is exactly what the status screen leaked, and it was *also* copy about
 *     who the operator is. The exclusion is right in general and wrong here.
 *  2. **File type.** Its `SWEPT` pattern is `.tsx?|jsx?|mjs|cjs`, so a
 *     `.html` file is not read at all. The offline page is static by design —
 *     it cannot import `PLATFORM_BRAND_NAME`, and `ConsoleBrandingEffects`
 *     cannot reach it either, since it is not in the React tree. Being
 *     un-brandable is precisely why it must be neutral.
 *
 * ## The comment rule is INVERTED between the two, which is the trap
 *
 * A `.ts` comment is dropped by the bundler and reaches nobody. An **HTML
 * comment SHIPS** — it is in the reader's View Source. So the HTML is checked
 * whole, prose included, and the TSX is checked with comments stripped.
 *
 * This is not hypothetical: the first draft of the offline-page fix explained
 * itself in an HTML comment that named the brand, which would have re-shipped
 * the leak inside the very change that removed it. The `WHOLE FILE` case
 * below is what caught it.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const REPO_ROOT = join(__dirname, '../../..')

/** Case-insensitive: the leaks this guards were lowercase. */
const OPERATOR = /aglyn/i

function read(relativePath: string): string {
  return readFileSync(join(REPO_ROOT, relativePath), 'utf8')
}

/**
 * Comments removed, for the files whose comments do NOT ship.
 *
 * Block comments first, then whole-line comments — the same shape
 * `branding-coverage.spec.ts` uses. A `//` inside a string would fool it, and
 * that is tolerable here because the guarded file is asserted to contain no
 * match at all: a stripper that removes too little can only make this test
 * stricter, never blinder.
 */
function stripTsComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

/** Checked WHOLE — an HTML comment reaches the reader. */
const SHIPS_ENTIRE = ['apps/console/public/_static/offline.html']

/** Checked with comments stripped — a bundler drops them. */
const SHIPS_CODE_ONLY = [
  'libs/shared/ui/jsx/src/lib/components/status-screen-plain.component.tsx',
]

describe('surfaces shown to someone never told the operator exists', () => {
  it.each(SHIPS_ENTIRE)(
    'names no operator anywhere, comments included: %s',
    (file) => {
      // WHOLE FILE on purpose. An HTML comment is served verbatim.
      expect(read(file)).not.toMatch(OPERATOR)
    },
  )

  it.each(SHIPS_CODE_ONLY)('names no operator in shipped code: %s', (file) => {
    expect(stripTsComments(read(file))).not.toMatch(OPERATOR)
  })

  /**
   * The premise. A guard whose files moved or emptied would assert nothing
   * and pass — the failure `plugin-page-title.spec.ts` shipped with, where
   * the first draft found 0 pages and passed three of four tests.
   */
  it('is reading real, non-trivial files', () => {
    for (const file of [...SHIPS_ENTIRE, ...SHIPS_CODE_ONLY]) {
      expect(read(file).length).toBeGreaterThan(500)
    }
    // The offline page is the console's service-worker fallback, and it is
    // only that while the worker points at it.
    expect(read('apps/console/public/sw.js')).toContain(
      '/_static/offline.html',
    )
  })

  it('would actually catch a leak in either shape', () => {
    // Negative control for the matcher AND for the stripper: a lowercase
    // class name, and a capitalised sentence, both detected.
    expect("const ROOT_CLASS = 'aglyn-status-screen'").toMatch(OPERATOR)
    expect('<title>Offline · Aglyn</title>').toMatch(OPERATOR)
    // And the stripper must not swallow real code along with a comment.
    expect(stripTsComments("/* c */\nconst x = 'aglyn-thing'")).toMatch(
      OPERATOR,
    )
  })
})
