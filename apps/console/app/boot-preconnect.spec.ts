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

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { bootPreconnects } from './boot-preconnect'

describe('bootPreconnects (AGL-3660)', () => {
  it('names the reCAPTCHA, Auth and Firestore origins a signed-in load waits on', () => {
    expect(bootPreconnects(false).map((one) => one.href)).toEqual([
      'https://www.google.com',
      'https://www.gstatic.com',
      'https://identitytoolkit.googleapis.com',
      'https://firestore.googleapis.com',
    ])
  })

  it('opens the CORS hosts anonymously, so the SDK requests reuse the socket', () => {
    const anonymous = bootPreconnects(false)
      .filter((one) => one.crossOrigin === 'anonymous')
      .map((one) => one.href)
    expect(anonymous).toEqual([
      'https://identitytoolkit.googleapis.com',
      'https://firestore.googleapis.com',
    ])
  })

  it('is empty under the emulators, which contact none of them', () => {
    expect(bootPreconnects(true)).toEqual([])
  })

  it('is what the root layout preconnects', () => {
    const layout = readFileSync(join(__dirname, 'layout.tsx'), 'utf8')
    expect(layout).toMatch(/for \(const \{ href, crossOrigin \} of bootPreconnects\(/)
    expect(layout).toMatch(/preconnect\(href,/)
  })
})
