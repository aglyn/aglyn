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
  LIVE_CHAT_MAX_PATH_LENGTH,
  LIVE_CHAT_MAX_PATHS,
} from '../constants'
import { liveChatProvider, type LiveChatProviderId } from './providers'

/**
 * A site's live chat settings (AGL-3698), stored at
 * `hosts/{hostId}/pluginSettings/live-chat` by the settings route alone.
 *
 * - `enabled` — the switch. Off keeps everything else, so a merchant can
 *   pause the chat without retyping the key.
 * - `provider` / `publicKey` — whose widget, and the public identifier its
 *   embed snippet carries.
 * - `pages` — `all`, `only` the listed addresses, or every page `except`
 *   them. An address is a site path (`/contact`), or a path ending `/*` for
 *   everything beneath it (`/shop/*` covers `/shop` and `/shop/anything`).
 * - `position` — the side the launcher sits on; match the widget's own.
 * - `loadWithPage` — load the widget once the page is idle, for a visitor
 *   whose recorded consent grants analytics, so the vendor's own greeting and
 *   visitor list work before anyone clicks. Off (the default) loads nothing
 *   until a visitor presses the launcher.
 */
export type LiveChatPages = 'all' | 'only' | 'except'
export type LiveChatPosition = 'right' | 'left'

export interface LiveChatSettings {
  enabled: boolean
  provider: LiveChatProviderId
  publicKey: string
  pages: LiveChatPages
  paths: string[]
  position: LiveChatPosition
  loadWithPage: boolean
}

export const LIVE_CHAT_DEFAULT_SETTINGS: LiveChatSettings = {
  enabled: false,
  provider: 'tidio',
  publicKey: '',
  pages: 'all',
  paths: [],
  position: 'right',
  loadWithPage: false,
}

const PAGES: readonly LiveChatPages[] = ['all', 'only', 'except']
const POSITIONS: readonly LiveChatPosition[] = ['right', 'left']

/** The characters a site path may carry here: RFC 3986 path characters, no query. */
const PATH_PATTERN = /^\/[A-Za-z0-9\-._~%!$&'()+,;=:@/]*(\/\*)?$/

/** A path the way the matcher compares it: one leading slash, no trailing one. */
export function normalizeLiveChatPath(raw: string): string {
  const trimmed = String(raw ?? '').trim()
  const wildcard = trimmed.endsWith('/*')
  const base = (wildcard ? trimmed.slice(0, -2) : trimmed)
    .replace(/\/{2,}/g, '/')
    .replace(/\/+$/, '')
  const path = base.startsWith('/') ? base : `/${base}`
  if (wildcard) return path === '/' ? '/*' : `${path}/*`
  return path || '/'
}

/** Whether one listed address covers a request path. */
export function liveChatPathMatches(pattern: string, path: string): boolean {
  const target = normalizeLiveChatPath(path || '/')
  const normalized = normalizeLiveChatPath(pattern)
  if (normalized === '/*') return true
  if (normalized.endsWith('/*')) {
    const base = normalized.slice(0, -2)
    return target === base || target.startsWith(`${base}/`)
  }
  return target === normalized
}

/**
 * Whether the chat shows on a page. `pathUnknown` is the designed 404 body,
 * cached per host rather than per URL (AGL-2511): only the path-independent
 * answer — every page — can be given there.
 */
export function liveChatShowsOnPath(
  settings: Pick<LiveChatSettings, 'pages' | 'paths'>,
  path: string,
  pathUnknown = false,
): boolean {
  if (settings.pages === 'all') return true
  if (pathUnknown) return false
  const listed = settings.paths.some((pattern) => liveChatPathMatches(pattern, path))
  return settings.pages === 'only' ? listed : !listed
}

export type LiveChatSettingsResult =
  | { settings: LiveChatSettings }
  | { error: string }

/**
 * A save from the console, checked field by field. Every refusal is a
 * sentence the card shows as it is.
 */
export function normalizeLiveChatSettings(input: unknown): LiveChatSettingsResult {
  const raw = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>
  const provider = liveChatProvider(raw['provider'])
  if (!provider) return { error: 'Choose Tidio or LiveChat.' }
  const enabled = raw['enabled'] === true
  const typedKey = typeof raw['publicKey'] === 'string' ? raw['publicKey'] : ''
  const publicKey = typedKey.trim() ? provider.extractKey(typedKey) : ''
  if (publicKey === null) {
    return {
      error: `That is not a ${provider.label} ${provider.keyLabel.toLowerCase()}. ${provider.keyHelp}`,
    }
  }
  if (enabled && !publicKey) {
    return { error: `Add your ${provider.label} ${provider.keyLabel.toLowerCase()} to turn the chat on.` }
  }
  const pages = PAGES.includes(raw['pages'] as LiveChatPages) ? (raw['pages'] as LiveChatPages) : null
  if (!pages) return { error: 'Choose which pages show the chat.' }
  const position = POSITIONS.includes(raw['position'] as LiveChatPosition)
    ? (raw['position'] as LiveChatPosition)
    : 'right'
  const rawPaths = Array.isArray(raw['paths']) ? raw['paths'] : []
  const paths: string[] = []
  for (const entry of rawPaths) {
    if (typeof entry !== 'string' || !entry.trim()) continue
    const text = entry.trim()
    if (text.length > LIVE_CHAT_MAX_PATH_LENGTH) {
      return { error: `“${text.slice(0, 40)}…” is longer than ${LIVE_CHAT_MAX_PATH_LENGTH} characters.` }
    }
    const candidate = text.startsWith('/') ? text : `/${text}`
    if (!PATH_PATTERN.test(candidate)) {
      return {
        error: `“${text}” is not a page address. Use a path such as /contact, or /shop/* for a section.`,
      }
    }
    const normalized = normalizeLiveChatPath(candidate)
    if (!paths.includes(normalized)) paths.push(normalized)
  }
  if (paths.length > LIVE_CHAT_MAX_PATHS) {
    return { error: `List at most ${LIVE_CHAT_MAX_PATHS} pages.` }
  }
  if (pages === 'only' && !paths.length) {
    return { error: 'List the pages the chat shows on, or choose every page.' }
  }
  return {
    settings: {
      enabled,
      provider: provider.id,
      publicKey,
      pages,
      paths: pages === 'all' ? [] : paths,
      position,
      loadWithPage: raw['loadWithPage'] === true,
    },
  }
}

/**
 * A stored document, read defensively: the route wrote it, but a reader of
 * something that decides what loads on a live page parses rather than trusts.
 * Anything unusable reads as the defaults — the chat off.
 */
export function readStoredLiveChatSettings(stored: unknown): LiveChatSettings {
  if (!stored || typeof stored !== 'object') return { ...LIVE_CHAT_DEFAULT_SETTINGS }
  const result = normalizeLiveChatSettings(stored)
  if ('error' in result) {
    return { ...LIVE_CHAT_DEFAULT_SETTINGS, ...pickSafe(stored as Record<string, unknown>), enabled: false }
  }
  return result.settings
}

/** What survives of an unusable document, so the card can still show it. */
function pickSafe(raw: Record<string, unknown>): Partial<LiveChatSettings> {
  const provider = liveChatProvider(raw['provider'])
  return {
    ...(provider ? { provider: provider.id } : {}),
    ...(typeof raw['publicKey'] === 'string' ? { publicKey: raw['publicKey'].slice(0, 200) } : {}),
  }
}

/**
 * What a published page carries: the provider and its key, where the
 * launcher sits and whether the widget may load with the page. Nothing else
 * of the settings reaches a visitor.
 */
export interface LiveChatSlice {
  provider: LiveChatProviderId
  publicKey: string
  position: LiveChatPosition
  loadWithPage: boolean
}

/** The slice for one page, or null where the chat does not show. */
export function liveChatSliceForPage(
  settings: LiveChatSettings,
  path: string,
  pathUnknown = false,
): LiveChatSlice | null {
  if (!settings.enabled) return null
  const provider = liveChatProvider(settings.provider)
  if (!provider || !provider.keyPattern.test(settings.publicKey)) return null
  if (!liveChatShowsOnPath(settings, path, pathUnknown)) return null
  return {
    provider: provider.id,
    publicKey: settings.publicKey,
    position: settings.position,
    loadWithPage: settings.loadWithPage,
  }
}

/**
 * The slice as the browser reads it back out of the page props. Checked
 * again, because the key is interpolated into a script URL or a global.
 */
export function readLiveChatSlice(value: unknown): LiveChatSlice | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  const provider = liveChatProvider(raw['provider'])
  const publicKey = typeof raw['publicKey'] === 'string' ? raw['publicKey'] : ''
  if (!provider || !provider.keyPattern.test(publicKey)) return null
  return {
    provider: provider.id,
    publicKey,
    position: raw['position'] === 'left' ? 'left' : 'right',
    loadWithPage: raw['loadWithPage'] === true,
  }
}
