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
 * A `?tab=` link opens the tab it names (AGL-2486), on every surface with
 * vertical tabs.
 *
 * Validating the incoming id against a hand-written condition goes wrong
 * quietly: a tab added after the condition was written is not in it, so
 * `/setup?tab=<newTab>` opens Basic details instead. Nothing fails — the page
 * renders a perfectly good panel, just not the one the URL asked for, which is
 * the kind of wrong nobody files a bug about twice.
 *
 * `useTabParam` fixed the mechanism. This is what stops the LIST going stale
 * again: the rendered tabs are derived from the page's own source and compared
 * with the ids the resolver is given. Adding a tab and forgetting the list is
 * red here rather than silently unreachable.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { SETUP_TAB_IDS } from '../app/(app)/[orgSlug]/hosts/[host]/setup/page'

const read = (...segments: string[]) =>
  readFileSync(join(__dirname, '..', ...segments), 'utf8')

const SETUP = read(
  'app',
  '(app)',
  '[orgSlug]',
  'hosts',
  '[host]',
  'setup',
  'page.tsx',
)

/**
 * Every `<Tab value={…}>` the source renders, as written.
 *
 * Two spellings, because the page has two kinds of tab: the schema-driven ones
 * (`value={schema.id}`, one per form) and the four fixed ones
 * (`value={THEME_TAB_ID}`).
 */
const renderedTabConstants = (source: string): string[] =>
  [...source.matchAll(/<Tab\s+value=\{([A-Z_]+)\}/g)].map((match) => match[1])

describe('a ?tab= link opens that tab (AGL-2486)', () => {
  it('THE REGRESSION: the Tracking tab is reachable by URL', () => {
    // The exact link that failed.
    expect(SETUP_TAB_IDS).toContain('hostTracking')
  })

  it('lists every schema-driven tab the page renders', () => {
    // The forms array is what becomes the first group of tabs.
    for (const id of ['hostDetails', 'hostSeo', 'hostTracking']) {
      expect(SETUP.includes(`id: '${id}'`)).toBe(true)
      expect(SETUP_TAB_IDS).toContain(id)
    }
  })

  it('lists every FIXED tab the page renders', () => {
    // Derived from the JSX rather than hand-listed here, so the next fixed tab
    // fails this instead of being quietly unreachable.
    //
    // The floor is a canary on the EXTRACTION, not a claim about how many
    // tabs Setup ought to have: it is what stops a regex that has stopped
    // matching from passing this test by finding nothing at all. Two, since
    // AGL-1485 moved Custom domain, Security and Activity to Admin.
    const constants = renderedTabConstants(SETUP)
    expect(constants.length).toBeGreaterThanOrEqual(2)
    for (const constant of constants) {
      const declared = SETUP.match(
        new RegExp(`const ${constant} = '([a-z-]+)'`),
      )
      expect(declared).toBeTruthy()
      expect(SETUP_TAB_IDS).toContain(declared![1])
    }
  })

  it('has no id in the list that the page does not render', () => {
    // The other direction: a tab removed but left in the list would send a
    // deep link to a panel that no longer exists.
    for (const id of SETUP_TAB_IDS) {
      expect(SETUP.includes(`'${id}'`)).toBe(true)
    }
  })

  it('every page with a tab param goes through the shared resolver', () => {
    // Three pages had three different answers and one of them was wrong.
    // Reading `?tab=` by hand is how the fourth one gets it wrong too.
    const pages = [
      ['app', '(app)', '[orgSlug]', 'hosts', '[host]', 'setup', 'page.tsx'],
      ['app', '(app)', '[orgSlug]', 'hosts', '[host]', 'admin', 'page.tsx'],
      ['app', '(app)', 'manage', 'user', 'page.tsx'],
    ]
    for (const segments of pages) {
      const source = read(...segments)
      expect(source).toContain('useTabParam')
      expect(source).not.toContain(`get('tab')`)
    }
  })
})
