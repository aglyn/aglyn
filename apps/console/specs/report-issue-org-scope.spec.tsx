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
 * A report names the workspace the reporter was IN, or names none (AGL-2486).
 *
 * Zach, 2026-08-22, filing from the staff console: "I was in the staff console
 * and therefore was not viewing an org but those fields said there was an org
 * attached to it. If we are not viewing an org the org context should be
 * nothing."
 *
 * AGL-2485 is the evidence: it recorded `/admin/media-quarantine` as the route
 * and `Test Org` as the organization — a workspace that page has nothing to do
 * with. `useCurrentOrg()` resolves through `useOrgScope().currentOrg`, which
 * falls back to a remembered selection and then the user's FIRST org so that
 * org-less pages still have one to ACT on. Right for an action, wrong for a
 * claim, and the org stamped on a report is a claim.
 *
 * Both directions are asserted, because a fix that simply stopped sending the
 * org would be the same defect pointed the other way — a report filed from a
 * workspace must still name it, or triage loses the tenant entirely.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

const mockUrlNamesOrg = jest.fn<boolean, []>()
const mockPathname = jest.fn<string, []>()

jest.mock('../hooks/use-url-names-org', () => ({
  useUrlNamesOrg: () => mockUrlNamesOrg(),
}))
jest.mock('../hooks/use-current-org', () => ({
  __esModule: true,
  default: () => ({ orgId: 'org-remembered', org: {}, ready: true }),
}))
jest.mock('./host-id-provider', () => ({ useHostId: () => undefined }), {
  virtual: true,
})
jest.mock('../components/host-id-provider', () => ({ useHostId: () => undefined }), {
  virtual: true,
})
jest.mock('next/navigation', () => ({ usePathname: () => mockPathname() }))
jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar: jest.fn() }),
}))
jest.mock('@aglyn/tenant-feature-instance', () => ({
  useUser: () => ({
    data: { uid: 'u1', getIdToken: async () => 'token' },
  }),
}))

describe('the org a report claims (AGL-2486)', () => {
  const sent = () =>
    JSON.parse(
      ((global.fetch as jest.Mock).mock.calls[0]?.[1]?.body as string) ?? '{}',
    )

  beforeEach(() => {
    jest.clearAllMocks()
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ identifier: 'CUS-1', url: 'https://x' }),
    }) as unknown as typeof fetch
  })

  async function fileFrom(route: string, urlNamesOrg: boolean) {
    mockPathname.mockReturnValue(route)
    mockUrlNamesOrg.mockReturnValue(urlNamesOrg)
    const { ReportIssueDialog } = await import(
      '../components/report-issue-dialog.component'
    )
    render(<ReportIssueDialog open onClose={jest.fn()} />)
    // EVERY required field of the default `bug` kind, read from the schema
    // rather than guessed: `submit()` opens with `if (!ready || busy) return`,
    // and `ready` needs the summary AND all four of `REPORT_FIELDS.bug`
    // (steps, expected, actual, frequency — all `required: true`). Filling
    // two of them left the button inert, so `fetch` was never called and
    // both cases failed on the setup rather than on the org claim they are
    // here to check. A future required field must be added here too — the
    // symptom is this same silent no-op, not a missing-field error.
    fireEvent.change(screen.getByLabelText(/summary/i), {
      target: { value: 'a summary' },
    })
    fireEvent.change(screen.getByLabelText(/what were you doing/i), {
      target: { value: '1. opened the page' },
    })
    fireEvent.change(screen.getByLabelText(/what did you expect/i), {
      target: { value: 'it would work' },
    })
    fireEvent.change(screen.getByLabelText(/what happened instead/i), {
      target: { value: 'a description' },
    })
    // `frequency` is a `<TextField select>` — a MUI Select, whose labelled
    // element is the combobox, not an input with a value setter. So it is
    // OPENED and an option is CLICKED, the way a reporter answers it. A
    // `fireEvent.change` here does not fail loudly enough to be safe: it
    // throws "does not have a value setter" only because MUI renders no
    // settable node, and a component that swapped to radios would make the
    // same call silently set nothing.
    fireEvent.mouseDown(screen.getByLabelText(/happen every time/i))
    fireEvent.click(screen.getByRole('option', { name: /every time i try/i }))
    fireEvent.click(screen.getByRole('button', { name: /send report/i }))
    await waitFor(() => expect(global.fetch).toHaveBeenCalled())
  }

  it('sends NO org when the route does not name one (the staff console)', async () => {
    await fileFrom('/admin/media-quarantine', false)
    expect(sent().orgId).toBeUndefined()
  })

  it('still sends the org when the route DOES name one', async () => {
    await fileFrom('/aglyn-org/hosts/aglyn-marketing/screens', true)
    expect(sent().orgId).toBe('org-remembered')
  })
})
