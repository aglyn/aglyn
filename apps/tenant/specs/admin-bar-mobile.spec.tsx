/**
 * @jest-environment jsdom
 * @jest-environment-options {"url": "https://www.aglyn.com/about"}
 *
 * Pragmas must stay in the FIRST block comment — behind the license header
 * they are silently ignored.
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
 * The admin bar at phone widths (AGL-1829 mobile pass).
 *
 * jsdom does not APPLY media queries, so what a phone actually shows cannot
 * be asserted end-to-end here. The suite decomposes the guarantee into what
 * jsdom CAN prove:
 *
 * - the `<style>` tag the bar ships carries the exact media-query rules
 *   (breakpoint, 44px mobile height, desktop-hide/mobile-show with the
 *   `!important` that beats inline styles, ≥40px touch targets);
 * - the elements carry the classes those rules select — the collapse set
 *   ([mark] [site name] [Edit] [⋯] [×] stays, everything else is
 *   `.aglyn-ab-desktop`);
 * - the ⋯ menu holds the quick links, the account link and Disconnect, and
 *   its Disconnect is the real one;
 * - the page offset MEASURES the bar instead of hardcoding a height: a bar
 *   reporting 44px offsets the page by 44px on resize, and restores.
 *
 * What jsdom cannot express — the media query actually flipping the
 * classes at 639px — is covered by a manual check: load a tenant page as
 * an editor, narrow the window below 640px, confirm the row collapses and
 * the ⋯ menu opens with the remaining controls.
 */

import { act, render, screen, waitFor, within } from '@testing-library/react'
import AdminBar, {
  BAR_HEIGHT_MOBILE,
  MOBILE_BREAKPOINT,
} from '../app/[host]/admin-bar/admin-bar'
import {
  editOptOutStorageKey,
  editTokenStorageKey,
} from '../app/[host]/admin-bar/admin-bar-shared'

const HOST = 'host-1'
const CONSOLE_ORIGIN = 'https://app.aglyn.com'

const CONTEXT_RESPONSE = {
  siteName: 'Aglyn Marketing',
  screenId: 'screen-1',
  screenName: 'About',
  versionId: 'v-live',
  draftChanges: true,
  editUrl: `${CONSOLE_ORIGIN}/acme/hosts/www/screens/screen-1/versions/v-live/besigner`,
  consoleUrl: `${CONSOLE_ORIGIN}/acme/hosts/www`,
  screensUrl: `${CONSOLE_ORIGIN}/acme/hosts/www/screens`,
  inboxUrl: `${CONSOLE_ORIGIN}/acme/hosts/www/inbox`,
  ordersUrl: null,
  analyticsUrl: `${CONSOLE_ORIGIN}/acme/hosts/www/analytics`,
  viewsToday: 128,
  screenViewsToday: 12,
  accountUrl: `${CONSOLE_ORIGIN}/manage/user`,
}

async function renderReadyBar(
  overrides: Partial<typeof CONTEXT_RESPONSE> = {},
) {
  global.fetch = jest.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ ...CONTEXT_RESPONSE, ...overrides }),
  })) as unknown as typeof fetch
  window.localStorage.setItem(
    editTokenStorageKey(HOST),
    JSON.stringify({
      token: 'aglyn-edit-bar-v1.payload.sig',
      expiresAtMs: Date.now() + 60_000,
      siteName: 'Aglyn Marketing',
      userEmail: 'editor@aglyn.com',
    }),
  )
  const view = render(
    <AdminBar hostId={HOST} consoleOrigin={CONSOLE_ORIGIN} />,
  )
  await waitFor(() =>
    expect(screen.getByRole('region', { name: 'Aglyn admin bar' })).toBeTruthy(),
  )
  return view
}

function barRegion(): HTMLElement {
  return screen.getByRole('region', { name: 'Aglyn admin bar' })
}

function barCss(): string {
  const style = barRegion().querySelector('style')
  expect(style).not.toBeNull()
  return style?.textContent ?? ''
}

describe('AdminBar at phone widths (AGL-1829)', () => {
  beforeEach(() => {
    window.localStorage.clear()
    window.sessionStorage.clear()
    document.documentElement.style.marginTop = ''
    document.documentElement.style.scrollPaddingTop = ''
    document.body.innerHTML = ''
  })

  it('ships the phone-width rules in its own <style> tag', async () => {
    await renderReadyBar()
    const css = barCss()
    // Base: 40px bar, mobile-only controls hidden.
    expect(css).toContain('.aglyn-admin-bar{height:40px')
    expect(css).toContain('.aglyn-ab-mobile{display:none !important;}')
    // Below the breakpoint: 44px bar, desktop set hidden, mobile set shown —
    // with the !important that outranks the elements' inline styles.
    expect(css).toContain(`@media (max-width:${MOBILE_BREAKPOINT - 1}px)`)
    expect(css).toContain(`height:${BAR_HEIGHT_MOBILE}px`)
    expect(css).toContain('.aglyn-ab-desktop{display:none !important;}')
    expect(css).toContain('.aglyn-ab-mobile{display:inline-flex !important;}')
    // Touch targets ≥40px for every control that stays.
    expect(css).toContain('min-height:40px')
    expect(css).toContain('min-width:40px')
  })

  it('collapses to [mark] [site name] [Edit] [⋯] [×]: everything else is desktop-classed', async () => {
    await renderReadyBar()
    const bar = barRegion()
    // The collapse survivors must NOT carry the desktop-only class.
    const brand = within(bar).getByText('Aglyn Marketing').closest('a')
    expect(brand?.classList.contains('aglyn-ab-desktop')).toBe(false)
    const edit = within(bar).getByText('Edit this page')
    expect(edit.classList.contains('aglyn-ab-desktop')).toBe(false)
    expect(
      within(bar)
        .getByLabelText('Hide admin bar')
        .classList.contains('aglyn-ab-desktop'),
    ).toBe(false)
    // Everything else does.
    for (const text of [
      'About',
      'Draft changes',
      'Screens',
      'Inbox',
      '128 views today · 12 on this page',
    ]) {
      const element = within(bar).getByText(text)
      expect(
        (element.closest('.aglyn-ab-desktop') ?? element).classList.contains(
          'aglyn-ab-desktop',
        ),
      ).toBe(true)
    }
    // The user-menu trigger (identity + account rows) is desktop-only; the
    // ⋯ menu carries the same rows below the breakpoint instead — two
    // dropdowns competing for a 44px bar would be chrome noise.
    expect(
      within(bar)
        .getByRole('button', {
          name: 'Account menu — connected as editor@aglyn.com',
        })
        .classList.contains('aglyn-ab-desktop'),
    ).toBe(true)
    // Disconnect lives only inside the menus now.
    expect(within(bar).queryByText('Disconnect')).toBeNull()
    // The ⋯ trigger is the mobile-only counterpart.
    const more = within(bar).getByLabelText('More admin bar options')
    expect(more.classList.contains('aglyn-ab-mobile')).toBe(true)
  })

  it('opens the ⋯ menu with quick links, the account link and Disconnect', async () => {
    await renderReadyBar()
    const more = screen.getByLabelText('More admin bar options')
    expect(more.getAttribute('aria-expanded')).toBe('false')
    // Closed means UNMOUNTED — no duplicate links for desktop users or
    // screen readers.
    expect(screen.queryByRole('menu')).toBeNull()

    act(() => {
      more.click()
    })
    expect(more.getAttribute('aria-expanded')).toBe('true')
    const menu = screen.getByRole('menu', { name: 'Admin bar menu' })
    expect(
      (within(menu).getByText('Screens') as HTMLAnchorElement).href,
    ).toBe(CONTEXT_RESPONSE.screensUrl)
    expect(
      (within(menu).getByText('Inbox') as HTMLAnchorElement).href,
    ).toBe(CONTEXT_RESPONSE.inboxUrl)
    // ordersUrl is null — absent from the menu like the bar.
    expect(within(menu).queryByText('Orders')).toBeNull()
    // The analytics row carries the stat cluster into the collapsed menu.
    expect(
      (
        within(menu).getByText(
          'Analytics · 128 views today · 12 on this page',
        ) as HTMLAnchorElement
      ).href,
    ).toBe(CONTEXT_RESPONSE.analyticsUrl)
    const account = within(menu).getByText(
      'editor@aglyn.com',
    ) as HTMLAnchorElement
    expect(account.href).toBe(CONTEXT_RESPONSE.accountUrl)
    expect(account.target).toBe('_blank')
    expect(within(menu).getByText('Disconnect').tagName).toBe('BUTTON')

    // A followed link closes the menu.
    act(() => {
      within(menu).getByText('Screens').click()
    })
    expect(screen.queryByRole('menu')).toBeNull()
    expect(more.getAttribute('aria-expanded')).toBe('false')
  })

  it("the menu's Disconnect is the real one: token gone, opt-out remembered, bar unmounted", async () => {
    await renderReadyBar()
    act(() => {
      screen.getByLabelText('More admin bar options').click()
    })
    const menu = screen.getByRole('menu', { name: 'Admin bar menu' })
    act(() => {
      within(menu).getByText('Disconnect').click()
    })
    expect(screen.queryByRole('region', { name: 'Aglyn admin bar' })).toBeNull()
    expect(window.localStorage.getItem(editTokenStorageKey(HOST))).toBeNull()
    expect(window.localStorage.getItem(editOptOutStorageKey(HOST))).toBe('1')
  })

  it('offsets the page by the MEASURED bar height, tracking resize, and restores', async () => {
    const siteHeader = document.createElement('header')
    siteHeader.style.position = 'fixed'
    siteHeader.style.top = '0px'
    document.body.appendChild(siteHeader)

    const { unmount } = await renderReadyBar()
    // jsdom reports zero geometry, so the mount fell back to BAR_HEIGHT.
    expect(document.documentElement.style.marginTop).toBe('40px')

    // Now the bar "renders" at the mobile height — as the media query would
    // below the breakpoint — and the window resizes. The offset must follow
    // the measurement, not a constant.
    const bar = barRegion()
    Object.defineProperty(bar, 'offsetHeight', {
      configurable: true,
      value: BAR_HEIGHT_MOBILE,
    })
    act(() => {
      window.dispatchEvent(new Event('resize'))
    })
    expect(document.documentElement.style.marginTop).toBe(
      `${BAR_HEIGHT_MOBILE}px`,
    )
    expect(document.documentElement.style.scrollPaddingTop).toBe(
      `${BAR_HEIGHT_MOBILE}px`,
    )
    expect(siteHeader.style.top).toBe(`${BAR_HEIGHT_MOBILE}px`)

    // Back to the desktop height on the next resize.
    Object.defineProperty(bar, 'offsetHeight', {
      configurable: true,
      value: 40,
    })
    act(() => {
      window.dispatchEvent(new Event('resize'))
    })
    expect(document.documentElement.style.marginTop).toBe('40px')
    expect(siteHeader.style.top).toBe('40px')

    unmount()
    expect(document.documentElement.style.marginTop).toBe('')
    expect(document.documentElement.style.scrollPaddingTop).toBe('')
    expect(siteHeader.style.top).toBe('0px')
  })
})
