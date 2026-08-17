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
 * The ready admin bar as TOP platform chrome (AGL-1829):
 *
 * - fixed to the top, not the bottom, and pushes the page down by its own
 *   height (html margin + scroll-padding), restored when it leaves;
 * - a site header that is itself fixed at `top: 0` is nudged down the same
 *   amount, and restored;
 * - content, left to right: site name linking to the host dashboard, screen
 *   name, draft indicator (only when the server says TRUE), Edit this page,
 *   plugin-gated quick links (Orders absent when its URL is null),
 *   connected-as identity;
 * - Disconnect clears the token, remembers the opt-out, and unmounts;
 * - × dismisses for this pageview only — storage untouched.
 */

import { act, render, screen, waitFor } from '@testing-library/react'
import AdminBar from '../app/[host]/admin-bar/admin-bar'
import {
  editOptOutStorageKey,
  editTokenStorageKey,
} from '../app/[host]/admin-bar/admin-bar-shared'

const HOST = 'host-1'
const CONSOLE_ORIGIN = 'https://app.aglyn.com'

// Loosely indexed so per-test overrides can null any field the payload
// makes nullable (viewsToday, accountUrl, …) without fighting inference.
const CONTEXT_RESPONSE: Record<string, unknown> = {
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

function storeToken(): void {
  window.localStorage.setItem(
    editTokenStorageKey(HOST),
    JSON.stringify({
      token: 'aglyn-edit-bar-v1.payload.sig',
      expiresAtMs: Date.now() + 60_000,
      siteName: 'Aglyn Marketing',
      userEmail: 'editor@aglyn.com',
    }),
  )
}

function mockContext(overrides: Partial<typeof CONTEXT_RESPONSE> = {}): void {
  global.fetch = jest.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ ...CONTEXT_RESPONSE, ...overrides }),
  })) as unknown as typeof fetch
}

async function renderReadyBar(
  overrides: Partial<typeof CONTEXT_RESPONSE> = {},
) {
  mockContext(overrides)
  storeToken()
  const view = render(
    <AdminBar hostId={HOST} consoleOrigin={CONSOLE_ORIGIN} />,
  )
  await waitFor(() =>
    expect(screen.getByRole('region', { name: 'Aglyn admin bar' })).toBeTruthy(),
  )
  return view
}

function linkByText(text: string): HTMLAnchorElement {
  const link = screen.getByText(text).closest('a')
  expect(link).not.toBeNull()
  return link as HTMLAnchorElement
}

describe('AdminBar top chrome (AGL-1829)', () => {
  beforeEach(() => {
    window.localStorage.clear()
    window.sessionStorage.clear()
    document.documentElement.style.marginTop = ''
    document.documentElement.style.scrollPaddingTop = ''
    document.body.innerHTML = ''
  })

  it('fixes to the top and pushes the page down while mounted', async () => {
    const { unmount } = await renderReadyBar()
    const bar = screen.getByRole('region', { name: 'Aglyn admin bar' })
    expect(bar.style.position).toBe('fixed')
    expect(bar.style.top).toBe('0px')
    expect(bar.style.bottom).toBe('')
    expect(document.documentElement.style.marginTop).toBe('40px')
    expect(document.documentElement.style.scrollPaddingTop).toBe('40px')
    unmount()
    expect(document.documentElement.style.marginTop).toBe('')
    expect(document.documentElement.style.scrollPaddingTop).toBe('')
  })

  it('nudges a top-anchored fixed site header down, and restores it', async () => {
    const siteHeader = document.createElement('header')
    siteHeader.style.position = 'fixed'
    siteHeader.style.top = '0px'
    document.body.appendChild(siteHeader)
    const staticHeader = document.createElement('nav')
    document.body.appendChild(staticHeader)

    const { unmount } = await renderReadyBar()
    expect(siteHeader.style.top).toBe('40px')
    expect(staticHeader.style.top).toBe('')
    unmount()
    expect(siteHeader.style.top).toBe('0px')
  })

  it('brands the bar with the real Aglyn mark, not a placeholder glyph', async () => {
    await renderReadyBar()
    const brandLink = linkByText('Aglyn Marketing')
    const mark = brandLink.querySelector('svg[data-aglyn-mark]')
    expect(mark).not.toBeNull()
    const paths = mark?.querySelectorAll('path') ?? []
    expect(paths.length).toBe(2)
    // Pinned to the canonical path data in
    // libs/shared/ui/jsx/src/lib/const/svg-icons.tsx (AglynLogoMark) — if
    // the brand mark changes there, this duplicate must follow.
    expect(paths[0]?.getAttribute('d')?.startsWith('M5,16.202l-0.267')).toBe(
      true,
    )
    expect(paths[1]?.getAttribute('d')?.startsWith('M15,9.997c0.323')).toBe(
      true,
    )
    // The brand "multi" fills, visible on the dark bar.
    expect(paths[0]?.getAttribute('fill')).toBe('#e040fb')
    expect(paths[1]?.getAttribute('fill')).toBe('#00b0ff')
    // The old placeholder was a literal "A" tile.
    expect(brandLink.textContent).toBe('Aglyn Marketing')
  })

  it('lays out the detail: dashboard link, screen, draft flag, quick links, identity', async () => {
    await renderReadyBar()
    expect(linkByText('Aglyn Marketing').href).toBe(CONTEXT_RESPONSE.consoleUrl)
    expect(screen.getByText('About')).toBeTruthy()
    expect(screen.getByText('Draft changes')).toBeTruthy()
    expect(linkByText('Edit this page').href).toBe(CONTEXT_RESPONSE.editUrl)
    expect(linkByText('Screens').href).toBe(CONTEXT_RESPONSE.screensUrl)
    expect(linkByText('Inbox').href).toBe(CONTEXT_RESPONSE.inboxUrl)
    // ordersUrl is null — the link must not render at all.
    expect(screen.queryByText('Orders')).toBeNull()
    expect(screen.getByText('editor@aglyn.com')).toBeTruthy()
  })

  it('shows the stat cluster and links it to the console analytics surface', async () => {
    await renderReadyBar()
    const stats = linkByText('128 views today · 12 on this page')
    expect(stats.href).toBe(CONTEXT_RESPONSE.analyticsUrl)
    expect(stats.target).toBe('_blank')
  })

  it('omits the per-screen figure when the server withheld it (not Pro)', async () => {
    await renderReadyBar({ screenViewsToday: null })
    expect(linkByText('128 views today')).toBeTruthy()
    expect(screen.queryByText(/on this page/)).toBeNull()
  })

  it('collapses to a plain Analytics link when the server had no verdict', async () => {
    // null is "the read failed", not zero — the bar must not invent a number.
    await renderReadyBar({ viewsToday: null, screenViewsToday: null })
    expect(linkByText('Analytics').href).toBe(CONTEXT_RESPONSE.analyticsUrl)
    expect(screen.queryByText(/views today/)).toBeNull()
  })

  it('links the connected-as identity to the console account page, in a new tab', async () => {
    await renderReadyBar()
    const identity = linkByText('editor@aglyn.com')
    expect(identity.href).toBe(`${CONSOLE_ORIGIN}/manage/user`)
    expect(identity.target).toBe('_blank')
    // Disconnect stays a separate control — a button, not part of the link.
    const disconnect = screen.getByText('Disconnect')
    expect(disconnect.tagName).toBe('BUTTON')
    expect(disconnect.closest('a')).toBeNull()
  })

  it('falls back to a plain identity span when the server sends no accountUrl', async () => {
    await renderReadyBar({ accountUrl: null })
    const identity = screen.getByText('editor@aglyn.com')
    expect(identity.closest('a')).toBeNull()
  })

  it('hides the draft flag when the server says false', async () => {
    await renderReadyBar({ draftChanges: false })
    expect(screen.queryByText('Draft changes')).toBeNull()
  })

  it('Disconnect clears the token, remembers the opt-out, and unmounts', async () => {
    await renderReadyBar()
    act(() => {
      screen.getByText('Disconnect').click()
    })
    expect(screen.queryByRole('region', { name: 'Aglyn admin bar' })).toBeNull()
    expect(window.localStorage.getItem(editTokenStorageKey(HOST))).toBeNull()
    expect(window.localStorage.getItem(editOptOutStorageKey(HOST))).toBe('1')
    // The page gets its room back.
    expect(document.documentElement.style.marginTop).toBe('')
  })

  it('× dismisses for this pageview only — storage untouched', async () => {
    await renderReadyBar()
    act(() => {
      screen.getByLabelText('Hide admin bar').click()
    })
    expect(screen.queryByRole('region', { name: 'Aglyn admin bar' })).toBeNull()
    expect(window.localStorage.getItem(editTokenStorageKey(HOST))).not.toBeNull()
    expect(window.localStorage.getItem(editOptOutStorageKey(HOST))).toBeNull()
  })
})
