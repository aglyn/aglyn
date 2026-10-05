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
 * `/llms.txt` for a tenant site, in the llmstxt.org format (AGL-2716).
 *
 * The file an agent reads FIRST — before the sitemap, before the homepage — to
 * decide whether this site can answer the question it is holding, and which
 * URL to fetch if it can.
 *
 * ## The format, exactly
 *
 * llmstxt.org specifies, in this order: an H1 with the project name (the ONLY
 * required part), an optional blockquote summary, zero or more non-heading
 * markdown sections, then zero or more H2-delimited sections of "file lists" —
 * markdown lists whose items are a required `[name](url)` link optionally
 * followed by `:` and a note.
 *
 * Every H2 section this builder emits is a file list of that shape, INCLUDING
 * the when-to-use section. That is the design decision worth keeping: guidance
 * written as prose tells an agent what the site is about and leaves it to
 * guess a URL, while guidance written as a link list answers "which address
 * serves this job" in the same breath. It also keeps the file inside the
 * format rather than beside it.
 *
 * ## What goes in it, and what does not
 *
 * NOT every URL — that is the sitemap's job, and this file links to it. A site
 * with five hundred pages has an llms.txt of the same length as a site with
 * five: identity, what it is for, the handful of entry points that lead
 * everywhere else, and the machine-readable descriptions of its own surface.
 *
 * ## The page list is the site's structure, not its alphabet (AGL-3576)
 *
 * The `## Pages` section names the pages a reader would find in the site's
 * own navigation, in that order: home, then the top-level pages as the
 * screens list arranges them, then their children under them. The first
 * version sorted twenty-five top-level paths alphabetically, and on aglyn.com
 * that was seventeen unlisted campaign pages and none of `/pricing`,
 * `/product/*` or `/solutions/*` — the file advertised what the robots meta
 * hid and hid what the site wanted read. A page that publishes `noindex` is
 * never listed here, by the same predicate the sitemap applies
 * ({@link isScreenIndexable}): the two files advertising different sets is
 * how a site tells agents about the URLs it withheld from crawlers.
 *
 * ## Why the derived guidance is factual and never promotional
 *
 * A site whose author writes nothing still gets a when-to-use section, built
 * from what the site demonstrably HAS: the collections it publishes, the
 * endpoints it answers, the entry counts. Marketing copy in this position is
 * worse than an empty section — an agent scoring a dozen candidate sources
 * discounts a claim it cannot check, and the whole point of the section is to
 * be checkable.
 */

import { isScreenGroup, SCREEN_ROOT_PATH, screenRoutePathToUrl } from './screen-route'
import { isScreenIndexable } from './search-indexing'

/** A content collection published by the site. */
export interface LlmsTxtCollection {
  /** Public slug — the path segment the list answers at. */
  slug: string
  /** Display name, falling back to the slug. */
  name?: string
  /** The collection's own description, when the author wrote one. */
  description?: string
  /** Published entries, when the count is known and cheap to have. */
  entryCount?: number
}

/**
 * A group of pages served under one base, one page per record of a dataset
 * (AGL-3475): `Services`, twelve pages at `/services/…`.
 */
export interface LlmsTxtPageGroup {
  /** What the pages are. */
  name: string
  /** The path the pages share, without slashes at either end. */
  base: string
  /** How many pages the group holds. */
  count: number
  /**
   * Whether a page is published at the base itself — a listing the group can
   * be linked to. Without one the group links to the sitemap, which lists
   * every page in it, rather than to an address that serves nothing.
   */
  hasListing?: boolean
}

/** One curated page link. */
export interface LlmsTxtPage {
  /** Route path, with or without its leading slash. */
  path: string
  /** Link text; the path is used when a screen has no name. */
  title?: string
  /** Optional note after the colon. */
  note?: string
}

/** Author-written agent guidance, as `host.seo.agent` stores it. */
export interface LlmsTxtAgentGuidance {
  /** "When to use this site" — the jobs it is the right answer to. */
  whenToUse?: string
  /** How an agent should call it — endpoints, auth, rate limits, etiquette. */
  howToUse?: string
}

export interface LlmsTxtOptions {
  /** The site's name — the H1, and the only required field in the format. */
  siteName: string
  /** Absolute origin, no trailing slash. */
  origin: string
  /** The summary blockquote. */
  description?: string
  agent?: LlmsTxtAgentGuidance | null
  pages?: readonly LlmsTxtPage[]
  collections?: readonly LlmsTxtCollection[]
  /** Pages served one per record, grouped by base (AGL-3475). */
  pageGroups?: readonly LlmsTxtPageGroup[]
  /** Whether this site serves `/search`. */
  hasSearch?: boolean
  /** Where a human is reached, when the site publishes one. */
  contactEmail?: string
}

/** Path of the agent-guidance file, at the site root, per llmstxt.org. */
export const LLMS_TXT_PATH = '/llms.txt'

/** Path of the machine-readable API description. */
export const OPENAPI_PATH = '/openapi.json'

/** Join an origin and a path into an absolute URL with exactly one slash. */
export function absoluteSiteUrl(origin: string, path: string): string {
  const base = origin.replace(/\/+$/, '')
  if (!path || path === '/') return `${base}/`
  return `${base}/${String(path).replace(/^\/+/, '')}`
}

/**
 * Markdown link text, escaped.
 *
 * Only `[` and `]` — the two characters that can close a link label early and
 * turn the rest of the line into loose text. Escaping more would put
 * backslashes in a page title for no benefit; this is a label, not a document.
 */
const label = (value: string): string =>
  String(value).replace(/\s+/g, ' ').trim().replace(/([[\]])/g, '\\$1')

/** One file-list item: `- [name](url): note`. */
const item = (name: string, url: string, note?: string): string =>
  note ? `- [${label(name)}](${url}): ${note}` : `- [${label(name)}](${url})`

/** Title-case-ish display name for a slug with no name of its own. */
function nameForSlug(slug: string): string {
  const words = slug.replace(/[-_]+/g, ' ').trim()
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : slug
}

/** The link text a page falls back to: its last path segment, de-slugged. */
function titleFromPath(path: string): string {
  const segment = path.split('/').filter(Boolean).pop() ?? ''
  return segment ? nameForSlug(segment) : 'Home'
}

/** The fields of a screen document the page list reads (AGL-3576). */
export interface LlmsTxtScreenRecord {
  /** The console-authored page name; the link text when it has one. */
  displayName?: string
  /**
   * `HostScreenVisibility`. Anything but `PUBLIC` publishes `noindex` in its
   * own head, and a page the site hides from crawlers is not one it
   * advertises to agents — see {@link isScreenIndexable}.
   */
  visibility?: number | null
  /** Position among siblings, as the console's screens list orders them. */
  order?: number
  /** A page group is a folder in the console, never a page. */
  kind?: string
}

/**
 * How many pages the list names.
 *
 * Well past a marketing site — aglyn.com publishes sixty indexable pages —
 * and short of an inventory: a two-thousand-page catalog lists its first two
 * hundred in structure order, which is its navigation and the pages under
 * it, and the sitemap index above carries the rest. Twenty-five, the cap
 * this replaced, held less than one site's top level.
 */
export const LLMS_TXT_PAGE_LIMIT = 200

/**
 * The pages the `## Pages` section names, in site order (AGL-3576).
 *
 * Membership is the routing map's: a screen the map does not name is not
 * reachable at a path of its own, whatever its document says. The screen
 * documents then decide which routed pages are PAGES an agent may read — not
 * a group, not `noindex` — and how they are arranged.
 *
 * The order is the site's structure, level by level: home, then the
 * top-level pages by their `order` (one with none sorts after every one the
 * author arranged, then by name), then the children, grouped under the
 * parent they sit under in the parent's own position, each group by `order`.
 * Level by level rather than depth-first so the cap, when it bites, keeps
 * the whole navigation and loses the deepest pages — a child whose parent is
 * not listed sorts after every child whose parent is.
 *
 * `screens` absent means the documents could not be read, and every routed
 * screen is kept rather than none, in the same structural order — the file
 * stays whole and each page's own `noindex` still holds, which is the
 * fail-open the sitemap chose for the same read.
 */
export function curateLlmsTxtPages(options: {
  /** `host.screens` — screen id → routing-map path. */
  routing?: Record<string, string | undefined> | null
  /** Screen documents by id; a routed screen with no document is dropped. */
  screens?: Record<string, LlmsTxtScreenRecord | undefined> | null
  /** Screens that are not pages: templates, list routes, status screens. */
  excluded?: ReadonlySet<string> | null
  limit?: number
}): LlmsTxtPage[] {
  const limit = options.limit ?? LLMS_TXT_PAGE_LIMIT
  if (limit <= 0) return []

  interface Candidate extends LlmsTxtPage {
    title: string
    order: number
    parentPath: string
    depth: number
  }
  const byPath = new Map<string, Candidate>()
  for (const [screenId, routePath] of Object.entries(options.routing ?? {})) {
    if (typeof routePath !== 'string' || !routePath) continue
    if (options.excluded?.has(screenId)) continue
    const record = options.screens?.[screenId]
    if (options.screens) {
      if (!record || isScreenGroup(record) || !isScreenIndexable(record)) continue
    }
    const path = screenRoutePathToUrl(routePath)
    if (byPath.has(path)) continue
    const segments = path.split('/').filter(Boolean)
    byPath.set(path, {
      path,
      title:
        String(record?.displayName ?? '').replace(/\s+/g, ' ').trim() ||
        titleFromPath(path),
      order:
        typeof record?.order === 'number' && Number.isFinite(record.order)
          ? record.order
          : Number.MAX_SAFE_INTEGER,
      parentPath:
        segments.length > 1
          ? `/${segments.slice(0, -1).join('/')}`
          : SCREEN_ROOT_PATH,
      depth: segments.length,
    })
  }

  const ordered: Candidate[] = []
  const position = new Map<string, number>()
  const place = (candidate: Candidate): void => {
    position.set(candidate.path, ordered.length)
    ordered.push(candidate)
  }
  const home = byPath.get(SCREEN_ROOT_PATH)
  if (home) place(home)

  const levels = new Map<number, Candidate[]>()
  for (const candidate of byPath.values()) {
    if (candidate.depth === 0) continue
    const level = levels.get(candidate.depth) ?? []
    level.push(candidate)
    levels.set(candidate.depth, level)
  }
  const parentPosition = (candidate: Candidate): number =>
    position.get(candidate.parentPath) ?? Number.MAX_SAFE_INTEGER
  for (const depth of [...levels.keys()].sort((a, b) => a - b)) {
    const level = levels.get(depth) ?? []
    level.sort(
      (a, b) =>
        parentPosition(a) - parentPosition(b) ||
        a.parentPath.localeCompare(b.parentPath) ||
        a.order - b.order ||
        a.title.localeCompare(b.title) ||
        a.path.localeCompare(b.path),
    )
    for (const candidate of level) place(candidate)
  }

  return ordered.slice(0, limit).map(({ path, title }) => ({ path, title }))
}

/**
 * Whether a text already states the Markdown negotiation contract. The
 * `Accept` spelling is the one every statement of it names, in the author's
 * words or the builder's.
 */
const NEGOTIATION_STATED = /text\/markdown/i

/**
 * The when-to-use items derived from what the site actually publishes.
 *
 * Each is a job an agent might hold, paired with the URL that answers it. The
 * counts and names come from the site's own data, so nothing here is a claim
 * the reader cannot verify by following the link.
 */
function derivedGuidance(options: LlmsTxtOptions): string[] {
  const { origin, siteName } = options
  const lines: string[] = []
  for (const collection of options.collections ?? []) {
    const name = collection.name || nameForSlug(collection.slug)
    const count =
      typeof collection.entryCount === 'number' && collection.entryCount > 0
        ? `${collection.entryCount} published ${
            collection.entryCount === 1 ? 'entry' : 'entries'
          }`
        : 'the published entries'
    lines.push(
      item(
        name,
        absoluteSiteUrl(origin, collection.slug),
        collection.description
          ? `${label(collection.description)} — ${count}, newest first`
          : `${count}, newest first. Read this when you need ${label(
              name.toLowerCase(),
            )} published by ${label(siteName)}`,
      ),
    )
  }
  for (const group of options.pageGroups ?? []) {
    if (!(group.count > 0)) continue
    const where = `/${group.base}/`
    const count = `${group.count} ${group.count === 1 ? 'page' : 'pages'}`
    lines.push(
      item(
        group.name || nameForSlug(group.base),
        group.hasListing
          ? absoluteSiteUrl(origin, group.base)
          : absoluteSiteUrl(origin, 'sitemap.xml'),
        group.hasListing
          ? `${count} under \`${where}\`, one per entry, each linked from this page`
          : `${count} under \`${where}\`, one per entry; the sitemap lists every one`,
      ),
    )
  }
  if (options.hasSearch) {
    lines.push(
      item(
        'Search this site',
        `${absoluteSiteUrl(origin, 'search')}?q=`,
        'full-text search across this site’s pages and published entries; ' +
          'append your query to `?q=`',
      ),
    )
  }
  lines.push(
    item(
      'Sitemap index',
      absoluteSiteUrl(origin, 'sitemap.xml'),
      'every indexable URL on this site, split into dated child sitemaps',
    ),
  )
  lines.push(
    item(
      'OpenAPI description',
      absoluteSiteUrl(origin, OPENAPI_PATH),
      'every public endpoint this site serves, with typed parameters, ' +
        'response schemas and a unique operationId per operation',
    ),
  )
  if (options.contactEmail) {
    lines.push(
      item(
        'Contact a person',
        `mailto:${options.contactEmail}`,
        'reach the people who publish this site when the answer is not on it',
      ),
    )
  }
  return lines
}

/** Build the `/llms.txt` body. */
export function buildLlmsTxt(options: LlmsTxtOptions): string {
  const { origin } = options
  const sections: string[] = []

  sections.push(`# ${label(options.siteName || 'Site')}`)

  const description = String(options.description ?? '').replace(/\s+/g, ' ').trim()
  if (description) sections.push(`> ${description}`)

  /*
    The author's own guidance leads, in their words, because they know things
    this file cannot derive — which questions the site is genuinely the best
    source for, and which it is not.
  */
  const whenToUse = String(options.agent?.whenToUse ?? '').trim()
  if (whenToUse) sections.push(whenToUse)

  /*
    The negotiation contract, stated ONCE. An agent that knows a Markdown
    variant exists asks for it; one that does not, parses HTML it did not need.
    Both spellings are given because the two conventions have different
    audiences: `Accept` is acceptmarkdown.com, `.md` is llmstxt.org, and an
    agent that only knows one of them still gets clean text.

    An author who states it in their own guidance — aglyn.com's "How an agent
    should call you" does — has said it, and this paragraph on top of theirs
    was the duplicated paragraph AGL-3576 found. Theirs stands alone.
  */
  const howToUse = String(options.agent?.howToUse ?? '').trim()
  if (!NEGOTIATION_STATED.test(`${whenToUse}\n${howToUse}`)) {
    sections.push(
      'Every page on this site serves a Markdown representation of itself. ' +
        'Send `Accept: text/markdown`, or append `.md` to any path — ' +
        `for example \`${absoluteSiteUrl(origin, 'about.md')}\`. ` +
        'Responses vary on `Accept`, so a cache cannot hand you the wrong one.',
    )
  }

  if (howToUse) sections.push(howToUse)

  const guidance = derivedGuidance(options)
  if (guidance.length) {
    sections.push(['## When to use this site', ...guidance].join('\n'))
  }

  const pages = options.pages ?? []
  if (pages.length) {
    sections.push(
      [
        '## Pages',
        ...pages.map((entry) =>
          item(
            entry.title || titleFromPath(entry.path),
            absoluteSiteUrl(origin, entry.path),
            entry.note,
          ),
        ),
      ].join('\n'),
    )
  }

  const collections = options.collections ?? []
  if (collections.length) {
    sections.push(
      [
        '## Feeds',
        ...collections.map((collection) =>
          item(
            `${collection.name || nameForSlug(collection.slug)} (RSS)`,
            absoluteSiteUrl(origin, `${collection.slug}/rss.xml`),
            'newest entries as RSS 2.0',
          ),
        ),
      ].join('\n'),
    )
  }

  /*
    Each paragraph once. The author's two boxes are free text, and the same
    paragraph pasted into both — or into one of them and derived here — reads
    as a file that does not know what it has already said.
  */
  const seen = new Set<string>()
  const paragraphs = sections
    .join('\n\n')
    .split('\n\n')
    .filter((paragraph) => {
      const key = paragraph.replace(/\s+/g, ' ').trim()
      if (!key || seen.has(key)) return false
      seen.add(key)
      return true
    })
  return `${paragraphs.join('\n\n').trim()}\n`
}
