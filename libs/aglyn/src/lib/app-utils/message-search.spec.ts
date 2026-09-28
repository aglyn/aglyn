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
 * A message is found by the words its writer stamped (AGL-3321): the token
 * a typed word becomes is one the writer stored, the arrays stay bounded,
 * and the backfill's copy computes the same arrays.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  MESSAGE_SEARCH_TOKENS_MAX,
  MESSAGE_SENDER_TOKENS_MAX,
  messageSearchFields,
  messageSender,
} from './message-search'
import { nameSearchToken } from './name-search'

describe('messageSearchFields', () => {
  const message = {
    name: 'Hannah Ortiz',
    email: 'hannah.ortiz@example.com',
    message: 'Do you take orders for a three-tier wedding cake?',
  }

  it('finds the sender by name, by address and by the address’s parts', () => {
    const { senderTokens } = messageSearchFields(message)
    for (const typed of ['Hannah', 'ort', 'hannah.ortiz@example.com', 'example']) {
      expect(senderTokens).toContain(nameSearchToken(typed))
    }
    // The message's words are not who sent it.
    expect(senderTokens).not.toContain('wedding')
  })

  it('searches the sender and the words of the message, punctuation aside', () => {
    const { searchTokens } = messageSearchFields(message)
    for (const typed of ['hannah', 'wedd', 'cake', 'tier', 'three-tier']) {
      expect(searchTokens).toContain(nameSearchToken(typed))
    }
    expect(searchTokens).not.toContain('cake?')
  })

  it('computes the same arrays whatever order the map’s keys arrive in', () => {
    const reversed = Object.fromEntries(Object.entries(message).reverse())
    expect(messageSearchFields(reversed)).toEqual(messageSearchFields(message))
  })

  it('keeps each array under its ceiling, the sender first', () => {
    const long = Array.from({ length: 300 }, (_, at) => `longword${at}`).join(' ')
    const { senderTokens, searchTokens } = messageSearchFields({
      name: 'Dana Reed',
      message: long,
    })
    expect(senderTokens.length).toBeLessThanOrEqual(MESSAGE_SENDER_TOKENS_MAX)
    expect(searchTokens.length).toBeLessThanOrEqual(MESSAGE_SEARCH_TOKENS_MAX)
    expect(searchTokens.slice(0, senderTokens.length)).toEqual(senderTokens)
  })

  it('stamps empty arrays on a message with nothing in it', () => {
    expect(messageSearchFields(null)).toEqual({ senderTokens: [], searchTokens: [] })
    expect(messageSearchFields({ blank: '  ' })).toEqual({ senderTokens: [], searchTokens: [] })
  })
})

describe('messageSender', () => {
  it('reads the conventional fields whatever they are spelled', () => {
    expect(messageSender({ 'Full Name': 'Priya Nair', 'Email Address': 'p@lumen.co' })).toEqual({
      name: 'Priya Nair',
      email: 'p@lumen.co',
    })
    expect(messageSender({ message: 'no sender' })).toEqual({})
  })
})

describe('the backfill’s copy answers the same worked examples', () => {
  const fixtures = JSON.parse(
    readFileSync(
      join(__dirname, '..', '..', '..', '..', '..', 'tools', 'scripts', 'lib', 'message-search.fixtures.json'),
      'utf8',
    ),
  ) as {
    fields: Array<{ fields: Record<string, unknown> | null; expected: unknown }>
    sender: Array<{ fields: Record<string, unknown> | null; expected: unknown }>
  }

  it('messageSearchFields', () => {
    expect(fixtures.fields.length).toBeGreaterThan(5)
    for (const one of fixtures.fields) expect(messageSearchFields(one.fields)).toEqual(one.expected)
  })

  it('messageSender', () => {
    expect(fixtures.sender.length).toBeGreaterThan(3)
    for (const one of fixtures.sender) expect(messageSender(one.fields)).toEqual(one.expected)
  })
})
