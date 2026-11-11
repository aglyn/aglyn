/**
 * @jest-environment jsdom
 *
 * Pragma must stay in the FIRST block comment — behind the license header it is
 * silently ignored.
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

import { PLATFORM_BRANDING_PROFILE } from '@aglyn/aglyn'
import { PLATFORM_BRAND_NAME } from '@aglyn/aglyn/app-utils/platform-brand'
import * as shared from '@aglyn/aglyn/app-utils/native-app-web-view'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

/**
 * The Besigner inside the native apps (AGL-3894, AGL-4056): the editor chrome
 * a browser tab needs and an app screen does not, and the back arrow both keep.
 *
 * Every case here is a DIRECT open: the web view's user agent carries the
 * apps' `AglynApp/<version>` marker and the tab holds no mark from the
 * `/auth/besigner` entry page, which is how the round-4 builds reached the
 * editor. The browser case beside each one is the proof the chrome is still
 * there for everybody else.
 */

const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15'
const MAC_APP_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) AglynApp/1.4.0 (macos)'

function setUserAgent(value: string) {
  Object.defineProperty(window.navigator, 'userAgent', { value, configurable: true })
}

let mockBrandingState: {
  branding: typeof PLATFORM_BRANDING_PROFILE
  whiteLabel: boolean
  ready: boolean
}

jest.mock('../hooks/use-branding', () => ({
  __esModule: true,
  useBranding: () => mockBrandingState,
  default: () => mockBrandingState,
}))
jest.mock('../hooks/use-org-scope', () => ({
  __esModule: true,
  useOrgSlug: () => 'acme',
}))
jest.mock('../hooks/use-secondary-nav', () => ({
  __esModule: true,
  useUrlNamesOrg: () => true,
}))
// The bar's own chrome, each covered by its own specs; here only what the apps leave out or keep matters.
jest.mock('../components/layouts/app-bar-menubar.component', () => ({ __esModule: true, default: () => null }))
jest.mock('../components/global-search/global-search-trigger.component', () => ({ __esModule: true, default: () => 'web search' }))
jest.mock('../components/notification-prompt.component', () => ({ __esModule: true, default: () => null }))
jest.mock('../components/notifications-menu.component', () => ({ __esModule: true, default: () => 'web bell' }))
jest.mock('../components/offline-indicator.component', () => ({ __esModule: true, default: () => null }))
jest.mock('../components/console-top-bar-slot.component', () => ({ __esModule: true, default: () => null }))
jest.mock('../components/org-switcher-nav.component', () => ({ __esModule: true, default: () => null }))
jest.mock('../components/user-menu.component', () => ({ __esModule: true, default: () => 'web avatar' }))

import { NATIVE_BESIGNER_BACK_CONTROL_ID } from '@aglyn/aglyn/app-utils/native-besigner-back'
import ConsoleBrandingEffects from '../components/console-branding-effects.component'
import MainLayout from '../components/layouts/main.layout'
import {
  isNativeAppWebView,
  markNativeAppWebView,
} from '../utils/besigner-entry'

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

function setTitle(value: string) {
  let element = document.querySelector('title')
  if (!element) {
    element = document.createElement('title')
    document.head.appendChild(element)
  }
  element.textContent = value
}

const SERVED = `Home · Page besigner · demo.aglyn.app · ${PLATFORM_BRAND_NAME}`

beforeEach(() => {
  mockBrandingState = {
    branding: PLATFORM_BRANDING_PROFILE,
    whiteLabel: false,
    ready: true,
  }
  setUserAgent(BROWSER_UA)
})

afterEach(() => {
  window.sessionStorage.clear()
})

describe('one answer for the console and the Besigner', () => {
  it('re-exports the shared detection, so the two can never disagree', () => {
    expect(isNativeAppWebView).toBe(shared.isNativeAppWebView)
    expect(markNativeAppWebView).toBe(shared.markNativeAppWebView)
  })
})

describe('the editor\'s back arrow', () => {
  const editor = () => (
    <MainLayout besigner backButton={{ href: '/acme/hosts/demo/screens/s1/view' }}>
      <div>canvas</div>
    </MainLayout>
  )

  it('leaves the editor in a browser tab', () => {
    render(editor())
    expect(screen.getByText('back')).toBeTruthy()
  })

  // AGL-4056: the apps draw no head over the editor, so its own arrow is the way out there too.
  it('is drawn inside the apps too, by the id the apps press it with', async () => {
    setUserAgent(MAC_APP_UA)
    render(editor())
    await waitFor(() => expect(screen.getByText('back')).toBeTruthy())
    const control = document.getElementById(NATIVE_BESIGNER_BACK_CONTROL_ID)
    expect(control?.getAttribute('href')).toBe('/acme/hosts/demo/screens/s1/view')
  })

  it('is drawn for a build that only set the entry page\'s mark', async () => {
    markNativeAppWebView()
    render(editor())
    await waitFor(() => expect(document.getElementById(NATIVE_BESIGNER_BACK_CONTROL_ID)).toBeTruthy())
  })
})

describe('Esc and ⌘[ inside the apps', () => {
  const editor = () => (
    <MainLayout besigner backButton={{ href: '/acme/hosts/demo/screens/s1/view' }}>
      <input aria-label="heading" />
    </MainLayout>
  )

  /** Counts presses of the back control, without leaving the test page. */
  function watchBack() {
    const control = document.getElementById(NATIVE_BESIGNER_BACK_CONTROL_ID) as HTMLElement
    const pressed = jest.fn((event: Event) => event.preventDefault())
    control.addEventListener('click', pressed)
    return pressed
  }

  it('Esc on the editor presses the back control', async () => {
    setUserAgent(MAC_APP_UA)
    render(editor())
    await waitFor(() => expect(document.getElementById(NATIVE_BESIGNER_BACK_CONTROL_ID)).toBeTruthy())
    const pressed = watchBack()
    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(pressed).toHaveBeenCalledTimes(1)
  })

  it('⌘[ presses it too', async () => {
    setUserAgent(MAC_APP_UA)
    render(editor())
    await waitFor(() => expect(document.getElementById(NATIVE_BESIGNER_BACK_CONTROL_ID)).toBeTruthy())
    const pressed = watchBack()
    fireEvent.keyDown(document.body, { key: '[', metaKey: true })
    expect(pressed).toHaveBeenCalledTimes(1)
  })

  it('Esc in a field stays the field\'s', async () => {
    setUserAgent(MAC_APP_UA)
    render(editor())
    await waitFor(() => expect(document.getElementById(NATIVE_BESIGNER_BACK_CONTROL_ID)).toBeTruthy())
    const pressed = watchBack()
    fireEvent.keyDown(screen.getByLabelText('heading'), { key: 'Escape' })
    expect(pressed).not.toHaveBeenCalled()
  })

  it('leaves a browser tab\'s Esc alone', () => {
    render(editor())
    const pressed = watchBack()
    fireEvent.keyDown(document.body, { key: 'Escape' })
    fireEvent.keyDown(document.body, { key: '[', metaKey: true })
    expect(pressed).not.toHaveBeenCalled()
  })
})

describe('the bar\'s duplicates of the apps\' own chrome', () => {
  const editor = () => (
    <MainLayout besigner backButton={{ href: '/acme/hosts/demo/screens/s1/view' }}>
      <div>canvas</div>
    </MainLayout>
  )

  it('a browser tab keeps the workspace search and the avatar', () => {
    render(editor())
    expect(screen.getByText('web search')).toBeTruthy()
    expect(screen.getByText('web avatar')).toBeTruthy()
  })

  it('the apps leave both out: their own ⌘K and account menu are the ones', async () => {
    setUserAgent(MAC_APP_UA)
    render(editor())
    await waitFor(() => expect(screen.queryByText('web search')).toBeNull())
    expect(screen.queryByText('web avatar')).toBeNull()
    expect(screen.getByText('canvas')).toBeTruthy()
  })
})

describe('the web notifications bell', () => {
  const editor = () => (
    <MainLayout besigner backButton={{ href: '/acme/hosts/demo/screens/s1/view' }}>
      <div>canvas</div>
    </MainLayout>
  )

  it('rings in a browser tab', () => {
    render(editor())
    expect(screen.getByText('web bell')).toBeTruthy()
  })

  it('is left out inside the apps, which keep their own notifications', async () => {
    setUserAgent(MAC_APP_UA)
    render(editor())
    await waitFor(() => expect(screen.queryByText('web bell')).toBeNull())
    expect(screen.getByText('canvas')).toBeTruthy()
  })
})

describe('the page title', () => {
  it('keeps the brand in a browser tab', async () => {
    setTitle(SERVED)
    const { unmount } = render(<ConsoleBrandingEffects />)
    await settle()
    expect(document.title).toBe(SERVED)
    unmount()
  })

  it('drops the trailing brand inside the apps, and keeps it dropped across navigations', async () => {
    setUserAgent(MAC_APP_UA)
    setTitle(SERVED)
    const { unmount } = render(<ConsoleBrandingEffects />)
    await waitFor(() => expect(document.title).toBe('Home · Page besigner · demo.aglyn.app'))
    // Next rewrites <title> on a client navigation; the observer answers it.
    setTitle(`About · Page besigner · demo.aglyn.app · ${PLATFORM_BRAND_NAME}`)
    await waitFor(() => expect(document.title).toBe('About · Page besigner · demo.aglyn.app'))
    unmount()
  })

  it('drops a white-label org\'s brand too, rather than renaming it', async () => {
    setUserAgent(MAC_APP_UA)
    mockBrandingState = {
      branding: { ...PLATFORM_BRANDING_PROFILE, productName: 'Northwind' },
      whiteLabel: true,
      ready: true,
    }
    setTitle(SERVED)
    const { unmount } = render(<ConsoleBrandingEffects />)
    await waitFor(() => expect(document.title).toBe('Home · Page besigner · demo.aglyn.app'))
    expect(document.title).not.toContain('Northwind')
    unmount()
  })
})
