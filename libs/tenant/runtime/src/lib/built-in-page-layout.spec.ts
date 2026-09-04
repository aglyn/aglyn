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
jest.mock('./get-screen-version', () => ({
  __esModule: true,
  default: jest.fn(),
}))

import getScreen from './get-screen'
import getScreenVersion from './get-screen-version'
import { resolveBuiltInPageLayoutId } from './built-in-page-layout'

const mockGetScreen = getScreen as unknown as jest.Mock
const mockGetScreenVersion = getScreenVersion as unknown as jest.Mock

const HOST = { $id: 'host-1', screens: { home: '/', about: 'about' } }

beforeEach(() => {
  jest.clearAllMocks()
  mockGetScreen.mockResolvedValue({
    screen: { $id: 'home', layoutId: 'homeLayout' },
    error: null,
  })
  // No version by default, so every case written before AGL-2518 keeps
  // exercising the screen binding it was written against.
  mockGetScreenVersion.mockResolvedValue({ version: undefined, error: null })
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

/**
 * The binding lives on the VERSION more often than on the screen (AGL-2518).
 *
 * This fallback read `screen.layoutId` alone, and its own comment asserted
 * that "screens carry their own `layoutId`". They frequently do not: choosing
 * a layout while editing writes it to the version document, and
 * `composeScreenNodes` has always resolved version-first for exactly that
 * reason.
 *
 * The cost was total and silent. A host whose home page was bound that way
 * resolved to `undefined`, so EVERY built-in page rendered with no header, no
 * nav and no footer — the defect AGL-2513 was filed to fix, still in force
 * after it shipped. `aglyn.com` was that shape: home page on "Marketing base"
 * via its version, `builtInPageLayoutId` unset, `/search` chrome-less and
 * unvisited. AGL-2518 pointed every byline on the site at a built-in page and
 * turned an unnoticed defect into the most-linked page on the site being a
 * dead end.
 */
describe('the home page’s layout lives on its version (AGL-2518)', () => {
  it('takes the version’s binding over the screen’s', async () => {
    mockGetScreen.mockResolvedValue({
      // The real shape on aglyn.com: no `layoutId` on the screen at all.
      screen: { $id: 'home', versionId: 'v1' },
      error: null,
    })
    mockGetScreenVersion.mockResolvedValue({
      version: { layoutId: 'marketingBase' },
      error: null,
    })
    expect(
      await resolveBuiltInPageLayoutId({ hostId: 'host-1', host: HOST }),
    ).toBe('marketingBase')
  })

  it('lets the version override a screen that has its own', async () => {
    // Key-present on the version wins, which is composition's rule — so the
    // built-in page lands in the same layout as the home page it copies.
    mockGetScreen.mockResolvedValue({
      screen: { $id: 'home', versionId: 'v1', layoutId: 'staleLayout' },
      error: null,
    })
    mockGetScreenVersion.mockResolvedValue({
      version: { layoutId: 'marketingBase' },
      error: null,
    })
    expect(
      await resolveBuiltInPageLayoutId({ hostId: 'host-1', host: HOST }),
    ).toBe('marketingBase')
  })

  it('honours an explicit null on the version as "no layout"', async () => {
    // `null` is a deliberate choice, not an absent key, and composition
    // treats it that way. Falling through to the screen here would give a
    // built-in page chrome the home page itself has turned off.
    mockGetScreen.mockResolvedValue({
      screen: { $id: 'home', versionId: 'v1', layoutId: 'homeLayout' },
      error: null,
    })
    mockGetScreenVersion.mockResolvedValue({
      version: { layoutId: null },
      error: null,
    })
    expect(
      await resolveBuiltInPageLayoutId({ hostId: 'host-1', host: HOST }),
    ).toBeUndefined()
  })

  it('falls back to the screen when the version carries no key', async () => {
    mockGetScreen.mockResolvedValue({
      screen: { $id: 'home', versionId: 'v1', layoutId: 'homeLayout' },
      error: null,
    })
    mockGetScreenVersion.mockResolvedValue({ version: {}, error: null })
    expect(
      await resolveBuiltInPageLayoutId({ hostId: 'host-1', host: HOST }),
    ).toBe('homeLayout')
  })

  it('falls back to the screen when the version read throws', async () => {
    // Fail-open, as composition does: a version read that dies must not cost
    // the page its chrome.
    mockGetScreen.mockResolvedValue({
      screen: { $id: 'home', versionId: 'v1', layoutId: 'homeLayout' },
      error: null,
    })
    mockGetScreenVersion.mockRejectedValue(new Error('permission denied'))
    expect(
      await resolveBuiltInPageLayoutId({ hostId: 'host-1', host: HOST }),
    ).toBe('homeLayout')
  })

  it('does not read a version when the host designated a layout', async () => {
    // The designated id short-circuits before any read at all.
    await resolveBuiltInPageLayoutId({
      hostId: 'host-1',
      host: { ...HOST, builtInPageLayoutId: 'searchLayout' },
    })
    expect(mockGetScreenVersion).not.toHaveBeenCalled()
    expect(mockGetScreen).not.toHaveBeenCalled()
  })
})
