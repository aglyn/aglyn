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
  damerauLevenshtein,
  editSimilarity,
  foldText,
  similarityTokens,
  textSimilarity,
  tokenSetSimilarity,
} from './similarity'

describe('text similarity', () => {
  it('folds accents and case', () => {
    expect(foldText('Café ÉCLAIR')).toBe('cafe eclair')
    expect(foldText(null)).toBe('')
  })

  it('counts a swap of neighbors as one edit', () => {
    expect(damerauLevenshtein('email', 'email')).toBe(0)
    expect(damerauLevenshtein('emial', 'email')).toBe(1)
    expect(damerauLevenshtein('', 'abc')).toBe(3)
    expect(damerauLevenshtein('kitten', 'sitting')).toBe(3)
    expect(damerauLevenshtein('ca', 'abc')).toBe(3)
  })

  it('scores edits over the longer length', () => {
    expect(editSimilarity('', '')).toBe(1)
    expect(editSimilarity('abcd', 'abce')).toBe(0.75)
  })

  it('splits words on anything that is not a letter or digit', () => {
    expect(similarityTokens('Phone (Mobile)_2')).toEqual(['phone', 'mobile', '2'])
  })

  it('scores word sets regardless of order, forgiving one typo in a long word', () => {
    expect(tokenSetSimilarity('mobile phone', 'Phone (mobile)')).toBe(1)
    expect(tokenSetSimilarity('phnoe number', 'phone number')).toBe(1)
    expect(tokenSetSimilarity('first name', 'last name')).toBe(0.5)
    expect(tokenSetSimilarity('', '')).toBe(1)
    expect(tokenSetSimilarity('a', '')).toBe(0)
  })

  it('takes the better of the word and edit scores', () => {
    expect(textSimilarity('E-mail', 'email')).toBe(1)
    expect(textSimilarity('Company Name', 'name company')).toBe(1)
    expect(textSimilarity('zip', 'country')).toBeLessThan(0.5)
  })
})
