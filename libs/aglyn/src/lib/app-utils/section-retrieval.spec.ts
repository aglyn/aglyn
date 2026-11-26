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

import { buildSectionIndex, rankSections, retrievalTokens } from './section-retrieval'

const sections = [
  { title: 'Acme Ranch', heading: 'Hours', text: 'Acme Ranch is open 9 to 4 on weekends. Acme Ranch gates close at sunset.' },
  { title: 'Acme Ranch', heading: 'Pets', text: 'Dogs are welcome on a leash at Acme Ranch.' },
  { title: 'Camping', heading: '', text: 'Acme Ranch camping: tent sites and cabins. Acme Ranch.' },
]

describe('section retrieval (AGL-4250)', () => {
  it('drops stop words and one-letter tokens', () => {
    expect(retrievalTokens('Do you allow a dog?')).toEqual(['allow', 'dog'])
  })

  it('ranks the section that answers above one that only names the business', () => {
    const index = buildSectionIndex(sections)
    const ranked = rankSections(index, 'are dogs allowed at Acme Ranch', { idf: true })
    expect(ranked[0].section.heading).toBe('Pets')
  })

  it('counts a title or heading word above a body word', () => {
    const index = buildSectionIndex(sections)
    expect(rankSections(index, 'camping')[0].section.title).toBe('Camping')
    expect(rankSections(index, 'hours')[0].section.heading).toBe('Hours')
  })

  it('answers nothing for a question with no indexed word', () => {
    expect(rankSections(buildSectionIndex(sections), 'zebra')).toEqual([])
    expect(rankSections(buildSectionIndex([]), 'hours')).toEqual([])
  })

  it('keeps every section above zero without idf, so the docs scores are unchanged', () => {
    const ranked = rankSections(buildSectionIndex(sections), 'acme', { limit: 10 })
    expect(ranked).toHaveLength(3)
    expect(buildSectionIndex(sections).frequency.get('acme')).toBe(3)
  })
})
