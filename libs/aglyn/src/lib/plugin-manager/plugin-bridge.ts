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

/**
 * Capability-scoped postMessage bridge protocol (AGL-45), per AGL-43 §2.
 * The host frames a plugin on a dedicated cross-origin; this module is the
 * versioned wire schema plus the validators BOTH sides run on every inbound
 * message. v1 contract: host passes declared props IN, plugin returns a
 * render height and named events OUT — no DOM, storage, or network access
 * through the bridge. Pure module: no `window`, so it unit-tests directly.
 */

/** Bump when the message shape changes incompatibly. */
export const PLUGIN_BRIDGE_VERSION = 1

/** Host → plugin. */
export type PluginHostMessage =
  | {
      type: 'init'
      v: number
      /** Props filtered to the manifest's declared `props` allowlist. */
      props: Record<string, unknown>
      /** Color scheme the host wants the plugin to match. */
      scheme?: 'light' | 'dark'
    }
  | { type: 'props'; v: number; props: Record<string, unknown> }

/** Plugin → host. */
export type PluginGuestMessage =
  | { type: 'ready'; v: number }
  | { type: 'resize'; v: number; height: number }
  | {
      type: 'event'
      v: number
      /** Must be one of the manifest's declared `events`. */
      name: string
      payload?: unknown
    }
  | {
      // Host-mediated fetch (AGL-191): the host validates `url` against the
      // manifest network allowlist and proxies it, replying with the
      // matching `id`.
      type: 'fetch-request'
      v: number
      id: string
      url: string
      method?: string
      body?: string
    }
  | { type: 'error'; v: number; message: string }

/** Host → plugin fetch reply (AGL-191). */
export interface PluginFetchResponseMessage {
  type: 'fetch-response'
  v: number
  id: string
  ok: boolean
  status: number
  body?: string
  error?: string
}

/** Largest plugin-declared render height the host will honor (px). */
export const PLUGIN_MAX_HEIGHT_PX = 4096

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)

/**
 * Filters a props object to the manifest-declared allowlist and drops
 * non-JSON-serializable values, so the host never leaks undeclared state
 * (host doc, auth, other props) across the bridge.
 */
export function filterPluginProps(
  props: Record<string, unknown> | undefined,
  allowed: string[] | undefined,
): Record<string, unknown> {
  if (!props || !allowed?.length) return {}
  const out: Record<string, unknown> = {}
  for (const key of allowed) {
    const value = props[key]
    if (value === undefined) continue
    try {
      // JSON-serializable subset check. `JSON.stringify` returns undefined
      // for functions/symbols (no throw) and throws on cycles/BigInt — both
      // must be dropped so undeclared/unclonable state can't cross.
      if (JSON.stringify(value) === undefined) continue
      out[key] = value
    } catch {
      // Skip unserializable values silently — they can't cross postMessage.
    }
  }
  return out
}

/**
 * Validates a message the HOST received from a plugin frame. Callers must
 * ALSO verify `event.origin === pluginOrigin` and `event.source === frame`
 * before trusting the result — origin/source checks are the security
 * boundary; this only shapes the payload. Unknown event names (not in the
 * manifest allowlist) are rejected here.
 */
export function parseGuestMessage(
  data: unknown,
  allowedEvents: string[] | undefined,
): PluginGuestMessage | null {
  if (!isPlainObject(data)) return null
  if (data['v'] !== PLUGIN_BRIDGE_VERSION) return null
  switch (data['type']) {
    case 'ready':
      return { type: 'ready', v: PLUGIN_BRIDGE_VERSION }
    case 'resize': {
      const height = Number(data['height'])
      if (!Number.isFinite(height) || height < 0) return null
      return {
        type: 'resize',
        v: PLUGIN_BRIDGE_VERSION,
        height: Math.min(height, PLUGIN_MAX_HEIGHT_PX),
      }
    }
    case 'event': {
      const name = String(data['name'] ?? '')
      if (!name || !(allowedEvents ?? []).includes(name)) return null
      let payload = data['payload']
      // Only pass JSON-round-trippable payloads to host code.
      try {
        payload = payload === undefined ? undefined : JSON.parse(
          JSON.stringify(payload),
        )
      } catch {
        payload = undefined
      }
      return { type: 'event', v: PLUGIN_BRIDGE_VERSION, name, payload }
    }
    case 'fetch-request': {
      // Shape-only here; the HOST re-validates the url against the manifest
      // network allowlist (isPluginNetworkAllowed) before proxying.
      const id = String(data['id'] ?? '')
      const url = String(data['url'] ?? '')
      if (!id || !url) return null
      const rawMethod = String(data['method'] ?? 'GET').toUpperCase()
      const method = rawMethod === 'POST' ? 'POST' : 'GET'
      const body =
        typeof data['body'] === 'string' ? data['body'] : undefined
      return {
        type: 'fetch-request',
        v: PLUGIN_BRIDGE_VERSION,
        id,
        url,
        method,
        ...(body !== undefined ? { body } : {}),
      }
    }
    case 'error':
      return {
        type: 'error',
        v: PLUGIN_BRIDGE_VERSION,
        message: String(data['message'] ?? 'Plugin error').slice(0, 500),
      }
    default:
      return null
  }
}

/**
 * Validates a message a PLUGIN received from the host. The loader calls
 * this after confirming `event.origin` is an aglyn origin. `init` carries
 * the already-filtered props (the host filtered them via
 * `filterPluginProps`), so the loader can trust the shape.
 */
export function parseHostMessage(data: unknown): PluginHostMessage | null {
  if (!isPlainObject(data)) return null
  if (data['v'] !== PLUGIN_BRIDGE_VERSION) return null
  if (data['type'] === 'init' || data['type'] === 'props') {
    const props = isPlainObject(data['props'])
      ? (data['props'] as Record<string, unknown>)
      : {}
    if (data['type'] === 'init') {
      const scheme = data['scheme']
      return {
        type: 'init',
        v: PLUGIN_BRIDGE_VERSION,
        props,
        ...(scheme === 'light' || scheme === 'dark' ? { scheme } : {}),
      }
    }
    return { type: 'props', v: PLUGIN_BRIDGE_VERSION, props }
  }
  return null
}
