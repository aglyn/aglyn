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
  WEGLOT_SCRIPT_ELEMENT_ID,
  WEGLOT_SCRIPT_SRC,
  WEGLOT_SWITCHER_TARGET_ID,
} from './constants'
import type { WeglotSiteSettings } from './model/weglot-settings'
import {
  WEGLOT_LOADER_GLOBAL,
  buildWeglotBoot,
  inlineJson,
  loadWeglot,
  weglotInitOptions,
} from './weglot-loader'

const settings: WeglotSiteSettings = {
  apiKey: 'wg_0123456789abcdef0123456789abcdef',
  sourceLanguage: 'en',
  targetLanguages: ['fr', 'es'],
  switcher: 'aglyn',
  switcherPosition: 'bottom-right',
}

type TestWindow = Window & Record<string, any>

/** Runs the boot the way the browser does: as an inline script. */
function runBoot(boot: string): void {
  const script = document.createElement('script')
  script.text = boot
  document.head.appendChild(script)
}

const weglotScript = () =>
  document.getElementById(WEGLOT_SCRIPT_ELEMENT_ID) as HTMLScriptElement | null

// The loader's give-up timer must not outlive the suite.
beforeAll(() => jest.useFakeTimers())
afterAll(() => jest.useRealTimers())

beforeEach(() => {
  document.head.innerHTML = ''
  document.body.innerHTML = ''
  window.localStorage.clear()
  delete (window as TestWindow)[WEGLOT_LOADER_GLOBAL]
  delete (window as TestWindow)['Weglot']
})

describe('Weglot.initialize options (AGL-3700)', () => {
  it('hides Weglot’s switcher when the page draws the themed one', () => {
    expect(weglotInitOptions(settings)).toEqual({
      api_key: settings.apiKey,
      cache: true,
      hide_switcher: true,
    })
  })

  it('puts Weglot’s own switcher inside the element the page positions', () => {
    expect(weglotInitOptions({ ...settings, switcher: 'weglot' })).toEqual({
      api_key: settings.apiKey,
      cache: true,
      hide_switcher: false,
      switchers: [
        { location: { target: `#${WEGLOT_SWITCHER_TARGET_ID}`, sibling: null } },
      ],
    })
  })
})

describe('the inline boot', () => {
  it('cannot be broken out of', () => {
    expect(inlineJson('</script><script>alert(1)</script>')).not.toMatch(/<|>/)
    expect(inlineJson('\u2028')).toBe('"\\u2028"')
  })

  it('loads nothing during parse for a visitor with no chosen translation', () => {
    runBoot(buildWeglotBoot(settings))
    expect(typeof (window as TestWindow)[WEGLOT_LOADER_GLOBAL]).toBe('function')
    expect(weglotScript()).toBeNull()
  })

  it('loads nothing early when the stored choice is the original language or not offered', () => {
    window.localStorage.setItem('wglang', 'en')
    runBoot(buildWeglotBoot(settings))
    expect(weglotScript()).toBeNull()
    delete (window as TestWindow)[WEGLOT_LOADER_GLOBAL]
    window.localStorage.setItem('wglang', 'de')
    runBoot(buildWeglotBoot(settings))
    expect(weglotScript()).toBeNull()
  })

  it('starts Weglot at once, async, for a returning visitor who chose a translation', () => {
    window.localStorage.setItem('wglang', 'fr')
    runBoot(buildWeglotBoot(settings))
    const script = weglotScript()
    expect(script?.src).toBe(WEGLOT_SCRIPT_SRC)
    expect(script?.async).toBe(true)
  })

  it('appends the script once however often it is asked, and initializes with the options', async () => {
    runBoot(buildWeglotBoot(settings))
    const win = window as TestWindow
    const first = win[WEGLOT_LOADER_GLOBAL]()
    const second = win[WEGLOT_LOADER_GLOBAL]()
    expect(first).toBe(second)
    expect(document.querySelectorAll(`#${WEGLOT_SCRIPT_ELEMENT_ID}`)).toHaveLength(1)

    const listeners: Record<string, () => void> = {}
    const initialize = jest.fn(() => {
      fake.initialized = true
      listeners['initialized']?.()
    })
    const fake: Record<string, any> = {
      initialized: false,
      initialize,
      on: (event: string, callback: () => void) => {
        listeners[event] = callback
      },
    }
    win['Weglot'] = fake
    weglotScript()?.onload?.(new Event('load'))
    await expect(first).resolves.toBe(fake)
    expect(initialize).toHaveBeenCalledWith(weglotInitOptions(settings))
  })

  it('resolves rather than hanging when the script fails to load', async () => {
    runBoot(buildWeglotBoot(settings))
    const pending = (window as TestWindow)[WEGLOT_LOADER_GLOBAL]()
    weglotScript()?.onerror?.(new Event('error'))
    await expect(pending).resolves.toBeNull()
  })

  it('a second boot on the same page keeps the first loader', () => {
    runBoot(buildWeglotBoot(settings))
    const loader = (window as TestWindow)[WEGLOT_LOADER_GLOBAL]
    runBoot(buildWeglotBoot({ ...settings, apiKey: 'wg_ffffffffffffffffffffffff' }))
    expect((window as TestWindow)[WEGLOT_LOADER_GLOBAL]).toBe(loader)
  })
})

describe('loadWeglot', () => {
  it('defines the loader when the boot never ran, then loads through it', () => {
    void loadWeglot(settings)
    expect(typeof (window as TestWindow)[WEGLOT_LOADER_GLOBAL]).toBe('function')
    expect(weglotScript()?.src).toBe(WEGLOT_SCRIPT_SRC)
  })
})
