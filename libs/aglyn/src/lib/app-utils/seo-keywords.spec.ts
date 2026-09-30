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
 * Target keywords: one count, used by the SEO check and by anything that
 * holds a written listing to it.
 */

import { SEO_MAX_KEYWORDS, seoKeywordCount, seoKeywordCoverage, seoKeywordList } from './seo-keywords'

describe('target keywords', () => {
  it('counts whole words in any case, and nothing inside a longer word', () => {
    expect(seoKeywordCount('Brass lamps, BRASS LAMPS and brasslamps', 'brass lamps')).toBe(2)
    expect(seoKeywordCount('Lampshade', 'lamp')).toBe(0)
    expect(seoKeywordCount('', 'lamp')).toBe(0)
  })

  it('reads a typed list trimmed, deduplicated and capped', () => {
    expect(seoKeywordList(' Lamps, lamps ,brass\n, ,  desk lamps ')).toEqual(['Lamps', 'brass', 'desk lamps'])
    expect(seoKeywordList('a,b,c,d,e,f,g')).toHaveLength(SEO_MAX_KEYWORDS)
  })

  it('reports where a page already says each keyword', () => {
    expect(seoKeywordCoverage(['lamps', 'austin'], { title: 'Desk lamps', body: 'Made in Austin.' })).toEqual([
      { keyword: 'lamps', inTitle: true, inDescription: false, inH1: false, inBody: false },
      { keyword: 'austin', inTitle: false, inDescription: false, inH1: false, inBody: true },
    ])
  })
})
