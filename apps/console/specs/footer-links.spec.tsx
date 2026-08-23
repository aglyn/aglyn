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
 * The console footer's links, and the build stamp beside them (AGL-2486).
 *
 * Both footer links the console shipped were broken, and the interesting one
 * was broken SILENTLY: the console's top-level dynamic segment is
 * `[orgSlug]`, so a relative `/contact` did not 404 — it resolved to a
 * workspace named "contact" and rendered a page titled "contact · Aglyn".
 * A 404 tells you the link is wrong; a workspace page for a workspace nobody
 * has does not. That is why the assertion below is "absolute", not "not 404".
 */

import { tailNavigation, mainNavigation } from '../constants/shared'

/** Every top-level path the console actually serves under `app/(app)`. */
const CONSOLE_SEGMENTS = ['admin', 'manage']

describe('console footer links (AGL-2486)', () => {
  it('offers more than the two it had', () => {
    expect(tailNavigation.length).toBeGreaterThanOrEqual(4)
  })

  it('sends every link to an absolute url', () => {
    for (const item of tailNavigation) {
      expect(`${item.children} → ${item.href}`).toMatch(
        /→ https?:\/\/[^/]+\//,
      )
    }
  })

  it('never uses a path the org-slug segment would swallow', () => {
    // The defect, stated as a rule. A bare `/contact` is indistinguishable
    // from a workspace slug at the routing layer, so the footer must not
    // produce one — including for a link added later.
    for (const item of tailNavigation) {
      const href = String(item.href)
      expect(href.startsWith('/')).toBe(false)
      const firstSegment = href.replace(/^https?:\/\/[^/]+/, '').split('/')[1]
      if (firstSegment) expect(CONSOLE_SEGMENTS).not.toContain(firstSegment)
    }
  })

  it('opens each one in a new tab, as the rest of the console does', () => {
    // These leave the console for the marketing site or the docs site, and
    // the product is an EDITOR — a full navigation away from an open canvas
    // is how unsaved work is lost.
    for (const item of tailNavigation) {
      expect(item.target).toBe('_blank')
      expect(item.rel).toContain('noopener')
    }
  })

  it('reaches the terms, the privacy policy and the DPA', () => {
    const hrefs = tailNavigation.map((item) => String(item.href)).join(' ')
    expect(hrefs).toContain('/legal/terms')
    expect(hrefs).toContain('/legal/privacy')
    expect(hrefs).toContain('/legal/dpa')
  })

  it('keeps the nav menu\'s legal link absolute too', () => {
    // Same defect, same file, one menu up — fixing only the footer would
    // leave the identical broken link in the navigation.
    const legal = mainNavigation.find(
      (entry: any) => entry?.children === 'Legal',
    ) as any
    for (const item of legal?.items ?? []) {
      expect(String(item.href).startsWith('/')).toBe(false)
    }
  })
})

describe('the build stamp (AGL-2486)', () => {
  /**
   * Read out of the source rather than rendered, because the value is a
   * BUILD-TIME define: `BUILD_ID` is inlined by the bundler, so a jest render
   * observes the test environment's value and would prove nothing about what
   * a deployment prints.
   */
  const source = require('node:fs').readFileSync(
    require('node:path').join(__dirname, '..', 'components/footer.component.tsx'),
    'utf8',
  )

  it('does not print the unset sentinel to a visitor', () => {
    // `(NULL)` in the footer of a product taking payments reads as a fault in
    // the product. The sentinel is right; printing it is not.
    expect(source).toMatch(/BUILD_ID === 'NULL'\s*\?\s*null/)
  })

  it('still prints a real build id when there is one', () => {
    expect(source).toContain('`(${BUILD_ID})`')
  })

  it('always prints the version, which is never unset', () => {
    expect(source).toContain('`Version ${PACKAGE_VERSION}`')
  })
})
