/**
 * @jest-environment node
 */

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
 * The structural guard for AGL-1059, and the reason it is structural.
 *
 * Next resolves `title` by walking route segments. A segment that sets a
 * PLAIN STRING title carries no template of its own, so it consumes the
 * ancestor template and every titled route nested below it renders
 * unbranded — `/zgover/hosts/demo/media` came out as "Media · demo", with
 * no "· Aglyn", while `/signin` one level down from the root was fine.
 *
 * Nothing about that is loud. There is no error, no warning, no type
 * error; the only symptom is a browser tab, on some routes, that nobody
 * is looking at while they add a route. It regressed twice already
 * (AGL-1059 landed three times) and it will regress again the next time
 * somebody adds a titled page under a titled layout — which is the normal
 * way to add a page.
 *
 * So this asserts the invariant on the SOURCE rather than the rendered
 * output: any title-setting file with a titled descendant must re-declare
 * the template, which is exactly what `segmentTitle()` does. A rendered
 * check would need a running, authenticated console and would still only
 * cover the routes somebody remembered to list.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

import { code as strip } from '../specs/source-text'

const APP_DIR = join(__dirname)

/** Files Next reads metadata from. */
const METADATA_FILES = new Set(['layout.tsx', 'page.tsx'])

interface TitledFile {
  /** Path relative to app/, for readable failures. */
  rel: string
  /** Directory owning it, relative to app/. */
  dir: string
  /** True when the title carries a template (object form or segmentTitle). */
  hasTemplate: boolean
}

function walk(dir: string, rel = ''): TitledFile[] {
  const found: TitledFile[] = []
  for (const entry of readdirSync(dir)) {
    const abs = join(dir, entry)
    if (statSync(abs).isDirectory()) {
      found.push(...walk(abs, rel ? `${rel}/${entry}` : entry))
      continue
    }
    if (!METADATA_FILES.has(entry)) continue
    const source = readFileSync(abs, 'utf8')
    /*
     * Strip comments so prose about titles cannot register as a title —
     * through the shared bounded stripper (AGL-1479). The copy that used to be
     * inline here read any `/*` as a comment opener, and a swallowed `title:`
     * does not fail this spec, it removes a file from the corpus: the
     * "re-declare the template" invariant then holds over fewer routes and
     * goes green.
     *
     * No fraction floor, uniquely: this walks 141 files and some are a licence
     * header over a two-line re-export. The span bound still applies.
     */
    const code = strip(source, rel ? `${rel}/${entry}` : entry, 0)
    if (!/\btitle\s*:/.test(code)) continue
    found.push({
      rel: rel ? `${rel}/${entry}` : entry,
      dir: rel,
      hasTemplate:
        /\btitle\s*:\s*segmentTitle\s*\(/.test(code) ||
        /\btitle\s*:\s*\{[^}]*\btemplate\b/.test(code),
    })
  }
  return found
}

/**
 * Every routable directory, and every directory that supplies a title.
 *
 * Separate from `walk` above because it answers a different question and
 * needs a LOOSER notion of "titles this route". `walk` looks for a literal
 * `title:` so it can inspect the template; a route may instead title itself
 * from an async `generateMetadata`, which is how
 * `(app)/[orgSlug]/marketplace/[listingId]` does it — its title comes from
 * `listingSocialCard`, whose fallback is pinned by `listing-social-card.spec`.
 * Treating `generateMetadata` as titling therefore trusts a neighbouring
 * spec rather than assuming; the alternative is a false failure on a route
 * that is correct.
 */
function walkRoutes(
  dir: string,
  rel = '',
  acc: { pages: string[]; titling: string[] } = { pages: [], titling: [] },
): { pages: string[]; titling: string[] } {
  for (const entry of readdirSync(dir)) {
    const abs = join(dir, entry)
    if (statSync(abs).isDirectory()) {
      walkRoutes(abs, rel ? `${rel}/${entry}` : entry, acc)
      continue
    }
    if (!METADATA_FILES.has(entry)) continue
    if (entry === 'page.tsx') acc.pages.push(rel)
    const code = strip(
      readFileSync(abs, 'utf8'),
      rel ? `${rel}/${entry}` : entry,
      0,
    )
    if (/\btitle\s*:/.test(code) || /\bgenerateMetadata\b/.test(code)) {
      acc.titling.push(rel)
    }
  }
  return acc
}

/** Whether `child` is nested strictly below `parent` in the route tree. */
const isBelow = (parent: string, child: string) =>
  parent === '' ? child !== '' : child.startsWith(`${parent}/`)

describe('console tab titles keep the brand (AGL-1059)', () => {
  const titled = walk(APP_DIR)

  it('finds the title-setting files at all', () => {
    // A guard that silently matches nothing passes forever. If a refactor
    // moves titles somewhere this walk cannot see, fail here rather than
    // reporting a clean run over an empty set.
    expect(titled.length).toBeGreaterThan(10)
    expect(titled.some((file) => file.rel === 'layout.tsx')).toBe(true)
  })

  it('re-declares the template on every layout with a titled route below it', () => {
    const offenders = titled
      // Only a LAYOUT hands its title down. A `page.tsx` is always a leaf:
      // it titles its own route and nothing else, even when sibling
      // directories nest below it on disk. Flagging pages would demand a
      // template that Next would never consult.
      .filter((file) => file.rel.endsWith('layout.tsx'))
      .filter((file) => !file.hasTemplate)
      .filter((file) =>
        titled.some(
          (other) => other !== file && isBelow(file.dir, other.dir),
        ),
      )
      .map((file) => file.rel)

    // Fix by returning `segmentTitle('…')` instead of a bare string. A LEAF
    // layout may keep the plain string — it has nothing below to hand the
    // template to, which is why this only flags files with descendants.
    expect(offenders).toEqual([])
  })

  /*
   * AGL-2060. The sibling invariant: not "is the brand still attached" but
   * "is there a title at all".
   *
   * Until 2026-07-28 the console had ONE titled layout — the root — because
   * pages titled themselves through `NextPageTitle`, which renders via
   * `next/head` and is inert in the App Router. So every console route
   * reported the root default, and GA4's "Views by Page title" collapsed the
   * whole console onto `Secure Platform Console – Aglyn`: 6.2K views on a row
   * that is not a page. AGL-1059 fixed it by adding 61 layouts in one commit,
   * and nothing has held that line since.
   *
   * A route that loses its title does not error, does not warn, and does not
   * fail the template guard above — that one only speaks about files which
   * ALREADY set a title. It reappears silently in the analytics as views
   * merged into a generic row, which is unrecoverable: GA4 dimension values
   * are not retroactive.
   */
  it('gives every route a title of its own, so none reports the root default', () => {
    const routes = walkRoutes(APP_DIR)
    // The corpus must be real. A walk that matched nothing would pass this
    // forever — the exact failure mode this repo keeps rediscovering.
    expect(routes.pages.length).toBeGreaterThan(40)
    expect(routes.titling.length).toBeGreaterThan(40)

    const untitled = routes.pages
      .filter(
        (page) =>
          // The ROOT layout is deliberately excluded as a title provider:
          // inheriting from it IS the bug. Its default exists for the
          // document shell, not as a page title any route should settle for.
          !routes.titling.some(
            (dir) => dir !== '' && (page === dir || page.startsWith(`${dir}/`)),
          ),
      )
      .sort()

    // Fix by adding a `layout.tsx` beside the page that exports
    // `metadata: { title: segmentTitle('…') }` — a client-component page
    // cannot export `metadata` itself, which is why titles live in layouts.
    expect(untitled).toEqual([])
  })

  it('uses one brand template, defined once', () => {
    const rootLayout = readFileSync(join(APP_DIR, 'layout.tsx'), 'utf8')
    const { TITLE_TEMPLATE } = require('./page-title') as {
      TITLE_TEMPLATE: string
    }
    expect(TITLE_TEMPLATE).toMatch(/^%s .+/)
    // The root declares the same template `segmentTitle` hands down. If
    // these drift, routes render under two different brand strings
    // depending on depth — the bug this file exists to prevent, wearing a
    // different hat.
    expect(rootLayout).toContain(TITLE_TEMPLATE)
  })
})
