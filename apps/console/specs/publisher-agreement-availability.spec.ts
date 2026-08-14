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
 * AGL-1660 — the console must not link a legal document that has no page.
 *
 * Two properties, both offline:
 *
 *   1. Every legal URL the console presents is in the published set. This is
 *      what nobody could check when `PUBLISHER_AGREEMENT_URL` was pointed at a
 *      route that 404ed for two and a half weeks.
 *   2. The seller panel gets the agreement's href from
 *      `publisherAgreementPresentation`, which returns null while the document
 *      is unpublished — never from the constant. A source check, because the
 *      failure mode is textual: someone re-introduces
 *      `href={PUBLISHER_AGREEMENT_URL}` and every runtime test still passes on
 *      the day the page happens to exist.
 */

import { readFileSync } from 'fs'
import { join } from 'path'
import {
  isPublishedLegalUrl,
  PUBLISHED_LEGAL_PATHS,
} from '@aglyn/aglyn/app-utils/published-legal-pages'
import { LEGAL_DOCUMENTS } from '../constants/legal-documents'
import { LEGAL_URLS } from '../constants/shared'

const sellerPanel = readFileSync(
  join(__dirname, '..', 'components', 'org-seller-panel.component.tsx'),
  'utf-8',
)

describe('legal links the console presents (AGL-1660)', () => {
  it('points the clickwrap control at documents that are published', () => {
    for (const url of Object.values(LEGAL_URLS)) {
      expect([url, isPublishedLegalUrl(url)]).toEqual([url, true])
    }
    for (const doc of LEGAL_DOCUMENTS) {
      expect([doc.key, isPublishedLegalUrl(doc.url)]).toEqual([doc.key, true])
    }
  })

  it('knows the publisher agreement is not one of them', () => {
    // Not a wish: the live /legal index lists exactly these, verified
    // 2026-08-14. If this fails because the agreement was published, the fix
    // is to add its path to PUBLISHED_LEGAL_PATHS and delete this test's
    // second half — the gate then opens on its own.
    expect(PUBLISHED_LEGAL_PATHS).not.toContain(
      '/legal/marketplace-publisher-agreement',
    )
  })
})

describe('the seller panel cannot link an unreadable agreement', () => {
  it('never reads the URL constant directly', () => {
    expect(sellerPanel).not.toContain('PUBLISHER_AGREEMENT_URL')
  })

  it('takes the href and the accept control from the presentation helper', () => {
    expect(sellerPanel).toContain('publisherAgreementPresentation')
    expect(sellerPanel).toContain('href={agreementPresentation.documentUrl}')
    expect(sellerPanel).toContain('agreementPresentation.canAccept ? (')
  })
})
