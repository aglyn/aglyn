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
  pluginVisitorDoors,
  type ResolvedVisitorDoor,
  visitorDoorCaughtNotice,
  visitorDoorPausedNotice,
  visitorDoorStaffFlags,
} from './plugin-visitor-doors'

/**
 * A public door's flood notices, built from the words the plugin that keeps
 * the door declares (AGL-1666, AGL-1831, AGL-3080) — here the form door the
 * forms plugin declares, whose sentences these must be exactly. The
 * interesting assertions are the negative ones: the owner's notice is easy to
 * write in a way that reassures and is wrong.
 */

const formDoor = (): ResolvedVisitorDoor => {
  const door = pluginVisitorDoors().find((one) => one.door === 'form')
  if (!door) throw new Error('the forms plugin declares the form door')
  return door
}

/** Mid-August, so the reset is unambiguously 1 September. */
const now = new Date('2026-08-14T12:00:00.000Z')

describe('the declared doors', () => {
  it('holds the form door, kept by the forms plugin, with its two counters', () => {
    expect(formDoor()).toMatchObject({
      pluginId: 'forms',
      refusedCounter: 'formSubmissionsRefused',
      caughtCounter: 'formSubmissionsSpam',
    })
  })
})

describe('AGL-1666 · the owner’s notice', () => {
  it('renders nothing until something has actually been refused', () => {
    // The counter document survives the month that created it, so a stale
    // `{ceiling, lastRefusedAtMs}` with a zero (or absent) count for THIS
    // month must not paint a scary banner over a quiet inbox.
    expect(visitorDoorPausedNotice(formDoor(), { refused: 0, ceiling: 5000 })).toBeNull()
    expect(visitorDoorPausedNotice(formDoor(), { refused: undefined as never, ceiling: 5000 })).toBeNull()
  })

  it('gives the owner the count, the ceiling and the reset date', () => {
    const notice = visitorDoorPausedNotice(formDoor(), { refused: 1234, ceiling: 5000, now })
    expect(notice).toEqual({
      title: 'Form submissions are paused',
      message:
        '1,234 submissions to this site have been refused this month after it passed ' +
        '5,000 submissions. Refused submissions are not stored and are not billed. This ' +
        'usually means a bot is filling in one of your forms — if it is real traffic, ' +
        'contact support and we will raise the limit.',
      until: 'Submissions start being accepted again on September 1, 2026.',
    })
  })

  it('says "1 submission … has", not "1 submissions … have"', () => {
    expect(visitorDoorPausedNotice(formDoor(), { refused: 1, ceiling: 5000, now })?.message).toContain(
      '1 submission to this site has been refused',
    )
  })

  it('still renders without a ceiling in the counter document', () => {
    const notice = visitorDoorPausedNotice(formDoor(), { refused: 7, now })
    expect(notice?.message).toContain('7 submissions')
    expect(notice?.message).not.toContain('after it passed')
  })

  it('renders the reset day in UTC, not the reader’s zone', () => {
    // A reader in UTC-5 formatting the 1 September instant locally sees
    // 31 August — a date on which the form is still paused.
    const until = visitorDoorPausedNotice(formDoor(), { refused: 3, now })?.until
    expect(until).toContain('September 1')
    expect(until).not.toContain('August')
  })
})

describe('AGL-1831 · the honeypot’s catches', () => {
  it('reports protection working, and nothing below one', () => {
    expect(visitorDoorCaughtNotice(formDoor(), { caught: 0 })).toBeNull()
    expect(visitorDoorCaughtNotice(formDoor(), { caught: 2 })).toBe(
      '2 bot submissions were caught and dropped by the honeypot this month — nothing was stored or billed.',
    )
    expect(visitorDoorCaughtNotice(formDoor(), { caught: 1 })).toBe(
      '1 bot submission was caught and dropped by the honeypot this month — nothing was stored or billed.',
    )
  })
})

describe('AGL-1681 · the staff flags', () => {
  it('flags a refusing site tersely, with the ceiling and the reset in the detail', () => {
    const flags = visitorDoorStaffFlags(formDoor(), { refused: 12, ceiling: 500, caught: 3 }, now)
    expect(flags.refused).toEqual({
      label: 'forms paused · 12 refused',
      detail:
        '12 form submissions refused this month — the site passed its 500-submission ' +
        'ceiling. Nothing refused is stored or billed. Accepting again on September 1, 2026.',
    })
    expect(flags.caught?.label).toBe('3 bot hits caught')
  })

  it('flags nothing below one, nor for a row that was not joined', () => {
    expect(visitorDoorStaffFlags(formDoor(), { refused: 0, ceiling: 500, caught: 0 }, now)).toEqual({
      refused: null,
      caught: null,
    })
    expect(visitorDoorStaffFlags(formDoor(), null, now)).toEqual({ refused: null, caught: null })
  })
})
