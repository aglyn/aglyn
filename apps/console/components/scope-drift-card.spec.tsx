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
 * AGL-2062: the staff half of `/api/admin/backfill-scope` is reachable.
 *
 * The properties asserted are the ones that make this a repair tool rather
 * than a button: it follows the route's cursor instead of reading one page
 * and calling it the total, it does not offer a write the scan did not
 * justify, and it passes `dryRun` explicitly — the route treats an ABSENT
 * `dryRun` as a dry run, so a client that "defaults" it has quietly put a
 * second copy of that rule somewhere it can drift.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'

const mockGetIdToken = jest.fn().mockResolvedValue('staff-token')

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useUser: () => ({ data: { getIdToken: mockGetIdToken } }),
}))

import ScopeDriftCard from './scope-drift-card.component'

/** Bodies of every POST the card made, in order. */
function sentBodies(): any[] {
  return (global.fetch as jest.Mock).mock.calls.map((call) =>
    JSON.parse(call[1].body),
  )
}

function reply(payload: Record<string, unknown>, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
  }
}

describe('ScopeDriftCard', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    global.fetch = jest.fn()
  })

  it('follows the cursor and SUMS the pages', async () => {
    // One page is not the answer — `ORGS_PER_RUN` bounds a response, so a
    // card that read page one and stopped would under-report drift and,
    // worse, would look like it had scanned everything.
    ;(global.fetch as jest.Mock)
      .mockResolvedValueOnce(
        reply({
          planned: 3,
          drift: { byCollection: { media: 3 }, members: 0 },
          done: false,
          nextCursor: 'org-b',
        }),
      )
      .mockResolvedValueOnce(
        reply({
          planned: 4,
          drift: { byCollection: { media: 1, datasets: 3 }, members: 2 },
          done: true,
          nextCursor: null,
        }),
      )

    render(<ScopeDriftCard />)
    fireEvent.click(screen.getByText('Scan for drift'))

    await waitFor(() =>
      expect(screen.getByText(/7 document\(s\) are missing/)).toBeTruthy(),
    )
    expect(screen.getByText('media: 4')).toBeTruthy()
    expect(screen.getByText('datasets: 3')).toBeTruthy()
    // The second request must carry the cursor the first one handed back.
    expect(sentBodies()[1].cursor).toBe('org-b')
  })

  it('treats 207 as a finding, not a failure', async () => {
    // The route answers 207 for "finished, and a human must look". A client
    // that only accepts `response.ok` throws away exactly the runs that
    // found something.
    ;(global.fetch as jest.Mock).mockResolvedValueOnce(
      reply(
        {
          planned: 2,
          drift: { byCollection: { mediaFolders: 2 }, members: 0 },
          done: true,
          nextCursor: null,
        },
        207,
      ),
    )

    render(<ScopeDriftCard />)
    fireEvent.click(screen.getByText('Scan for drift'))

    await waitFor(() =>
      expect(screen.getByText(/2 document\(s\) are missing/)).toBeTruthy(),
    )
  })

  it('scans as an EXPLICIT dry run, and will not write without one', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValueOnce(
      reply({
        planned: 0,
        drift: { byCollection: {}, members: 0 },
        done: true,
        nextCursor: null,
      }),
    )

    render(<ScopeDriftCard />)
    const stampButton = screen.getByText(
      'Stamp the missing scopes',
    ) as HTMLElement
    // Disabled before any scan: a write the operator has not seen a report
    // for is the thing the dry-run protocol exists to prevent.
    expect(stampButton.closest('button')?.disabled).toBe(true)

    fireEvent.click(screen.getByText('Scan for drift'))
    await waitFor(() => expect(screen.getByText(/No drift/)).toBeTruthy())

    expect(sentBodies()[0].dryRun).toBe(true)
    // A clean scan planned nothing, so there is nothing to stamp.
    expect(stampButton.closest('button')?.disabled).toBe(true)
  })

  it('stamps with dryRun false once a scan has justified it', async () => {
    ;(global.fetch as jest.Mock)
      .mockResolvedValueOnce(
        reply({
          planned: 5,
          drift: { byCollection: { contacts: 5 }, members: 0 },
          done: true,
          nextCursor: null,
        }),
      )
      .mockResolvedValueOnce(
        reply({ planned: 5, done: true, nextCursor: null }),
      )

    render(<ScopeDriftCard />)
    fireEvent.click(screen.getByText('Scan for drift'))
    await waitFor(() =>
      expect(screen.getByText(/5 document\(s\) are missing/)).toBeTruthy(),
    )

    fireEvent.click(screen.getByText('Stamp the missing scopes'))
    await waitFor(() => expect(screen.getByText(/Stamped 5/)).toBeTruthy())

    expect(sentBodies()[1].dryRun).toBe(false)
    // The spent scan is cleared, so the write cannot be repeated against a
    // report that no longer describes anything.
    expect(
      screen.getByText('Stamp the missing scopes').closest('button')?.disabled,
    ).toBe(true)
  })

  it('says so when the legacy scan was truncated', async () => {
    // The count is then a FLOOR. Swallowing this is how a partial answer
    // gets read as the total.
    ;(global.fetch as jest.Mock).mockResolvedValueOnce(
      reply({
        planned: 1,
        drift: { byCollection: { media: 1 }, members: 0 },
        legacyScanTruncated: true,
        done: true,
        nextCursor: null,
      }),
    )

    render(<ScopeDriftCard />)
    fireEvent.click(screen.getByText('Scan for drift'))

    await waitFor(() =>
      expect(screen.getByText(/lower bound rather than the total/)).toBeTruthy(),
    )
  })
})
