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
 * The live-page element picker's wire protocol (AGL-3758).
 *
 * The console's Actions card opens a site page in a frame with
 * {@link ELEMENT_PICK_PARAM}; the page's pick mode highlights elements under
 * the pointer and, on a click, posts the element's selector to the console —
 * the same `[data-aglyn="leaf:<id>"]` selector the Besigner's Interactions
 * "Pick element" stores, which the site runtime resolves through
 * `expandLeafSelector`. Import-free on purpose: the tenant's admin-bar stub,
 * on every published page, reads the param from here.
 */

/** Query param that arms pick mode on a framed published page. */
export const ELEMENT_PICK_PARAM = 'aglyn-pick'

/** `postMessage` type every pick-mode message carries. */
export const ELEMENT_PICK_MESSAGE_TYPE = 'aglyn-pick-element'

export type ElementPickMessage =
  /** Pick mode loaded and is waiting for a click. */
  | { type: typeof ELEMENT_PICK_MESSAGE_TYPE; event: 'ready' }
  /** The builder clicked an element. */
  | {
      type: typeof ELEMENT_PICK_MESSAGE_TYPE
      event: 'picked'
      selector: string
      /** What the element reads as, for the console's chip. */
      label: string
    }
  /** Escape on the page. */
  | { type: typeof ELEMENT_PICK_MESSAGE_TYPE; event: 'cancel' }

/** Whether a `message` event's data is one of ours, shaped as promised. */
export function isElementPickMessage(data: unknown): data is ElementPickMessage {
  if (!data || typeof data !== 'object') return false
  const message = data as Record<string, unknown>
  if (message['type'] !== ELEMENT_PICK_MESSAGE_TYPE) return false
  if (message['event'] === 'ready' || message['event'] === 'cancel') return true
  return (
    message['event'] === 'picked' &&
    typeof message['selector'] === 'string' &&
    message['selector'] !== '' &&
    typeof message['label'] === 'string'
  )
}

/** `pageUrl` with pick mode armed, keeping any query it already has. */
export function elementPickUrl(pageUrl: string): string {
  const url = new URL(pageUrl)
  url.searchParams.set(ELEMENT_PICK_PARAM, '1')
  return url.toString()
}
