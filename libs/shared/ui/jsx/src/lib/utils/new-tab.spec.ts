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

import {
  mergeNewTabRel,
  NEW_TAB_HINT,
  newTabLinkProps,
  openInNewTab,
  openPendingTab,
  withNewTabHint,
} from './new-tab'

describe('new-tab helpers (AGL-3660)', () => {
  afterEach(() => jest.restoreAllMocks())

  it('spells the link attributes once', () => {
    expect(newTabLinkProps).toEqual({
      target: '_blank',
      rel: 'noopener noreferrer',
    })
  })

  it('appends the hint exactly once', () => {
    expect(withNewTabHint('Preview')).toBe(`Preview ${NEW_TAB_HINT}`)
    expect(withNewTabHint(withNewTabHint('Preview'))).toBe(
      `Preview ${NEW_TAB_HINT}`,
    )
  })

  it("keeps a caller's rel tokens and adds noopener noreferrer", () => {
    expect(mergeNewTabRel('nofollow')).toBe('nofollow noopener noreferrer')
    expect(mergeNewTabRel('noreferrer')).toBe('noreferrer noopener')
    expect(mergeNewTabRel(undefined)).toBe('noopener noreferrer')
  })

  it('opens a URL in a new, unlinked tab', () => {
    const open = jest.spyOn(window, 'open').mockReturnValue(null)
    openInNewTab('https://acme.example/')
    expect(open).toHaveBeenCalledWith(
      'https://acme.example/',
      '_blank',
      'noopener,noreferrer',
    )
  })

  /**
   * The bug this replaced: `window.open('', '_blank', 'noopener')` returns
   * null, so the caller could not navigate the tab it opened and sent the
   * console tab to the preview instead.
   */
  it('navigates the pending tab, never the console tab', () => {
    const replace = jest.fn()
    const tab = {
      opener: window,
      closed: false,
      close: jest.fn(),
      location: { replace },
    }
    const open = jest
      .spyOn(window, 'open')
      .mockReturnValue(tab as unknown as Window)
    const pending = openPendingTab()
    expect(open).toHaveBeenCalledWith('about:blank', '_blank')
    expect(tab.opener).toBeNull()
    pending.navigate('https://acme.example/preview')
    expect(replace).toHaveBeenCalledWith('https://acme.example/preview')
  })

  it('falls back to a fresh new tab when the blank one was blocked', () => {
    const open = jest.spyOn(window, 'open').mockReturnValue(null)
    const pending = openPendingTab()
    pending.navigate('https://acme.example/preview')
    expect(open).toHaveBeenLastCalledWith(
      'https://acme.example/preview',
      '_blank',
      'noopener,noreferrer',
    )
    expect(() => pending.close()).not.toThrow()
  })
})
