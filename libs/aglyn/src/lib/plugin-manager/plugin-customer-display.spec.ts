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
  customerDisplayCredential,
  customerDisplayHost,
  customerDisplayReturnPath,
  customerDisplayScreenHref,
  registerCustomerDisplayHost,
  rememberCustomerDisplayCredential,
  sanitizeCustomerDisplayScreen,
  subscribeCustomerDisplayHost,
} from './plugin-customer-display'

/**
 * A plugin's screen on a paired customer display (AGL-4042): the shape a
 * register may store, where the display opens it, the only address the
 * screen may send the display back to, and the host the register's page
 * offers while it has a display. Names no plugin: the fixtures are invented.
 */

const SCREEN = { pluginId: 'acme-forms', path: '/display-fill', params: { form: 'f1', host: 'host-1' } }

describe('a screen a register may store', () => {
  it('keeps a declared-shape plugin page and its short plain parameters', () => {
    expect(sanitizeCustomerDisplayScreen(SCREEN)).toEqual(SCREEN)
    expect(sanitizeCustomerDisplayScreen({ ...SCREEN, params: undefined })).toEqual({ ...SCREEN, params: {} })
  })

  it('refuses anything else, so nothing opens on the display unchecked', () => {
    const refused = [
      { ...SCREEN, pluginId: 'Acme' },
      { ...SCREEN, pluginId: '../commerce' },
      { ...SCREEN, path: 'display-fill' },
      { ...SCREEN, path: '/display-fill?x=1' },
      { ...SCREEN, path: 'https://evil.example.com/' },
      { ...SCREEN, path: '//evil.example.com' },
      { ...SCREEN, params: { return: '/kiosk/acme-forms/other' } },
      { ...SCREEN, params: { 'bad key': 'x' } },
      { ...SCREEN, params: { grant: 7 } },
      { ...SCREEN, params: { grant: 'x'.repeat(2001) } },
      { ...SCREEN, params: Object.fromEntries(Array.from({ length: 9 }, (_, index) => [`k${index}`, 'v'])) },
      null,
      'screen',
    ]
    for (const raw of refused) expect(sanitizeCustomerDisplayScreen(raw)).toBeNull()
  })
})

describe('where the display opens it, and where it comes back', () => {
  it('opens the plugin’s public page with its parameters and the display’s own address', () => {
    const href = customerDisplayScreenHref(SCREEN, '/kiosk/acme-pos/display') as string
    const url = new URL(href, 'https://console.example.com')
    expect(url.pathname).toBe('/kiosk/acme-forms/display-fill')
    expect(Object.fromEntries(url.searchParams)).toEqual({ form: 'f1', host: 'host-1', return: '/kiosk/acme-pos/display' })
    expect(customerDisplayReturnPath(url.search)).toBe('/kiosk/acme-pos/display')
  })

  it('never sends the display anywhere but a public console page', () => {
    expect(customerDisplayScreenHref(SCREEN, 'https://evil.example.com')).toBeNull()
    expect(customerDisplayScreenHref(SCREEN, '/admin/users')).toBeNull()
    for (const search of ['?return=https://evil.example.com', '?return=//evil.example.com', '?return=/kiosk/../admin', '']) {
      expect(customerDisplayReturnPath(search)).toBeNull()
    }
  })
})

describe('the display host the register’s page offers', () => {
  it('is there while registered, tells subscribers, and is withdrawn only by its own registration', async () => {
    const heard = jest.fn()
    const stop = subscribeCustomerDisplayHost(heard)
    expect(customerDisplayHost()).toBeNull()
    const shown: unknown[] = []
    const first = { show: async (screen: unknown) => (shown.push(screen), true) }
    const withdrawFirst = registerCustomerDisplayHost(first)
    expect(customerDisplayHost()).toBe(first)
    expect(await customerDisplayHost()?.show(SCREEN)).toBe(true)
    expect(shown).toEqual([SCREEN])
    const second = { show: async () => false }
    const withdrawSecond = registerCustomerDisplayHost(second)
    withdrawFirst()
    expect(customerDisplayHost()).toBe(second)
    withdrawSecond()
    expect(customerDisplayHost()).toBeNull()
    expect(heard).toHaveBeenCalledTimes(3)
    stop()
    registerCustomerDisplayHost(first)()
    expect(heard).toHaveBeenCalledTimes(3)
  })
})

describe('the display’s credential, for a screen’s page (AGL-4042)', () => {
  const store = new Map<string, string>()
  beforeAll(() => {
    ;(globalThis as { window?: unknown }).window = {
      localStorage: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string): void => {
          store.set(key, value)
        },
        removeItem: (key: string): void => {
          store.delete(key)
        },
      },
    }
  })
  afterAll(() => {
    delete (globalThis as { window?: unknown }).window
  })

  it('is kept by the display’s page, read by a screen’s page, and forgotten when unpaired', () => {
    expect(customerDisplayCredential()).toBeNull()
    rememberCustomerDisplayCredential('aBcD-ef_0123456789xyzXYZ0123456789abcdEFGHI')
    expect(customerDisplayCredential()).toBe('aBcD-ef_0123456789xyzXYZ0123456789abcdEFGHI')
    rememberCustomerDisplayCredential(null)
    expect(customerDisplayCredential()).toBeNull()
  })

  it('keeps nothing out of shape', () => {
    rememberCustomerDisplayCredential('short')
    expect(customerDisplayCredential()).toBeNull()
    rememberCustomerDisplayCredential('has spaces and <tags> in it, far too odd')
    expect(customerDisplayCredential()).toBeNull()
  })
})
