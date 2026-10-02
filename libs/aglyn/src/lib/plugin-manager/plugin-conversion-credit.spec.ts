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
 * A creditor's description, as the sentences a door's alert appends
 * (AGL-3461). What a record is credited to and what it is filed under are two
 * facts, and the claim held here is that neither is ever worded as the other.
 */

import { conversionDescriptionSentences } from './plugin-conversion-credit'

describe('conversionDescriptionSentences', () => {
  it('says nothing for nothing', () => {
    expect(conversionDescriptionSentences(null)).toEqual([])
    expect(conversionDescriptionSentences({ filedUnder: [] })).toEqual([])
  })

  it('names what it is CREDITED to, and how the visitor was touched', () => {
    expect(
      conversionDescriptionSentences({
        credited: { label: 'One job — AI', how: 'viewed /ai-website-draft, a page filed under it' },
        filedUnder: [],
      }),
    ).toEqual([
      'Credited to “One job — AI”: the visitor viewed /ai-website-draft, a page filed under it.',
    ])
  })

  it('says what it is FILED under in a sentence of its own, never as a credit', () => {
    const sentences = conversionDescriptionSentences({
      filedUnder: [
        { id: 'a', label: 'Spring' },
        { id: 'b', label: 'Retargeting' },
      ],
    })

    expect(sentences).toEqual(['Filed under “Spring” and “Retargeting”.'])
    expect(sentences.join(' ')).not.toContain('Credited')
  })

  it('summarizes a long list rather than printing every container', () => {
    expect(
      conversionDescriptionSentences({
        filedUnder: ['A', 'B', 'C', 'D', 'E'].map((label) => ({ id: label, label })),
      }),
    ).toEqual(['Filed under “A”, “B” and 3 more.'])
  })

  it('keeps the credit first when it has both', () => {
    expect(
      conversionDescriptionSentences({
        credited: { label: 'Spring', how: 'clicked one of its emails' },
        filedUnder: [{ id: 'a', label: 'Spring' }],
      }),
    ).toEqual(['Credited to “Spring”: the visitor clicked one of its emails.', 'Filed under “Spring”.'])
  })
})
