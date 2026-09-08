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
 * The lead-file normalizer (AGL-2701).
 *
 * What is pinned by name: the address is the only cell that can refuse a
 * row, because it is the document id; `qualified` is not a status a file
 * may set; an unqualified reason with no unqualified status to belong to
 * is dropped and reported; and the leads export's own header maps itself,
 * with the capture door's columns left alone.
 */

import { leadCsvHeader } from './crm-csv'
import {
  LEAD_IMPORT_FIELD_LABELS,
  LEAD_IMPORT_FIELDS,
  LEAD_IMPORT_REASON_MAX,
  LEAD_IMPORT_SKIP_LABELS,
  LEAD_IMPORT_STATUSES,
  guessLeadImportMapping,
  leadImportSkippedCsv,
  mapLeadImportRow,
  normalizeLeadImportRow,
  parseImportLeadStatus,
} from './crm-lead-import'

describe('the lead vocabulary', () => {
  it('labels every field and every skip reason', () => {
    for (const field of LEAD_IMPORT_FIELDS) {
      expect(LEAD_IMPORT_FIELD_LABELS[field]).toBeTruthy()
    }
    expect(Object.keys(LEAD_IMPORT_SKIP_LABELS).sort()).toEqual([
      'duplicate',
      'invalid-email',
      'lead-ceiling',
      'write-failed',
    ])
  })

  /**
   * The list's own status control offers new, working and unqualified;
   * qualification is the conversion's to write, beside the contact it
   * created. A file may set exactly what a person may.
   */
  it('offers the three statuses a person may set, and not qualified', () => {
    expect([...LEAD_IMPORT_STATUSES]).toEqual(['new', 'working', 'unqualified'])
  })
})

describe('guessLeadImportMapping', () => {
  it("reads the leads export header, leaving the capture door's columns unmapped", () => {
    expect(guessLeadImportMapping(leadCsvHeader())).toEqual({
      0: 'email',
      1: 'name',
      2: 'status',
      3: 'ownerEmail',
      8: 'unqualifiedReason',
      10: 'notes',
    })
  })

  /**
   * At the organization level the export gains a `Site` column after
   * `Owner`. The drawer's picker names the one site the route is
   * authorized for, so a cell must never be able to redirect a row.
   */
  it('leaves the organization file’s Site column unmapped', () => {
    const mapping = guessLeadImportMapping(
      leadCsvHeader({ siteName: (id: string) => id }),
    )
    expect(mapping[4]).toBeUndefined()
    expect(Object.values(mapping)).not.toContain('hostId')
  })

  it('reads another product’s header from the aliases', () => {
    expect(
      guessLeadImportMapping([
        'Email Address',
        'Full Name',
        'Lead Status',
        'Assigned To',
        'Lost reason',
        'Comments',
      ]),
    ).toEqual({
      0: 'email',
      1: 'name',
      2: 'status',
      3: 'ownerEmail',
      4: 'unqualifiedReason',
      5: 'notes',
    })
  })
})

describe('mapLeadImportRow', () => {
  it('takes the mapped cells verbatim and leaves the empty ones absent', () => {
    expect(
      mapLeadImportRow(['  Dana@Example.com ', '', 'Working'], {
        0: 'email',
        1: 'name',
        2: 'status',
      }),
    ).toEqual({ email: '  Dana@Example.com ', status: 'Working' })
  })
})

describe('parseImportLeadStatus', () => {
  it('reads a status by id or by label, in any case', () => {
    expect(parseImportLeadStatus('working')).toBe('working')
    expect(parseImportLeadStatus('  WORKING ')).toBe('working')
    expect(parseImportLeadStatus('Unqualified')).toBe('unqualified')
    expect(parseImportLeadStatus('New')).toBe('new')
  })

  it('refuses qualified and anything it does not know', () => {
    expect(parseImportLeadStatus('qualified')).toBeNull()
    expect(parseImportLeadStatus('Qualified')).toBeNull()
    expect(parseImportLeadStatus('converted')).toBeNull()
    expect(parseImportLeadStatus('')).toBeNull()
    expect(parseImportLeadStatus(undefined)).toBeNull()
  })
})

describe('normalizeLeadImportRow', () => {
  it('normalizes the address, tidies the name, and carries the rest', () => {
    const verdict = normalizeLeadImportRow({
      email: '  Dana@EXAMPLE.com ',
      name: ' Dana   Marsh ',
      status: 'Working',
      ownerEmail: ' Rep@Example.com ',
      notes: 'Met at the trade show',
    })
    expect(verdict).toEqual({
      ok: true,
      row: {
        email: 'dana@example.com',
        name: 'Dana Marsh',
        status: 'working',
        ownerEmail: 'rep@example.com',
        notes: 'Met at the trade show',
        dropped: [],
      },
    })
  })

  it('refuses a row whose address cannot be read, and says what it was', () => {
    expect(normalizeLeadImportRow({ email: 'not-an-address', name: 'Dana' })).toEqual({
      ok: false,
      reason: 'invalid-email',
      input: 'not-an-address',
    })
    expect(normalizeLeadImportRow({})).toEqual({
      ok: false,
      reason: 'invalid-email',
      input: '',
    })
  })

  it('drops a status it may not set and reports the cell', () => {
    const verdict = normalizeLeadImportRow({ email: 'a@b.com', status: 'Qualified' })
    expect(verdict.ok).toBe(true)
    if (verdict.ok === false) return
    expect(verdict.row.status).toBeUndefined()
    expect(verdict.row.dropped).toEqual([{ field: 'status', value: 'Qualified' }])
  })

  /** The reason is what an unqualified lead was CLOSED for; on any other
   * row it describes nothing, so it is reported rather than stored. */
  it('keeps an unqualified reason only beside the unqualified status', () => {
    const closed = normalizeLeadImportRow({
      email: 'a@b.com',
      status: 'unqualified',
      unqualifiedReason: 'No budget',
    })
    expect(closed.ok === true && closed.row.unqualifiedReason).toBe('No budget')
    expect(closed.ok === true && closed.row.dropped).toEqual([])

    const open = normalizeLeadImportRow({
      email: 'a@b.com',
      status: 'working',
      unqualifiedReason: 'No budget',
    })
    expect(open.ok === true && open.row.unqualifiedReason).toBeUndefined()
    expect(open.ok === true && open.row.dropped).toEqual([
      { field: 'unqualifiedReason', value: 'No budget' },
    ])
  })

  it('drops an owner address it cannot read and reports it', () => {
    const verdict = normalizeLeadImportRow({ email: 'a@b.com', ownerEmail: 'nobody' })
    expect(verdict.ok === true && verdict.row.ownerEmail).toBeUndefined()
    expect(verdict.ok === true && verdict.row.dropped).toEqual([
      { field: 'ownerEmail', value: 'nobody' },
    ])
  })

  it('caps the reason where the unqualify dialog caps it', () => {
    const verdict = normalizeLeadImportRow({
      email: 'a@b.com',
      status: 'unqualified',
      unqualifiedReason: 'x'.repeat(LEAD_IMPORT_REASON_MAX + 50),
    })
    expect(verdict.ok === true && verdict.row.unqualifiedReason?.length).toBe(
      LEAD_IMPORT_REASON_MAX,
    )
  })
})

describe('leadImportSkippedCsv', () => {
  it('round-trips the original columns with the reason appended', () => {
    expect(
      leadImportSkippedCsv(
        ['Email', 'Name'],
        [
          { cells: ['bad', 'Dana'], reason: 'invalid-email' },
          { cells: ['a@b.com', 'Ada'], reason: 'duplicate' },
        ],
      ),
    ).toBe(
      'Email,Name,Skipped because\n' +
        'bad,Dana,No usable email address\n' +
        'a@b.com,Ada,The same address appears earlier in this file',
    )
  })
})
