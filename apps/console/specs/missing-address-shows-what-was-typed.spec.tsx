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
 * `/_missing` puts the typed address back in the address bar (AGL-3290).
 *
 * The middleware forwards an address that names no workspace to
 * `/_missing?from=<that address>`. Once the visitor is there, the bar should
 * show what they typed — but `from` is a query parameter anyone can write, so
 * only a path on this origin may ever reach `history.replaceState`.
 */
import { render } from '@testing-library/react'

const search = { value: '' }

jest.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(search.value),
}))
// The shell is not what is under test, and it drags in the whole auth stack.
jest.mock('../components/layouts/authenticated.layout', () => ({
  __esModule: true,
  default: ({ children }: { children: unknown }) => children,
}))
jest.mock('../components/layouts/main.layout', () => ({
  __esModule: true,
  default: ({ children }: { children: unknown }) => children,
}))
jest.mock('../components/not-found-content.component', () => ({
  __esModule: true,
  default: () => null,
}))

async function renderWith(query: string) {
  search.value = query
  const { RestoreRequestedAddress } = await import(
    '../components/missing-address.component'
  )
  render(<RestoreRequestedAddress />)
}

describe('the not-found page shows the address that was typed (AGL-3290)', () => {
  let replaceState: jest.SpyInstance

  beforeEach(() => {
    replaceState = jest
      .spyOn(window.history, 'replaceState')
      .mockImplementation(() => undefined)
  })
  afterEach(() => replaceState.mockRestore())

  it('writes the typed path, query and all, back into the address bar', async () => {
    await renderWith(`from=${encodeURIComponent('/sign?tab=a')}`)
    expect(replaceState).toHaveBeenCalledWith(null, '', '/sign?tab=a')
  })

  it.each([
    ['a protocol-relative address', '//evil.example/x'],
    ['an absolute URL', 'https://evil.example/'],
    ['a backslash the URL parser reads as a slash', '/\\evil.example'],
    ['no address at all', ''],
  ])('writes nothing for %s', async (_case, from) => {
    await renderWith(from ? `from=${encodeURIComponent(from)}` : '')
    expect(replaceState).not.toHaveBeenCalled()
  })
})
