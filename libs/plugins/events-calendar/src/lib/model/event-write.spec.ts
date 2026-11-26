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
  EVENT_DEFAULT_DURATION_MS,
  EVENT_TITLE_MAX_LENGTH,
  eventEndsAtMs,
  eventStatusOf,
  eventWrite,
  eventWriteProblem,
  type EventWriteInput,
} from './event-write'

const START = Date.parse('2026-11-05T18:00:00Z')

const input = (overrides: Partial<EventWriteInput> = {}): EventWriteInput => ({
  title: 'Book club',
  startsAtMs: START,
  endsAtMs: START + 2 * 60 * 60 * 1000,
  location: 'Back room',
  organizer: 'Ada',
  description: 'Chapter four',
  coverImage: '/covers/book-club.jpg',
  coverImageAlt: 'Six chairs in a circle',
  status: 'published',
  ...overrides,
})

describe('eventWrite, the one rule both writers store through', () => {
  it('stores trimmed, capped text and the times as given', () => {
    const write = eventWrite(
      input({ title: `  ${'x'.repeat(200)}  `, location: '  Back room ' }),
    )
    expect(write.fields.title).toHaveLength(EVENT_TITLE_MAX_LENGTH)
    expect(write.fields).toMatchObject({
      location: 'Back room',
      startsAtMs: START,
      endsAtMs: START + 2 * 60 * 60 * 1000,
      coverImageAlt: 'Six chairs in a circle',
      status: 'published',
    })
    expect(write.remove).toEqual([])
  })

  it('gives an event without an end after its start one hour', () => {
    for (const endsAtMs of [null, 0, START, START - 1]) {
      expect(eventWrite(input({ endsAtMs })).fields.endsAtMs).toBe(
        START + EVENT_DEFAULT_DURATION_MS,
      )
    }
    expect(eventEndsAtMs(START, Number.NaN)).toBe(
      START + EVENT_DEFAULT_DURATION_MS,
    )
  })

  it('removes the cover description with no cover, or when it is blank', () => {
    expect(eventWrite(input({ coverImage: ' ' })).remove).toEqual([
      'coverImageAlt',
    ])
    expect(eventWrite(input({ coverImageAlt: '' })).remove).toEqual([
      'coverImageAlt',
    ])
    expect(eventWrite(input({ coverImage: '' })).fields).not.toHaveProperty(
      'coverImageAlt',
    )
  })

  it('keeps a blank optional field out of the write, and removes it only when asked', () => {
    const kept = eventWrite(input({ location: '', organizer: null }))
    expect(kept.fields).not.toHaveProperty('location')
    expect(kept.remove).toEqual([])
    const cleared = eventWrite(input({ location: '', organizer: null }), {
      clearBlank: true,
    })
    expect(cleared.remove).toEqual(['location', 'organizer'])
  })

  it('refuses an event with no title or no start', () => {
    expect(eventWriteProblem({ title: ' ', startsAtMs: START })).toMatch(
      /title/,
    )
    expect(eventWriteProblem({ title: 'Book club', startsAtMs: 0 })).toMatch(
      /start/,
    )
    expect(
      eventWriteProblem({ title: 'Book club', startsAtMs: Number.NaN }),
    ).toMatch(/start/)
    expect(() => eventWrite(input({ title: '' }))).toThrow(/title/)
  })

  it('reads a status without regard to case and refuses anything else', () => {
    expect(eventStatusOf(' Published ')).toBe('published')
    expect(eventStatusOf('DRAFT')).toBe('draft')
    expect(eventStatusOf('deleted')).toBeNull()
    expect(eventStatusOf(null)).toBeNull()
  })
})

describe('eventWrite, the calendar v2 fields (AGL-4252)', () => {
  it('leaves every v2 field alone for a writer that does not know them', () => {
    const write = eventWrite(input())
    expect(write.fields).not.toHaveProperty('recurrence')
    expect(write.fields).not.toHaveProperty('seriesEndsAtMs')
    expect(write.remove).not.toContain('recurrence')
    expect(write.remove).not.toContain('categoryIds')
  })

  it('stores categories, zone, rule, ticket and the series end', () => {
    const write = eventWrite(
      input({
        categoryIds: ['mx', 'mx', 'kids'],
        timeZone: 'America/Chicago',
        recurrence: { freq: 'weekly', count: 2 },
        ticket: { kind: 'product', id: 'pass-1' },
      }),
    )
    expect(write.fields).toMatchObject({
      categoryIds: ['mx', 'kids'],
      timeZone: 'America/Chicago',
      recurrence: { freq: 'weekly', count: 2 },
      ticket: { kind: 'product', id: 'pass-1' },
      seriesEndsAtMs: START + 7 * 24 * 60 * 60 * 1000 + 2 * 60 * 60 * 1000,
    })
  })

  it('clears what a v2 writer emptied, and ends a one-off series at the event', () => {
    const write = eventWrite(
      input({ categoryIds: [], timeZone: 'Not/AZone', recurrence: null, ticket: { kind: 'x', id: 'y' } }),
    )
    expect(write.remove).toEqual(
      expect.arrayContaining(['categoryIds', 'timeZone', 'recurrence', 'ticket']),
    )
    expect(write.fields.seriesEndsAtMs).toBe(write.fields.endsAtMs)
  })
})

