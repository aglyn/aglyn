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
 * THE RECORDED-NOT-PRICED ROLLUP FIELDS REACH A SURFACE (AGL-2321, item 2).
 *
 * `report-usage` writes sixteen fields onto `orgs/{id}/usage/{month}` that
 * nothing read back off the document. The route argues, correctly, that
 * pricing them would put an invented rate into `billedCents` on the day the
 * meter first had data — but "do not price it" was never "do not surface it",
 * and `/api/admin/org-usage`'s hand-written projection dropped every one of
 * them. That is AGL-1134's projection hazard one layer up: the history a rate
 * would be derived from was unreachable from the only place anyone looks.
 *
 * The projection half is guarded in `org-usage-authz.spec.ts`, seeded with a
 * distinct non-zero value per field. This file is the RENDER half, and each
 * test is shaped against a specific way the render could look right and be
 * wrong:
 *
 *  - a value printed for one field and reused for its neighbour — every
 *    figure below is distinct, so a transposition cannot pass;
 *  - the withheld/billed pair collapsed to the dollar alone, which is the
 *    defect the writer's own comment names: `*WithheldUsd` is zero whenever
 *    the flag was on, so `$0.00` alone cannot tell a withheld month from an
 *    in-band one;
 *  - `siteSizeMb` printed without `siteSizeTruncated`, which makes a LOWER
 *    BOUND read as a total;
 *  - a month that recorded nothing rendered as measured zeroes, which states
 *    as fact something nobody measured.
 *
 * ITEM 3 IS HERE TOO, and the issue's framing of it was wrong. The fix is not
 * "stop reading `BILL_ORG_LIBRARY_STORAGE_FROM` live": every reader of that
 * env var answers *what is the switch NOW* for a current-month estimate, and
 * serving that from a stored past value would be a defect, not a fix.
 * `orgLibraryBilled`/`orgLibraryBilledFrom` were frozen onto the rollup so a
 * HISTORICAL reader would not need the env var — and no historical reader had
 * ever been built. `librarySentence` is it, and it consults the document
 * only. The last test below pins that: the env var is set to a value that
 * contradicts the row, and the row still wins.
 */

import { render, screen } from '@testing-library/react'

import StaffOrgUsageTable, {
  recordedUsageLines,
} from '../components/staff-org-usage-table.component'

const MONTH = '2026-08'

/** A row whose every recorded figure is distinct from every other. */
const FULL_ROW = {
  month: MONTH,
  storageGb: 1.5,
  pageViews: 120,
  formSubmissions: 3,
  costUsd: 2.5,
  assistCostUsd: 18.75,
  recorded: {
    emailSends: 4321,
    emailSendsOverage: 321,
    workflowRuns: 87,
    actionRuns: 219,
    billableCostUsd: 3.0625,
    apiOverageUsd: 6.5,
    formSubmissionsBilled: false,
    formSubmissionsOverageWithheldUsd: 4.25,
    contactsOverageBilled: true,
    contactsOverageUsd: 7.75,
    contactsOverageWithheldUsd: 0,
    orgLibraryStorageGb: 1.875,
    orgLibraryBilled: true,
    orgLibraryBilledFrom: '2026-07',
    siteSizeMb: 512.4,
    siteSizeTruncated: true,
  },
  deltas: null,
}

describe('the recorded meters reach the staff table', () => {
  it('renders every meter with its own figure', () => {
    render(<StaffOrgUsageTable months={[FULL_ROW]} />)

    // Each figure named individually. A render that printed the first meter
    // three times, or summed them, fails on the second assertion.
    expect(screen.getByText(/Emails 4,321/)).toBeTruthy()
    expect(screen.getByText(/321 over band/)).toBeTruthy()
    expect(screen.getByText(/Workflow runs 87/)).toBeTruthy()
    expect(screen.getByText(/Action runs 219/)).toBeTruthy()
  })

  it('renders the pre-markup billable cost to four decimals', () => {
    render(<StaffOrgUsageTable months={[FULL_ROW]} />)

    // Two decimals would round $3.0625 to $3.06 and lose the whole reason
    // the pre-markup twin is worth recording separately from `costUsd`.
    expect(screen.getByText(/Billable \$3\.0625/)).toBeTruthy()
    expect(screen.getByText(/API overage \$6\.50/)).toBeTruthy()
  })

  it('says WITHHELD, not just a dollar figure, when the flag was off', () => {
    render(<StaffOrgUsageTable months={[FULL_ROW]} />)

    // The defect this pair exists to end: `$4.25` on its own is
    // indistinguishable from an in-band month that happened to cost $4.25.
    expect(screen.getByText(/Form overage withheld \$4\.25/)).toBeTruthy()
    // And the opposite flag renders as billed, with the charged figure —
    // proving the render reads each row's own flag rather than one of them.
    expect(screen.getByText(/Contacts overage billed \$7\.75/)).toBeTruthy()
  })

  it('marks a truncated site measurement as a lower bound', () => {
    render(<StaffOrgUsageTable months={[FULL_ROW]} />)

    const line = screen.getByText(/Site size 512\.4 MB/)
    // Without this the number reads as a total. It is a floor.
    expect(line.textContent).toMatch(/truncated/)
  })

  it('does not mark an untruncated measurement as a lower bound', () => {
    const lines = recordedUsageLines({
      ...FULL_ROW.recorded,
      siteSizeMb: 88.25,
      siteSizeTruncated: false,
    })

    // The negative control for the test above: without it, a render that
    // appended "truncated" unconditionally would pass both.
    expect(lines.join('\n')).toMatch(/Site size 88\.3 MB/)
    expect(lines.join('\n')).not.toMatch(/truncated/)
  })

  it('says nothing was recorded rather than printing measured zeroes', () => {
    render(
      <StaffOrgUsageTable
        months={[
          {
            month: '2026-01',
            storageGb: 1,
            pageViews: 2,
            formSubmissions: 0,
            costUsd: 0,
            recorded: {
              emailSends: null as unknown as undefined,
              workflowRuns: null as unknown as undefined,
              actionRuns: null as unknown as undefined,
              billableCostUsd: null as unknown as undefined,
              formSubmissionsBilled: null,
              contactsOverageBilled: null,
              orgLibraryStorageGb: null,
              orgLibraryBilled: null,
              orgLibraryBilledFrom: null,
              siteSizeMb: null,
              siteSizeTruncated: null,
            },
            deltas: null,
          },
        ]}
      />,
    )

    // A rollup from before these meters existed measured nothing. "Emails 0"
    // would be a fabricated measurement, and a blank cell reads the same way.
    expect(
      screen.getByText('No additional meters recorded for this month.'),
    ).toBeTruthy()
    expect(screen.queryByText(/Emails 0/)).toBeNull()
  })
})

describe('the historical library answer comes off the row (AGL-2321 item 3)', () => {
  const ORIGINAL = process.env.BILL_ORG_LIBRARY_STORAGE_FROM

  afterEach(() => {
    if (ORIGINAL == null) delete process.env.BILL_ORG_LIBRARY_STORAGE_FROM
    else process.env.BILL_ORG_LIBRARY_STORAGE_FROM = ORIGINAL
  })

  it('reports the month the ROLLUP recorded, not the month the env var holds now', () => {
    // The switch has moved since this row was written. A reader that
    // re-derived from the live env var would print 2026-12 — the answer to a
    // question about NEXT month, on a row about August.
    process.env.BILL_ORG_LIBRARY_STORAGE_FROM = '2026-12'

    expect(recordedUsageLines(FULL_ROW.recorded).join('\n')).toMatch(
      /Org library 1\.875 GB, billed from 2026-07/,
    )
  })

  it('reports NOT BILLED from the row even when the env var would say otherwise', () => {
    // The switch is on now and was off then. The invoice does not change
    // retroactively, so neither does this line.
    process.env.BILL_ORG_LIBRARY_STORAGE_FROM = '2026-01'

    expect(
      recordedUsageLines({
        ...FULL_ROW.recorded,
        orgLibraryBilled: false,
        orgLibraryBilledFrom: null,
      }).join('\n'),
    ).toMatch(/Org library 1\.875 GB, not billed/)
  })

  it('states the size alone when the rollup recorded no verdict', () => {
    // Pre-AGL-1370 rollups carry the bytes and not the flag. The size is
    // still true; the verdict must not be invented from today's environment.
    process.env.BILL_ORG_LIBRARY_STORAGE_FROM = '2026-01'

    const line = recordedUsageLines({
      orgLibraryStorageGb: 0.5,
      orgLibraryBilled: null,
      orgLibraryBilledFrom: null,
    }).join('\n')
    expect(line).toMatch(/Org library 0\.500 GB/)
    expect(line).not.toMatch(/billed/)
  })
})
