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
import { render, screen, waitFor } from '@testing-library/react'

/**
 * The Besigner inside the native apps (AGL-3894): the editor chrome a browser
 * tab needs and an app screen does not.
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
// The bar's own chrome, each covered by its own specs; here only the arrow matters.
jest.mock('../components/layouts/app-bar-menubar.component', () => ({ __esModule: true, default: () => null }))
jest.mock('../components/global-search/global-search-trigger.component', () => ({ __esModule: true, default: () => null }))
jest.mock('../components/notification-prompt.component', () => ({ __esModule: true, default: () => null }))
jest.mock('../components/notifications-menu.component', () => ({ __esModule: true, default: () => 'web bell' }))
jest.mock('../components/offline-indicator.component', () => ({ __esModule: true, default: () => null }))
jest.mock('../components/console-top-bar-slot.component', () => ({ __esModule: true, default: () => null }))
jest.mock('../components/org-switcher-nav.component', () => ({ __esModule: true, default: () => null }))
jest.mock('../components/user-menu.component', () => ({ __esModule: true, default: () => null }))

import ConsoleBrandingEffects from '../components/console-branding-effects.component'
import MainLayout from '../components/layouts/main.layout'
import {
  isNativeAppWebView,
  markNativeAppWebView,
} from '@aglyn/aglyn/app-utils/console/besigner-entry'

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

  it('is not drawn inside the apps, whose Done button is the way out', async () => {
    setUserAgent(MAC_APP_UA)
    render(editor())
    await waitFor(() => expect(screen.queryByText('back')).toBeNull())
    expect(screen.getByText('canvas')).toBeTruthy()
  })

  it('is not drawn for a build that only set the entry page\'s mark', async () => {
    markNativeAppWebView()
    render(editor())
    await waitFor(() => expect(screen.queryByText('back')).toBeNull())
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
