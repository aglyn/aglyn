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
 * The gift card search tokens every writer stamps (AGL-3321), and the
 * backfill's restatement of them, answer the same worked examples.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { nameSearchToken } from '@aglyn/aglyn/app-utils/name-search'
import { giftCardSearchTokens } from './gift-card-search'

const fixtures: {
  cases: Array<{ name: string; code: string; recipientEmail: string | null; expected: string[] }>
} = JSON.parse(
  readFileSync(
    join(
      __dirname,
      ...Array(6).fill('..'),
      'tools',
      'scripts',
      'lib',
      'gift-card-search-tokens.fixtures.json',
    ),
    'utf8',
  ),
)

describe('giftCardSearchTokens', () => {
  it.each(fixtures.cases.map((entry) => [entry.name, entry] as const))('%s', (_name, entry) => {
    expect(giftCardSearchTokens(entry.code, entry.recipientEmail)).toEqual(entry.expected)
  })

  it('finds a card by what a merchant would type: part of the code, the code, the address', () => {
    const tokens = giftCardSearchTokens('GC-A1B2C3D4E5F6', 'jane.doe@acme.com')
    for (const typed of ['GC-A1B2', 'gc-a1b2c3d4e5f6', 'A1B2C3', 'jane', 'acme.com', 'doe']) {
      expect(tokens).toContain(nameSearchToken(typed))
    }
  })
})
