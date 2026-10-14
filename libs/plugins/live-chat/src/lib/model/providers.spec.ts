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

import { pluginSiteCspDeclarations } from '@aglyn/aglyn/plugin-manager/plugin-site-csp'
import { LIVE_CHAT_PLUGIN_ID } from '../constants'
import { LIVE_CHAT_PROVIDER_ORDER, LIVE_CHAT_PROVIDERS, liveChatProvider } from './providers'

describe('the chat providers (AGL-3698)', () => {
  it('declare to the tenant policy exactly the hosts each widget is described with', () => {
    // The policy is built from plugins.config.json's `siteCsp`; the loader and
    // the docs from these descriptors. One list, two spellings: held equal.
    const declared = pluginSiteCspDeclarations().find((entry) => entry.pluginId === LIVE_CHAT_PLUGIN_ID)
    expect(declared).toMatchObject({ switchField: 'enabled', variantField: 'provider', requiredField: 'publicKey' })
    expect(Object.keys(declared?.variants ?? {}).sort()).toEqual([...LIVE_CHAT_PROVIDER_ORDER].sort())
    for (const id of LIVE_CHAT_PROVIDER_ORDER) {
      expect([id, declared?.variants[id]]).toEqual([id, LIVE_CHAT_PROVIDERS[id].cspHosts])
    }
  })

  it('admits no script host through the policy, because the tenant sends no script-src', () => {
    for (const id of LIVE_CHAT_PROVIDER_ORDER) {
      expect(Object.keys(LIVE_CHAT_PROVIDERS[id].cspHosts).sort()).toEqual(
        expect.arrayContaining(['connect']),
      )
      expect(Object.keys(LIVE_CHAT_PROVIDERS[id].cspHosts)).not.toContain('script')
    }
  })

  it('builds each loader URL from the key alone', () => {
    expect(LIVE_CHAT_PROVIDERS.tidio.scriptSrc('abc123abc123abc123abc123')).toBe(
      'https://code.tidio.co/abc123abc123abc123abc123.js',
    )
    expect(LIVE_CHAT_PROVIDERS.livechat.scriptSrc('12345678')).toBe('https://cdn.livechatinc.com/tracking.js')
  })

  it('knows only its two providers', () => {
    expect(liveChatProvider('tidio')?.label).toBe('Tidio')
    expect(liveChatProvider('livechat')?.label).toBe('LiveChat')
    expect(liveChatProvider('toString')).toBeNull()
    expect(liveChatProvider(undefined)).toBeNull()
  })
})
