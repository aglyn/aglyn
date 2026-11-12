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
 *
 * @jest-environment jsdom

/**
 * Setup → Business profile: a save that clears a field ends "Up to date"
 * (AGL-4047).
 *
 * Clearing "What the business does" and pressing Update saved, but the button
 * stayed "Update": the cleared box held `undefined` and the stored copy
 * reseeded it as `''`, which final-form's `===` called a change. Rendered
 * through the real forms library, because the compare under test is the
 * field's own.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'

const mockSetDoc = jest.fn().mockResolvedValue(undefined)
const mockEnqueueSnackbar = jest.fn()
const mockProfile = {
  data: {
    whatYouDo: 'Mobile dog grooming',
    services: ['Full groom'],
    audience: 'Busy owners',
    sources: { whatYouDo: 'owner', services: 'owner', audience: 'owner' },
  } as Record<string, unknown> | undefined,
}

jest.mock('firebase/firestore', () => ({
  doc: (_db: unknown, ...path: string[]) => path.join('/'),
  setDoc: (...args: unknown[]) => mockSetDoc(...args),
  serverTimestamp: () => 'now',
}))
jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => ({}),
  useUser: () => ({ data: { uid: 'user-1' } }),
  // The REAL guard: the card's save goes through it like every settings card.
  writeGuardedBySeed: jest.requireActual('@aglyn/tenant-feature-instance').writeGuardedBySeed,
}))
jest.mock('../hooks/use-firestore-doc', () => ({
  __esModule: true,
  default: (ref: () => string | null) => {
    const path = ref()
    return {
      data: path?.includes('businessProfile') && path.startsWith('hosts/') ? mockProfile.data : undefined,
      status: 'success',
      fromCache: false,
      listen: undefined,
    }
  },
}))
jest.mock('@aglyn/shared-ui-jsx', () => ({
  ...jest.requireActual('@aglyn/shared-ui-jsx'),
  useLoading: () => ({ queueLoading: () => () => undefined }),
}))
jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar: mockEnqueueSnackbar }),
}))
jest.mock('../constants/docs-links', () => ({ docsHelp: () => undefined }))

const BusinessProfileCard = require('../components/business-profile-card.component').default

const box = (label: string) => screen.getByLabelText(label, { selector: 'textarea' }) as HTMLTextAreaElement
const button = (name: string) => screen.getByRole('button', { name }) as HTMLButtonElement

describe('Business profile, a save that clears a field (AGL-4047)', () => {
  it('returns to Up to date once the cleared field is stored', async () => {
    const { rerender } = render(<BusinessProfileCard orgId="org-1" hostId="host-1" />)
    await screen.findByLabelText('What the business does', { selector: 'textarea' })
    expect(button('Up to date').disabled).toBe(true)

    fireEvent.change(box('What the business does'), { target: { value: '' } })
    fireEvent.click(button('Update'))
    await waitFor(() => expect(mockSetDoc).toHaveBeenCalledTimes(1))
    const [, written] = mockSetDoc.mock.calls[0]
    expect(written.whatYouDo).toBe('')
    await waitFor(() =>
      expect(mockEnqueueSnackbar).toHaveBeenCalledWith('Business profile saved', { variant: 'success' }),
    )

    // The listener hands back what the save stored.
    mockProfile.data = { ...mockProfile.data, whatYouDo: written.whatYouDo, sources: written.sources }
    rerender(<BusinessProfileCard orgId="org-1" hostId="host-1" />)
    await waitFor(() => expect(button('Up to date').disabled).toBe(true))
    expect(box('What the business does').value).toBe('')
  })
})
