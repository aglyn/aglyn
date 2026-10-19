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

import { aiDatasetDraftContent } from '../runtime/ai-dataset-generation'
import { aiLayoutArticles, aiLayoutFitText, aiLayoutWords } from './ai-layout-copy'

/*
 * The beta.270 Sugar Hollow Photography packages (AGL-3988) said "A easygoing
 * session for couples planning a Blue Ridge wedding." in their records, and
 * the home page's cards that listed them said it again.
 */
describe('"a" and "an" agree with the word after them in English copy (AGL-3988)', () => {
  it('says production’s line plainly', () => {
    expect(aiLayoutArticles('A easygoing session for couples planning a Blue Ridge wedding.')).toBe(
      'An easygoing session for couples planning a Blue Ridge wedding.',
    )
    expect(aiLayoutArticles('Book a easygoing outdoor session, an relaxed walk or an mini session.')).toBe(
      'Book an easygoing outdoor session, a relaxed walk or a mini session.',
    )
  })

  it('leaves what the letters do not settle as the model wrote it', () => {
    // A u or an h is said either way: "a unique", "an hour", "an honest".
    expect(aiLayoutArticles('A unique view, an hour away, an honest price, an umbrella.')).toBe(
      'A unique view, an hour away, an honest price, an umbrella.',
    )
    // "one" and "eu" open with a consonant sound.
    expect(aiLayoutArticles('A one-hour session and a European trip, a once-a-year shoot.')).toBe(
      'A one-hour session and a European trip, a once-a-year shoot.',
    )
    // An initialism, and a capital "A" inside a sentence, which is a letter.
    expect(aiLayoutArticles('Read an FAQ, then Plan A is ready and grade A eggs.')).toBe('Read an FAQ, then Plan A is ready and grade A eggs.')
    // Words that only end or hold "a".
    expect(aiLayoutArticles('Data and a camera, Ana and an extra.')).toBe('Data and a camera, Ana and an extra.')
  })

  it('opens a sentence with "An" and keeps its capital', () => {
    expect(aiLayoutArticles('We shoot film. A elopement is small.')).toBe('We shoot film. An elopement is small.')
  })

  it('leaves another language’s words alone', () => {
    expect(aiLayoutArticles('A orillas del río', 'es')).toBe('A orillas del río')
  })

  it('is applied wherever the compiler fits a line, and to a dataset’s words', () => {
    expect(aiLayoutFitText('A easygoing session', 'itemText')).toBe('An easygoing session')
    expect(aiLayoutWords('A easygoing session', 'itemText', '')).toBe('An easygoing session')
    const content = aiDatasetDraftContent(
      'Photography packages',
      {
        fields: [
          { name: 'Name', type: 'text' },
          { name: 'Description', type: 'text' },
          { name: 'Includes', type: 'list' },
          { name: 'Hours', type: 'number' },
        ],
        records: [['Engagement session', 'A easygoing session for couples.', 'A online gallery; a print', '2']],
      } as never,
      { recordPages: false },
    )
    expect((content['records'] as Array<Record<string, unknown>>)[0]).toEqual({
      Name: 'Engagement session',
      Description: 'An easygoing session for couples.',
      Includes: ['An online gallery', 'a print'],
      Hours: '2',
    })
  })
})
