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

import { SITE_FONT_PAIRINGS } from '@aglyn/aglyn/app-utils/site-font-pairings'
import { SITE_KINDS } from '@aglyn/aglyn/app-utils/site-kinds'
import { SITE_THEME_BASES } from '@aglyn/aglyn/app-utils/site-starter'
import { AI_SITE_BASES, AI_SITE_FONT_PAIRINGS, AI_SITE_KIND_LOOKS, AI_SITE_KINDS } from './ai-site-kinds'

/**
 * The AI start's kinds are the platform's with a look merged over each
 * (AGL-4049): a kind the core adds without a look would drop out of the guided
 * start's cards, and a look for a kind the core no longer has is dead weight.
 */
describe('AI site kinds against the core (AGL-4049)', () => {
  it('gives every core kind a look, and no other id one', () => {
    expect(Object.keys(AI_SITE_KIND_LOOKS).sort()).toEqual(SITE_KINDS.map((kind) => kind.id).sort())
  })

  it('keeps the core order, one AI kind per core kind', () => {
    expect(AI_SITE_KINDS).toHaveLength(SITE_KINDS.length)
    SITE_KINDS.forEach((kind, i) => {
      expect(AI_SITE_KINDS[i]?.id).toBe(kind.id)
      expect(AI_SITE_KINDS[i]).toMatchObject(kind)
    })
  })

  it('names only core font pairings and bases in a look', () => {
    const fonts = new Set(SITE_FONT_PAIRINGS.map((pairing) => pairing.id))
    for (const { look } of AI_SITE_KINDS) {
      for (const id of look.fonts) expect(fonts.has(id)).toBe(true)
      for (const base of look.bases) expect(SITE_THEME_BASES).toContain(base)
    }
  })

  it('re-exports the core pairings and bases under the old names', () => {
    expect(AI_SITE_FONT_PAIRINGS).toBe(SITE_FONT_PAIRINGS)
    expect(AI_SITE_BASES).toBe(SITE_THEME_BASES)
  })
})
