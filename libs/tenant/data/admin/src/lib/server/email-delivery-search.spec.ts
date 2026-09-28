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
 * A delivery message is searchable by the tokens its writers stamp
 * (AGL-3321), and those are the tokens the backfill writes: both sides answer
 * `tools/scripts/lib/email-search-tokens.fixtures.json`.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { nameSearchToken } from '@aglyn/aglyn/app-utils/name-search'
import {
  EMAIL_DELIVERY_SEARCH_TOKEN_LIMIT,
  emailDeliverySearchTokens,
} from './email-delivery-log'

const fixtures = JSON.parse(
  readFileSync(
    join(__dirname, '..', '..', '..', '..', '..', '..', '..', 'tools', 'scripts', 'lib', 'email-search-tokens.fixtures.json'),
    'utf8',
  ),
) as { deliveries: Array<{ name: string; message: Record<string, unknown>; tokens: string[] }> }

describe('emailDeliverySearchTokens', () => {
  it.each(fixtures.deliveries.map((entry) => [entry.name, entry] as const))(
    '%s',
    (_name, { message, tokens }) => {
      expect(emailDeliverySearchTokens(message)).toEqual(tokens)
    },
  )

  it('finds a message by its recipient’s domain, a word of its subject, or its sender', () => {
    const tokens = emailDeliverySearchTokens({
      to: 'dana@acme.com',
      subject: 'Your invoice is ready',
      context: 'billing',
    })
    for (const typed of ['acme', 'dana', 'invoice', 'ready', 'billing']) {
      expect(tokens).toContain(nameSearchToken(typed))
    }
  })

  it('never stores more than the cap, and the recipient is never the part cut', () => {
    // Words that share no prefix, so each value brings its full budget.
    const long = (salt: number) =>
      Array.from({ length: 60 }, (_unused, at) =>
        String.fromCharCode(0x4e00 + salt * 100 + at).repeat(3),
      ).join(' ')
    const tokens = emailDeliverySearchTokens({
      to: 'dana@acme.com',
      subject: long(1),
      context: long(2),
    })
    expect(tokens).toHaveLength(EMAIL_DELIVERY_SEARCH_TOKEN_LIMIT)
    expect(tokens).toContain(nameSearchToken('acme'))
  })
})
