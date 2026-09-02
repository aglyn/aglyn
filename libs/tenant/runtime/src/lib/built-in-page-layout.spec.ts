/**
 * @jest-environment node
 *
 * Must stay the FIRST block comment in the file — Jest reads the pragma only
 * from the opening docblock, so a license header above it silently leaves the
 * suite on jsdom.
 *
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
 * Which layout wraps a page the platform composed (AGL-2513).
 *
 * The default matters as much as the setting: every site had the home page's
 * layout implicitly before this existed, so a site that never opens the card
 * must keep getting exactly that. The fallback to `undefined` matters more —
 * it is what makes a deleted layout a chrome-less search page instead of a
 * failed one.
 */

jest.mock('./get-screen', () => ({
  __esModule: true,
  default: jest.fn(),
}))

import getScreen from './get-screen'
import { resolveBuiltInPageLayoutId } from './built-in-page-layout'

const mockGetScreen = getScreen as unknown as jest.Mock

const HOST = { $id: 'host-1', screens: { home: '/', about: 'about' } }

beforeEach(() => {
  jest.clearAllMocks()
  mockGetScreen.mockResolvedValue({
    screen: { $id: 'home', layoutId: 'homeLayout' },
    error: null,
  })
})

describe('resolveBuiltInPageLayoutId (AGL-2513)', () => {
  it('takes the host’s designated layout', async () => {
    const layoutId = await resolveBuiltInPageLayoutId({
      hostId: 'host-1',
      host: { ...HOST, builtInPageLayoutId: 'searchLayout' },
    })

    expect(layoutId).toBe('searchLayout')
    // The point of designating one is not paying for the home screen read.
    expect(mockGetScreen).not.toHaveBeenCalled()
  })

  it('falls back to the layout the home page uses', async () => {
    const layoutId = await resolveBuiltInPageLayoutId({
      hostId: 'host-1',
      host: HOST,
    })

    expect(layoutId).toBe('homeLayout')
    expect(mockGetScreen).toHaveBeenCalledWith({
      hostId: 'host-1',
      screenId: 'home',
    })
  })

  it('ignores a designation that is only whitespace', async () => {
    const layoutId = await resolveBuiltInPageLayoutId({
      hostId: 'host-1',
      host: { ...HOST, builtInPageLayoutId: '   ' },
    })

    expect(layoutId).toBe('homeLayout')
  })

  it('answers undefined when the home page has no layout either', async () => {
    mockGetScreen.mockResolvedValue({ screen: { $id: 'home' }, error: null })

    expect(
      await resolveBuiltInPageLayoutId({ hostId: 'host-1', host: HOST }),
    ).toBeUndefined()
  })

  it('answers undefined for a site with no home page', async () => {
    expect(
      await resolveBuiltInPageLayoutId({
        hostId: 'host-1',
        host: { $id: 'host-1', screens: { about: 'about' } },
      }),
    ).toBeUndefined()
  })

  it('fails open — a read that throws costs chrome, never the page', async () => {
    mockGetScreen.mockRejectedValue(new Error('firestore down'))
    const spy = jest.spyOn(console, 'error').mockImplementation(() => undefined)

    expect(
      await resolveBuiltInPageLayoutId({ hostId: 'host-1', host: HOST }),
    ).toBeUndefined()
    spy.mockRestore()
  })
})
