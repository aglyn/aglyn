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
  type MediaDeliveryCapability,
  type MediaDeliveryProvider,
  mediaDeliveryProvider,
  registerMediaDeliveryProvider,
} from './media-delivery-provider'
import { resetPluginServicesForTests } from './plugin-services'

/**
 * The delivery provider slot (AGL-2824): one plugin holds it, core asks for
 * it by capability, and an unconfigured provider answers as absent so the
 * media CDN's own path stays the one that serves.
 */

function fakeProvider(configured: Partial<Record<MediaDeliveryCapability, boolean>>): MediaDeliveryProvider {
  return {
    isConfigured: (capability) => configured[capability] === true,
    putObject: async () => undefined,
    deleteObject: async () => undefined,
    deleteObjectsWithPrefix: async () => 0,
    deliveryUrl: async ({ key }) => `https://delivery.example/${key}`,
  }
}

afterEach(() => resetPluginServicesForTests())

describe('the media delivery provider slot (AGL-2824)', () => {
  it('answers null when no plugin registered a provider', () => {
    expect(mediaDeliveryProvider('deliver')).toBeNull()
    expect(mediaDeliveryProvider('store')).toBeNull()
  })

  it('answers the provider only for the capabilities it is configured for', () => {
    const provider = fakeProvider({ deliver: true })
    registerMediaDeliveryProvider(provider, { pluginId: 'delivery-a' })
    expect(mediaDeliveryProvider('deliver')).toBe(provider)
    expect(mediaDeliveryProvider('store')).toBeNull()
  })

  it('treats a configuration check that throws as unconfigured', () => {
    registerMediaDeliveryProvider(
      {
        ...fakeProvider({}),
        isConfigured: () => {
          throw new Error('settings unreadable')
        },
      },
      { pluginId: 'delivery-a' },
    )
    expect(mediaDeliveryProvider('deliver')).toBeNull()
  })

  it('lets the owning plugin replace its provider and refuses a second plugin', () => {
    const first = fakeProvider({ deliver: true })
    const second = fakeProvider({ deliver: true, store: true })
    registerMediaDeliveryProvider(first, { pluginId: 'delivery-a' })
    registerMediaDeliveryProvider(second, { pluginId: 'delivery-a' })
    expect(mediaDeliveryProvider('store')).toBe(second)
    expect(() =>
      registerMediaDeliveryProvider(fakeProvider({ deliver: true }), {
        pluginId: 'delivery-b',
      }),
    ).toThrow(/delivery-a.*delivery-b/)
    // The incumbent keeps serving after the refusal.
    expect(mediaDeliveryProvider('deliver')).toBe(second)
  })

  it('refuses a registration with no owner', () => {
    expect(() => registerMediaDeliveryProvider(fakeProvider({}))).toThrow(
      /no owner/,
    )
  })
})
