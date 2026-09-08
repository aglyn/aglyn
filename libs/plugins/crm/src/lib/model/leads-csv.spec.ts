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

import { LEAD_CSV_COLUMNS, leadCsvHeader, leadsCsv } from './leads-csv'

/**
 * The leads file (AGL-2662): the status by label with an absent one as
 * New, the owner by address, the sources by name joined with `|`, the
 * instants as ISO, and a Site column only when the caller can name sites.
 */
describe('the leads CSV', () => {
  const seenMs = Date.UTC(2026, 8, 1, 9)
  const rows = [
    {
      email: 'maya@example.com',
      name: 'Maya, Q.',
      ownerUid: 'uid-1',
      sources: ['signup', 'form:contact'],
      firstSeenAtMs: Date.UTC(2026, 7, 1),
      lastSeenAtMs: seenMs,
      submissionCount: 3,
      notes: 'Called back',
      hostId: 'site-1',
    },
    {
      email: 'june@example.com',
      status: 'unqualified' as const,
      unqualifiedReason: 'Not a fit',
      source: 'booking',
      lastSeenAtMs: seenMs,
      hostId: 'site-2',
    },
  ]

  it('writes the standard columns under a site, the owner by address', () => {
    const csv = leadsCsv(rows, {
      ownerEmail: (uid) => (uid === 'uid-1' ? 'owner@example.com' : uid),
    })
    expect(csv.split('\n')).toEqual([
      LEAD_CSV_COLUMNS.join(','),
      'maya@example.com,"Maya, Q.",New,owner@example.com,Sign-up|Form contact,' +
        '2026-08-01T00:00:00.000Z,2026-09-01T09:00:00.000Z,3,,,Called back',
      `june@example.com,,Unqualified,,Booking,,2026-09-01T09:00:00.000Z,,Not a fit,,`,
    ])
  })

  it('adds a Site column after Owner at the organization level', () => {
    const header = leadCsvHeader({ siteName: () => 'Shop' })
    expect(header.indexOf('Site')).toBe(header.indexOf('Owner') + 1)
    const csv = leadsCsv(rows, {
      siteName: (hostId) => (hostId === 'site-1' ? 'Shop' : undefined),
    })
    const [, first, second] = csv.split('\n')
    expect(first).toContain(',New,uid-1,Shop,Sign-up|Form contact,')
    // A site the mount cannot name is written by its id, never blank.
    expect(second.split(',')[4]).toBe('site-2')
  })
})
