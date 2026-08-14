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
 * AGL-1407: the two console pickers that write a media-bearing document FIELD
 * must write a REFERENCE, and the card that shows one back must resolve it.
 *
 * `logoUrl` on the host document and `coverImage` on a collection entry were
 * converted from raw `firebasestorage` URLs to `media:{scope}/{mediaId}` by
 * `tools/scripts/backfill-media-refs.mjs`. A migration only holds if the
 * writers agree with it: both of these took `media.url` straight off the
 * picked asset, so one visit to either card would have put a raw URL back —
 * silently, and looking exactly like success, because a raw URL still renders.
 *
 * A source guard rather than a render. Both surfaces mount live Firestore
 * subscriptions and a picker dialog, and what is being pinned is which
 * function the value goes through, which is legible in the source and would
 * survive being mocked out of a render test.
 *
 * The content page used to be the exception and is no longer (AGL-1705): its
 * cover took a reference and its BODY images took a raw URL, because
 * markdown-lite resolved nothing and `![alt](media:…)` would have been a
 * broken image. AGL-1686 removed that premise, so the same dialog and the same
 * callback now have ONE correct answer, and the marketplace README writers
 * joined them.
 *
 * The remaining asymmetry is real and is asserted below: the listing's image
 * FIELDS keep an absolute URL, because `og:image` reads them out of band.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { code } from './source-text'

const LOGO_CARD = join(__dirname, '..', 'components', 'logo-card.component.tsx')
const FAVICON_CARD = join(
  __dirname,
  '..',
  'components',
  'favicon-card.component.tsx',
)
const LISTING_EDITOR = join(
  __dirname,
  '..',
  'components',
  'marketplace',
  'listing-detail-editor.component.tsx',
)
const PUBLISH_FORM = join(
  __dirname,
  '..',
  'components',
  'marketplace',
  'publish-plugin-form.component.tsx',
)
const CONTENT_PAGE = join(
  __dirname,
  '..',
  'app',
  '(app)',
  '[orgSlug]',
  'hosts',
  '[host]',
  'content',
  'page.tsx',
)

/**
 * Comments stripped — the rule has to be in the CODE, not the prose.
 *
 * Through the shared bounded stripper since AGL-1479: the copy that lived here
 * treated any `/*` as a comment opener, which is how four sibling specs came to
 * assert against a file with 16,383 characters missing from the middle of it.
 */
const logoCode = code(
  readFileSync(LOGO_CARD, 'utf8'),
  'logo-card.component.tsx',
)
const faviconCode = code(
  readFileSync(FAVICON_CARD, 'utf8'),
  'favicon-card.component.tsx',
)
const contentCode = code(
  readFileSync(CONTENT_PAGE, 'utf8'),
  'hosts/[host]/content/page.tsx',
)

describe('site logo card (AGL-1407)', () => {
  it('writes the picked asset through mediaNodeSrc, not media.url', () => {
    expect(logoCode).toMatch(/logoUrl:\s*src/)
    expect(logoCode).toMatch(/mediaNodeSrc\(media\)/)
    // The exact regression: `setDoc({ logoUrl: media.url }, …)`.
    expect(logoCode).not.toMatch(/logoUrl:\s*media\.url/)
  })

  it('resolves the stored value before showing it back', () => {
    expect(logoCode).toMatch(/resolveMediaSrc\(logoUrl/)
    // `src={logoUrl}` renders `media:…` as a broken image, which is what the
    // preview did until the data was converted underneath it.
    expect(logoCode).not.toMatch(/src=\{logoUrl\}/)
  })
})

/**
 * The third card, added when the reopened favicon leg landed. Same defect, and
 * the one with a live customer site behind it: `seo.favicon` on two hosts held
 * a raw storage URL, and this card would have written another one back the
 * next time anyone picked an icon.
 */
describe('favicon card (AGL-1407)', () => {
  it('writes the picked asset through mediaNodeSrc, not media.url', () => {
    expect(faviconCode).toMatch(/mediaNodeSrc\(media\)/)
    expect(faviconCode).toMatch(/favicon:\s*src/)
    // The exact regression: `setDoc({ seo: { favicon: media.url } }, …)`.
    expect(faviconCode).not.toMatch(/favicon:\s*media\.url/)
  })

  it('resolves the stored value before showing it back', () => {
    expect(faviconCode).toMatch(/resolveMediaSrc\(favicon/)
    // `src={favicon}` renders `media:…` as a broken 32px tile.
    expect(faviconCode).not.toMatch(/src=\{favicon\}/)
  })

  it('still clears the field with an empty string, not a reference', () => {
    // The Remove path is deliberately untouched: `host-icon` and this card
    // both test truthiness, and a deleted field would leave the projection
    // row's `favicon` behind (AGL-1071).
    expect(faviconCode).toMatch(/favicon:\s*''/)
  })
})

describe('content entry picker (AGL-1407, AGL-1705)', () => {
  it('writes the cover as a reference', () => {
    expect(contentCode).toMatch(/mediaNodeSrc\(media\)/)
    expect(contentCode).toMatch(/coverImage:\s*src\b/)
    expect(contentCode).not.toMatch(/coverImage:\s*url\b/)
  })

  /**
   * INVERTED by AGL-1705, and the inversion is the record of why. This spec
   * used to pin the opposite — "still writes the raw URL into a markdown BODY
   * image" — on the grounds that markdown-lite had no resolver, so a reference
   * would have been a broken image rather than a tidier one. That was true
   * when it was written and stopped being true at AGL-1686, which taught all
   * five markdown-lite renderers to call `resolveMediaSrc` and taught the
   * parser to accept a reference as an image `src`.
   *
   * The cover branch is no longer asserted in isolation because there is no
   * longer a split to guard: one `mediaNodeSrc` call feeds all three targets.
   */
  it('writes a markdown BODY image as a reference too', () => {
    // Both body paths — the visual editor's insert and the raw markdown tab's
    // append — take the same `src` the cover does.
    expect(contentCode).toMatch(/insertImage\(alt, src\)/)
    expect(contentCode).toMatch(/!\[\$\{alt\}\]\(\$\{src\}\)/)
    // The exact regression, and the thing AGL-1215 exists to stop storing:
    // `media.url` names the object's current location, so a folder move 404s
    // it permanently.
    expect(contentCode).not.toMatch(/insertImage\(alt, url\)/)
    expect(contentCode).not.toMatch(/!\[\$\{alt\}\]\(\$\{url\}\)/)
  })
})

/**
 * AGL-1705's second half — the marketplace pair, which were split out of
 * AGL-1686 rather than folded in because they stored an ORIGIN-ABSOLUTE URL
 * and it could not be verified whether a listing README renders on another
 * origin. It does not. `MarketplaceListingContent` is registered through
 * `registerConsoleExtension`, its `marketplaceListing` slot has exactly one
 * render site (the console's `/[orgSlug]/marketplace/[listingId]` route), and
 * `apps/tenant` never imports the marketplace plugin. The `og:image` path
 * reads `previewImageUrl`/`logoUrl`, never the README body.
 */
describe('marketplace README writers (AGL-1705)', () => {
  const listingCode = code(
    readFileSync(LISTING_EDITOR, 'utf8'),
    'listing-detail-editor.component.tsx',
  )
  const publishCode = code(
    readFileSync(PUBLISH_FORM, 'utf8'),
    'publish-plugin-form.component.tsx',
  )

  it('inserts a reference into the listing README body', () => {
    expect(listingCode).toMatch(/mediaNodeSrc\(media\)/)
    expect(listingCode).toMatch(/insertImage\('',\s*src\)/)
    expect(listingCode).not.toMatch(/insertImage\('',\s*url\)/)
  })

  /**
   * The image FIELDS deliberately keep `mediaSrc`. Not an inconsistency left
   * behind: they are read OUT OF BAND — `og:image` and `resolveSocialImage`
   * have no page to resolve a relative path against — and AGL-1701 gave them
   * their own first-party validator and a Firestore deny rule. Flattening the
   * two would have re-broken the unfurl.
   */
  it('leaves the listing IMAGE fields on the absolute URL', () => {
    expect(listingCode).toMatch(/previewImageUrl:\s*url\b/)
    expect(listingCode).toMatch(/logoUrl:\s*url\b/)
    expect(listingCode).toMatch(/mediaSrc\(media\)/)
  })

  it('inserts a reference into the publish form README', () => {
    expect(publishCode).toMatch(/mediaNodeSrc\(media/)
    expect(publishCode).toMatch(/insertImage\('',\s*src\)/)
    expect(publishCode).not.toMatch(/insertImage\('',\s*url\)/)
  })

  /**
   * Both writers keep a `?? mediaSrc(...)`/`?? url` tail rather than dropping
   * it. `mediaNodeSrc` derives the reference from `cdnPath`, which is only
   * minted for orgs entitled to `mediaCdn` and is deleted for private assets —
   * so a free-tier publisher has no reference to write, and the fallback is
   * what keeps their README image from becoming an empty `src`.
   */
  it('keeps the free-tier fallback in both', () => {
    expect(listingCode).toMatch(/mediaNodeSrc\(media\)\s*\?\?\s*url/)
    expect(publishCode).toMatch(/mediaNodeSrc\(media[^)]*\)\s*\?\?\s*mediaSrc/)
  })
})
