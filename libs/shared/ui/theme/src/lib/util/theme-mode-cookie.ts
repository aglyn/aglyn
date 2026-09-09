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
 * The visitor's stored light/dark choice, read where there is no browser.
 *
 * The provider persists the choice with `js-cookie`, which reads
 * `document.cookie` — a global that does not exist while a page renders on the
 * server, so the provider's own reader answers "no choice" for every server
 * render. A server layout has the request's cookies and can answer properly;
 * this module is what it reads them with.
 *
 * Nothing here imports React, MUI or `js-cookie`, and the one import is a
 * type, erased at compile time. That is deliberate: a Server Component may
 * take this module without pulling the theme library's context providers into
 * its graph, the same reason `util/emotion-cache` and `util/host-theme` are
 * deep-imported rather than taken from the barrel.
 */
export const THEME_MODE_COOKIE = 'theme-color-mode'

/**
 * A stored cookie value as a theme mode.
 *
 * Only an explicit `light` or `dark` is a mode. Everything else — no cookie at
 * all, and the `system` the switcher writes when a visitor picks "Device
 * default" — is `null`, meaning "the visitor named no scheme, follow the
 * device". `system` reads back as the absence of a choice rather than as a
 * value because the device's preference is not knowable here: it lives in
 * `prefers-color-scheme`, which only a browser can evaluate.
 *
 * This is the same grammar the browser-side reader in
 * `create-with-theme-provider` applies to the same cookie, so a server render
 * and the hydration that follows it resolve one value between them.
 */
export function parseThemeModeCookie(
  value: string | undefined | null,
): ThemeMode {
  return value === 'dark' || value === 'light' ? value : null
}
