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

import { resetPluginServicesForTests } from './plugin-services'
import {
  registerStockPhotoProvider,
  stockPhotoProvider,
  stockPhotoSourceKey,
  type StockPhotoProvider,
} from './stock-photo-provider'
import { pluginMediaIngest, registerPluginMediaIngest } from './plugin-media-ingest'

/**
 * The stock photo seam (AGL-3660): libraries register, a caller gets the
 * first configured one or nothing; and the media ingest the console holds.
 */

function fakeProvider(id: string, configured: boolean | (() => boolean)): StockPhotoProvider {
  return {
    id,
    label: id,
    isConfigured: typeof configured === 'function' ? configured : () => configured,
    search: async () => ({ photos: [], cached: false }),
    download: async () => null,
    credit: () => ({
      providerLabel: id,
      license: 'License',
      licenseUrl: 'https://library.example/license',
      attributionRequired: false,
      text: 'Photo',
    }),
  }
}

afterEach(() => resetPluginServicesForTests())

describe('the stock photo providers (AGL-3660)', () => {
  it('answers null when no library is registered', () => {
    expect(stockPhotoProvider()).toBeNull()
  })

  it('skips a library this deployment did not configure, and one whose check throws', () => {
    const configured = fakeProvider('b', true)
    registerStockPhotoProvider(fakeProvider('a', false), { pluginId: 'p1' })
    registerStockPhotoProvider(
      fakeProvider('c', () => {
        throw new Error('settings unreadable')
      }),
      { pluginId: 'p2', priority: 5 },
    )
    registerStockPhotoProvider(configured, { pluginId: 'p1' })
    expect(stockPhotoProvider()).toBe(configured)
  })

  it('keeps two libraries of one plugin apart by their ids', () => {
    const first = fakeProvider('a', true)
    const second = fakeProvider('b', true)
    registerStockPhotoProvider(first, { pluginId: 'p1' })
    registerStockPhotoProvider(second, { pluginId: 'p1', priority: 1 })
    expect(stockPhotoProvider()).toBe(second)
  })

  it('refuses a library with no id', () => {
    expect(() => registerStockPhotoProvider(fakeProvider(' ', true), { pluginId: 'p1' })).toThrow(/id/)
  })

  it('keys a copied photo by its library and id', () => {
    expect(stockPhotoSourceKey({ provider: 'pixabay', id: '123' })).toBe('pixabay:123')
  })
})

describe('the media ingest (AGL-3660)', () => {
  it('answers null until the app registers one', () => {
    expect(pluginMediaIngest()).toBeNull()
    const ingest = {
      ingest: async () => ({ ok: false as const, status: 403, reason: 'no' }),
      findStockPhoto: async (): Promise<null> => null,
    }
    registerPluginMediaIngest(ingest, { pluginId: 'console' })
    expect(pluginMediaIngest()).toBe(ingest)
  })

  it('refuses an implementation missing either half', () => {
    expect(() =>
      registerPluginMediaIngest({ ingest: async () => ({ ok: false as const, status: 500, reason: '' }) } as never, {
        pluginId: 'console',
      }),
    ).toThrow(/findStockPhoto/)
  })
})
