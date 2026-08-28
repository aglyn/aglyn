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
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/** Every `.ts`/`.tsx` source under a directory, specs excluded. */
function tsxFilesUnder(dir: string): string[] {
  const found: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      found.push(...tsxFilesUnder(path))
      continue
    }
    if (/\.tsx?$/.test(entry.name) && !entry.name.includes('.spec.')) {
      found.push(path)
    }
  }
  return found
}
import { SETUP_TAB_IDS } from '../app/(app)/[orgSlug]/hosts/[host]/setup/page'

const read = (...segments: string[]) =>
  readFileSync(join(__dirname, '..', ...segments), 'utf8')

const REPO = join(__dirname, '..', '..', '..')
const readRepo = (path: string) => readFileSync(join(REPO, path), 'utf8')

/**
 * The shared vertical tab RAIL. Every hub surface draws through it — the org
 * marketplace, the content browser, the publish panel, and each relocated
 * feature plugin's console page — so a second answer here is a second answer
 * on all of them at once.
 */
const HUB_TABS = 'libs/shared/ui/next/src/lib/components/hub-tabs.tsx'
/** The one reader. It takes the query key from its caller, so it reads `get(param)`. */
const RESOLVER = 'libs/shared/ui/next/src/lib/hooks/use-tab-param.ts'

/**
 * A file that DRAWS a tab rail — the thing that must not resolve the parameter
 * itself.
 *
 * The rule is about rails, not about the parameter: a routed index that reads
 * `?tab=` only to FORWARD it selects no tab at all, has no panels to get
 * wrong, and answers an unknown id with a destination rather than a fallback.
 * Naming such pages in a path allowlist is the version of this guard that goes
 * stale the moment one is retired; asking whether the file renders a rail
 * does not.
 */
const drawsATabRail = (source: string) =>
  /<TabList\b/.test(source) || /<Tab\s/.test(source)

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

  it('the shared RAIL goes through the resolver too (AGL-693)', () => {
    /*
     * `HubTabs` was the fourth answer, and the widest: it read `?tab=` into
     * `useState`, which reads once. Every hub built on it therefore ignored
     * back, forward, and any link that moved the parameter under a page
     * already mounted.
     *
     * It could not have used this hook while the hook lived in
     * `apps/console/hooks` — a library cannot import from an app — which is
     * why the fix was to move the hook rather than to patch the rail.
     * `hub-tabs-follows-tab-param.spec.tsx` drives the behavior; this holds
     * the rail to the one reader.
     */
    const source = readRepo(HUB_TABS)
    expect(source).toContain('useTabParam')
    expect(source).not.toContain(`get('tab')`)
    // And not by way of a copy: the hook has to be the LIBRARY one, or the
    // console keeps a second definition of the same rule.
    expect(readRepo(RESOLVER)).toContain('export function useTabParam')
  })

  it('no surface that DRAWS tabs resolves the param itself', () => {
    /*
     * The general form of the three-answers failure. A page that draws a rail
     * and reaches for `searchParams.get('tab')` is writing the fourth answer,
     * whatever it does with it — and the ones that got it wrong all looked
     * reasonable in isolation.
     */
    const offenders = [
      ...tsxFilesUnder(join(__dirname, '..', 'app')),
      ...tsxFilesUnder(join(__dirname, '..', 'components')),
      ...tsxFilesUnder(join(REPO, 'libs', 'shared', 'ui', 'next', 'src')),
    ]
      .filter((path) => {
        const source = readFileSync(path, 'utf8')
        return source.includes(`get('tab')`) && drawsATabRail(source)
      })
      .map((path) => path.replace(`${REPO}/`, ''))
    expect(offenders).toEqual([])
  })

  it('THE CONTROL: the sweep reads real files and the rail test bites', () => {
    // A walker that found nothing, or a rail test that matched nothing, would
    // pass the test above on a console full of hand-rolled readers.
    const swept = tsxFilesUnder(join(REPO, 'libs', 'shared', 'ui', 'next', 'src'))
    expect(swept.some((path) => path.endsWith('hub-tabs.tsx'))).toBe(true)
    expect(drawsATabRail(readRepo(HUB_TABS))).toBe(true)
    expect(drawsATabRail(readRepo(RESOLVER))).toBe(false)
  })

  it('every page that still has PANELS goes through the shared resolver', () => {
    // Three pages had three different answers and one of them was wrong.
    // Reading `?tab=` by hand is how the fourth one gets it wrong too.
    //
    // Manage Account has left this list: its six panels are routes (AGL-693),
    // so it selects nothing and has nothing to resolve. What it does with the
    // parameter now is forward it, which `account-section-links.spec.tsx`
    // owns.
    const pages = [
      ['app', '(app)', '[orgSlug]', 'hosts', '[host]', 'setup', 'page.tsx'],
    ]
    for (const segments of pages) {
      const source = read(...segments)
      expect(source).toContain('useTabParam')
      expect(source).not.toContain(`get('tab')`)
    }
  })

  /**
   * A page whose panels became ROUTES carries no `?tab=` map at all (AGL-693).
   *
   * The parameter existed so a panel could be linked to; a route is the link.
   * With no shipped customers there is nothing holding an old settings or
   * admin URL, so a compatibility map would be a second set of names for the
   * same pages, maintained against them forever.
   *
   * What this still holds is that those pages do not go back to reading the
   * parameter by hand — the thing the resolver above exists to prevent.
   */
  it('a routed section index reads no tab param', () => {
    const routed = [
      ['app', '(app)', '[orgSlug]', 'settings', 'page.tsx'],
      ['app', '(app)', '[orgSlug]', 'hosts', '[host]', 'admin', 'page.tsx'],
    ]
    for (const segments of routed) {
      const source = read(...segments)
      expect(source).not.toContain(`get('tab')`)
      expect(source).toContain('router.replace')
    }
  })

  /**
   * Manage Account is the ONE routed index that keeps a map, and it is not an
   * exception to the reasoning above — it is the case the reasoning turns on.
   *
   * "Nothing shipped holds an old link" is true of settings and site admin and
   * false here: `security-alerts.ts` has been mailing
   * `/manage/user?tab=security` on every new-device sign-in, those messages sit
   * in inboxes, and they cannot be edited. The reader opening one has just been
   * told a stranger reached their account.
   *
   * What the map may NOT become is a second reader of the parameter with its
   * own opinion — the failure this whole suite exists for. It resolves through
   * `constants/account-sections.ts`, which is also what draws the rail, so the
   * ids it forwards and the sections that exist are one list.
   */
  it('the account index forwards ?tab= through the sections list', () => {
    const source = read('app', '(app)', 'manage', 'user', 'page.tsx')
    expect(source).toContain('accountSectionHrefForTab')
    expect(source).toContain('router.replace')
  })
})