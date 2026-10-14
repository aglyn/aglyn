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

import {
  AI_LAYOUT_LABELS_EN,
  aiLayoutLabel,
  aiLayoutLanguageOf,
  aiLayoutSpeaksOtherThanEnglish,
  type AiLayoutLabel,
} from './ai-layout-labels'

const KEYS = Object.keys(AI_LAYOUT_LABELS_EN) as AiLayoutLabel[]

describe("the words the platform places, in the site's language (AGL-3760)", () => {
  it.each(['es', 'fr', 'pt', 'de', 'it'])('has every label in %s, none left in English', (language) => {
    for (const key of KEYS) {
      const label = aiLayoutLabel(key, language)
      expect(label.trim()).not.toBe('')
      expect(label).not.toBe(AI_LAYOUT_LABELS_EN[key])
    }
  })

  it('reads a region or a script as its language, and any other as English', () => {
    expect(aiLayoutLabel('seeAll', 'es-MX')).toBe('Ver todo')
    expect(aiLayoutLabel('seeAll', 'pt-BR')).toBe('Ver tudo')
    expect(aiLayoutLabel('seeAll', 'ja')).toBe('See all')
    expect(aiLayoutLabel('seeAll', 'en')).toBe('See all')
    expect(aiLayoutLabel('seeAll', null)).toBe('See all')
    expect(aiLayoutLabel('seeAll')).toBe('See all')
  })

  it('tells a site in another language from an English one, or one that named none', () => {
    expect(aiLayoutLanguageOf('es-MX')).toBe('es')
    expect(aiLayoutSpeaksOtherThanEnglish('es')).toBe(true)
    expect(aiLayoutSpeaksOtherThanEnglish('ja')).toBe(true)
    expect(aiLayoutSpeaksOtherThanEnglish('en-GB')).toBe(false)
    expect(aiLayoutSpeaksOtherThanEnglish('')).toBe(false)
    expect(aiLayoutSpeaksOtherThanEnglish(undefined)).toBe(false)
  })
})
