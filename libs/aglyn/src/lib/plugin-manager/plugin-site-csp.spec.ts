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
  pluginSiteCspHosts,
  pluginSiteCspHostsFor,
  pluginSiteCspPluginsToRead,
  type PluginSiteCspDeclaration,
} from './plugin-site-csp'

const CHAT: PluginSiteCspDeclaration = {
  pluginId: 'chat',
  switchField: 'enabled',
  variantField: 'provider',
  requiredField: 'publicKey',
  variants: {
    a: { connect: ['socket.a.test', 'api.a.test'], img: ['img.a.test'] },
    b: { frame: ['frame.b.test'], connect: ['api.b.test'] },
  },
}
const OTHER: PluginSiteCspDeclaration = {
  pluginId: 'other',
  switchField: 'on',
  variantField: 'kind',
  variants: { x: { connect: ['api.a.test', 'x.test'] } },
}

describe("a plugin's site feature widens its site's policy only while on (AGL-3698)", () => {
  it('admits the chosen variant’s hosts for a switched-on, configured plugin', () => {
    expect(pluginSiteCspHostsFor(CHAT, { enabled: true, provider: 'b', publicKey: 'k' })).toEqual(CHAT.variants['b'])
  })

  it('admits a single-variant plugin by its switch alone (AGL-3700)', () => {
    const SINGLE: PluginSiteCspDeclaration = {
      pluginId: 'single',
      switchField: 'enabled',
      variants: { default: { connect: ['api.s.test'], img: ['cdn.s.test'] } },
    }
    expect(pluginSiteCspHostsFor(SINGLE, { enabled: true })).toEqual(SINGLE.variants['default'])
    expect(pluginSiteCspHostsFor(SINGLE, { enabled: 'true' })).toEqual({})
    expect(pluginSiteCspHostsFor(SINGLE, null)).toEqual({})
  })

  it('fails closed on every malformed setting', () => {
    for (const settings of [
      null,
      {},
      { enabled: 'true', provider: 'a', publicKey: 'k' },
      { enabled: true, provider: 'a', publicKey: ' ' },
      { enabled: true, provider: 'c', publicKey: 'k' },
      { enabled: true, provider: 'toString', publicKey: 'k' },
      { enabled: true, provider: 1, publicKey: 'k' },
    ]) {
      expect(pluginSiteCspHostsFor(CHAT, settings as never)).toEqual({})
    }
  })

  it('unions what every enabled plugin admits, de-duplicated, and nothing from a switched-off one', () => {
    const settings = {
      chat: { enabled: true, provider: 'a', publicKey: 'k' },
      other: { on: true, kind: 'x' },
    }
    expect(pluginSiteCspHosts(['chat', 'other'], settings, [CHAT, OTHER])).toEqual({
      connect: ['socket.a.test', 'api.a.test', 'x.test'],
      frame: [],
      img: ['img.a.test'],
      media: [],
      font: [],
    })
    expect(pluginSiteCspHosts(['other'], settings, [CHAT, OTHER]).img).toEqual([])
  })

  it('reads settings only for the declared plugins the site runs', () => {
    expect(pluginSiteCspPluginsToRead(['mui', 'chat'], [CHAT, OTHER])).toEqual(['chat'])
    expect(pluginSiteCspPluginsToRead(['mui'], [CHAT, OTHER])).toEqual([])
  })

  it('compiles the first-party declarations: live chat, with bare hostnames only', () => {
    const declared = pluginSiteCspPluginsToRead(['live-chat'])
    expect(declared).toEqual(['live-chat'])
    const tidio = pluginSiteCspHosts(['live-chat'], {
      'live-chat': { enabled: true, provider: 'tidio', publicKey: 'abc' },
    })
    expect(tidio.connect).toContain('socket.tidio.co')
    for (const hosts of Object.values(tidio)) {
      for (const host of hosts) expect(host).toMatch(/^(\*\.)?[a-z0-9.-]+\.[a-z]{2,}$/)
    }
  })
})
