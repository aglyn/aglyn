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
import { safeJsonLd } from './safe-json-ld'
import {
  AUTHOR_SAME_AS_MAX,
  type ContentAuthorRecord,
  contentAuthorJsonLd,
  contentAuthorSchemaType,
  hostSeoEntityJsonLd,
  normalizeContentAuthor,
  resolveEntryAuthor,
  resolveEntryAuthorName,
} from './content-authors'

const ORIGIN = 'https://example.com'

describe('contentAuthorSchemaType', () => {
  it('answers Person for the numeric enum', () => {
    expect(contentAuthorSchemaType(HostEntityType.PERSON)).toBe('Person')
    expect(contentAuthorSchemaType(HostEntityType.ORGANIZATION)).toBe(
      'Organization',
    )
  })

  /**
   * The defect this helper exists to end (AGL-2486).
   *
   * `Setup → SEO → Entity` builds its Select options as template literals, so
   * the type reaches Firestore as the STRING `"2"`. The tenant's structured
   * data compared that with `=== HostEntityType.PERSON`, the NUMBER `2`, and
   * strict equality across a string and a number is always false — so a site
   * that declared itself a Person published `"@type": "Organization"` on every
   * page, for as long as the field has existed.
   *
   * The mutation that proves this test reads: change the helper back to
   * `type === HostEntityType.PERSON` and this case goes red naming `"2"`,
   * while the numeric case above stays green — which is exactly how the bug
   * survived. A test that only ever passed the enum could not see it.
   */
  it('answers Person for the STRING the Setup form actually stores', () => {
    expect(contentAuthorSchemaType('2')).toBe('Person')
    expect(contentAuthorSchemaType('1')).toBe('Organization')
  })

  it('falls back to Organization for anything unrecognised', () => {
    expect(contentAuthorSchemaType(undefined)).toBe('Organization')
    expect(contentAuthorSchemaType('')).toBe('Organization')
    expect(contentAuthorSchemaType('nonsense')).toBe('Organization')
    expect(contentAuthorSchemaType(null)).toBe('Organization')
  })
})

describe('normalizeContentAuthor', () => {
  it('refuses a nameless author rather than emitting one', () => {
    // `schema.org` requires `name` on both branches, so a record without one
    // is not an author — it is a row that would publish `{"@type":"Person"}`.
    expect(normalizeContentAuthor({ url: ORIGIN })).toBeNull()
    expect(normalizeContentAuthor({ name: '   ' })).toBeNull()
    expect(normalizeContentAuthor(null)).toBeNull()
    expect(normalizeContentAuthor('Ada')).toBeNull()
  })

  it('keeps only string profile links, bounded', () => {
    const author = normalizeContentAuthor({
      name: 'Ada',
      sameAs: [
        'https://a.example',
        42,
        null,
        ...Array.from({ length: 30 }, (_, i) => `https://x${i}.example`),
      ],
    })
    expect(author?.sameAs).toHaveLength(AUTHOR_SAME_AS_MAX)
    expect(author?.sameAs?.[0]).toBe('https://a.example')
    for (const item of author?.sameAs ?? []) {
      expect(typeof item).toBe('string')
    }
  })
})

describe('contentAuthorJsonLd — Person vs Organization is a real branch', () => {
  const person: ContentAuthorRecord = {
    $id: 'author-1',
    type: HostEntityType.PERSON,
    name: 'Ada Lovelace',
    url: 'https://example.com/ada',
    image: 'https://cdn.example/ada.png',
    jobTitle: 'Principal Engineer',
    worksFor: 'Analytical Engines Ltd',
    sameAs: ['https://example.com/@ada'],
    bio: 'Writes about compilers.',
  }

  it('emits the Person fields, with the portrait as `image`', () => {
    expect(contentAuthorJsonLd(person, { origin: ORIGIN })).toEqual({
      '@type': 'Person',
      name: 'Ada Lovelace',
      url: 'https://example.com/ada',
      image: 'https://cdn.example/ada.png',
      jobTitle: 'Principal Engineer',
      worksFor: { '@type': 'Organization', name: 'Analytical Engines Ltd' },
      sameAs: ['https://example.com/@ada'],
    })
  })

  it('emits the Organization fields, with the mark as `logo`', () => {
    const out = contentAuthorJsonLd(
      { ...person, type: HostEntityType.ORGANIZATION },
      { origin: ORIGIN },
    )
    expect(out).toEqual({
      '@type': 'Organization',
      name: 'Ada Lovelace',
      url: 'https://example.com/ada',
      logo: 'https://cdn.example/ada.png',
      sameAs: ['https://example.com/@ada'],
    })
    // The two fields `schema.org/Organization` does not define. A label would
    // have carried them through; a branch does not.
    expect(out).not.toHaveProperty('jobTitle')
    expect(out).not.toHaveProperty('worksFor')
    expect(out).not.toHaveProperty('image')
  })

  it('never emits `bio` — it is page copy, not a schema.org claim', () => {
    const out = contentAuthorJsonLd(person, { origin: ORIGIN })
    expect(out).not.toHaveProperty('description')
    expect(JSON.stringify(out)).not.toContain('compilers')
  })

  it('resolves a `media:` portrait to an absolute, crawlable URL', () => {
    const out = contentAuthorJsonLd(
      { ...person, image: 'media:host-1/media-1' },
      { origin: ORIGIN, hostId: 'host-1' },
    )
    // The AGL-1343 property, one field over: a crawler reads this out of
    // band, so `media:{scope}/{id}` and a site-relative path are both useless.
    expect(String(out?.['image'])).toMatch(/^https:\/\/example\.com\//)
  })

  it('omits the image entirely when it cannot be made absolute', () => {
    // Never `"image": null` — `strictNullChecks` is off, so the guard is
    // load-bearing rather than decorative.
    const out = contentAuthorJsonLd(
      { ...person, image: 'media:host-1/media-1' },
      { origin: null, hostId: 'host-1' },
    )
    expect(out).not.toHaveProperty('image')
    expect(out?.['name']).toBe('Ada Lovelace')
  })

  it('returns undefined rather than a nameless author object', () => {
    expect(contentAuthorJsonLd(undefined)).toBeUndefined()
    expect(contentAuthorJsonLd({ name: '' })).toBeUndefined()
  })
})

describe('hostSeoEntityJsonLd', () => {
  it('emits the site entity, honouring the STRING type the form stores', () => {
    expect(hostSeoEntityJsonLd({ type: '2', name: 'Ada' })).toEqual({
      '@type': 'Person',
      name: 'Ada',
    })
    expect(hostSeoEntityJsonLd({ type: '1', name: 'Aglyn' })).toEqual({
      '@type': 'Organization',
      name: 'Aglyn',
    })
  })

  it('is undefined for an unnamed entity, so `publisher` is simply absent', () => {
    expect(hostSeoEntityJsonLd({ name: '' })).toBeUndefined()
    expect(hostSeoEntityJsonLd(undefined)).toBeUndefined()
  })
})

/**
 * The back-compat contract, asserted over entries IN THE SHAPES THE STORE
 * ACTUALLY HOLDS rather than over the new one (AGL-2486).
 *
 * Three generations live in `hosts/{h}/collections/{c}/entries`:
 *
 *  1. pre-AGL-686 — no author field at all;
 *  2. AGL-686 — a free-typed `authorName` string;
 *  3. AGL-2486 — an `authorId` reference (with the resolved name beside it).
 *
 * None of the first two may lose its byline, and none may regress to `null`
 * structured data. The third must resolve to the record.
 */
describe('resolveEntryAuthor — every stored entry shape keeps its byline', () => {
  const authors: ContentAuthorRecord[] = [
    {
      $id: 'author-1',
      type: HostEntityType.ORGANIZATION,
      name: 'The Aglyn Team',
      url: 'https://example.com/team',
    },
  ]

  it('(1) pre-AGL-686: no author field resolves to null, so the SITE wins', () => {
    const entry = { title: 'Old post', slug: 'old-post' }
    expect(resolveEntryAuthor(entry as never, authors)).toBeNull()
    expect(resolveEntryAuthorName(entry as never, authors)).toBe('')
    // Null is what lets the caller fall through to the publisher entity — the
    // behaviour these entries have always had. It is NOT an empty author.
    expect(
      contentAuthorJsonLd(resolveEntryAuthor(entry as never, authors)),
    ).toBeUndefined()
  })

  it('(2) AGL-686: a free-typed name still publishes as a bare Person', () => {
    const entry = { title: 'Post', authorName: 'The Aglyn Team' }
    expect(contentAuthorJsonLd(resolveEntryAuthor(entry, authors))).toEqual({
      // Byte for byte what the tenant emitted for this shape before AGL-2486:
      // `{'@type': 'Person', name: entry.authorName}` and nothing else. A
      // published page's structured data does not change under this feature.
      '@type': 'Person',
      name: 'The Aglyn Team',
    })
    expect(resolveEntryAuthorName(entry, authors)).toBe('The Aglyn Team')
  })

  it('(2b) an author name of only whitespace is not a byline', () => {
    expect(resolveEntryAuthor({ authorName: '   ' }, authors)).toBeNull()
  })

  it('(3) AGL-2486: a reference resolves to the full record', () => {
    const entry = { authorId: 'author-1', authorName: 'The Aglyn Team' }
    expect(contentAuthorJsonLd(resolveEntryAuthor(entry, authors))).toEqual({
      '@type': 'Organization',
      name: 'The Aglyn Team',
      url: 'https://example.com/team',
    })
  })

  it('the record WINS over a stale name stored beside it', () => {
    const entry = { authorId: 'author-1', authorName: 'Old Name' }
    expect(resolveEntryAuthorName(entry, authors)).toBe('The Aglyn Team')
  })

  it('a DELETED author falls through to the stored name, never to nothing', () => {
    // Removing an author from the masthead must not strip the byline off
    // years of posts — which is the whole reason the name is denormalized
    // beside the reference on save.
    const entry = { authorId: 'gone', authorName: 'The Aglyn Team' }
    expect(resolveEntryAuthorName(entry, authors)).toBe('The Aglyn Team')
    expect(contentAuthorJsonLd(resolveEntryAuthor(entry, authors))).toEqual({
      '@type': 'Person',
      name: 'The Aglyn Team',
    })
  })

  it('a dangling reference with no stored name falls through to the SITE', () => {
    expect(resolveEntryAuthor({ authorId: 'gone' }, authors)).toBeNull()
  })

  it('resolves with no authors list at all (the loader-less path)', () => {
    expect(resolveEntryAuthor({ authorName: 'Ada' })).toEqual({
      type: HostEntityType.PERSON,
      name: 'Ada',
      sameAs: [],
    })
  })
})

/**
 * Author text is CUSTOMER-AUTHORED and reaches an inline
 * `<script type="application/ld+json">`, so the breakout question has to be
 * asked of the value this module produces rather than of a hand-written
 * string (AGL-496 / AGL-2486).
 *
 * The escaping lives in `safeJsonLd` — the one serializer every JSON-LD block
 * in the repo is built with — and NOT in this module, deliberately: escaping
 * twice would double-encode and put literal backslashes into a byline. These
 * cases prove the composition, which is what actually ships.
 */
describe('an author name cannot break out of the JSON-LD script element', () => {
  it('neutralises `</script>` in every author field', () => {
    const hostile = '</script><img src=x onerror=alert(1)>'
    const out = safeJsonLd({
      '@context': 'https://schema.org',
      '@type': 'Article',
      author: contentAuthorJsonLd({
        type: HostEntityType.PERSON,
        name: hostile,
        url: hostile,
        jobTitle: hostile,
        worksFor: hostile,
        sameAs: [hostile],
      }),
    })
    expect(out).not.toContain('</script>')
    expect(out).not.toContain('<img')
    expect(out).toContain('\\u003c')
    expect(out).toContain('\\u003e')
    // Still valid JSON — inert, not mangled. An escape that broke the parse
    // would trade a breakout for structured data nobody can read.
    expect(JSON.parse(out).author.name).toBe(hostile)
  })

  it('neutralises the U+2028/U+2029 separators a paste can carry', () => {
    const out = safeJsonLd({
      author: contentAuthorJsonLd({
        name: `Ada${String.fromCharCode(0x2028)}Lovelace`,
      }),
    })
    expect(out).toContain('\\u2028')
  })

  it('survives a stray quote and a backslash in a byline', () => {
    const name = 'Ada "Ada" \\ Lovelace'
    const out = safeJsonLd({ author: contentAuthorJsonLd({ name }) })
    expect(JSON.parse(out).author.name).toBe(name)
  })
})
