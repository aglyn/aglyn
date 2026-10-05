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
 * "Stop serving" in Page Properties → Record pages (AGL-3475).
 *
 * Stopping leaves the page a template, which nobody can visit, and then
 * offers once to make it a normal page again. Making it a page goes through
 * the platform's convert route, which checks the plan's pages and answers a
 * refusal in its own sentence. Declining leaves the template where it is.
 *
 * NO PRODUCTION DATA IS READ; every hook and request is a local stub.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { RecordTemplateSection } from './record-template-section.component'

const BINDING = { screenId: 'scr-service', datasetId: 'ds-services', base: 'services', slugField: 'slug' }
const BINDINGS = [BINDING]
const NO_DOCS: unknown[] = []

const confirm = jest.fn()
const enqueueSnackbar = jest.fn()
/** Each request the section sends, by path and body; a path in `refuse` answers 403 with its sentence. */
const requests: Array<{ path: string; body: Record<string, unknown> }> = []
let refuse: Record<string, string> = {}

jest.mock('@aglyn/shared-util-http/authorized-token', () => ({
  authorizedFetch: async (_user: unknown, path: string, init: { body: string }) => {
    requests.push({ path, body: JSON.parse(init.body) })
    const error = refuse[path]
    return {
      ok: !error,
      json: async () => (error ? { error } : { ok: true }),
    }
  },
}))
jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => ({}),
  useFirestoreCollection: () => ({ data: NO_DOCS }),
  useOrgDataScope: () => ({ scope: null }),
  // A plan not yet read skips the entitlement notice, so the section renders its form.
  useOrgPlan: () => ({ org: null, ready: false }),
  useUser: () => ({ data: { uid: 'uid-test' } }),
}))
jest.mock('./record-page-source', () => ({
  useSiteRecordPageBindings: () => ({ bindings: BINDINGS, loading: false }),
  useRecordPagePreview: () => ({ status: 'idle' }),
}))
jest.mock('@aglyn/shared-ui-jsx', () => ({
  useConfirmationContext: () => ({ confirm }),
}))
jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar }),
}))
jest.mock('firebase/firestore', () => ({
  collection: () => null,
  limit: () => null,
  query: () => null,
  where: () => null,
}))

beforeEach(() => {
  confirm.mockReset()
  enqueueSnackbar.mockReset()
  requests.length = 0
  refuse = {}
})

function stopServing() {
  render(<RecordTemplateSection hostId="host-1" orgId="org-1" screenId="scr-service" screenKind="template" />)
  fireEvent.click(screen.getByRole('button', { name: 'Stop serving' }))
}

it('stops serving, then makes the page a normal page again when the member says so', async () => {
  confirm.mockResolvedValue(undefined)
  stopServing()
  await waitFor(() => expect(requests).toHaveLength(2))
  expect(requests).toEqual([
    { path: '/api/hosts/record-pages', body: { action: 'remove', hostId: 'host-1', screenId: 'scr-service' } },
    { path: '/api/hosts/screens', body: { action: 'convert', hostId: 'host-1', id: 'scr-service', kind: 'page' } },
  ])
  // The offer names what a page costs and what it would show.
  expect(confirm.mock.calls[1][0]).toMatchObject({
    title: 'Make this a normal page again?',
    description: expect.stringContaining('counts toward your plan’s pages'),
    confirmationText: 'Make it a page',
    cancellationText: 'Keep it hidden',
  })
  expect(confirm.mock.calls[1][0].description).toContain('{{item.name}}')
  await waitFor(() =>
    expect(enqueueSnackbar).toHaveBeenLastCalledWith('This is a normal page again', { variant: 'success' }),
  )
})

it('leaves the page a template when the member keeps it hidden', async () => {
  // The dialog rejects on cancel.
  confirm.mockResolvedValueOnce(undefined).mockRejectedValueOnce(undefined)
  stopServing()
  await waitFor(() => expect(confirm).toHaveBeenCalledTimes(2))
  await waitFor(() => expect((screen.getByRole('button', { name: 'Stop serving' }) as HTMLButtonElement).disabled).toBe(false))
  expect(requests.map((request) => request.path)).toEqual(['/api/hosts/record-pages'])
})

it('shows the convert route’s refusal when the plan has no room for another page', async () => {
  confirm.mockResolvedValue(undefined)
  refuse['/api/hosts/screens'] = 'Making “Service” a page again puts this site at 6 of 5 pages.'
  stopServing()
  await waitFor(() =>
    expect(enqueueSnackbar).toHaveBeenLastCalledWith(
      'Making “Service” a page again puts this site at 6 of 5 pages.',
      { variant: 'error' },
    ),
  )
})

it('offers nothing when stopping fails, so a page is never made from a template still serving', async () => {
  confirm.mockResolvedValue(undefined)
  refuse['/api/hosts/record-pages'] = 'Only a publisher can change record pages'
  stopServing()
  await waitFor(() =>
    expect(enqueueSnackbar).toHaveBeenLastCalledWith('Only a publisher can change record pages', { variant: 'error' }),
  )
  expect(confirm).toHaveBeenCalledTimes(1)
  expect(requests.map((request) => request.path)).toEqual(['/api/hosts/record-pages'])
})
