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
 * HTML-escape a text value for interpolation into markup this plugin builds by
 * hand (AGL-2283).
 *
 * Commerce has three such places and React guards none of them, because none
 * of them is React: the packing slip and the POS receipt are written into a
 * `window.open('')` popup with `document.write`, and the supplier confirmation
 * page is a string a server route sends. All three interpolated values
 * straight in.
 *
 * The packing slip is the one that matters. `order.shippingAddress` is copied
 * verbatim from Stripe's `shipping_details` — a SHOPPER types it — and the
 * popup is an `about:blank` document that inherits the CONSOLE's origin, so a
 * name of `<img src=x onerror=…>` runs script against the merchant's own
 * authenticated session. The receipt and the slip's line names are merchant-
 * authored and lower severity, but they are the same construction and are
 * escaped the same way rather than reasoned about one at a time.
 *
 * `'` becomes `&#39;` rather than `&apos;`, which HTML 4 does not define.
 * Non-string input coerces rather than throwing: these call sites read
 * optional fields off documents, and a `null` slipping through must produce
 * empty text, never a crash in the middle of a merchant's print dialog.
 */
export function escapeHtml(value: unknown): string {
  if (value == null) return ''
  return String(value).replace(
    /[&<>"']/g,
    (character) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      })[character] as string,
  )
}
