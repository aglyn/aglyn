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
 * ## Why the derived guidance is factual and never promotional
 *
 * A site whose author writes nothing still gets a when-to-use section, built
 * from what the site demonstrably HAS: the collections it publishes, the
 * endpoints it answers, the entry counts. Marketing copy in this position is
 * worse than an empty section — an agent scoring a dozen candidate sources
 * discounts a claim it cannot check, and the whole point of the section is to
 * be checkable.
 */

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
    The negotiation contract, stated once. An agent that knows a Markdown
    variant exists asks for it; one that does not, parses HTML it did not need.
    Both spellings are given because the two conventions have different
    audiences: `Accept` is acceptmarkdown.com, `.md` is llmstxt.org, and an
    agent that only knows one of them still gets clean text.
  */
  sections.push(
    'Every page on this site serves a Markdown representation of itself. ' +
      'Send `Accept: text/markdown`, or append `.md` to any path — ' +
      `for example \`${absoluteSiteUrl(origin, 'about.md')}\`. ` +
      'Responses vary on `Accept`, so a cache cannot hand you the wrong one.',
  )

  const howToUse = String(options.agent?.howToUse ?? '').trim()
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
            entry.title || nameForSlug(entry.path.replace(/^\/+/, '')) || 'Home',
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

  return `${sections.join('\n\n').trim()}\n`
}
