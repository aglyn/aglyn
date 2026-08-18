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
 * The tenant never falls through to the framework's error page (AGL-2074).
 *
 * ## Why this is a FILE-EXISTENCE guard and not only a render test
 *
 * The bug was not that a boundary rendered badly. It was that **no boundary
 * existed**, in an app where nothing about the source tree says one is
 * missing: every page compiled, every test passed, and the defect was visible
 * only to someone loading a URL that did not exist. Next resolves these by
 * FILE PATH, so the path is the contract — a boundary moved one directory up
 * still compiles, still renders in a unit test, and silently stops covering
 * the route it was written for.
 *
 * So the assertions below are deliberately about paths, and the paths are
 * spelled out rather than globbed. Each one is checked to FAIL if the file is
 * deleted or relocated, which is the failure mode that shipped.
 *
 * ## And the white-label assertion is the one to keep
 *
 * The tenant serves white-labelled customer domains. A boundary that reaches
 * for the platform's name when host data is unavailable puts Aglyn's brand on
 * an agency's client's site at the moment something broke — see AGL-1354 for
 * how narrow that boundary is. The guard is crude on purpose: the string does
 * not appear in these files at all, so there is no judgement call at review
 * time about whether a given mention is "the safe kind".
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const APP = join(__dirname, '..', 'app')

/**
 * Every rung, and the reason it cannot be folded into the one above it.
 * `[host]/*` renders under `[host]/layout`, so it gets the site's theme and
 * mark; `app/*` renders when that layout is what failed, so it cannot.
 */
const BOUNDARIES = [
  ['[host]/not-found.tsx', 'the 404, under the host theme'],
  ['[host]/error.tsx', 'a throw in the page, loader or metadata'],
  ['error.tsx', 'a throw in [host]/layout, which [host]/error cannot catch'],
  ['global-error.tsx', 'a throw in the root layout'],
  ['not-found.tsx', 'a path that never resolves a host'],
] as const

describe('tenant error boundaries (AGL-2074)', () => {
  it.each(BOUNDARIES)('app/%s exists — %s', (relativePath) => {
    // `readFileSync` rather than `existsSync`: a zero-byte file passes an
    // existence check and exports no component, which is the same outage
    // with a green test next to it.
    const source = readFileSync(join(APP, relativePath), 'utf8')
    expect(source).toContain('export default')
  })

  it.each(BOUNDARIES)(
    'app/%s names no platform brand (white-label, AGL-1354)',
    (relativePath) => {
      const source = readFileSync(join(APP, relativePath), 'utf8')
      // Strip comments first — the reasoning ABOVE the code is allowed to
      // discuss Aglyn and white-labelling by name, and must be, or the next
      // person deletes the rule without learning why it is there. Only what
      // renders is constrained.
      const code = source
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '')
        // Import specifiers too. `@aglyn/shared-ui-jsx/...` is our own
        // package scope on every file in the monorepo — matching it would
        // make this assertion fire on the act of importing the shared
        // component, which is the opposite of the rule. What is constrained
        // is the copy a VISITOR reads.
        .replace(/^\s*import\s[\s\S]*?from\s+'[^']*'\s*$/gm, '')
      expect(code).not.toMatch(/Aglyn/i)
      expect(code).not.toMatch(/powered by/i)
    },
  )

  it('the two provider-free screens declare their own colors', () => {
    // `color-scheme` alone left BLACK text on the browser's black canvas —
    // it changes UA defaults for the ROOT element, and these render into a
    // div. A page that is invisible in dark mode is worse than the framework
    // page it replaces and looks identical in review, so the presence of a
    // real `prefers-color-scheme` rule is asserted rather than assumed.
    const plain = readFileSync(
      join(
        __dirname,
        '..',
        '..',
        '..',
        'libs/shared/ui/jsx/src/lib/components/status-screen-plain.component.tsx',
      ),
      'utf8',
    )
    expect(plain).toContain('prefers-color-scheme: dark')
    expect(plain).toMatch(/background:\s*#/)
    expect(plain).toMatch(/color:\s*#/)
  })

  it('the branded screen sizes the site logo with an explicit height', () => {
    // Measured in a real browser: `maxHeight` + `width: 'auto'` laid the
    // marketing host's logo out at 0x0 — in the DOM, `complete`,
    // `naturalWidth: 300`, and invisible. The 404 rendered with no mark and
    // the markup looked correct, so only a rendered measurement caught it.
    const branded = readFileSync(
      join(__dirname, '..', 'components', 'site-status-screen.component.tsx'),
      'utf8',
    )
    // Comments stripped first — the reasoning beside this `sx` names
    // `maxHeight` as the thing that FAILED, and an assertion that cannot
    // tell the explanation from the code fails on its own docstring. (It
    // did, on the first run. Which is the guard working.)
    const code = branded
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '')
    const logoSx = code.slice(
      code.indexOf('component="img"'),
      code.indexOf('objectFit'),
    )
    expect(logoSx).toMatch(/height:\s*44/)
    expect(logoSx).not.toMatch(/maxHeight/)
  })
})
