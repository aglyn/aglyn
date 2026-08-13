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
 * The asymmetry in the content page is the point of the third case and is not
 * an oversight: a cover has known readers that all resolve, and a BODY image
 * is markdown whose renderers resolve nothing, so `![alt](media:…)` would be a
 * broken image on the page. Same dialog, same callback, two correct answers.
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

describe('content entry cover picker (AGL-1407)', () => {
  /** The `onPick` branch that assigns the cover. */
  const coverBranch = (() => {
    const at = contentCode.indexOf("pickerTarget === 'cover'")
    if (at < 0) throw new Error('the cover branch is gone — retarget me')
    return contentCode.slice(at, contentCode.indexOf('bodyTab', at))
  })()

  it('writes the cover as a reference', () => {
    expect(coverBranch).toMatch(/mediaNodeSrc\(media\)/)
    expect(coverBranch).not.toMatch(/coverImage:\s*url\b/)
  })

  it('still writes the raw URL into a markdown BODY image', () => {
    // Not a gap being tolerated: markdown-lite has no resolver, so a
    // reference here is a broken image rather than a tidier one.
    expect(contentCode).toMatch(/!\[\$\{alt\}\]\(\$\{url\}\)/)
    expect(contentCode).toMatch(/insertImage\(alt, url\)/)
  })
})
