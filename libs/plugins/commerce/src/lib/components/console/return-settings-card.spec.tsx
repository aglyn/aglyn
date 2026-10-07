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
 * RETURN SETTINGS WRITE `settings/store` `returns` (AGL-3611).
 *
 * Asserted on the write — the object handed to the batch, which the buyer's
 * route later reads with `readReturnSettings` — and on the merge that keeps
 * the other cards' fields on the same document.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'

let mockStore: Record<string, unknown> | undefined
const batchSet = jest.fn()

jest.mock('firebase/firestore', () => ({
  doc: (_db: unknown, ...segments: string[]) => ({ path: segments.join('/') }),
}))

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => ({}),
  useUser: () => ({ data: { uid: 'uid-admin' } }),
  useFirestoreDoc: () => ({ data: mockStore, status: 'success', fromCache: false }),
  writeGuardedBySeed: async (_guard: unknown, write: () => Promise<void>) => {
    await write()
    return { ok: true }
  },
}))

jest.mock('@aglyn/tenant-feature-instance/hooks/helpers/site-wide-change', () => ({
  writeSiteWideChange: async (options: { write: (batch: unknown) => void }) => {
    options.write({ set: batchSet })
  },
}))

jest.mock('@aglyn/aglyn', () => ({ pluginDocsHelp: () => undefined }))
jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar: jest.fn() }),
}))
jest.mock('@aglyn/shared-ui-jsx', () => ({
  CardDisplay: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}))

import ReturnSettingsCard from './return-settings-card.component'

const save = () => fireEvent.click(screen.getByRole('button', { name: 'Save return settings' }))

beforeEach(() => {
  batchSet.mockClear()
  mockStore = { currency: 'USD', returns: { enabled: true, windowDays: 30, eligibleTypes: ['physical'] } }
})

describe('return settings (AGL-3611)', () => {
  it('shows the saved policy', () => {
    render(<ReturnSettingsCard hostId="host-1" />)
    expect((screen.getByLabelText('Accept return requests online') as HTMLInputElement).checked).toBe(true)
    expect((screen.getByLabelText('Return window in days') as HTMLInputElement).value).toBe('30')
    expect((screen.getByLabelText('Physical products') as HTMLInputElement).checked).toBe(true)
    expect((screen.getByLabelText('Digital products') as HTMLInputElement).checked).toBe(false)
  })

  it('writes the switch, the window and the types to settings/store, merged', async () => {
    render(<ReturnSettingsCard hostId="host-1" />)
    fireEvent.click(screen.getByLabelText('Accept return requests online'))
    fireEvent.change(screen.getByLabelText('Return window in days'), { target: { value: '14' } })
    fireEvent.click(screen.getByLabelText('Services'))
    save()
    await waitFor(() => expect(batchSet).toHaveBeenCalledTimes(1))
    const [ref, data, options] = batchSet.mock.calls[0]
    expect(ref).toEqual({ path: 'hosts/host-1/settings/store' })
    expect(data).toEqual({
      returns: { enabled: false, windowDays: 14, eligibleTypes: ['physical', 'service'] },
    })
    expect(options).toEqual({ merge: true })
  })

  it('starts from the defaults on a store that never set a policy', async () => {
    mockStore = { currency: 'USD' }
    render(<ReturnSettingsCard hostId="host-1" />)
    fireEvent.click(screen.getByLabelText('Digital products'))
    save()
    await waitFor(() => expect(batchSet).toHaveBeenCalledTimes(1))
    expect(batchSet.mock.calls[0][1]).toEqual({
      returns: { enabled: true, windowDays: 30, eligibleTypes: ['physical', 'digital'] },
    })
  })

  it('refuses a window past a year', () => {
    render(<ReturnSettingsCard hostId="host-1" />)
    fireEvent.change(screen.getByLabelText('Return window in days'), { target: { value: '400' } })
    expect(
      (screen.getByRole('button', { name: 'Save return settings' }) as HTMLButtonElement).disabled,
    ).toBe(true)
  })
})
