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

import { parseClientErrorEvents } from './client-error-report'

describe('parseClientErrorEvents (AGL-1538)', () => {
  it('parses a well-formed batch', () => {
    const events = parseClientErrorEvents({
      events: [
        {
          kind: 'error',
          message: 'boom',
          stack: 'Error: boom\n  at fn (https://app.aglyn.com/x.js:1:2)',
          url: 'https://app.aglyn.com/orgs/acme',
        },
      ],
    })
    expect(events).toHaveLength(1)
    expect(events[0].message).toBe('boom')
    expect(events[0].url).toBe('https://app.aglyn.com/orgs/acme')
  })

  it('drops events without a message, and non-object entries', () => {
    const events = parseClientErrorEvents({
      events: [{ kind: 'error' }, null, 'nope', 42, { message: '' }],
    })
    expect(events).toEqual([])
  })

  it('returns [] for malformed payloads', () => {
    expect(parseClientErrorEvents(null)).toEqual([])
    expect(parseClientErrorEvents({})).toEqual([])
    expect(parseClientErrorEvents({ events: 'x' })).toEqual([])
  })

  it('caps the batch at 10 events', () => {
    const events = parseClientErrorEvents({
      events: Array.from({ length: 40 }, (_, i) => ({ message: `e${i}` })),
    })
    expect(events).toHaveLength(10)
  })

  it('clamps message and stack lengths', () => {
    const [event] = parseClientErrorEvents({
      events: [{ message: 'm'.repeat(5_000), stack: 's'.repeat(50_000) }],
    })
    expect(event.message).toHaveLength(1_024)
    expect(event.stack).toHaveLength(8_192)
  })

  it('strips query strings and fragments from urls — the PII boundary', () => {
    const [event] = parseClientErrorEvents({
      events: [
        {
          message: 'boom',
          url: 'https://app.aglyn.com/reset?token=SECRET#frag',
          source: 'https://app.aglyn.com/chunk.js?v=1',
        },
      ],
    })
    expect(event.url).toBe('https://app.aglyn.com/reset')
    expect(event.source).toBe('https://app.aglyn.com/chunk.js')
  })

  it('drops unparseable urls rather than passing them through', () => {
    const [event] = parseClientErrorEvents({
      events: [{ message: 'boom', url: 'not a url' }],
    })
    expect(event.url).toBeUndefined()
  })
})
