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

jest.mock('@aglyn/tenant-data-admin', () => ({ firebaseAdmin: {} }))
jest.mock('@aglyn/tenant-data-admin/server/contact-email-index', () => ({
  findContactByEmail: jest.fn(),
}))

import { namesResemble, nameWords } from '../model/person-name-match'
import {
  candidateFrom,
  isTheAccountsOwnRecord,
  PERSON_NAME_MATCH_LIMIT,
  selectPersonMatches,
  type PersonCandidate,
} from './person-matches'

const ACCOUNT_CREATED = Date.UTC(2026, 8, 23, 20, 0, 0)

const request = {
  orgId: 'house',
  orgSlug: 'house-org',
  email: 'matt.t@personal.example',
  name: 'Matt Tropp',
  accountCreatedAtMs: ACCOUNT_CREATED,
}

const person = (overrides: Partial<PersonCandidate>): PersonCandidate => ({
  kind: 'contact',
  id: 'c1',
  name: null,
  email: null,
  sources: ['outreach'],
  firstSeenAtMs: ACCOUNT_CREATED - 30 * 86_400_000,
  ...overrides,
})

describe('whether two names are one person', () => {
  it.each([
    ['Matt Tropp', 'Matthew Tropp'],
    ['Bob Smith', 'Robert Smith'],
    ['José Álvarez', 'Jose Alvarez'],
    ['Jon Smyth', 'John Smyth'],
    ['Katie O’Neil', 'Katherine O’Neil'],
    ['Anna Maria Lopez', 'Anna Lopez'],
  ])('%s ~ %s', (a, b) => {
    expect(namesResemble(a, b)).toBe(true)
  })

  it.each([
    ['Matt Tropp', 'Matt Trapp'],
    ['Matt Tropp', 'Mark Tropp'],
    ['Madonna', 'Madonna'],
    ['Al Tropp', 'Alice Tropp'],
    ['', 'Matt Tropp'],
    [null, 'Matt Tropp'],
  ])('%s is not %s', (a, b) => {
    expect(namesResemble(a, b)).toBe(false)
  })

  it('reads words without accents, case, punctuation or initials', () => {
    expect(nameWords('  Dr. J. R. R. Tolkien-Smith ')).toEqual(['dr', 'tolkien', 'smith'])
  })
})

describe('leaving out the account’s own record', () => {
  it('skips the contact the sign-up itself created', () => {
    const own = person({ sources: ['account'], firstSeenAtMs: ACCOUNT_CREATED + 5_000 })
    expect(isTheAccountsOwnRecord(own, ACCOUNT_CREATED)).toBe(true)
  })

  it('keeps a record the workspace had before the account existed', () => {
    const earlier = person({ sources: ['account'], firstSeenAtMs: ACCOUNT_CREATED - 86_400_000 })
    expect(isTheAccountsOwnRecord(earlier, ACCOUNT_CREATED)).toBe(false)
    expect(isTheAccountsOwnRecord(person({ sources: ['account', 'outreach'] }), ACCOUNT_CREATED)).toBe(false)
  })
})

describe('what the matcher reports', () => {
  it('reports an address match with a link, and never the sign-up’s own contact', () => {
    const matches = selectPersonMatches({
      request,
      byEmail: [
        person({ id: 'own', email: request.email, sources: ['account'], firstSeenAtMs: ACCOUNT_CREATED }),
        person({ kind: 'lead', id: 'lead-key', name: 'Matt Tropp', email: request.email, sources: ['form'] }),
      ],
      byName: [],
    })
    expect(matches).toEqual([
      {
        kind: 'lead',
        id: 'lead-key',
        label: 'Matt Tropp',
        email: request.email,
        basis: 'email',
        firstSeenAtMs: ACCOUNT_CREATED - 30 * 86_400_000,
        sources: ['form'],
        href: expect.stringContaining('house-org'),
      },
    ])
  })

  it('flags a known person on a work address who signed up on a personal one', () => {
    const matches = selectPersonMatches({
      request,
      byEmail: [],
      byName: [
        person({ id: 'work', name: 'Matthew Tropp', email: 'matthew@publisher.example' }),
        person({ id: 'other', name: 'Matthew Trapp', email: 'mt@elsewhere.example' }),
      ],
    })
    expect(matches.map((found) => [found.id, found.basis])).toEqual([['work', 'name']])
    expect(matches[0].href).toMatch(/\/contacts\/work$/)
  })

  it('does not report the same record twice, or an address match again as a name', () => {
    const lead = person({ kind: 'lead', id: 'l1', name: 'Matt Tropp', email: request.email })
    const matches = selectPersonMatches({ request, byEmail: [lead, lead], byName: [lead] })
    expect(matches).toHaveLength(1)
    expect(matches[0].basis).toBe('email')
  })

  it('caps the guesses', () => {
    const byName = Array.from({ length: 12 }, (_, i) => person({ id: `c${i}`, name: 'Matthew Tropp' }))
    expect(selectPersonMatches({ request, byEmail: [], byName })).toHaveLength(PERSON_NAME_MATCH_LIMIT)
  })

  it('reads a contact’s source flags and a lead’s source list alike', () => {
    expect(candidateFrom('contact', 'c', { sources: { account: true, form: true, old: false } }).sources).toEqual([
      'account',
      'form',
    ])
    expect(candidateFrom('lead', 'l', { sources: ['booking'], firstSeenAtMs: 5 }).firstSeenAtMs).toBe(5)
    expect(candidateFrom('contact', 'c', { createdAt: { toMillis: () => 7 } }).firstSeenAtMs).toBe(7)
  })
})
