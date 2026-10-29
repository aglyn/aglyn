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
 *
 * @jest-environment node
 */

/**
 * AGL-1660 — the marketplace publisher agreement is only acceptable once its
 * page is in the published legal set.
 *
 * `PUBLISHER_AGREEMENT_URL` once named a document that 404ed, and the console
 * rendered it as "Read the full Marketplace Publisher Agreement" directly
 * above an Accept button for two and a half weeks. The published set itself is
 * core's (`published-legal-pages`, whose spec holds its recognition rules);
 * what this holds is that the agreement asks that set, and never a separate
 * flag, before it offers acceptance.
 */

import { isPublishedLegalUrl } from '@aglyn/aglyn/app-utils/published-legal-pages'
import {
  PUBLISHER_AGREEMENT_URL,
  publisherAgreementConsentPresentation,
  publisherAgreementConsentRefusal,
  publisherAgreementIsPublished,
  publisherAgreementPresentation,
} from './publisher-agreement'

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

  it('cannot be agreed to on a save while it is unpublished (AGL-4105)', () => {
    // The per-save box reads its link and whether it can be ticked from the
    // same published set, and the routes refuse a save's agreement whatever
    // it says while there is no page behind it.
    expect(publisherAgreementConsentPresentation(false)).toEqual({
      documentUrl: null,
      canAgree: false,
      unavailableNotice: expect.any(String),
    })
    expect(publisherAgreementConsentPresentation(true)).toEqual({
      documentUrl: PUBLISHER_AGREEMENT_URL,
      canAgree: true,
      unavailableNotice: null,
    })
    const refusal = publisherAgreementConsentRefusal(
      { version: 'any', accepted: true },
      { published: false },
    )
    expect(refusal?.status).toBe(409)
    expect(refusal?.body.agreement).toMatchObject({ state: 'unavailable' })
    expect(String(refusal?.body.error)).toMatch(/not published yet/)
  })

  it('gates the live constant on the live published set', () => {
    // The whole point, stated once: whatever `PUBLISHER_AGREEMENT_URL` is
    // today, the product must not be collecting acceptances unless that URL is
    // in the published set. Publishing the page (adding its path to
    // PUBLISHED_LEGAL_PATHS) is what flips this, and nothing else can.
    if (!isPublishedLegalUrl(PUBLISHER_AGREEMENT_URL)) {
      expect(publisherAgreementPresentation('none').canAccept).toBe(false)
      expect(publisherAgreementPresentation('none').documentUrl).toBeNull()
      expect(publisherAgreementConsentPresentation().canAgree).toBe(false)
    } else {
      expect(publisherAgreementPresentation('none').canAccept).toBe(true)
      expect(publisherAgreementConsentPresentation().canAgree).toBe(true)
    }
  })
})
