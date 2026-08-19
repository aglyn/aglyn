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
 * AGL-2168 — the Inbox `/product/forms` leads with.
 *
 * Its hero mockup shows every row as a person: an initials avatar, a name,
 * the form beneath it, a relative time, and an unread dot. The console
 * rendered no sender at all — the one content cell was every field
 * concatenated, so the name was in there somewhere, wherever the author
 * happened to define it.
 */

import {
  initialsOf,
  relativeTime,
  routingChips,
  senderHue,
  submissionSender,
} from './submission-presenter'

describe('submissionSender', () => {
  it('finds the name a contact form conventionally uses', () => {
    const sender = submissionSender({
      name: 'Priya Nair',
      email: 'priya@lumen.co',
      message: 'Hi',
    })
    expect(sender.label).toBe('Priya Nair')
    expect(sender.email).toBe('priya@lumen.co')
    expect(sender.initials).toBe('PN')
  })

  it('matches a key whatever the author capitalised or spaced it', () => {
    // A form is author-defined. `Full Name`, `full_name` and `fullname`
    // are the same field to everyone except an exact-match lookup.
    expect(submissionSender({ 'Full Name': 'Marcus Reyes' }).label).toBe(
      'Marcus Reyes',
    )
    expect(submissionSender({ full_name: 'Dana Lee' }).label).toBe('Dana Lee')
    expect(submissionSender({ FIRSTNAME: 'Tom' }).label).toBe('Tom')
  })

  it('prefers a name over an email when both are present', () => {
    expect(
      submissionSender({ email: 'a@b.co', name: 'Sofia Marín' }).label,
    ).toBe('Sofia Marín')
  })

  it('falls back to the email, then to a placeholder', () => {
    expect(submissionSender({ email: 'amara@okafor.dev' }).label).toBe(
      'amara@okafor.dev',
    )
    // A newsletter form is one field wide and that field is the email;
    // a survey may carry no identity at all.
    expect(submissionSender({ rating: '5' }).label).toBe('Someone')
    expect(submissionSender(undefined).label).toBe('Someone')
  })

  it('ignores a field that is present but empty', () => {
    // An optional name left blank must not produce a nameless avatar.
    expect(submissionSender({ name: '   ', email: 'x@y.co' }).label).toBe(
      'x@y.co',
    )
  })
})

describe('initialsOf', () => {
  it('takes one letter per word, at most two', () => {
    expect(initialsOf('Priya Nair')).toBe('PN')
    expect(initialsOf('Ana María de la Cruz')).toBe('AM')
    expect(initialsOf('Cher')).toBe('C')
  })

  it('uses an email local part rather than the @', () => {
    expect(initialsOf('priya@lumen.co')).toBe('P')
    expect(initialsOf('first.last@lumen.co')).toBe('FL')
  })

  it('always returns something', () => {
    // An avatar with no letters in it is worse than a generic one.
    expect(initialsOf('')).toBe('?')
    expect(initialsOf('   ')).toBe('?')
  })
})

describe('senderHue', () => {
  it('is stable for one sender', () => {
    // A random palette index would make the same person a different colour
    // on every render, which is the opposite of what an avatar is for.
    expect(senderHue('Priya Nair')).toBe(senderHue('Priya Nair'))
    expect(senderHue('Priya Nair')).toBeGreaterThanOrEqual(0)
    expect(senderHue('Priya Nair')).toBeLessThan(360)
  })

  it('separates two different senders', () => {
    expect(senderHue('Priya Nair')).not.toBe(senderHue('Marcus Reyes'))
  })
})

describe('relativeTime', () => {
  const NOW = Date.UTC(2026, 7, 18, 12, 0, 0)
  const ago = (ms: number) => relativeTime(NOW - ms, NOW)

  it('reads as the mockup does', () => {
    expect(ago(2 * 60_000)).toBe('2m')
    expect(ago(18 * 60_000)).toBe('18m')
    expect(ago(60 * 60_000)).toBe('1h')
    expect(ago(3 * 3_600_000)).toBe('3h')
    expect(ago(26 * 3_600_000)).toBe('1d')
  })

  it('collapses anything under a minute to `now`', () => {
    expect(ago(1000)).toBe('now')
    expect(ago(59_000)).toBe('now')
  })

  it('says `now` for a timestamp slightly in the FUTURE', () => {
    // The server stamps `createdAt` and the browser does the subtraction,
    // so a fresh submission can land a few seconds ahead of the local
    // clock. "in 4 seconds" on an inbox row is a bug report waiting to
    // happen.
    expect(relativeTime(NOW + 4000, NOW)).toBe('now')
  })

  it('keeps scaling past a day', () => {
    expect(ago(6 * 86_400_000)).toBe('6d')
    expect(ago(10 * 86_400_000)).toBe('1w')
    expect(ago(200 * 86_400_000)).toBe('6mo')
  })

  it('renders a missing timestamp as a dash, not `now`', () => {
    // `serverTimestamp` reads back null until the write lands.
    expect(relativeTime(undefined, NOW)).toBe('--')
    expect(relativeTime(Number.NaN, NOW)).toBe('--')
  })
})

describe('routingChips', () => {
  it('always says the submission is in the Inbox', () => {
    const chips = routingChips(undefined)
    expect(chips.map((chip) => chip.label)).toEqual(['Saved to Inbox'])
  })

  it('names the dataset a record really went into', () => {
    const chips = routingChips({
      dataset: { id: 'd1', name: 'Leads', recordId: 'r1' },
    })
    expect(chips.map((chip) => chip.label)).toEqual([
      'Saved to Inbox',
      'Added to “Leads” dataset',
    ])
  })

  it('claims NOTHING when no record was appended', () => {
    // A dataset that was deleted, or one whose record quota is full: the
    // submit route swallows both on purpose so a submission is never lost
    // to them. A chip for a row that does not exist is worse than silence.
    expect(routingChips({ dataset: { id: 'd1', name: 'Leads' } })).toHaveLength(
      1,
    )
    expect(routingChips({ dataset: {} })).toHaveLength(1)
  })

  it('still reports an unnamed dataset', () => {
    const chips = routingChips({ dataset: { id: 'd1', recordId: 'r1' } })
    expect(chips[1].label).toBe('Added to a dataset')
  })
})
