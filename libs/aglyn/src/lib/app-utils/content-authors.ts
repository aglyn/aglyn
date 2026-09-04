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

import { HostEntityType } from '../foundation/definitions/platform.types'
import { absoluteMediaSrc } from './media-ref'
import { urlSlugSegment } from './url-slug'

/**
 * Custom content authors (AGL-2486).
 *
 * ## An author is a RECORD, not an account
 *
 * Until now a post's byline was `entry.authorName` — one free-typed string
 * (AGL-686), retyped on every entry, with no url, no portrait, no social
 * profiles and no way to say the piece was written by the company rather than
 * a person. That is enough to print a name under a headline and not enough to
 * be `schema.org/author`, which wants an ENTITY: something with a stable
 * identity a crawler can join across articles and against the site's own
 * publisher entity.
 *
 * So the author becomes a document the customer authors and an entry
 * REFERENCES (`entry.authorId`). Publishing a piece under a pen name, a guest
 * contributor, or the company itself is then the ordinary case rather than a
 * retyped string, and renaming an author updates every post at render time —
 * the same property `categoryId` bought the taxonomy in AGL-582.
 *
 * ## Scope: the HOST, at `hosts/{hostId}/authors/{authorId}`
 *
 * Not the org, and this follows the data rather than inventing a rule.
 * Content collections live at `hosts/{hostId}/collections/{collectionId}` and
 * their entries underneath; the console surface that manages them is
 * `/[orgSlug]/hosts/[host]/content`; and the entity an author has to
 * serialise consistently with — `host.seo.entity`, the site's publisher — is
 * a field of the host document. An author referenced from an entry therefore
 * resolves inside the same document tree the entry already lives in, with the
 * host's existing rules and the tenant's existing Admin-SDK reads. An
 * org-scoped store would need a second root, a second read on every entry
 * render, and a sharing model ("which sites may publish under this byline")
 * that nothing in the product asks for yet.
 *
 * ## The type is a BRANCH, not a label
 *
 * `schema.org/Person` and `schema.org/Organization` do not carry the same
 * fields: a Person has `jobTitle` and `worksFor` and its portrait is `image`;
 * an Organization has no job title and its mark is `logo`. Emitting one
 * shape with the other's keys is invalid structured data that validates as
 * "ignored", so {@link contentAuthorJsonLd} branches on the type and the
 * console hides the fields that do not apply.
 */

/**
 * How many authors one host may hold (AGL-2486).
 *
 * A flat PLATFORM cap, deliberately, in the shape of
 * `ENTRIES_MAX_PER_COLLECTION` / `ACTIONS_MAX_PER_HOST` (AGL-2266) and
 * `WEBHOOK_MAX_PER_HOST` (AGL-1360): nothing here is priced, no
 * `OrgEntitlements` key is added, every plan gets the same number. The reason
 * a number exists at all is the one those issues wrote down — a
 * client-creatable host subcollection with no cap is unbounded Firestore
 * documents mintable from the browser against a $0 subscription — and adding
 * a new subcollection without one would be that hole, freshly dug.
 *
 * 200 is far past any real masthead (the largest content collection in
 * production holds double digits of ENTRIES, let alone bylines) and small
 * enough that the console can list every author in a single unpaginated read.
 */
export const AUTHORS_MAX_PER_HOST = 200

/** Longest stored author name; the byline is a name, not a paragraph. */
export const AUTHOR_NAME_MAX_LENGTH = 120

/** Longest stored author slug; it is one path segment, not a sentence. */
export const AUTHOR_SLUG_MAX_LENGTH = 80

/**
 * The site-wide segment an author's page lives under (AGL-2518):
 * `/author/{slug}`, and `/author/{slug}/page/{n}` after it.
 *
 * Singular, and site-wide rather than nested under a collection. AGL-2517
 * put this archive at `/{collection}/author/{slug}`, which gives one person
 * as many pages as the site has collections — three partial archives of the
 * same author, none of them the address a byline should link to, all three
 * competing for the same search result. A person is not a property of a
 * collection.
 *
 * NOT added to `RESERVED_SCREEN_ROUTE_SEGMENTS`. The catch-all resolves
 * published screens BEFORE it reaches this route, exactly as it does for a
 * collection's own `/{slug}`, so a site that already publishes a page at
 * `/author` keeps it and simply has no author pages — the same trade every
 * other platform-built address on a tenant site makes.
 */
export const AUTHOR_ROUTE_SEGMENT = 'author'

/** Most `sameAs` profile links one author may carry. */
export const AUTHOR_SAME_AS_MAX = 12

/** Most display links one author may carry. */
export const AUTHOR_LINKS_MAX = 12

/**
 * A link the author profile PRINTS, as opposed to one it only declares
 * (AGL-2516).
 *
 * `sameAs` already held profile URLs, and it is exactly the wrong shape to
 * render: a bare list of strings with no label and no icon, which a card can
 * only draw as a row of identical anonymous links. It exists for crawlers,
 * where a URL alone is the whole point.
 *
 * A link somebody CLICKS needs to say what it is before they click it, and
 * the two ways of saying that pull in opposite directions:
 *
 *  * a KNOWN platform is recognised by its mark, and the mark is not the
 *    author's to choose — an X link drawn with a GitHub glyph is a broken
 *    link that still resolves, and letting anyone pick that is a footgun with
 *    no upside. So {@link platform} fixes the icon AND the accessible name;
 *  * anything else — a personal newsletter, a conference talk, an ORCID
 *    record — has no mark anyone would recognise, so it takes a label and an
 *    icon the author chooses.
 *
 * One field decides which of the two a row is, and the console shows the
 * fields that apply to it. See {@link AUTHOR_SOCIAL_PLATFORMS}.
 */
export interface ContentAuthorLink {
  /**
   * A known platform id from {@link AUTHOR_SOCIAL_PLATFORMS}, whose icon and
   * accessible name are FIXED. Empty (or unrecognised) makes this a custom
   * link, which is where {@link label} and {@link icon} apply instead.
   */
  platform?: string
  /** Custom links only — what this link is called. */
  label?: string
  /** Custom links only — the picked `mdi` icon id. */
  icon?: string
  /**
   * Custom links only — the picked icon's PATH, resolved where the catalog
   * is already loaded.
   *
   * The same split AGL-1212 made for besigner icons, for the same reason: the
   * mdi catalog is ~2.9 MB and only picker surfaces load it, so a renderer
   * given an id alone can only draw a fallback glyph. The id stays the source
   * of truth; the path travels with the document so the tenant never pays for
   * the catalog to draw one icon.
   */
  iconPath?: string
  /** Where it goes. `https:` or `mailto:` only — see the normalizer. */
  url?: string
}

/**
 * The platforms whose mark is fixed (AGL-2516).
 *
 * `icon` is an `mdi` id, resolved to a path by whichever surface draws it —
 * the renderer imports these few directly rather than through the catalog,
 * because the set is closed and known at build time.
 *
 * Ordered as a masthead would list them rather than alphabetically: the
 * places writers are actually followed first, then the ways to reach them.
 */
export const AUTHOR_SOCIAL_PLATFORMS: ReadonlyArray<{
  id: string
  label: string
  icon: string
}> = [
  { id: 'x', label: 'X', icon: 'twitter' },
  { id: 'linkedin', label: 'LinkedIn', icon: 'linkedin' },
  { id: 'github', label: 'GitHub', icon: 'github' },
  { id: 'mastodon', label: 'Mastodon', icon: 'mastodon' },
  { id: 'youtube', label: 'YouTube', icon: 'youtube' },
  { id: 'instagram', label: 'Instagram', icon: 'instagram' },
  { id: 'facebook', label: 'Facebook', icon: 'facebook' },
  { id: 'website', label: 'Website', icon: 'web' },
  { id: 'email', label: 'Email', icon: 'email' },
  { id: 'rss', label: 'RSS', icon: 'rss' },
]

/** The platform a link declares, or `undefined` when it is a custom one. */
export function authorLinkPlatform(
  platform: string | undefined | null,
): (typeof AUTHOR_SOCIAL_PLATFORMS)[number] | undefined {
  const id = typeof platform === 'string' ? platform.trim() : ''
  if (!id) return undefined
  return AUTHOR_SOCIAL_PLATFORMS.find((entry) => entry.id === id)
}

/**
 * What a link is CALLED, which is never the author's choice on a known
 * platform.
 *
 * A custom link with no label falls back to its own URL rather than to
 * something generic: "Link" beside four other "Link"s is not an accessible
 * name, and the URL at least distinguishes them.
 */
export function authorLinkLabel(link: ContentAuthorLink): string {
  const known = authorLinkPlatform(link.platform)
  if (known) return known.label
  return text(link.label, 60) || text(link.url, 400)
}

/**
 * Schemes an author link may use.
 *
 * `https:` and `mailto:` only, matching the share bar and the Entry Author
 * card's own href guard. `http:` is excluded deliberately — a byline link is
 * published on every post its author wrote, and a mixed-content warning
 * across a whole archive is a poor trade for a scheme nobody should still be
 * publishing. Everything else, `javascript:` first among them, is a script
 * injection wearing a URL.
 */
const SAFE_AUTHOR_LINK_HREF = /^(https:\/\/|mailto:)/i

/**
 * Sanitize the stored link rows into the shape a renderer may assume.
 *
 * Drops any row without a usable, safely-schemed URL — a link that goes
 * nowhere is worse than an absent one, because it still takes a click. A row
 * naming a platform keeps ONLY the platform (its label and icon come from the
 * registry, so a stored label or icon beside one is stale data that must not
 * win); a custom row keeps its label and icon and drops any platform id that
 * did not resolve.
 */
export function normalizeContentAuthorLinks(
  value: unknown,
): ContentAuthorLink[] {
  if (!Array.isArray(value)) return []
  const links: ContentAuthorLink[] = []
  for (const row of value as unknown[]) {
    if (!row || typeof row !== 'object') continue
    const raw = row as Record<string, unknown>
    const url = text(raw['url'], 400)
    if (!url || !SAFE_AUTHOR_LINK_HREF.test(url)) continue
    const known = authorLinkPlatform(raw['platform'] as never)
    if (known) {
      links.push({ platform: known.id, url })
    } else {
      links.push({
        label: text(raw['label'], 60),
        icon: text(raw['icon'], 120),
        iconPath: text(raw['iconPath'], 4000),
        url,
      })
    }
    if (links.length >= AUTHOR_LINKS_MAX) break
  }
  return links
}

/**
 * One custom author, as stored at `hosts/{hostId}/authors/{authorId}`.
 *
 * Every field is optional at the type level because `strictNullChecks` is off
 * repo-wide and because a document written by an older console must keep
 * reading — {@link normalizeContentAuthor} is what turns a stored shape into
 * something safe to serialise, and it is the only thing that should.
 */
export interface ContentAuthorRecord {
  $id?: string
  /**
   * `Person` or `Organization` — the SAME enum the site's SEO entity uses
   * (`host.seo.entity.type`), so the two serialise through one branch rather
   * than two spellings of the same question.
   *
   * Stored as the numeric enum by this feature's editor. Read through
   * {@link contentAuthorSchemaType}, which also accepts the STRING form,
   * because the Setup → SEO → Entity form has always written `"1"` / `"2"`
   * (its Select options are template literals) — see that helper.
   */
  type?: HostEntityType | string | number
  /** The byline. The only field an author cannot be published without. */
  name?: string
  /**
   * The segment that addresses this author's page — `/author/{slug}`
   * (AGL-2518).
   *
   * Optional, and {@link contentAuthorSlug} falls back to the slugified name,
   * so an author who never opens the field still has a working, readable
   * address. It exists for the two cases a derived slug cannot serve:
   *
   *  * a RENAME. The name is the byline and it changes — a married name, a
   *    pen name, a company rebrand — and a derived slug moves the page with
   *    it, breaking every link anyone ever shared. A stored slug is the
   *    author saying "this address is mine regardless of what you call me";
   *  * a COLLISION. Two people named Chris Taylor derive one segment, and the
   *    archive would then hold both their work under one page with no way to
   *    separate it.
   *
   * Matching still accepts the record id and the slugified display name (see
   * `entryMatchesAuthorRoute`), so setting this never breaks an address that
   * already worked — it only adds one.
   */
  slug?: string
  /** Author page / personal site — `schema.org` `url`. */
  url?: string
  /**
   * Portrait or logo. A `media:` reference (what the console's media picker
   * writes) or a plain URL — an external avatar is a legitimate answer, so
   * the field accepts both and {@link contentAuthorJsonLd} resolves whichever
   * arrives through the same helper `og:image` uses.
   *
   * Emitted as `image` for a Person and `logo` for an Organization.
   */
  image?: string
  /** Person only — `schema.org/Person.jobTitle`. */
  jobTitle?: string
  /** Person only — the organization they write for (`worksFor.name`). */
  worksFor?: string
  /**
   * Profile URLs (social, ORCID, Crunchbase…) — `schema.org` `sameAs`.
   *
   * Declared, never drawn. {@link links} is the rendered list; every link
   * there is folded into the emitted `sameAs` too, so an author who fills in
   * the visible row does not also have to retype the URL for the crawler.
   */
  sameAs?: string[]
  /** The links the author profile PRINTS (AGL-2516). */
  links?: ContentAuthorLink[]
  /**
   * Byline blurb for the page. NOT structured data: `description` on a Person
   * is a claim about the person, and a marketing sentence is not that.
   */
  bio?: string
}

/**
 * The author's schema type, tolerant of every spelling the store holds.
 *
 * The numeric enum is what `HostEntityType` declares, but the Setup → SEO →
 * Entity form persists its Select value — a TEMPLATE LITERAL, i.e. the string
 * `"1"` or `"2"` — and the tenant's structured data compared that with
 * `=== HostEntityType.PERSON` (the number `2`). Strict equality across a
 * string and a number is always false, so a site that declared itself a
 * Person published `"@type": "Organization"` regardless (AGL-2486). Coercing
 * here, once, is what stops the same defect being re-derived per call site.
 *
 * Anything unrecognised — absent, empty, a stray value — resolves to
 * `Organization`, which is the default this repo has always emitted.
 */
export function contentAuthorSchemaType(
  type: HostEntityType | string | number | undefined | null,
): 'Person' | 'Organization' {
  return Number(type) === HostEntityType.PERSON ? 'Person' : 'Organization'
}

const text = (value: unknown, max = AUTHOR_NAME_MAX_LENGTH): string =>
  typeof value === 'string' ? value.trim().slice(0, max) : ''

/**
 * A stored author document, sanitized into the shape the rest of the codebase
 * may assume — the {@link mapCollectionCategories} treatment, one collection
 * over: only strings survive, `sameAs` keeps string entries only, and an
 * author with no name resolves to `null` because a nameless byline is not a
 * byline and `schema.org` requires `name` on both branches.
 */
export function normalizeContentAuthor(
  value: unknown,
  id?: string,
): ContentAuthorRecord | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  const name = text(raw['name'])
  if (!name) return null
  const sameAs = Array.isArray(raw['sameAs'])
    ? (raw['sameAs'] as unknown[])
        .map((item) => text(item, 400))
        .filter(Boolean)
        .slice(0, AUTHOR_SAME_AS_MAX)
    : []
  return {
    ...(id ? { $id: id } : typeof raw['$id'] === 'string' ? { $id: raw['$id'] } : {}),
    type: contentAuthorSchemaType(raw['type'] as never) === 'Person'
      ? HostEntityType.PERSON
      : HostEntityType.ORGANIZATION,
    name,
    // Through the URL slugifier rather than stored raw: this is a path
    // segment, and a stored `Chris Taylor` would build `/author/Chris Taylor`
    // while every incoming request arrived slugified and matched nothing.
    slug: urlSlugSegment(text(raw['slug'], AUTHOR_SLUG_MAX_LENGTH)),
    url: text(raw['url'], 400),
    image: text(raw['image'], 1000),
    jobTitle: text(raw['jobTitle']),
    worksFor: text(raw['worksFor']),
    sameAs,
    links: normalizeContentAuthorLinks(raw['links']),
    bio: text(raw['bio'], 600),
  }
}

/* ── The author's page (AGL-2518) ───────────────────────────────────────── */

/** How a caller names the author whose page it wants addressed. */
export interface ContentAuthorAddress {
  /** The resolved record, when there is one. */
  author?: ContentAuthorRecord | null
  /** `entry.authorId` — a reference that may not have resolved. */
  authorId?: string
  /** The legacy free-typed byline (AGL-686). */
  authorName?: string
}

/**
 * The segment that addresses one author's page.
 *
 * Precedence is the author's stored {@link ContentAuthorRecord.slug} first
 * and the slugified name second — the opposite of what AGL-2517 built, which
 * put the record ID first "so the link survives a rename".
 *
 * A Firestore auto-id does survive a rename, and it is also unreadable. This
 * is a PUBLIC address on a marketing site: it goes in a byline, a share
 * sheet, a CV. `/author/hT3kQ9xLmZ2` is not an address anyone can read, and
 * the rename it protects against is answered better by the stored slug, which
 * is stable AND readable. The id is still ACCEPTED on the way in (see
 * `entryMatchesAuthorRoute`), so a link built under the old precedence keeps
 * resolving.
 *
 * Empty when there is nothing addressable, so a caller renders plain text
 * rather than a link to `/author/`.
 */
export function contentAuthorSlug(options: ContentAuthorAddress): string {
  return (
    urlSlugSegment(options.author?.slug) ||
    urlSlugSegment(options.author?.name) ||
    urlSlugSegment(options.authorName) ||
    urlSlugSegment(options.authorId) ||
    urlSlugSegment(options.author?.$id)
  )
}

/**
 * Every segment that should resolve to this author.
 *
 * The archive answers to the stored slug, the display name, the legacy
 * free-typed byline and the record id, because which of those a link happens
 * to carry depends on when it was built and by what — and a byline that
 * 404s is worse than one pointing at a page with an unexpected URL.
 *
 * Deduped, and empties dropped: a set containing `''` would match a request
 * for `/author/` against every author on the site.
 */
export function contentAuthorSlugCandidates(
  options: ContentAuthorAddress,
): string[] {
  return Array.from(
    new Set(
      [
        options.author?.slug,
        options.author?.name,
        options.authorName,
        options.authorId,
        options.author?.$id,
      ]
        .map((value) => urlSlugSegment(value))
        .filter(Boolean),
    ),
  )
}

/** Does `slug` address this author? */
export function contentAuthorMatchesSlug(
  options: ContentAuthorAddress,
  slug: string | undefined | null,
): boolean {
  const wanted = urlSlugSegment(slug)
  if (!wanted) return false
  return contentAuthorSlugCandidates(options).includes(wanted)
}

/**
 * The author's page on this site — `/author/{slug}` (AGL-2518).
 *
 * Empty when nothing addresses the author, which is what lets a template bind
 * this unconditionally: a link whose href does not resolve renders as inert
 * markup of the same element (AGL-1268/1357), so an entry with no byline
 * shows no link rather than one pointing nowhere.
 */
export function contentAuthorPageUrl(options: ContentAuthorAddress): string {
  const slug = contentAuthorSlug(options)
  return slug ? `/${AUTHOR_ROUTE_SEGMENT}/${slug}` : ''
}

/**
 * The paginated sub-path of an author page — `/author/{slug}/page/{n}`.
 *
 * The same word the collection listing pages with, deliberately: a reader who
 * has learned one URL shape on the site has learned both, and a second
 * spelling would buy nothing. Declared here rather than imported from
 * `collection-entries`, which imports THIS module.
 */
const AUTHOR_PAGE_SEGMENT = 'page'

/**
 * The canonical URL of one page of an author's archive (AGL-2518).
 *
 * Page 1 is the bare `/author/{slug}` — there is no `/author/{slug}/page/1`,
 * so the first page cannot become a second address for itself. The rule
 * `collectionListUrl` states, one route over.
 */
export function contentAuthorPageAtUrl(
  options: ContentAuthorAddress & { page?: number | null },
): string {
  const base = contentAuthorPageUrl(options)
  if (!base) return ''
  const page = Number(options.page)
  return Number.isFinite(page) && page > 1
    ? `${base}/${AUTHOR_PAGE_SEGMENT}/${Math.floor(page)}`
    : base
}

/**
 * Where an author archive's pager can go from here (AGL-2518).
 *
 * The `collectionPaginationLinks` contract, restated for this route: **the
 * edges resolve to the empty string, never to a URL**, which is what lets a
 * designed author template bind `{{pagination.prevUrl}}` unconditionally. A
 * link whose href is `''` renders as an inert placeholder of the same element
 * (AGL-1268/1357), which is the correct pager on page 1 of 1.
 *
 * ONE computation, because it has the same two consumers that must agree: the
 * built-in fallback's pager nodes and the tokens a template binds.
 */
export function contentAuthorPaginationLinks(
  options: ContentAuthorAddress & {
    page?: number | null
    totalPages?: number | null
  },
): { page: number; totalPages: number; prevUrl: string; nextUrl: string } {
  const positive = (value: number | null | undefined): number => {
    const parsed = Math.floor(Number(value))
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 1
  }
  const page = positive(options.page)
  const totalPages = positive(options.totalPages)
  const href = (n: number) => contentAuthorPageAtUrl({ ...options, page: n })
  return {
    page,
    totalPages,
    prevUrl: page > 1 ? href(page - 1) : '',
    nextUrl: page < totalPages ? href(page + 1) : '',
  }
}

/** A parsed `/author/{slug}` route (AGL-2518). */
export interface ContentAuthorRoute {
  /** The addressed segment, normalized. */
  authorSlug: string
  /** 1-based list page; 1 on the bare archive. */
  page: number
}

/**
 * Parse a path into an author route, or `null` when the path is not one.
 *
 * The two shapes are `/author/{slug}` and `/author/{slug}/page/{n}`, matching
 * the collection listing's own pagination so a reader who has learned one URL
 * shape on the site has learned both.
 *
 * A pure parser, deliberately, for the reason `parseCollectionRoute` is one:
 * the tenant loader and its tests must not be able to disagree about what the
 * route table says. Page `0`, a negative page and a non-numeric page all
 * resolve to `null` rather than to page 1, so a nonsense URL 404s instead of
 * silently serving the first page under a second address.
 */
export function parseContentAuthorRoute(
  segments: readonly string[],
): ContentAuthorRoute | null {
  const parts = (segments ?? []).filter(Boolean)
  if (parts[0] !== AUTHOR_ROUTE_SEGMENT) return null
  const authorSlug = urlSlugSegment(parts[1])
  if (!authorSlug) return null
  if (parts.length === 2) return { authorSlug, page: 1 }
  if (parts.length === 4 && parts[2] === AUTHOR_PAGE_SEGMENT) {
    const page = Number(parts[3])
    return Number.isInteger(page) && page >= 1 ? { authorSlug, page } : null
  }
  return null
}

/** How an author's `image` is turned into something a crawler can fetch. */
export interface ContentAuthorImageContext {
  /** The site's public origin, for absolutizing a site-relative CDN path. */
  origin?: string | null
  /** Host id, so a restricted org asset resolves for the site rendering it. */
  hostId?: string
}

/**
 * `schema.org` JSON-LD for one author (AGL-2486) — a `Person` or an
 * `Organization`, with the fields that branch actually defines.
 *
 * | field      | Person                    | Organization |
 * | ---------- | ------------------------- | ------------ |
 * | `name`     | required                  | required     |
 * | `url`      | optional                  | optional     |
 * | portrait   | `image`                   | `logo`       |
 * | `jobTitle` | optional                  | — not valid  |
 * | `worksFor` | optional (`Organization`) | — not valid  |
 * | `sameAs`   | optional                  | optional     |
 *
 * The image goes through {@link absoluteMediaSrc}, the same resolver
 * `og:image` and `Article.image` use (AGL-1343/1407), so a portrait picked
 * from the DAM reaches the structured data as a fetchable absolute URL rather
 * than the literal string `media:{scope}/{id}`. An unresolvable reference —
 * or a site-relative path with no origin to resolve against — emits NO image
 * key at all rather than a broken one.
 *
 * Returns `undefined` for an author with no usable name, so every call site
 * can spread the result conditionally instead of emitting `"author": null`.
 *
 * ## Escaping
 *
 * Nothing is escaped HERE, and that is correct: this returns a VALUE, and the
 * one place a value becomes markup is `Aglyn.safeJsonLd`, which every
 * `<script type="application/ld+json">` in the repo is built with. It escapes
 * `<`, `>`, `&` and U+2028/U+2029 to their `\uXXXX` forms after
 * `JSON.stringify`, so an author named `</script><img onerror=…>` serialises
 * as inert text rather than closing the element (AGL-496). Escaping a second
 * time here would double-encode and put literal backslashes in a byline.
 */
export function contentAuthorJsonLd(
  author: ContentAuthorRecord | null | undefined,
  context?: ContentAuthorImageContext,
): Record<string, unknown> | undefined {
  const normalized = normalizeContentAuthor(author, author?.$id)
  if (!normalized) return undefined
  const schemaType = contentAuthorSchemaType(normalized.type)
  const image = absoluteMediaSrc(normalized.image, {
    hostId: context?.hostId,
    origin: context?.origin,
  })
  const sameAs = Array.from(
    new Set([
      ...(normalized.sameAs ?? []),
      ...(normalized.links ?? [])
        .map((link) => link.url ?? '')
        .filter((url) => /^https:\/\//i.test(url)),
    ]),
  ).slice(0, AUTHOR_SAME_AS_MAX)
  return {
    '@type': schemaType,
    name: normalized.name,
    ...(normalized.url ? { url: normalized.url } : {}),
    // `image` on a Person, `logo` on an Organization — the one field whose
    // KEY the branch changes, which is why a shared "entity" serializer that
    // took a type parameter and emitted `logo` for both would be wrong.
    ...(image
      ? schemaType === 'Person'
        ? { image }
        : { logo: image }
      : {}),
    ...(schemaType === 'Person' && normalized.jobTitle
      ? { jobTitle: normalized.jobTitle }
      : {}),
    ...(schemaType === 'Person' && normalized.worksFor
      ? { worksFor: { '@type': 'Organization', name: normalized.worksFor } }
      : {}),
    // A link the profile PRINTS is also a profile the author claims, so the
    // rendered rows join `sameAs` rather than being a second list to keep in
    // step by hand (AGL-2516). `mailto:` is excluded: `sameAs` is for pages
    // that identify the same entity, and an address is not one.
    ...(sameAs.length ? { sameAs } : {}),
  }
}

/** The site's own publisher entity, as `host.seo.entity` stores it. */
export interface HostSeoEntity {
  type?: HostEntityType | string | number
  name?: string
  logo?: string
}

/**
 * `schema.org` JSON-LD for the SITE entity (`host.seo.entity`) — the value
 * `Article.publisher` and `WebSite.publisher` are built from.
 *
 * Lives beside {@link contentAuthorJsonLd} on purpose (AGL-2486): a site
 * entity and a post author answer the same question about two different
 * subjects, and the reason the Person branch was broken for two years is that
 * the answer was written inline at its one call site where nothing could
 * test it. One module, two entry points, one `Person`/`Organization`
 * decision — {@link contentAuthorSchemaType}.
 *
 * `logo` is emitted verbatim on BOTH branches, unchanged from what the tenant
 * has always published. It is `host.seo.entity.logo`, a plain URL field on
 * the Setup form rather than a media-picker target, and re-keying it to
 * `image` for a Person would change the publisher block on every page of
 * every site that set one — a separate decision from this one.
 */
export function hostSeoEntityJsonLd(
  entity: HostSeoEntity | null | undefined,
): Record<string, unknown> | undefined {
  const name = text(entity?.name, 400)
  if (!name) return undefined
  return {
    '@type': contentAuthorSchemaType(entity?.type),
    name,
  }
}

/**
 * The publisher's picture, under the property its TYPE actually has
 * (AGL-2486).
 *
 * `schema.org` gives `logo` to an Organization and not to a Person; a Person
 * carries `image`. The tenant emitted `logo` for both, so a site that declared
 * itself a Person published a property its own `@type` does not define —
 * ignored by every consumer, which is the worst kind of wrong: the field is
 * set, the console says it is published, and nothing renders it.
 *
 * That is the same shape as the bug one function up, where a string `"2"` was
 * compared with a numeric enum and no site could ever publish `Person` at all.
 * Both resolve here so the type is decided in exactly one place.
 *
 * Returns a spreadable object so callers stay a spread rather than a ternary:
 * `{...hostSeoEntityImageJsonLd(entity)}` adds nothing when there is no
 * picture, which is what an absent property should cost.
 */
export function hostSeoEntityImageJsonLd(
  entity: HostSeoEntity | null | undefined,
  context?: ContentAuthorImageContext,
): Record<string, string> {
  /*
    Through `absoluteMediaSrc`, exactly as an author's portrait goes
    (AGL-1343/1407). The stored value has three generations — a raw storage
    URL, a site-relative CDN path, and a `media:` reference — and the site
    entity's was the one path still emitting whichever it found. A `media:`
    reference reaches Google as the literal string `media:{scope}/{id}`,
    which does not fetch; a site-relative path with no origin does not either.

    An unresolvable value emits NO key rather than a broken one — the same
    rule the author serializer states, and the reason both return a spreadable
    object instead of a URL.
  */
  /*
    TRIMMED first. `absoluteMediaSrc` does not trim, and a whitespace-only
    value — what a field cleared by typing spaces leaves behind — is not
    empty to it: it reads as a relative path and comes back joined to the
    origin, so the site would publish `https://example.com/   ` as its
    publisher logo. Trimmed here rather than in the resolver, which og:image
    and every author portrait also go through.
  */
  const stored = typeof entity?.logo === 'string' ? entity.logo.trim() : ''
  const image = stored
    ? absoluteMediaSrc(stored, {
        hostId: context?.hostId,
        origin: context?.origin,
      })
    : ''
  if (!image) return {}
  return contentAuthorSchemaType(entity?.type) === 'Person'
    ? { image }
    : { logo: image }
}

/** An entry, as far as author resolution is concerned. */
export interface AuthorBearingEntry {
  /** Reference into `hosts/{hostId}/authors` (AGL-2486). */
  authorId?: string
  /** The legacy free-typed byline (AGL-686). Still read, forever. */
  authorName?: string
}

/**
 * The author record an entry publishes under, or `null` for "the site".
 *
 * ## Precedence, and why the legacy string keeps working
 *
 * 1. `entry.authorId` resolving against the host's authors — the new shape.
 * 2. `entry.authorName` — every entry written before AGL-2486, and every
 *    entry whose editor chose "custom byline" instead of a record. Promoted
 *    to a `Person` with just a name, which is EXACTLY the JSON-LD the tenant
 *    already emitted for it, so no published page's structured data changes.
 * 3. `null` — the caller falls back to the site's publisher entity, as before.
 *
 * An `authorId` pointing at a DELETED author falls through to step 2 and then
 * to the site rather than resolving to nothing: an author record removed from
 * the masthead must not silently strip the byline off ten years of posts.
 */
export function resolveEntryAuthor(
  entry: AuthorBearingEntry | null | undefined,
  authors?: readonly ContentAuthorRecord[] | null,
): ContentAuthorRecord | null {
  const authorId = (entry?.authorId ?? '').trim()
  if (authorId) {
    const match = (authors ?? []).find((author) => author?.$id === authorId)
    const normalized = normalizeContentAuthor(match, authorId)
    if (normalized) return normalized
  }
  const legacy = (entry?.authorName ?? '').trim()
  if (legacy) {
    return { type: HostEntityType.PERSON, name: legacy, sameAs: [] }
  }
  return null
}

/**
 * The byline TEXT for an entry — what `{{entry.author}}` and the Entry Meta
 * block print (AGL-1459). Resolves a record's name, falls back to the legacy
 * string, and returns `''` when neither exists so the block renders nothing
 * rather than the word "undefined".
 */
export function resolveEntryAuthorName(
  entry: AuthorBearingEntry | null | undefined,
  authors?: readonly ContentAuthorRecord[] | null,
): string {
  return resolveEntryAuthor(entry, authors)?.name ?? ''
}
