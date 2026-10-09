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

import type { PluginSiteCspHosts } from '@aglyn/aglyn/plugin-manager/plugin-site-csp'

/**
 * The two chat services a site can run (AGL-3698), each described completely
 * enough to LOAD it, to say what it stores, and to STOP it.
 *
 * Both are the merchant's own account: Aglyn holds no Tidio or LiveChat
 * account, app or key. The only thing the merchant gives us is the PUBLIC
 * identifier the vendor's own embed snippet carries in the clear — Tidio's
 * public key, LiveChat's license number — so it is stored in the site's
 * settings like any other public setting, never sealed.
 *
 * `cspHosts` must equal the `siteCsp` variants in `plugins.config.json`, which
 * is what the tenant's policy is built from; `providers.spec.ts` holds the two
 * together. The hosts are the vendors' own published CSP lists (Tidio's
 * Widget SDK "Security policy" page; LiveChat's "Use LiveChat with Content
 * Security Policy", the per-host CSP2 list), narrowed to the directives the
 * tenant enforces. `script-src` is not one of them (AGL-1228), so the loader
 * script needs no entry.
 */

export type LiveChatProviderId = 'tidio' | 'livechat'

export interface LiveChatProvider {
  id: LiveChatProviderId
  /** The vendor's name, as the console and the docs print it. */
  label: string
  /** What the console calls the identifier. */
  keyLabel: string
  /** Where the merchant finds it, in the vendor's own words. */
  keyHelp: string
  /** The identifier, exactly. It is interpolated into a script URL or a global. */
  keyPattern: RegExp
  /**
   * The identifier out of whatever the merchant pasted: the bare value, the
   * whole embed snippet, or the script URL. Null when none is there.
   */
  extractKey(raw: string): string | null
  /** The vendor's loader. Only ever called with a key that passed `keyPattern`. */
  scriptSrc(key: string): string
  /** The hosts the widget reaches, by enforced directive. */
  cspHosts: PluginSiteCspHosts
  /** The cookies and browser-storage keys the vendor writes, for the cookie inventory. */
  storageNames: readonly string[]
  /** Name prefixes the teardown sweeps from cookies and local storage. */
  storagePrefixes: readonly string[]
  /** The elements the vendor adds to the page, which the teardown removes. */
  elementIds: readonly string[]
}

const TIDIO_KEY = /^[a-z0-9]{20,64}$/
const LIVECHAT_LICENSE = /^[0-9]{4,12}$/

export const TIDIO_CHAT_PROVIDER: LiveChatProvider = {
  id: 'tidio',
  label: 'Tidio',
  keyLabel: 'Public key',
  keyHelp:
    'In Tidio, open Settings › Developer and copy the Public key, or paste the whole install code.',
  keyPattern: TIDIO_KEY,
  extractKey(raw) {
    const text = String(raw ?? '').trim()
    const fromUrl = /code\.tidio\.co\/([a-z0-9]+)\.js/i.exec(text)
    const candidate = (fromUrl ? fromUrl[1] : text).toLowerCase()
    return TIDIO_KEY.test(candidate) ? candidate : null
  },
  scriptSrc: (key) => `https://code.tidio.co/${key}.js`,
  cspHosts: {
    connect: [
      'socket.tidio.co',
      'api-v2.tidio.co',
      'uploads.tidio.com',
      'sentry-new.tidio.co',
      'widget-v4.tidiochat.com',
    ],
    img: [
      'code.tidio.co',
      'avatars.tidiochat.com',
      'tidio-images-messenger.s3.us-east-1.amazonaws.com',
      'cdnjs.cloudflare.com',
      'unpkg.com',
    ],
    media: ['code.tidio.co', 'widget-v4.tidiochat.com'],
    font: ['code.tidio.co'],
  },
  storageNames: ['tidio_state_<public key> (local storage)', 'tidio_token'],
  storagePrefixes: ['tidio_'],
  elementIds: ['tidio-chat', 'tidio-chat-iframe', 'tidio-chat-code'],
}

export const LIVECHAT_CHAT_PROVIDER: LiveChatProvider = {
  id: 'livechat',
  label: 'LiveChat',
  keyLabel: 'License number',
  keyHelp:
    'In LiveChat, open Settings › Channels › Website and copy the license number from the install code, or paste the whole code.',
  keyPattern: LIVECHAT_LICENSE,
  extractKey(raw) {
    const text = String(raw ?? '').trim()
    const fromSnippet = /license\s*[=:]\s*["']?(\d+)/i.exec(text)
    const candidate = fromSnippet ? fromSnippet[1] : text
    return LIVECHAT_LICENSE.test(candidate) ? candidate : null
  },
  scriptSrc: () => 'https://cdn.livechatinc.com/tracking.js',
  cspHosts: {
    connect: [
      'api.livechatinc.com',
      'cdn.livechatinc.com',
      'secure.livechatinc.com',
      'api.text.com',
    ],
    frame: ['api.livechatinc.com', 'cdn.livechatinc.com', 'secure.livechatinc.com'],
    img: [
      'cdn.livechatinc.com',
      'secure.livechatinc.com',
      'cdn.livechat-static.com',
      'cdn.livechat-files.com',
      'cdn.files-text.com',
    ],
    media: ['cdn.livechatinc.com', 'secure.livechatinc.com', 'cdn.livechat-static.com'],
    font: ['cdn.livechatinc.com', 'secure.livechatinc.com'],
  },
  storageNames: ['__lc_cid', '__lc_cst', '__lc2_cid', '__lc2_cst'],
  storagePrefixes: ['__lc'],
  elementIds: ['chat-widget-container'],
}

export const LIVE_CHAT_PROVIDERS: Readonly<Record<LiveChatProviderId, LiveChatProvider>> = {
  tidio: TIDIO_CHAT_PROVIDER,
  livechat: LIVECHAT_CHAT_PROVIDER,
}

/** The providers in the order the console offers them: Tidio first. */
export const LIVE_CHAT_PROVIDER_ORDER: readonly LiveChatProviderId[] = ['tidio', 'livechat']

export function liveChatProvider(id: unknown): LiveChatProvider | null {
  return typeof id === 'string' && Object.prototype.hasOwnProperty.call(LIVE_CHAT_PROVIDERS, id)
    ? LIVE_CHAT_PROVIDERS[id as LiveChatProviderId]
    : null
}
