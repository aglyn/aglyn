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
  AI_SITE_MEMORY_LISTED,
  aiListedPreferences,
  aiPreferencesFromEdit,
  aiSitePreferenceOf,
  type AiSitePreference,
} from './ai-site-memory'

const ids = (question: string, opCounts: Record<string, number> = { set: 2 }) =>
  aiPreferencesFromEdit({ question, opCounts }).map((match) => match.id)

describe('aiPreferencesFromEdit (AGL-3661)', () => {
  it('recognizes a tone the owner asked for', () => {
    expect(ids('make this sound more casual and friendly')).toEqual(['tone-casual'])
    expect(ids('Make the hero more professional')).toEqual(['tone-formal'])
  })

  it('recognizes the length of copy the owner wants', () => {
    expect(ids('this is too long, make it shorter')).toEqual(['copy-short'])
    expect(ids('Expand the about text with more detail')).toEqual(['copy-detailed'])
  })

  it('remembers a removed section only when the edit removed something', () => {
    expect(ids('remove the testimonials section', { remove: 1 })).toEqual(['removes-testimonials'])
    expect(ids('get rid of the FAQ', { remove: 2 })).toEqual(['removes-faq'])
    // Asked, but the applied edit removed nothing: not a preference.
    expect(ids('remove the testimonials section', { set: 1 })).toEqual([])
  })

  it('finds several in one request, one per group', () => {
    expect(ids('shorter and friendlier please, and drop the pricing', { set: 3, remove: 1 })).toEqual([
      'tone-casual',
      'copy-short',
      'removes-pricing',
    ])
  })

  it('remembers nothing from an edit that applied nothing or a question with no rule', () => {
    expect(ids('make this friendlier', {})).toEqual([])
    expect(ids('change the button color to blue')).toEqual([])
    expect(ids('')).toEqual([])
  })
})

describe('aiListedPreferences (AGL-3661)', () => {
  const row = (id: string, count: number, lastSeenAtMs: number): AiSitePreference => ({
    id,
    group: id,
    text: id,
    count,
    lastSeenAtMs,
    source: 'assist-edit',
  })

  it('lists the most repeated first, then the most recent, capped', () => {
    const rows = [row('a', 1, 10), row('b', 3, 1), row('c', 1, 20), ...Array.from({ length: 8 }, (_, i) => row(`z${i}`, 1, 0))]
    const listed = aiListedPreferences(rows)
    expect(listed.slice(0, 3)).toEqual(['b', 'c', 'a'])
    expect(listed).toHaveLength(AI_SITE_MEMORY_LISTED)
  })
})

describe('aiSitePreferenceOf (AGL-3661)', () => {
  it('reads a stored row and refuses one with no text', () => {
    expect(aiSitePreferenceOf('copy-short', { text: ' Prefers short copy ', group: 'length', count: 2, lastSeenAtMs: 5 })).toEqual({
      id: 'copy-short',
      group: 'length',
      text: 'Prefers short copy',
      count: 2,
      lastSeenAtMs: 5,
      source: 'assist-edit',
    })
    expect(aiSitePreferenceOf('x', { text: '' })).toBeNull()
  })
})
