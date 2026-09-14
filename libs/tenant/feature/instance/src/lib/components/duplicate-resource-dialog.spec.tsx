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
 * The Duplicate dialog and the flow around it (AGL-2936): the name field
 * arrives filled, the copies list names what comes along, pressing
 * Duplicate posts ONE attempt to the resources door with a key of its own,
 * a refusal is shown in place and does not close the dialog, and a second
 * open mints a second key.
 */

import { DUPLICATE_COPIES } from '@aglyn/aglyn/app-utils/duplicate-resource'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

const mockAuthorizedFetch = jest.fn()
jest.mock('@aglyn/shared-util-http/authorized-token', () => ({
  __esModule: true,
  authorizedFetch: (...args: unknown[]) => mockAuthorizedFetch(...args),
}))
jest.mock('../hooks/firebase/firebase-services', () => ({
  __esModule: true,
  useUser: () => ({ data: { uid: 'uid-1' } }),
}))

const { useDuplicateResource } =
  require('./duplicate-resource-dialog') as typeof import('./duplicate-resource-dialog')

function Surface(props: { onDuplicated?: jest.Mock }) {
  const flow = useDuplicateResource({
    hostId: 'host-1',
    onDuplicated: props.onDuplicated,
  })
  return (
    <>
      <button onClick={() => flow.request('screen', { id: 'scr-1', name: 'Home' })}>
        {'Duplicate…'}
      </button>
      {flow.dialog}
    </>
  )
}

const answer = (status: number, body: unknown) =>
  mockAuthorizedFetch.mockResolvedValueOnce({ ok: status < 400, json: async () => body })

const postedBody = (call = 0) =>
  JSON.parse((mockAuthorizedFetch.mock.calls[call][2] as { body: string }).body)

beforeEach(() => {
  mockAuthorizedFetch.mockReset()
})

it('opens with the default name and the copies sentence for the kind', () => {
  render(<Surface />)
  fireEvent.click(screen.getByRole('button', { name: 'Duplicate…' }))
  expect(screen.getByRole('dialog', { name: 'Duplicate screen' })).toBeTruthy()
  expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('Copy of Home')
  for (const line of DUPLICATE_COPIES.screen) {
    expect(screen.getByText(line)).toBeTruthy()
  }
})

it('posts one duplicate with the typed name and an attempt key, then reports the copy', async () => {
  const onDuplicated = jest.fn()
  answer(200, { ok: true, id: 'scr-2', versionId: 'ver-2', name: 'Landing B' })
  render(<Surface onDuplicated={onDuplicated} />)
  fireEvent.click(screen.getByRole('button', { name: 'Duplicate…' }))
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Landing B' } })
  fireEvent.click(screen.getByRole('button', { name: 'Duplicate' }))

  await waitFor(() => expect(onDuplicated).toHaveBeenCalledTimes(1))
  expect(mockAuthorizedFetch).toHaveBeenCalledTimes(1)
  expect(mockAuthorizedFetch.mock.calls[0][1]).toBe('/api/hosts/resources')
  expect(postedBody()).toMatchObject({
    hostId: 'host-1',
    resource: 'screen',
    action: 'duplicate',
    sourceId: 'scr-1',
    name: 'Landing B',
    attemptKey: expect.any(String),
  })
  expect(onDuplicated).toHaveBeenCalledWith(
    'screen',
    { id: 'scr-2', versionId: 'ver-2', name: 'Landing B' },
    { id: 'scr-1', name: 'Home' },
  )
  expect(screen.queryByRole('dialog')).toBeNull()
})

it('shows a refusal in place and keeps the dialog open; a new open mints a new key', async () => {
  answer(403, { error: 'Your plan includes 5 screens — upgrade in Billing for more' })
  render(<Surface />)
  fireEvent.click(screen.getByRole('button', { name: 'Duplicate…' }))
  fireEvent.click(screen.getByRole('button', { name: 'Duplicate' }))
  await screen.findByText('Your plan includes 5 screens — upgrade in Billing for more')
  expect(screen.getByRole('dialog')).toBeTruthy()
  const firstKey = postedBody(0).attemptKey

  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  answer(200, { ok: true, id: 'scr-3', versionId: null, name: 'Copy of Home' })
  fireEvent.click(screen.getByRole('button', { name: 'Duplicate…' }))
  fireEvent.click(screen.getByRole('button', { name: 'Duplicate' }))
  await waitFor(() => expect(mockAuthorizedFetch).toHaveBeenCalledTimes(2))
  expect(postedBody(1).attemptKey).not.toBe(firstKey)
})

it('refuses an empty name without posting', () => {
  render(<Surface />)
  fireEvent.click(screen.getByRole('button', { name: 'Duplicate…' }))
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: '   ' } })
  expect(
    (screen.getByRole('button', { name: 'Duplicate' }) as HTMLButtonElement).disabled,
  ).toBe(true)
  expect(mockAuthorizedFetch).not.toHaveBeenCalled()
})
