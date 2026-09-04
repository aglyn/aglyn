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
  hostSeoEntityImageJsonLd,
  AUTHOR_LINKS_MAX,
  AUTHOR_SOCIAL_PLATFORMS,
  authorLinkLabel,
  authorLinkPlatform,
  normalizeContentAuthorLinks,
  contentAuthorMatchesSlug,
  contentAuthorPageAtUrl,
  contentAuthorPageUrl,
  contentAuthorPaginationLinks,
  contentAuthorSlug,
  parseContentAuthorRoute,
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

/**
 * A publisher's picture goes under the property its TYPE has (AGL-2486).
 *
 * `schema.org` gives `logo` to an Organization and `image` to a Person, and
 * the tenant emitted `logo` for both — so a site declaring itself a Person
 * published a property its own `@type` does not define. Ignored by every
 * consumer, which is the worst kind of wrong: the field is set, the console
 * said it was published, and nothing rendered it.
 */
describe('hostSeoEntityImageJsonLd (AGL-2486)', () => {
  const CONTEXT = { origin: 'https://acme.example', hostId: 'h1' }

  it('gives an Organization a logo', () => {
    expect(
      hostSeoEntityImageJsonLd(
        { type: 1, name: 'Acme', logo: 'https://x/l.png' },
        CONTEXT,
      ),
    ).toEqual({ logo: 'https://x/l.png' })
  })

  it('gives a Person an IMAGE, which is the property Person has', () => {
    expect(
      hostSeoEntityImageJsonLd(
        { type: 2, name: 'Ada', logo: 'https://x/p.jpg' },
        CONTEXT,
      ),
    ).toEqual({ image: 'https://x/p.jpg' })
  })

  it('reads a STRING type, which is what the console persists', () => {
    // The Select's options are template literals, so the stored value is
    // `"2"`. A strict comparison with the numeric enum is always false —
    // the bug that kept every site on `Organization` no matter what it chose.
    expect(
      hostSeoEntityImageJsonLd({ type: '2', logo: 'https://x/p.jpg' }, CONTEXT),
    ).toEqual({ image: 'https://x/p.jpg' })
  })

  it('RESOLVES a site-relative CDN path against the site origin', () => {
    // The value has three generations, and the entity path used to emit
    // whichever it found — so a `media:` reference reached a crawler as the
    // literal string `media:{scope}/{id}`, which does not fetch.
    const resolved = hostSeoEntityImageJsonLd(
      { type: 1, logo: '/api/media/cdn/h1/abc.png' },
      CONTEXT,
    )
    expect(resolved.logo).toBe('https://acme.example/api/media/cdn/h1/abc.png')
  })

  it('emits NO key rather than a broken one', () => {
    // An unresolvable value, and an absent one, answer alike: spreadable by
    // design, so an absent property costs an empty spread rather than a
    // ternary at every call site.
    expect(hostSeoEntityImageJsonLd({ type: 2, name: 'Ada' }, CONTEXT)).toEqual({})
    expect(hostSeoEntityImageJsonLd({ logo: '   ' }, CONTEXT)).toEqual({})
    expect(hostSeoEntityImageJsonLd(undefined, CONTEXT)).toEqual({})
    // No origin to resolve against: a site-relative path cannot become
    // absolute, so nothing is published.
    expect(
      hostSeoEntityImageJsonLd({ logo: '/api/media/cdn/h1/abc.png' }, {}),
    ).toEqual({})
  })
})

/**
 * The links an author profile PRINTS (AGL-2516).
 *
 * `sameAs` was already there and is the wrong shape to render: bare strings a
 * card can only draw as a row of identical anonymous links. These carry what a
 * reader needs BEFORE the click — which is a mark on a known platform, and a
 * label the author writes on anything else.
 */
describe('Author display links (AGL-2516)', () => {
  describe('what a link is called', () => {
    it('takes a known platform’s name from the registry, not the author', () => {
      // The mark and the accessible name are not the author's to choose: an X
      // link drawn as GitHub is a broken link that still resolves.
      expect(
        authorLinkLabel({
          platform: 'x',
          label: 'my totally different label',
          url: 'https://x.com/aglyn',
        }),
      ).toBe('X')
    })

    it('uses the author’s label on a custom link', () => {
      expect(
        authorLinkLabel({ label: 'Newsletter', url: 'https://example.com/n' }),
      ).toBe('Newsletter')
    })

    it('falls back to the url rather than to something generic', () => {
      // Four rows all named "Link" is not an accessible name; the URLs at
      // least tell them apart.
      expect(authorLinkLabel({ url: 'https://example.com/talk' })).toBe(
        'https://example.com/talk',
      )
    })

    it('resolves only ids the registry actually declares', () => {
      expect(authorLinkPlatform('github')?.icon).toBe('github')
      expect(authorLinkPlatform('myspace')).toBeUndefined()
      expect(authorLinkPlatform('')).toBeUndefined()
      expect(authorLinkPlatform(undefined)).toBeUndefined()
    })

    it('gives every registered platform a label and an icon', () => {
      expect(AUTHOR_SOCIAL_PLATFORMS.length).toBeGreaterThan(0)
      for (const platform of AUTHOR_SOCIAL_PLATFORMS) {
        expect(Boolean(platform.id && platform.label && platform.icon)).toBe(true)
      }
      // Ids are what gets STORED, so a duplicate would make one unreachable.
      const ids = AUTHOR_SOCIAL_PLATFORMS.map((entry) => entry.id)
      expect(new Set(ids).size).toBe(ids.length)
    })
  })

  describe('normalizing stored rows', () => {
    it('keeps https and mailto, and drops everything else', () => {
      const links = normalizeContentAuthorLinks([
        { platform: 'x', url: 'https://x.com/aglyn' },
        { label: 'Email', url: 'mailto:hi@example.com' },
        // eslint-disable-next-line no-script-url
        { label: 'Bad', url: 'javascript:alert(1)' },
        { label: 'Insecure', url: 'http://example.com' },
        { label: 'Nowhere', url: '' },
      ])
      expect(links.map((link) => link.url)).toEqual([
        'https://x.com/aglyn',
        'mailto:hi@example.com',
      ])
    })

    it('drops a stored label and icon that sit beside a known platform', () => {
      // The registry owns both, so a stored pair is stale data that must not
      // win — otherwise renaming a platform leaves old rows saying the old
      // thing forever.
      const [link] = normalizeContentAuthorLinks([
        {
          platform: 'github',
          label: 'stale',
          icon: 'stale-icon',
          url: 'https://github.com/aglyn',
        },
      ])
      expect(link).toEqual({ platform: 'github', url: 'https://github.com/aglyn' })
    })

    it('drops a platform id nothing recognises, keeping the row custom', () => {
      const [link] = normalizeContentAuthorLinks([
        { platform: 'myspace', label: 'Profile', url: 'https://example.com/p' },
      ])
      expect(link?.platform).toBeUndefined()
      expect(link?.label).toBe('Profile')
    })

    it('carries a custom icon’s PATH beside its id', () => {
      // AGL-1212's split: the catalog is ~2.9MB and only picker surfaces load
      // it, so a renderer given an id alone can only draw a fallback glyph.
      const [link] = normalizeContentAuthorLinks([
        { label: 'Talk', icon: 'presentation', iconPath: 'M1 1h2', url: 'https://e.com/t' },
      ])
      expect([link?.icon, link?.iconPath]).toEqual(['presentation', 'M1 1h2'])
    })

    it('caps the list and survives junk', () => {
      const many = Array.from({ length: AUTHOR_LINKS_MAX + 5 }, (_, i) => ({
        label: `L${i}`,
        url: `https://example.com/${i}`,
      }))
      expect(normalizeContentAuthorLinks(many)).toHaveLength(AUTHOR_LINKS_MAX)
      expect(normalizeContentAuthorLinks(undefined)).toEqual([])
      expect(normalizeContentAuthorLinks('nope')).toEqual([])
      expect(normalizeContentAuthorLinks([null, 7, 'x'])).toEqual([])
    })
  })

  describe('structured data', () => {
    it('folds printed links into sameAs so the author types a url once', () => {
      const json = contentAuthorJsonLd({
        type: HostEntityType.PERSON,
        name: 'Zach Gover',
        sameAs: ['https://example.com/declared'],
        links: [
          { platform: 'x', url: 'https://x.com/aglyn' },
          { label: 'Email', url: 'mailto:hi@example.com' },
        ],
      } as ContentAuthorRecord)
      expect(json?.['sameAs']).toEqual([
        'https://example.com/declared',
        'https://x.com/aglyn',
      ])
    })

    it('never lets a mailto into sameAs', () => {
      // `sameAs` is for pages that identify the same entity. An address is not
      // a page, and Google reports one as an invalid sameAs.
      const json = contentAuthorJsonLd({
        name: 'Aglyn',
        links: [{ platform: 'email', url: 'mailto:hi@example.com' }],
      } as ContentAuthorRecord)
      expect(json?.['sameAs']).toBeUndefined()
    })

    it('does not repeat a url that is already declared', () => {
      const json = contentAuthorJsonLd({
        name: 'Zach Gover',
        sameAs: ['https://x.com/aglyn'],
        links: [{ platform: 'x', url: 'https://x.com/aglyn' }],
      } as ContentAuthorRecord)
      expect(json?.['sameAs']).toEqual(['https://x.com/aglyn'])
    })

    it('still respects the sameAs ceiling once links join it', () => {
      const json = contentAuthorJsonLd({
        name: 'Zach Gover',
        sameAs: Array.from(
          { length: AUTHOR_SAME_AS_MAX },
          (_, i) => `https://example.com/d${i}`,
        ),
        links: [{ platform: 'x', url: 'https://x.com/aglyn' }],
      } as ContentAuthorRecord)
      expect((json?.['sameAs'] as string[]).length).toBe(AUTHOR_SAME_AS_MAX)
    })

    it('escapes a link exactly as every other value does', () => {
      const json = contentAuthorJsonLd({
        name: 'Zach Gover',
        links: [{ label: '</script>', url: 'https://example.com/</script>' }],
      } as ContentAuthorRecord)
      expect(safeJsonLd(json)).not.toContain('</script>')
    })
  })

  it('normalizes links as part of the record', () => {
    const author = normalizeContentAuthor({
      name: 'Zach Gover',
      links: [
        { platform: 'x', url: 'https://x.com/aglyn' },
        { label: 'Bad', url: 'ftp://example.com' },
      ],
    })
    expect(author?.links).toEqual([{ platform: 'x', url: 'https://x.com/aglyn' }])
  })
})

/**
 * The author's PAGE (AGL-2518) — `/author/{slug}`, site-wide.
 *
 * AGL-2517 put an archive under each collection, so one person had as many
 * partial pages as the site has collections, none of them the address a
 * byline should link to. These cases pin the reshape: one address per person,
 * readable, stable across a rename, and still answering to every older
 * spelling of them so no published link breaks.
 */
describe('the author page (AGL-2518)', () => {
  describe('which segment addresses an author', () => {
    it('prefers the stored slug — the one thing a rename cannot move', () => {
      expect(
        contentAuthorSlug({ author: { slug: 'zg', name: 'Zach Gover' } }),
      ).toBe('zg')
    })

    it('falls back to the name, so nobody has to set one', () => {
      expect(contentAuthorSlug({ author: { name: 'Zach Gover' } })).toBe(
        'zach-gover',
      )
    })

    it('puts the record id LAST, not first', () => {
      /*
        The reversal of AGL-2517, and the reason is that this is a public
        address on a marketing site rather than an internal reference.
        `/author/hT3kQ9xLmZ2` survives a rename and is unreadable; the stored
        slug survives a rename AND reads. The id is still accepted on the way
        in — see the matcher below — so links built under the old precedence
        keep resolving.
      */
      expect(
        contentAuthorSlug({ author: { $id: 'hT3kQ9xLmZ2', name: 'Zach Gover' } }),
      ).toBe('zach-gover')
      // With nothing else to go on it is still better than no address.
      expect(contentAuthorSlug({ authorId: 'hT3kQ9xLmZ2' })).toBe('ht3kq9xlmz2')
    })

    it('is empty when nothing addresses the author', () => {
      // The caller then renders plain text instead of a link to `/author/`.
      expect(contentAuthorSlug({})).toBe('')
      expect(contentAuthorPageUrl({})).toBe('')
    })
  })

  describe('which segments resolve BACK to them', () => {
    const author = {
      $id: 'hT3kQ9xLmZ2',
      slug: 'zg',
      name: 'Zach Gover',
    }

    it('accepts the slug, the name and the id', () => {
      for (const segment of ['zg', 'zach-gover', 'ht3kq9xlmz2']) {
        expect([segment, contentAuthorMatchesSlug({ author }, segment)]).toEqual(
          [segment, true],
        )
      }
    })

    it('accepts the legacy free-typed byline', () => {
      expect(
        contentAuthorMatchesSlug(
          { authorName: 'The Aglyn Team' },
          'the-aglyn-team',
        ),
      ).toBe(true)
    })

    it('refuses a segment that addresses nobody, and the empty one', () => {
      expect(contentAuthorMatchesSlug({ author }, 'someone-else')).toBe(false)
      // An empty segment must not match every author on the site.
      expect(contentAuthorMatchesSlug({ author }, '')).toBe(false)
      expect(contentAuthorMatchesSlug({}, 'zg')).toBe(false)
    })
  })

  describe('parsing the route', () => {
    it('resolves the page and its pagination', () => {
      expect(parseContentAuthorRoute(['author', 'zach-gover'])).toEqual({
        authorSlug: 'zach-gover',
        page: 1,
      })
      expect(
        parseContentAuthorRoute(['author', 'zach-gover', 'page', '3']),
      ).toEqual({ authorSlug: 'zach-gover', page: 3 })
    })

    it('slugifies the segment, so one author has one URL', () => {
      expect(parseContentAuthorRoute(['author', 'Zach Gover'])).toEqual({
        authorSlug: 'zach-gover',
        page: 1,
      })
    })

    it('refuses a page number that is not one', () => {
      // A nonsense page 404s rather than silently serving page 1 at a second
      // address, which would be duplicate content at infinitely many URLs.
      expect(parseContentAuthorRoute(['author', 'z', 'page', '0'])).toBeNull()
      expect(parseContentAuthorRoute(['author', 'z', 'page', 'two'])).toBeNull()
      expect(parseContentAuthorRoute(['author', 'z', 'page', '-1'])).toBeNull()
    })

    it('is not a route at all for anything else', () => {
      expect(parseContentAuthorRoute(['author'])).toBeNull()
      expect(parseContentAuthorRoute(['blog', 'author', 'zach'])).toBeNull()
      expect(parseContentAuthorRoute([])).toBeNull()
      expect(parseContentAuthorRoute(['authors', 'zach'])).toBeNull()
    })
  })

  describe('paginating it', () => {
    const author = { slug: 'zg', name: 'Zach Gover' }

    it('leaves page 1 at the bare address', () => {
      // No `/author/zg/page/1`, so the first page cannot become a second
      // address for itself.
      expect(contentAuthorPageAtUrl({ author, page: 1 })).toBe('/author/zg')
      expect(contentAuthorPageAtUrl({ author, page: 2 })).toBe(
        '/author/zg/page/2',
      )
    })

    it('resolves the EDGES to the empty string, never to a URL', () => {
      // What lets a designed template bind `{{pagination.prevUrl}}`
      // unconditionally: an href of `''` renders as an inert placeholder of
      // the same element (AGL-1268/1357), which is the correct pager on page
      // 1 of 1.
      const alone = contentAuthorPaginationLinks({
        author,
        page: 1,
        totalPages: 1,
      })
      expect([alone.prevUrl, alone.nextUrl]).toEqual(['', ''])
      const middle = contentAuthorPaginationLinks({
        author,
        page: 2,
        totalPages: 3,
      })
      expect([middle.prevUrl, middle.nextUrl]).toEqual([
        '/author/zg',
        '/author/zg/page/3',
      ])
    })

    it('reads an unusable page or total as a single page', () => {
      const links = contentAuthorPaginationLinks({
        author,
        page: 0,
        totalPages: NaN,
      })
      expect(links).toEqual({
        page: 1,
        totalPages: 1,
        prevUrl: '',
        nextUrl: '',
      })
    })
  })

  it('round-trips: the url it builds is one the parser resolves', () => {
    const author = { $id: 'hT3kQ9xLmZ2', name: 'Zach Gover' }
    const url = contentAuthorPageAtUrl({ author, page: 2 })
    const route = parseContentAuthorRoute(url.replace(/^\//, '').split('/'))
    expect(route).toEqual({ authorSlug: 'zach-gover', page: 2 })
    // …and the segment the parser produced addresses the author it came from.
    expect(contentAuthorMatchesSlug({ author }, route!.authorSlug)).toBe(true)
  })

  it('stores the slug as a path segment, not as whatever was typed', () => {
    // A stored `Chris Taylor` would build `/author/Chris Taylor` while every
    // incoming request arrived slugified and matched nothing.
    const author = normalizeContentAuthor({
      name: 'Chris Taylor',
      slug: '  Chris Taylor  ',
    })
    expect(author?.slug).toBe('chris-taylor')
  })
})
