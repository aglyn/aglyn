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
 * The staff "Legal acceptances" card rendered `Documents (sha256)` as plain
 * text with nowhere to click (owner feedback sweep). `legalAcceptanceDocumentHref`
 * is the honesty gate behind the fix: link only a document whose pinned URL
 * still names a page this deployment actually publishes, never a stale value
 * or an invented one.
 */

import { legalAcceptanceDocumentHref } from './legal-document-link'

describe('legalAcceptanceDocumentHref', () => {
  it('links a document whose pinned URL is a real published legal page', () => {
    expect(legalAcceptanceDocumentHref('https://aglyn.com/legal/terms')).toBe(
      'https://aglyn.com/legal/terms',
    )
    expect(
      legalAcceptanceDocumentHref('https://aglyn.com/legal/privacy'),
    ).toBe('https://aglyn.com/legal/privacy')
  })

  it('refuses a URL on another host — a lookalike is not our published text', () => {
    expect(
      legalAcceptanceDocumentHref(
        'https://not-aglyn.example.com/legal/terms',
      ),
    ).toBeUndefined()
  })

  it('refuses a path this deployment does not publish', () => {
    expect(
      legalAcceptanceDocumentHref('https://aglyn.com/legal/not-a-real-page'),
    ).toBeUndefined()
  })

  it('refuses a missing or empty url outright, never inventing one', () => {
    expect(legalAcceptanceDocumentHref(undefined)).toBeUndefined()
    expect(legalAcceptanceDocumentHref(null)).toBeUndefined()
    expect(legalAcceptanceDocumentHref('')).toBeUndefined()
  })
})
