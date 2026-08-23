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

/**
 * Dynamic segments that name a SCOPE rather than the thing on the page.
 *
 * A title's job in a tab strip is to tell one open tab from another, and the
 * segments below are shared by every tab a user has open at once — putting
 * them in the title costs characters and distinguishes nothing:
 *
 * - `orgSlug` — the org is the whole console session. Every tab is in it, and
 *   for a white-label org the tab's brand suffix already carries it.
 * - `host` — deliberately IN most of these titles as a trailing scope, but it
 *   is not the identity: four tabs on the same site is the reported bug.
 * - `versionId` — an opaque id for a revision of the entity named beside it.
 *   A user picks between "Home" and "Checkout", never between two versions of
 *   Home in two tabs; a version that needs distinguishing would be a label,
 *   which nothing records.
 * - `pluginSlug` — resolved to a DISPLAY name by `pluginPageTitle`, which is
 *   the same rule this guard is asking for, applied one indirection away.
 *
 * Everything else is an ENTITY: the URL names a specific screen, component,
 * layout, template, listing, person or org, and the tab must say which one.
 * Adding a segment here is how you exempt a route — deliberately, in review,
 * with a reason — rather than by quietly shipping a title that omits it.
 */
const SCOPE_SEGMENTS = new Set(['orgSlug', 'host', 'versionId', 'pluginSlug'])

/**
 * Whether a route only ever REDIRECTS, and so never paints a tab.
 *
 * `screens/[screenId]/versions/[versionId]/page.tsx` is nine lines of
 * `permanentRedirect` to the view route. It has no document, no `<head>` and
 * no title to get wrong, and demanding one would mean adding a layout that
 * exists solely to satisfy this test. Detected on the source rather than
 * listed by path so the next redirect shim is exempt without an edit here.
 */
function isRedirectOnly(route: string): boolean {
  const page = join(APP_DIR, route, 'page.tsx')
  const code = strip(readFileSync(page, 'utf8'), `${route}/page.tsx`, 0)
  return /\b(permanentRedirect|redirect)\s*\(/.test(code)
}

/** `[screenId]` -> `screenId`; anything else -> null. */
function dynamicParam(segment: string): string | null {
  const match = /^\[\.{0,3}(.+)\]$/.exec(segment)
  return match ? match[1] : null
}

/** The entity params a route's URL names, outermost first. */
function entityParams(route: string): string[] {
  return route
    .split('/')
    .map(dynamicParam)
    .filter((param): param is string => !!param && !SCOPE_SEGMENTS.has(param))
}

/** The balanced `{…}` beginning at or after `from`, as source. */
function balancedFrom(code: string, from: number): string {
  const open = code.indexOf('{', from)
  if (open < 0) return ''
  let depth = 0
  for (let i = open; i < code.length; i += 1) {
    if (code[i] === '{') depth += 1
    else if (code[i] === '}') {
      depth -= 1
      if (depth === 0) return code.slice(open, i + 1)
    }
  }
  return code.slice(open)
}

/**
 * The BODY of a function declared at `start` — skipping its parameter list.
 *
 * Naively taking the first balanced `{…}` takes the DESTRUCTURED PARAMETER
 * instead: every one of these reads `generateMetadata({ params }: …)`, so the
 * first brace group is `{ params }` and the body is never examined. That is
 * not a near miss — it made this guard report `marketplace/[listingId]` and
 * `publisher/[handle]` as anonymous when both name their entity correctly,
 * and a guard whose failures include correct routes is one people learn to
 * edit around. So the parameter list is matched and stepped over first.
 */
function functionBody(code: string, start: number): string {
  const paren = code.indexOf('(', start)
  if (paren < 0) return ''
  let depth = 0
  for (let i = paren; i < code.length; i += 1) {
    if (code[i] === '(') depth += 1
    else if (code[i] === ')') {
      depth -= 1
      if (depth === 0) return balancedFrom(code, i + 1)
    }
  }
  return ''
}

/**
 * ONLY the source Next actually reads a title from: the `metadata` export and
 * the `generateMetadata` export, and nothing else in the file.
 *
 * Scoping this was not tidiness — the loose version passed two of the exact
 * routes this test was written to catch. `screens/[screenId]/…/view/page.tsx`
 * is a `'use client'` page: it exports NO metadata at all, so Next reads none
 * of it, but it is 700 lines of screen editor that says `screenId` constantly.
 * Reading the whole file therefore answered "does this route know its own id"
 * — which every route does — instead of "does its TITLE say it".
 *
 * The same trap in the other direction is why a `page.tsx` is still eligible:
 * a SERVER page may legitimately export metadata, and skipping pages outright
 * would exempt it.
 */
function metadataRegions(code: string): string {
  const regions: string[] = []
  const constant = /export const metadata[^=]*=\s*\{/.exec(code)
  if (constant) regions.push(balancedFrom(code, constant.index))
  const generated = /export\s+(?:async\s+)?function\s+generateMetadata\b/.exec(
    code,
  )
  if (generated) regions.push(functionBody(code, generated.index))
  return regions.join('\n')
}

/**
 * The metadata source of every titling file at or above `route`, joined.
 *
 * Next resolves a route's title from the DEEPEST segment that sets one, but a
 * shallower layout may legitimately be the one that names the entity, so this
 * asks the weaker question: does anything on the resolution path so much as
 * mention the param? A guard that demanded the deepest file specifically
 * would fail routes that are correct.
 */
function titleSourceFor(
  route: string,
  dir: string,
  rel = '',
  acc: string[] = [],
): string[] {
  for (const entry of readdirSync(dir)) {
    const abs = join(dir, entry)
    const here = rel ? `${rel}/${entry}` : entry
    if (statSync(abs).isDirectory()) {
      // Only descend the branch the route actually lies on.
      const next = rel ? `${rel}/${entry}` : entry
      if (route === next || route.startsWith(`${next}/`)) {
        titleSourceFor(route, abs, next, acc)
      }
      continue
    }
    if (!METADATA_FILES.has(entry)) continue
    const region = metadataRegions(strip(readFileSync(abs, 'utf8'), here, 0))
    if (region) acc.push(region)
  }
  return acc
}

/**
 * Every LITERAL title in the route tree, with the file that declares it.
 *
 * Both spellings the console actually uses: `title: segmentTitle('X')`, which
 * is the dominant form because it applies the brand template, and a bare
 * `title: 'X'`. Comments are stripped through the same shared bounded stripper
 * the other walkers use, so prose naming a title cannot enter the corpus.
 */
function readdirTitles(
  dir: string,
  rel = '',
  acc: { title: string; rel: string }[] = [],
): { title: string; rel: string }[] {
  for (const entry of readdirSync(dir)) {
    const abs = join(dir, entry)
    if (statSync(abs).isDirectory()) {
      readdirTitles(abs, rel ? `${rel}/${entry}` : entry, acc)
      continue
    }
    if (!METADATA_FILES.has(entry)) continue
    const where = rel ? `${rel}/${entry}` : entry
    const code = strip(readFileSync(abs, 'utf8'), where, 0)
    /*
     * ONLY inside `export const metadata = { … }`. Scoping this to the file
     * was wrong and the guard caught itself doing it: a confirm dialog's
     * `title: 'Are you sure?'` in two `page.tsx` files read as two routes
     * sharing a page title. It is a dialog prop and reaches no `page_title`
     * at all — a false RED, which is worse than the gap, because the fix a
     * reader would reach for is renaming a dialog for a reason that is not
     * true.
     */
    const block = /export const metadata[^=]*=\s*\{/.exec(code)
    if (!block) continue
    let depth = 0
    let end = block.index + block[0].length - 1
    for (let i = end; i < code.length; i += 1) {
      if (code[i] === '{') depth += 1
      else if (code[i] === '}') {
        depth -= 1
        if (depth === 0) {
          end = i
          break
        }
      }
    }
    const metadata = code.slice(block.index, end + 1)
    for (const match of metadata.matchAll(
      /\btitle\s*:\s*(?:segmentTitle\s*\(\s*)?['"]([^'"]+)['"]/g,
    )) {
      acc.push({ title: match[1], rel: where })
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

  it('gives no two routes the SAME title (AGL-2164)', () => {
    // The sibling test above proves every route HAS a title. It cannot see
    // two routes that both have one and both say the same thing — and in GA4
    // that is the same defect wearing a different hat, because `page_title` is
    // the dimension the Pages report groups by. Two routes sharing a string
    // merge into one row, and the merge is silent: the number looks like a
    // popular page rather than two pages nobody can tell apart.
    //
    // Literal titles only. A route titled from `generateMetadata` resolves at
    // request time (the marketplace listing takes its title from the listing),
    // so a static check cannot know its value and must not guess one.
    const owners = new Map<string, string[]>()
    for (const entry of readdirTitles(APP_DIR)) {
      const list = owners.get(entry.title) ?? []
      list.push(entry.rel)
      owners.set(entry.title, list)
    }

    // The corpus must be real, or this passes forever over nothing — the
    // failure mode this file already guards against twice.
    expect(owners.size).toBeGreaterThan(25)

    const shared = [...owners.entries()]
      .filter(([, files]) => files.length > 1)
      .map(([title, files]) => `${title} — ${files.sort().join(', ')}`)
      .sort()

    // Fix by making the titles distinct, not by deleting one: a route with no
    // title of its own falls back to the root default, which is the bug the
    // test above exists to catch. Rename so a human reading the GA4 Pages
    // report can tell the two apart.
    expect(shared).toEqual([])
  })

  /*
   * AGL-2486. The invariant the three tests above cannot state: a title that
   * IDENTIFIES the thing on the page.
   *
   * Every check before this one is satisfied by a title that is merely
   * PRESENT, BRANDED and textually distinct from other ROUTES' titles. None of
   * them can see the defect that was reported: four browser tabs, open on four
   * different screens of one site, all reading "Screen besigner · demo". That
   * is one route, so "no two routes share a title" has nothing to say about
   * it; the title is present and branded, so the other two are satisfied too.
   * The guard went green while every screen in the product shared a tab.
   *
   * The rule is on the URL, because the URL is where the promise is made: if a
   * route needs `[screenId]` to know what to render, its title needs it to say
   * what it rendered. `SCOPE_SEGMENTS` is the exemption list, and adding to it
   * is a decision someone makes in review rather than an omission nobody sees.
   *
   * Mentioning the param is a weak check on purpose — it cannot know that
   * `screenId` reached the STRING rather than a log line. What it can do is
   * make the omission impossible to ship silently, which is the failure this
   * had. The rendered titles themselves are pinned by
   * `entity-page-title.spec.ts`.
   */
  it('names the entity in the title of every route whose URL names one (AGL-2486)', () => {
    const routes = walkRoutes(APP_DIR).pages
    const entityRoutes = routes.filter(
      (route) => entityParams(route).length && !isRedirectOnly(route),
    )

    // The corpus must be real. A classifier that stopped recognising dynamic
    // segments — a rename of the bracket convention, a regex slip — would
    // leave this passing forever over an empty list, which is the exact way
    // the previous three guards were satisfied by nothing.
    expect(entityRoutes.length).toBeGreaterThan(10)
    expect(
      entityRoutes.some((route) => route.includes('[screenId]')),
    ).toBe(true)
    // And the exemption list must stay an exemption list, not a way out.
    expect(SCOPE_SEGMENTS.size).toBeLessThan(6)

    const anonymous: string[] = []
    for (const route of entityRoutes) {
      const source = titleSourceFor(route, APP_DIR).join('\n')
      const missing = entityParams(route).filter(
        (param) => !new RegExp(`\\b${param}\\b`).test(source),
      )
      if (missing.length) anonymous.push(`${route} — omits ${missing.join(', ')}`)
    }

    // Fix by naming the entity: `generateMetadata` reads the id from `params`
    // and builds the title through `entityPageTitle`, whose subject the
    // client then upgrades from the id to the loaded name. Do NOT fix by
    // widening `SCOPE_SEGMENTS` unless the segment genuinely names a scope
    // every open tab shares.
    expect(anonymous.sort()).toEqual([])
  })

  it('uses one brand template, defined once', () => {
    const rootLayout = readFileSync(join(APP_DIR, 'layout.tsx'), 'utf8')
    const { TITLE_TEMPLATE } = require('./page-title') as {
      TITLE_TEMPLATE: string
    }
    expect(TITLE_TEMPLATE).toMatch(/^%s .+/)

    // The root now IMPORTS the template `segmentTitle` hands down, rather
    // than restating it (AGL-2170). This assertion used to be
    // `expect(rootLayout).toContain(TITLE_TEMPLATE)` — a source substring
    // check, which held only while the template was a bare literal and
    // silently stopped being checkable when the brand became configuration
    // (AGL-2153): two interpolations that produce the same string share no
    // substring. Rather than re-guard a duplicate, the duplicate is gone, and
    // what is pinned is that it stays gone.
    expect(rootLayout).toContain("import { TITLE_TEMPLATE } from './page-title'")
    expect(rootLayout).toContain('template: TITLE_TEMPLATE')
    // And the root must not re-mint one, which is the regression that would
    // reintroduce the drift.
    expect(rootLayout).not.toMatch(/template:\s*[`'"]%s/)
  })

  it('builds the brand template from configuration, not a literal', () => {
    // A self-host operator renames the product with
    // NEXT_PUBLIC_PLATFORM_BRAND_NAME and must not have to edit source
    // (AGL-2153). A literal here would put every browser tab in the console
    // back on our brand regardless of what they configured.
    const source = readFileSync(join(APP_DIR, 'page-title.ts'), 'utf8')
    expect(source).toContain('PLATFORM_BRAND_NAME')
    expect(source).not.toMatch(/TITLE_TEMPLATE\s*=\s*['"]%s · Aglyn['"]/)
  })
})
