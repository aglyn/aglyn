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
 * Every relative link between docs pages resolves — page AND anchor — and no
 * page in the Aglyn AI section is unreachable from the rest of the tree.
 *
 * ## The half the build already holds, and the half it does not
 *
 * `docusaurus.config.ts` sets `onBrokenLinks: 'throw'`, so a link to a page
 * that does not exist fails the build. It sets `onBrokenAnchors: 'warn'`, so a
 * link to an anchor that does not exist does NOT: it prints a warning into a
 * build log nobody reads and ships. The AI section is written almost entirely
 * in deep links — `overview.md#who-can-use-it`,
 * `custom-roles.md#ai-permissions`, `layouts.md#generate-a-layout-with-aglyn-ai`
 * — so the unchecked half is most of what those pages actually promise. A
 * heading renamed for search is enough to break a dozen of them at once, which
 * is exactly the kind of edit an SEO pass makes.
 *
 * `tools/marketing/verify-applier.mjs` already resolves the blog decks' links
 * against this same tree, for the same reason: the keyword plan those posts
 * were written from is dated 2026-09-13 and names `/alternatives/framer` and a
 * docs path `ai/generate-a-page`, neither of which exists. This is that
 * discipline turned on the docs pages' own cross-links, in the tier that costs
 * milliseconds rather than the production build.
 *
 * ## Why an orphan is a failure and not a style note
 *
 * `ab-tests-with-ai.md` shipped reachable from the sidebar and from nothing
 * else: not from `overview.md`'s capability table, which is the section's own
 * front page, and not from any Related list. A page no other page links to
 * collects no internal link equity, is not reachable by a reader following the
 * prose, and is the single easiest docs defect to ship — nothing is red, the
 * page renders, and only a reader counting links would notice. So it is
 * asserted, and scoped to `docs/ai/` because that is the section this guard
 * was written for; widening it to the whole tree is a bigger sweep than this
 * change measured.
 *
 * Site-absolute links (`/img/…`, `/api/…`, `/ai/how-aglyn-ai-builds`) are left
 * to the build. They address the static directory and a second Docusaurus
 * instance as well as this one, so resolving them here would mean modelling
 * the route table rather than the filesystem — and `onBrokenLinks: 'throw'`
 * already covers the page half of them.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, normalize, relative, resolve } from 'node:path'

const DOCS = join(__dirname, '..', 'docs')
const AI_SECTION = join(DOCS, 'ai')

function* markdownFiles(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) yield* markdownFiles(path)
    else if (path.endsWith('.md') || path.endsWith('.mdx')) yield path
  }
}

const exists = (path: string): boolean => {
  try {
    return statSync(path).isFile()
  } catch {
    return false
  }
}

/**
 * Docusaurus heading slug, via github-slugger: lowercase, drop everything that
 * is not a letter, a number, a space or a hyphen, then spaces to hyphens. Runs
 * are preserved, so "A & B" slugs to `a--b`.
 */
function slugify(heading: string): string {
  return heading
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/ /g, '-')
}

const body = (source: string): string => source.replace(/^---\n[\s\S]*?\n---/, '')

/** Every anchor a page offers: its headings' slugs, and any explicit `{#id}`. */
function anchorsOf(file: string): Set<string> {
  const text = body(readFileSync(file, 'utf8'))
  const found = new Set<string>()
  for (const match of text.matchAll(/^#{1,6}\s+(.+?)\s*$/gm)) {
    const explicit = match[1].match(/\{#([^}]+)\}\s*$/)
    found.add(
      explicit ? explicit[1] : slugify(match[1].replace(/\{#[^}]+\}\s*$/, '')),
    )
  }
  return found
}

const anchorCache = new Map<string, Set<string>>()
const anchors = (file: string): Set<string> => {
  let set = anchorCache.get(file)
  if (!set) {
    set = anchorsOf(file)
    anchorCache.set(file, set)
  }
  return set
}

/** The page a relative href addresses, or `null` where none exists. */
function targetOf(from: string, pathPart: string): string | null {
  if (!pathPart) return from
  const at = normalize(join(dirname(from), pathPart))
  const candidates = /\.mdx?$/.test(at)
    ? [at]
    : [`${at}.md`, `${at}.mdx`, join(at, 'overview.md'), join(at, 'index.md')]
  return candidates.find(exists) ?? null
}

interface Link {
  readonly from: string
  readonly href: string
  readonly pathPart: string
  readonly hash: string
}

/** Every relative markdown link on a page. Absolute and external are skipped. */
function linksOf(file: string): Link[] {
  const found: Link[] = []
  for (const match of body(readFileSync(file, 'utf8')).matchAll(
    /\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g,
  )) {
    const href = match[1]
    if (/^(?:[a-z]+:|\/|#)/i.test(href)) continue
    const [pathPart, hash = ''] = href.split('#')
    found.push({ from: file, href, pathPart, hash })
  }
  return found
}

const shortName = (file: string): string => relative(DOCS, file)

describe('internal docs links resolve', () => {
  const pages = [...markdownFiles(DOCS)]
  const links = pages.flatMap(linksOf)

  it('THE CONTROL: there are pages, and links between them, to check', () => {
    // A sweep over an empty list is green for the wrong reason.
    expect(pages.length).toBeGreaterThan(100)
    expect(links.length).toBeGreaterThan(500)
  })

  it('points every relative link at a page that exists', () => {
    const dead = links
      .filter((link) => targetOf(link.from, link.pathPart) == null)
      .map((link) => `${shortName(link.from)} → ${link.href}`)
    expect(dead).toEqual([])
  })

  it('points every #anchor at a heading that exists', () => {
    // The half `onBrokenAnchors: 'warn'` lets through.
    const dead: string[] = []
    for (const link of links) {
      if (!link.hash) continue
      const target = targetOf(link.from, link.pathPart)
      if (target == null) continue // reported by the assertion above
      if (!anchors(target).has(link.hash)) {
        dead.push(
          `${shortName(link.from)} → ${link.href}  (no #${link.hash} on ${shortName(target)})`,
        )
      }
    }
    expect(dead).toEqual([])
  })

  it('THE CONTROL: a fabricated page and a fabricated anchor are both caught', () => {
    // Otherwise the two sweeps above pass because the resolver accepts
    // anything. `ai/generate-a-page` is the docs path the 2026-09-13 keyword
    // plan invented; the real page is under building-sites/.
    const overview = join(AI_SECTION, 'overview.md')
    expect(targetOf(overview, './generate-a-page')).toBeNull()
    expect(targetOf(overview, './generate-a-site')).not.toBeNull()
    expect(anchors(overview).has('who-can-use-it')).toBe(true)
    expect(anchors(overview).has('who-can-use-it-🙂')).toBe(false)
  })

  it('leaves no page in the Aglyn AI section unlinked from another page', () => {
    // A page reachable only from the sidebar, which is how
    // `ab-tests-with-ai.md` shipped.
    const sectionPages = readdirSync(AI_SECTION).filter((f) => f.endsWith('.md'))
    // Inbound from a DIFFERENT page: a page's own Related list does not
    // rescue it, and a self-link must not be able to mask an orphan.
    const inbound = new Set(
      links
        .map((link) => ({ from: resolve(link.from), to: targetOf(link.from, link.pathPart) }))
        .filter((edge) => edge.to != null && resolve(edge.to) !== edge.from)
        .map((edge) => resolve(edge.to as string)),
    )
    const orphans = sectionPages.filter(
      (file) => !inbound.has(resolve(join(AI_SECTION, file))),
    )
    expect(orphans).toEqual([])
  })

  it('THE CONTROL: the section has pages, and the overview is what links them', () => {
    const sectionPages = readdirSync(AI_SECTION).filter((f) => f.endsWith('.md'))
    expect(sectionPages.length).toBeGreaterThan(5)
    const fromOverview = linksOf(join(AI_SECTION, 'overview.md')).filter(
      (link) => targetOf(link.from, link.pathPart)?.startsWith(AI_SECTION),
    )
    expect(fromOverview.length).toBeGreaterThan(5)
  })
})
