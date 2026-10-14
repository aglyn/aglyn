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
  LIVE_CHAT_READY_TIMEOUT_MS,
  LIVE_CHAT_SCRIPT_ATTRIBUTE,
} from './constants'
import type { LiveChatSlice } from './model/settings'
import {
  LIVECHAT_CHAT_PROVIDER,
  liveChatProvider,
  TIDIO_CHAT_PROVIDER,
  type LiveChatProviderId,
} from './model/providers'

/**
 * Putting a vendor's widget on the page, and taking it off again (AGL-3698).
 *
 * Nothing here runs at import or at render. The runtime calls `loadLiveChat`
 * only when a visitor pressed the launcher, when this tab's visitor already
 * did on an earlier page, or — for a site that asked for it — once the page
 * is idle AND the visitor's recorded consent grants analytics. So the
 * vendor's script, its sockets and its storage never cost the page's first
 * render, and never reach a visitor who did not ask and did not consent.
 *
 * Every script element we add carries {@link LIVE_CHAT_SCRIPT_ATTRIBUTE}; the
 * teardown removes only those, never a chat a merchant embedded some other
 * way.
 */

interface TidioChatApi {
  open?: () => void
  show?: () => void
  hide?: () => void
}

interface LiveChatWidgetApi {
  _q?: unknown[]
  _h?: unknown
  on?: (event: string, callback: () => void) => void
  call?: (method: string, ...args: unknown[]) => void
}

export interface LiveChatWindow extends Window {
  tidioChatApi?: TidioChatApi
  LiveChatWidget?: LiveChatWidgetApi
  __lc?: Record<string, unknown>
}

/** Which provider's script of ours is on the page, if any. */
export function liveChatLoadedProvider(doc: Document = document): LiveChatProviderId | null {
  const element = doc.querySelector(`script[${LIVE_CHAT_SCRIPT_ATTRIBUTE}]`)
  return (liveChatProvider(element?.getAttribute(LIVE_CHAT_SCRIPT_ATTRIBUTE))?.id ?? null)
}

const pending = new Map<string, Promise<void>>()

/**
 * Loads the slice's widget, resolving once the vendor says it is ready, and
 * opens the chat window when `open` is set (a launcher press). Idempotent per
 * provider and key: a second call waits on the first.
 */
export function loadLiveChat(
  slice: LiveChatSlice,
  options: { open?: boolean; win?: LiveChatWindow; timeoutMs?: number } = {},
): Promise<void> {
  const win = options.win ?? (window as LiveChatWindow)
  const provider = liveChatProvider(slice.provider)
  if (!provider || !provider.keyPattern.test(slice.publicKey)) {
    return Promise.reject(new Error('live chat: unusable settings'))
  }
  const key = `${provider.id}:${slice.publicKey}`
  let ready = pending.get(key)
  if (!ready) {
    ready = (provider.id === 'tidio' ? loadTidio : loadLiveChatInc)(
      win,
      slice.publicKey,
      options.timeoutMs ?? LIVE_CHAT_READY_TIMEOUT_MS,
    )
    pending.set(key, ready)
    // A failed load may be retried by the next press.
    ready.catch(() => pending.delete(key))
  }
  return ready.then(() => {
    if (options.open) openLiveChat(provider.id, win)
  })
}

function appendScript(win: LiveChatWindow, providerId: LiveChatProviderId, src: string, onError: () => void) {
  const doc = win.document
  const script = doc.createElement('script')
  script.src = src
  script.async = true
  script.setAttribute(LIVE_CHAT_SCRIPT_ATTRIBUTE, providerId)
  script.addEventListener('error', onError)
  doc.body.appendChild(script)
}

function withTimeout(
  win: LiveChatWindow,
  timeoutMs: number,
  start: (resolve: () => void, reject: (error: Error) => void) => void,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let settled = false
    const timer = win.setTimeout(() => {
      if (settled) return
      settled = true
      reject(new Error('live chat: the widget did not load in time'))
    }, timeoutMs)
    start(
      () => {
        if (settled) return
        settled = true
        win.clearTimeout(timer)
        resolve()
      },
      (error) => {
        if (settled) return
        settled = true
        win.clearTimeout(timer)
        reject(error)
      },
    )
  })
}

/**
 * Tidio: one script whose URL names the public key, and a `tidioChat-ready`
 * event on the document once `window.tidioChatApi` works.
 */
function loadTidio(win: LiveChatWindow, publicKey: string, timeoutMs: number): Promise<void> {
  return withTimeout(win, timeoutMs, (resolve, reject) => {
    if (win.tidioChatApi && liveChatLoadedProvider(win.document) === 'tidio') {
      resolve()
      return
    }
    win.document.addEventListener('tidioChat-ready', () => resolve(), { once: true })
    appendScript(win, 'tidio', TIDIO_CHAT_PROVIDER.scriptSrc(publicKey), () =>
      reject(new Error('live chat: Tidio could not be reached')),
    )
  })
}

/**
 * LiveChat: the license on `window.__lc`, the command queue its own install
 * code defines (`LiveChatWidget`, replayed by `tracking.js`), then the loader.
 */
function loadLiveChatInc(win: LiveChatWindow, license: string, timeoutMs: number): Promise<void> {
  return withTimeout(win, timeoutMs, (resolve, reject) => {
    if (win.LiveChatWidget?._h && liveChatLoadedProvider(win.document) === 'livechat') {
      resolve()
      return
    }
    win.__lc = {
      ...(win.__lc ?? {}),
      license: Number(license),
      integration_name: 'aglyn',
      product_name: 'livechat',
    }
    if (!win.LiveChatWidget) {
      const queue: LiveChatWidgetApi = { _q: [], _h: null }
      const push = (entry: unknown[]) => {
        const handler = queue._h as ((...args: unknown[]) => unknown) | null
        return handler ? handler(...entry) : queue._q?.push(entry)
      }
      Object.assign(queue, {
        _v: '2.0',
        on: (...args: unknown[]) => push(['on', args]),
        once: (...args: unknown[]) => push(['once', args]),
        off: (...args: unknown[]) => push(['off', args]),
        get: () => {
          throw new Error("[LiveChatWidget] You can't use getters before load.")
        },
        call: (...args: unknown[]) => push(['call', args]),
        init: () => undefined,
      })
      win.LiveChatWidget = queue
    }
    win.LiveChatWidget.on?.('ready', () => resolve())
    appendScript(win, 'livechat', LIVECHAT_CHAT_PROVIDER.scriptSrc(license), () =>
      reject(new Error('live chat: LiveChat could not be reached')),
    )
  })
}

/** Opens the chat window. */
export function openLiveChat(providerId: LiveChatProviderId, win: LiveChatWindow = window as LiveChatWindow) {
  if (providerId === 'tidio') {
    win.tidioChatApi?.show?.()
    win.tidioChatApi?.open?.()
  } else {
    win.LiveChatWidget?.call?.('maximize')
  }
}

/**
 * Shows or hides a loaded widget: a page the merchant excluded, reached by a
 * client-side navigation after the widget loaded, hides it.
 */
export function setLiveChatVisible(
  providerId: LiveChatProviderId,
  visible: boolean,
  win: LiveChatWindow = window as LiveChatWindow,
) {
  if (providerId === 'tidio') {
    if (visible) win.tidioChatApi?.show?.()
    else win.tidioChatApi?.hide?.()
  } else {
    win.LiveChatWidget?.call?.(visible ? 'minimize' : 'hide')
  }
}

/**
 * Takes a widget loaded with the page off it again, for a visitor who
 * withdrew consent while the page was open: hide it, remove our script and
 * the vendor's elements, and delete the vendor's cookies and local storage
 * keys. The script that already ran cannot be unloaded; hiding it first and
 * sweeping last is the order that leaves nothing for it to write back to.
 */
export function removeLiveChat(
  providerId: LiveChatProviderId,
  win: LiveChatWindow = window as LiveChatWindow,
): void {
  const provider = liveChatProvider(providerId)
  if (!provider) return
  setLiveChatVisible(providerId, false, win)
  const doc = win.document
  doc
    .querySelectorAll(`script[${LIVE_CHAT_SCRIPT_ATTRIBUTE}="${provider.id}"]`)
    .forEach((element) => element.remove())
  for (const id of provider.elementIds) doc.getElementById(id)?.remove()
  for (const key of [...pending.keys()]) {
    if (key.startsWith(`${provider.id}:`)) pending.delete(key)
  }
  sweepLiveChatStorage(provider.storagePrefixes, win)
}

/** Deletes cookies and local storage keys starting with any prefix. */
export function sweepLiveChatStorage(prefixes: readonly string[], win: LiveChatWindow = window as LiveChatWindow): string[] {
  const removed: string[] = []
  const doc = win.document
  const names = (doc.cookie || '')
    .split(';')
    .map((part) => part.split('=')[0]?.trim() ?? '')
    .filter((name) => name && prefixes.some((prefix) => name.startsWith(prefix)))
  const hostname = win.location?.hostname ?? ''
  const labels = hostname.split('.')
  const domains = ['']
  for (let index = 0; index < labels.length - 1; index += 1) {
    domains.push(`; domain=.${labels.slice(index).join('.')}`)
  }
  for (const name of names) {
    for (const domain of domains) {
      doc.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/${domain}`
    }
    removed.push(name)
  }
  try {
    const storage = win.localStorage
    const keys: string[] = []
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index)
      if (key && prefixes.some((prefix) => key.startsWith(prefix))) keys.push(key)
    }
    for (const key of keys) {
      storage.removeItem(key)
      removed.push(key)
    }
  } catch {
    // Storage blocked: there is nothing of the vendor's in it either.
  }
  return removed
}

/** Test seam: forget loads in flight. */
export function resetLiveChatLoaderForTests(): void {
  pending.clear()
}
