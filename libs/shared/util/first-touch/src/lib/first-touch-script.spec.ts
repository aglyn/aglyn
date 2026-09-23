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
 *
 * @jest-environment jsdom
 * @jest-environment-options {"url": "https://www.example.com/pricing?gclid=abc"}
 */

import type { FirstTouchRuntime } from './first-touch'
import { FIRST_TOUCH_PAGE_GLOBAL, FIRST_TOUCH_PAGE_STORAGE_GLOBAL } from './first-touch-page'
import { firstTouchScript } from './first-touch-script'

/**
 * The served script is the kit's own source text, so it only works while the
 * kit references nothing outside itself. These run it as a page would — a
 * script element, with nothing but browser globals in scope — and the
 * wrapper's `try` means a reference that escaped would not throw here: it
 * would leave no runtime on the page, which is what is asserted.
 */

const page = window as unknown as Record<string, unknown>

function run(script: string, attributes: Record<string, string> = {}): FirstTouchRuntime | null {
  const element = document.createElement('script')
  for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value)
  element.textContent = script
  document.head.appendChild(element)
  return (page[FIRST_TOUCH_PAGE_GLOBAL] as FirstTouchRuntime | undefined) ?? null
}

beforeEach(() => {
  delete page[FIRST_TOUCH_PAGE_GLOBAL]
  delete page[FIRST_TOUCH_PAGE_STORAGE_GLOBAL]
  delete page['__aglynFirstTouch']
  document.cookie = 'aglyn_ft=; Path=/; Max-Age=0; Domain=example.com'
  document.head.innerHTML = ''
})

it('runs from its own source text, with nothing in scope but the page', () => {
  const runtime = run(firstTouchScript({ hosts: ['example.com', '*.example.com'] }))
  expect(runtime).not.toBeNull()
  expect(runtime?.tier()).toBe('cookie')
  expect(runtime?.read()).toMatchObject({ host: 'www.example.com', path: '/pricing', click: ['gclid'] })
})

it('holds the record in memory when the tag says consent is pending', () => {
  const runtime = run(firstTouchScript({ hosts: ['*.example.com'] }), { 'data-consent': 'pending' })
  expect(runtime?.tier()).toBe('memory')
  expect(document.cookie).not.toContain('aglyn_ft=')
})

it('lets a decision the page made before the script arrived win', () => {
  page[FIRST_TOUCH_PAGE_STORAGE_GLOBAL] = false
  const runtime = run(firstTouchScript({ hosts: ['*.example.com'], storage: true }))
  expect(runtime?.tier()).toBe('memory')
})

it('cannot be closed early by anything in its configuration', () => {
  const script = firstTouchScript({
    hosts: ['</script><script>alert(1)</script>', '*.example.com'],
    handoffUrl: 'https://app.example.com/api/first-touch?\u2028',
  })
  expect(script).not.toMatch(/<\/script/i)
  expect(script).not.toMatch(/[\u2028\u2029]/)
  expect(run(script)).not.toBeNull()
})
