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
 * AGL-1660 — a legal document we ask people to accept must have a page.
 *
 * The defect this guards: `PUBLISHER_AGREEMENT_URL` named a canonical document
 * at `/legal/marketplace-publisher-agreement`, the console rendered it as
 * "Read the full Marketplace Publisher Agreement" directly above an Accept
 * button, and the URL 404ed. It stayed that way for two and a half weeks and
 * was found by a legal audit, because nothing in the repo knew which legal
 * pages exist.
 *
 * Now something does. The invariant is not "the link works" — an offline suite
 * cannot know that — it is "we never *offer acceptance* of a document that is
 * not in the published set", which is checkable here and is the half that
 * carries the legal weight.
 */

import {
  isPublishedLegalUrl,
  LEGAL_ORIGIN,
  PUBLISHED_LEGAL_PATHS,
} from './published-legal-pages'
import {
  PUBLISHER_AGREEMENT_URL,
  publisherAgreementIsPublished,
  publisherAgreementPresentation,
  publisherAgreementRefusal,
} from './publisher-agreement'

describe('published legal pages', () => {
  it('recognises each published document, by absolute URL and by path', () => {
    for (const path of PUBLISHED_LEGAL_PATHS) {
      expect(isPublishedLegalUrl(path)).toBe(true)
      expect(isPublishedLegalUrl(`${LEGAL_ORIGIN}${path}`)).toBe(true)
      // A trailing slash is the same page, and a link written either way must
      // not read as unpublished.
      expect(isPublishedLegalUrl(`${LEGAL_ORIGIN}${path}/`)).toBe(true)
    }
  })

  it('refuses an unpublished path, another origin, and junk', () => {
    // `/legal/marketplace-publisher-agreement` used to sit here. It was
    // published on 2026-08-14 (AGL-1674) and is now covered by the positive
    // loop above; `/legal/refunds` keeps this case honest, because a negative
    // case with nothing in it stops testing anything the day it empties.
    expect(isPublishedLegalUrl('/legal/refunds')).toBe(false)
    // A lookalike host serving anything at all is not our published text.
    expect(isPublishedLegalUrl('https://aglyn.com.evil.example/legal/terms')).toBe(
      false,
    )
    expect(isPublishedLegalUrl('http://aglyn.com/legal/terms')).toBe(false)
    expect(isPublishedLegalUrl('')).toBe(false)
    expect(isPublishedLegalUrl(null)).toBe(false)
    expect(isPublishedLegalUrl('not a url')).toBe(false)
  })
})

describe('the publisher agreement is only acceptable once it is readable', () => {
  it('derives availability from the published set, not a separate flag', () => {
    expect(publisherAgreementIsPublished()).toBe(
      isPublishedLegalUrl(PUBLISHER_AGREEMENT_URL),
    )
  })

  it('offers no link and no accept control while it is unpublished', () => {
    for (const state of ['none', 'outdated'] as const) {
      const presentation = publisherAgreementPresentation(state, false)
      expect(presentation.documentUrl).toBeNull()
      expect(presentation.canAccept).toBe(false)
      expect(presentation.unavailableNotice).toBeTruthy()
    }
  })

  it('offers both once it is published', () => {
    expect(publisherAgreementPresentation('none', true)).toEqual({
      documentUrl: PUBLISHER_AGREEMENT_URL,
      canAccept: true,
      unavailableNotice: null,
    })
    // Already current is "nothing to do", not "blocked".
    expect(publisherAgreementPresentation('current', true).canAccept).toBe(false)
    expect(
      publisherAgreementPresentation('current', true).documentUrl,
    ).toBe(PUBLISHER_AGREEMENT_URL)
  })

  it('does not send a blocked publisher to a control that is not there', () => {
    // The publish refusal used to say "accept it in Marketplace → Publisher
    // Profile". While the document is unpublished that is a dead end, and a
    // dead end reads as a broken console rather than as our omission.
    const refusal = publisherAgreementRefusal('none', false)
    expect(refusal).not.toMatch(/Publisher Profile/)
    expect(refusal).toMatch(/not published yet/)
    expect(publisherAgreementRefusal('none', true)).toMatch(/Publisher Profile/)
  })

  it('gates the live constant on the live published set', () => {
    // The whole point, stated once: whatever `PUBLISHER_AGREEMENT_URL` is
    // today, the product must not be collecting acceptances unless that URL is
    // in the published set. Publishing the page (adding its path to
    // PUBLISHED_LEGAL_PATHS) is what flips this, and nothing else can.
    if (!isPublishedLegalUrl(PUBLISHER_AGREEMENT_URL)) {
      expect(publisherAgreementPresentation('none').canAccept).toBe(false)
      expect(publisherAgreementPresentation('none').documentUrl).toBeNull()
    } else {
      expect(publisherAgreementPresentation('none').canAccept).toBe(true)
    }
  })
})
