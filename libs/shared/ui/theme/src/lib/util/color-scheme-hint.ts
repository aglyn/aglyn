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

import type { ThemeMode } from '../hocs/create-with-theme-provider'

/**
 * The device's own light/dark preference, carried on the request.
 *
 * `prefers-color-scheme` is a media feature, and a media feature is a browser
 * fact: a server render has no viewport to evaluate it against, so
 * `useMediaQuery` reports light for every visitor whose device is dark. This
 * user-agent client hint is the same preference in a form the server CAN read
 * — the browser puts it on the request, so a visitor following their device
 * gets their scheme in the first byte rather than a light document that
 * repaints once React has hydrated the whole page.
 *
 * A browser sends it only where the origin asked for it, and the tenant
 * middleware is what asks — it advertises this same token in `Accept-CH` and
 * `Critical-CH` and splits its cache on it in `Vary`, from a copy of its own,
 * since an edge bundle takes no library imports. Reading the request header by
 * this constant is safe whatever the transport did to the casing: `Headers`
 * matches case-insensitively.
 *
 * ⚠️ CHROMIUM ONLY. Firefox and Safari implement neither this hint nor the
 * `Accept-CH` negotiation that asks for it, so on those browsers the header is
 * simply absent and the scheme settles once the page has hydrated. Absence is
 * therefore an ordinary answer, never an error: every reader must have a
 * behavior for "the request did not say".
 *
 * Nothing in this module imports React, MUI or `js-cookie`, and its one import
 * is a type erased at compile time. That is what lets a Server Component take
 * it without pulling the theme library's context providers into the RSC graph
 * — the same reason `util/theme-mode-cookie`, `util/emotion-cache` and
 * `util/host-theme` are deep-imported rather than taken from the barrel.
 */
export const COLOR_SCHEME_HINT_HEADER = 'Sec-CH-Prefers-Color-Scheme'

/**
 * A `Sec-CH-Prefers-Color-Scheme` request-header value as a theme mode.
 *
 * Only `light` and `dark` are schemes; anything else — a header the browser
 * never sent, a value from a future revision of the media feature — is `null`,
 * meaning "the request named no scheme, fall back to the browser's own answer
 * once there is one". A caller that mistook an unknown value for light would
 * pin a dark device to the wrong scheme for the whole render.
 *
 * The value is a structured-field string, so it may arrive quoted (`"dark"`);
 * the quotes are stripped and the token is compared case-insensitively so one
 * parser reads every spelling a conforming user agent may send.
 *
 * This is the device-preference counterpart to `parseThemeModeCookie`, which
 * reads the visitor's EXPLICIT choice off the same request. The two are
 * separate answers on purpose and are never merged here: a stated preference
 * outranks a device default, and the layering that enforces that lives in
 * `useThemeModeState`, where the switcher can still tell them apart.
 */
export function parseColorSchemeHint(
  value: string | undefined | null,
): ThemeMode {
  const scheme = value?.trim().replace(/^"|"$/g, '').toLowerCase()
  return scheme === 'dark' || scheme === 'light' ? scheme : null
}
