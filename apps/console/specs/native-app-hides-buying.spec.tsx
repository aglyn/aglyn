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

import { PlanLockedControl } from '@aglyn/shared-ui-jsx/components/plan-locked-control.component'
import { PlanUpsellNotice } from '@aglyn/shared-ui-jsx/components/plan-upsell-notice.component'
import { UsageMeter } from '@aglyn/shared-ui-jsx/components/usage-meter.component'
import { render, screen, waitFor } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ReactElement } from 'react'
import NativeAppBuyingGate from '../components/native-app-buying-gate.component'

/**
 * The store builds of the apps take no payment to Aglyn and show no way to
 * start one, and the Besigner they show in a web view must not either: their
 * web view says `no-buying` in its user agent, and every control that leads
 * to buying leaves the page. In a browser, and in an app build that can buy,
 * the page is exactly what it was.
 */

const BROWSER_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'
const APP_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 AglynApp/1.4.0 (ios)'
const STORE_APP_UA = APP_UA.replace('(ios)', '(ios; no-buying)')
const STORE_ANDROID_UA =
  'Mozilla/5.0 (Linux; Android 13; sdk_gphone64_arm64; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/109.0.5414.123 Mobile Safari/537.36 AglynApp/1.4.0 (android; no-buying)'

const ORIGINAL_UA = window.navigator.userAgent

/** The Upgrade control's anchor (a button-styled link), or null where it is absent. */
const upgrade = (): HTMLAnchorElement | null => screen.queryByText('Upgrade')?.closest('a') ?? null

function setUserAgent(value: string) {
  Object.defineProperty(window.navigator, 'userAgent', { value, configurable: true })
}

afterEach(() => setUserAgent(ORIGINAL_UA))

const SENTENCE = 'Schedule a version to go live at a set time.'

const notice = (): ReactElement => (
  <PlanUpsellNotice planLabel="Pro" upgradeHref="/acme/billing#plans">
    {SENTENCE}
  </PlanUpsellNotice>
)

/** The markup the console drew before the gate existed: the notice with no provider above it. */
function ungated(element: ReactElement): string {
  const { container, unmount } = render(element)
  const html = container.innerHTML
  unmount()
  return html
}

describe('the upgrade notice, in the three places the console runs', () => {
  it('a browser tab: the Upgrade button, and the page byte for byte as it was', () => {
    setUserAgent(BROWSER_UA)
    const before = ungated(notice())
    const { container } = render(<NativeAppBuyingGate>{notice()}</NativeAppBuyingGate>)
    expect(upgrade()?.getAttribute('href')).toBe('/acme/billing#plans')
    expect(container.innerHTML).toBe(before)
  })

  it('an app build that can buy: the Upgrade button, and the page as it was', async () => {
    setUserAgent(APP_UA)
    const before = ungated(notice())
    const { container } = render(<NativeAppBuyingGate>{notice()}</NativeAppBuyingGate>)
    // The client's second render has settled: the gate answered from the user agent.
    await waitFor(() => expect(upgrade()).toBeTruthy())
    expect(container.innerHTML).toBe(before)
  })

  it.each([
    ['iPhone', STORE_APP_UA],
    ['Android', STORE_ANDROID_UA],
  ])('a %s store build: the sentence and the plan stay, the Upgrade button is absent', async (_label, ua) => {
    setUserAgent(ua)
    render(<NativeAppBuyingGate>{notice()}</NativeAppBuyingGate>)
    await waitFor(() => expect(upgrade()).toBeNull())
    expect(screen.queryByText('Upgrade')).toBeNull()
    expect(screen.getByRole('alert').textContent).toBe(`${SENTENCE} Included from Pro.`)
    expect(document.querySelector('a[href*="billing"]')).toBeNull()
  })
})

describe('the other shared plan controls follow the same answer', () => {
  const meter = (): ReactElement => (
    <UsageMeter label="Sites" used={9} limit={10} upgradeHref="/acme/billing#plans" />
  )
  const locked = (): ReactElement => (
    <PlanLockedControl locked reason="Scheduling is included from Pro." planLabel="Pro" upgradeHref="/acme/billing#plans">
      <button type="button">{'Schedule'}</button>
    </PlanLockedControl>
  )

  it.each([
    ['a browser tab', BROWSER_UA],
    ['an app build that can buy', APP_UA],
  ])('%s keeps the meter\'s Upgrade link and the locked control\'s plan link', async (_label, ua) => {
    setUserAgent(ua)
    render(
      <NativeAppBuyingGate>
        {meter()}
        {locked()}
      </NativeAppBuyingGate>,
    )
    await waitFor(() => expect(upgrade()).toBeTruthy())
    expect(screen.getByText('Included from Pro')).toBeTruthy()
  })

  it('a store build leaves both links out; the amber bar and the disabled control stay', async () => {
    setUserAgent(STORE_APP_UA)
    render(
      <NativeAppBuyingGate>
        {meter()}
        {locked()}
      </NativeAppBuyingGate>,
    )
    await waitFor(() => expect(upgrade()).toBeNull())
    expect(screen.queryByText('Included from Pro')).toBeNull()
    expect(screen.getByRole('progressbar')).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Schedule' }) as HTMLButtonElement).disabled).toBe(true)
    expect(document.querySelector('a[href*="billing"]')).toBeNull()
  })
})

describe('the console mounts the gate once, above every page', () => {
  it('wraps the whole client stack in the providers', () => {
    const providers = readFileSync(join(__dirname, '../app/providers.tsx'), 'utf8')
    expect(providers).toContain("import NativeAppBuyingGate from '../components/native-app-buying-gate.component'")
    expect(providers.indexOf('<NativeAppBuyingGate>')).toBeLessThan(providers.indexOf('<FirebaseAppLayout>'))
    expect(providers.indexOf('</NativeAppBuyingGate>')).toBeGreaterThan(providers.indexOf('</FirebaseAppLayout>'))
  })
})
