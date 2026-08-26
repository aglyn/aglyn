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

/** Most `sameAs` profile links one author may carry. */
export const AUTHOR_SAME_AS_MAX = 12

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
  /** Profile URLs (social, ORCID, Crunchbase…) — `schema.org` `sameAs`. */
  sameAs?: string[]
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
    url: text(raw['url'], 400),
    image: text(raw['image'], 1000),
    jobTitle: text(raw['jobTitle']),
    worksFor: text(raw['worksFor']),
    sameAs,
    bio: text(raw['bio'], 600),
  }
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
    ...(normalized.sameAs?.length ? { sameAs: normalized.sameAs } : {}),
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
