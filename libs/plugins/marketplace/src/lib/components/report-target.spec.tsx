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
 * AGL-2435: the marketplace report route has a way in, and it reaches the
 * staff queue.
 *
 * `POST marketplace/report` was registered, rule-complete and unreachable —
 * deterministic doc ids so one account cannot inflate a queue, verified
 * reporter uid, listing name and publisher org resolved server-side, written
 * to `marketplaceReports`, which `/admin/marketplace-reports` triages. And
 * nothing in the product ever POSTed to it, so the queue could not receive a
 * single report.
 *
 * This drives the REAL component and reads the REAL `fetch` payload, rather
 * than asserting that a file contains a URL. A source grep would have passed
 * on a button that opened a dialog and posted nothing.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import ReportTarget from './report-target.component'

const enqueueSnackbar = jest.fn()

jest.mock('@aglyn/shared-ui-snackstack', () => ({
  ...jest.requireActual('@aglyn/shared-ui-snackstack'),
  useSnackbar: () => ({ enqueueSnackbar }),
}))

let currentUser: unknown = { uid: 'u-reporter', getIdToken: async () => 'tok' }

jest.mock('@aglyn/tenant-feature-instance', () => ({
  ...jest.requireActual('@aglyn/tenant-feature-instance'),
  useUser: () => ({ data: currentUser }),
}))

function lastFetchBody(): Record<string, unknown> {
  const call = (global.fetch as jest.Mock).mock.calls.at(-1)
  return JSON.parse(String(call?.[1]?.body ?? '{}'))
}

function openDialog() {
  fireEvent.click(screen.getByRole('button', { name: 'Report' }))
}

function type(text: string) {
  fireEvent.change(screen.getByLabelText('Reason'), {
    target: { value: text },
  })
}

const send = () => screen.getByRole('button', { name: 'Send report' })

beforeEach(() => {
  jest.clearAllMocks()
  currentUser = { uid: 'u-reporter', getIdToken: async () => 'tok' }
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ ok: true, targetType: 'listing' }),
  }) as never
})

describe('AGL-2435 · reporting a listing', () => {
  it('POSTs to the route the staff queue is fed by', async () => {
    render(<ReportTarget listingId="listing-1" label="Acme Theme" />)
    openDialog()
    type('Ships a tracking pixel')
    fireEvent.click(send())
    await waitFor(() => expect(global.fetch).toHaveBeenCalled())
    // The path is the registered plugin API route. Nothing else reaches
    // `marketplaceReports`.
    expect((global.fetch as jest.Mock).mock.calls[0][0]).toBe(
      '/api/marketplace/report',
    )
    expect(lastFetchBody()).toEqual({
      listingId: 'listing-1',
      reason: 'Ships a tracking pixel',
    })
  })

  it('sends the bearer token the route authenticates with', async () => {
    render(<ReportTarget listingId="listing-1" label="Acme Theme" />)
    openDialog()
    type('Broken')
    fireEvent.click(send())
    await waitFor(() => expect(global.fetch).toHaveBeenCalled())
    const init = (global.fetch as jest.Mock).mock.calls[0][1]
    // Without this the route answers 401 and the report is silently lost.
    expect(init.headers.Authorization).toBe('Bearer tok')
  })

  it('omits reviewUid, so the server files this against the LISTING', async () => {
    // `report.ts` forks on `reviewUid` to set `targetType`. Sending an empty
    // string would make every listing report look like a review report, and
    // the staff queue would triage the wrong object.
    render(<ReportTarget listingId="listing-1" label="Acme Theme" />)
    openDialog()
    type('Broken')
    fireEvent.click(send())
    await waitFor(() => expect(global.fetch).toHaveBeenCalled())
    expect('reviewUid' in lastFetchBody()).toBe(false)
  })

  it('trims the reason and refuses an all-whitespace one before the round trip', () => {
    render(<ReportTarget listingId="listing-1" label="Acme Theme" />)
    openDialog()
    type('    ')
    expect((send() as HTMLButtonElement).disabled).toBe(true)
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('caps the reason at the length the server stores', () => {
    // The server slices to 1000. A control that accepted more would silently
    // discard the end of what someone wrote.
    render(<ReportTarget listingId="listing-1" label="Acme Theme" />)
    openDialog()
    type('x'.repeat(1500))
    expect((screen.getByLabelText('Reason') as HTMLTextAreaElement).value.length).toBe(1000)
  })

  it('surfaces a server refusal instead of claiming success', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ error: 'Unknown listing' }),
    }) as never
    render(<ReportTarget listingId="gone" label="Acme Theme" />)
    openDialog()
    type('Broken')
    fireEvent.click(send())
    await waitFor(() => expect(enqueueSnackbar).toHaveBeenCalled())
    expect(enqueueSnackbar).toHaveBeenCalledWith(
      'Unknown listing',
      expect.objectContaining({ variant: 'error' }),
    )
    // The dialog stays open so the reason is not lost.
    expect(screen.getByLabelText('Reason')).toBeTruthy()
  })

  it('confirms that a human will read it', async () => {
    render(<ReportTarget listingId="listing-1" label="Acme Theme" />)
    openDialog()
    type('Broken')
    fireEvent.click(send())
    await waitFor(() => expect(enqueueSnackbar).toHaveBeenCalled())
    expect(enqueueSnackbar).toHaveBeenCalledWith(
      'Thanks — staff will review this report',
      expect.objectContaining({ variant: 'success' }),
    )
  })

  it('refuses to send while signed out, and says why', () => {
    // The route answers 401 without a token. A control that posted anyway
    // would teach a reporter that reporting does not work.
    currentUser = undefined
    render(<ReportTarget listingId="listing-1" label="Acme Theme" />)
    openDialog()
    type('Broken')
    expect((send() as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText('Sign in to send a report.')).toBeTruthy()
  })
})

describe('AGL-2435 · reporting a review', () => {
  it('sends reviewUid, so the server files this against the REVIEW', async () => {
    render(
      <ReportTarget
        listingId="listing-1"
        reviewUid="u-author"
        label="this review by Dana"
      />,
    )
    openDialog()
    type('Abusive language')
    fireEvent.click(send())
    await waitFor(() => expect(global.fetch).toHaveBeenCalled())
    expect(lastFetchBody()).toEqual({
      listingId: 'listing-1',
      reviewUid: 'u-author',
      reason: 'Abusive language',
    })
  })
})

describe('AGL-2435 · the control is MOUNTED, not merely written', () => {
  const LIB = join(__dirname, '..')
  const source = (relative: string) =>
    readFileSync(join(LIB, relative), 'utf8')

  it('renders on the listing page', () => {
    // A component nobody mounts is the same unreachable route with more code
    // in front of it. `<ReportTarget` and not the bare name: the import line
    // alone survives deleting the JSX.
    const page = source('components/listing-content.component.tsx')
    expect(page).toContain('<ReportTarget')
    expect(page).toContain(
      "import ReportTarget from './report-target.component'",
    )
  })

  it('renders on each review, but not on your own', () => {
    const reviews = source('components/listing-reviews.component.tsx')
    expect(reviews).toContain('<ReportTarget')
    // The guard, not just the element: reporting yourself is noise a staff
    // member then has to read.
    expect(reviews).toContain('uid && review.$id !== uid ? (')
  })

  it('the route it posts to is the one the plugin registers', () => {
    // Pins both ends. A rename on either side leaves a button that posts
    // into nothing, which is the exact state this issue closes.
    expect(source('components/report-target.component.tsx')).toContain(
      "'/api/marketplace/report'",
    )
    expect(source('server.ts')).toContain(
      "registerPluginApiRoute('marketplace/report'",
    )
  })
})
