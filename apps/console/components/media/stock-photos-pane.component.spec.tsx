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
 * The Stock photos pane (AGL-4066) talks to the console's route as the
 * signed-in member, for the one library it was opened for, and hands its
 * client to the dialog for the confirm button.
 */

import { act, render, screen } from '@testing-library/react'
import StockPhotosPane from './stock-photos-pane.component'

const mockUser = { getIdToken: jest.fn(async () => 'id-token-1') }
let mockSignedIn: unknown = mockUser

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useUser: () => ({ data: mockSignedIn }),
}))

/** The route's answer, as much of a Response as the client reads. */
const fetchMock = jest.fn(async () => ({
  ok: true,
  status: 200,
  json: async () => ({ status: 'ready', library: { label: 'Pixabay' } }),
}))

beforeEach(() => {
  fetchMock.mockClear()
  mockSignedIn = mockUser
  Object.assign(globalThis, { fetch: fetchMock })
})

describe('the Stock photos pane', () => {
  it('asks the route as the member, for the library it was opened for', async () => {
    const onClient = jest.fn()
    await act(async () => {
      render(<StockPhotosPane target={{ hostId: 'h1' }} libraryName="this site's library" onSelect={jest.fn()} onClient={onClient} />)
    })
    expect(await screen.findByText(/Photos come from Pixabay/)).toBeTruthy()
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/api/media/stock-photos')
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer id-token-1')
    expect(JSON.parse(String(init.body))).toEqual({ action: 'status', hostId: 'h1' })
    expect(onClient).toHaveBeenLastCalledWith(expect.objectContaining({ importPhoto: expect.any(Function) }))
  })

  it('waits for sign-in to resolve before asking anything', async () => {
    mockSignedIn = undefined
    const onClient = jest.fn()
    await act(async () => {
      render(<StockPhotosPane target={{ orgId: 'o1' }} libraryName="the library" onSelect={jest.fn()} onClient={onClient} />)
    })
    expect(screen.getByRole('progressbar', { name: 'Loading stock photos' })).toBeTruthy()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(onClient).toHaveBeenLastCalledWith(null)
  })
})
