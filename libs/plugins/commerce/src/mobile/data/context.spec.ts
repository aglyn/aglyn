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
import { urlAlphabet } from 'nanoid'
import { CARRIER_MAX_LENGTH, TRACKING_NUMBER_MAX_LENGTH } from './limits'
import { newAttemptKey, newResourceId, RESOURCE_ID_ALPHABET, RESOURCE_ID_LENGTH } from './context'

/*
 * The app restates a few numbers its sources keep in files a phone cannot
 * import (server code, a barrel that reaches React). Read as text, so this
 * spec runs under the app's own jest without loading either.
 */
const repo = join(__dirname, '../../../../../..')
const source = (path: string) => readFileSync(join(repo, path), 'utf8')
const constant = (text: string, name: string) => Number(new RegExp(`export const ${name} = (\\d+)`).exec(text)?.[1])

describe('the app mints ids and trims input as the console does', () => {
  it('draws resource ids from createResourceUid’s alphabet and length', () => {
    expect(RESOURCE_ID_ALPHABET).toBe(urlAlphabet)
    expect(RESOURCE_ID_LENGTH).toBe(constant(source('libs/aglyn/src/lib/foundation/constants/app.ts'), 'RESOURCE_ID_LENGTH'))
    const ids = new Set(Array.from({ length: 200 }, () => newResourceId()))
    expect(ids.size).toBe(200)
    for (const id of ids) expect(id).toMatch(/^[A-Za-z0-9_-]{10}$/)
  })

  it('mints without a secure random source too', () => {
    const crypto = globalThis.crypto
    Object.defineProperty(globalThis, 'crypto', { value: undefined, configurable: true })
    try {
      expect(newResourceId()).toMatch(/^[A-Za-z0-9_-]{10}$/)
      expect(newAttemptKey('refund')).toMatch(/^refund:/)
    } finally {
      Object.defineProperty(globalThis, 'crypto', { value: crypto, configurable: true })
    }
  })

  it('trims a carrier and tracking number to the fulfill route’s bounds', () => {
    const route = source('libs/plugins/commerce/src/lib/server/fulfill-order.ts')
    expect(CARRIER_MAX_LENGTH).toBe(constant(route, 'CARRIER_MAX'))
    expect(TRACKING_NUMBER_MAX_LENGTH).toBe(constant(route, 'TRACKING_NUMBER_MAX'))
  })
})
