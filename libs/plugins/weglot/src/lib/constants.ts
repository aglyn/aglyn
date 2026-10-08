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

/** The plugin's id, as `plugins.config.json` declares it. */
export const WEGLOT_PLUGIN_ID = 'weglot'

/** The site runtime the plugin mounts on every page of a site that switched it on. */
export const WEGLOT_RUNTIME_ID = 'weglot-site-runtime'

/**
 * Weglot's JavaScript integration, exactly as Weglot documents it
 * (developers.weglot.com/javascript/javascript). The one script a published
 * page loads for this plugin.
 */
export const WEGLOT_SCRIPT_SRC = 'https://cdn.weglot.com/weglot.min.js'

/**
 * The hosts Weglot's script reaches from a visitor's browser, read out of
 * `weglot.min.js` itself (fetched 2026-10-08, library 5.90.2) rather than
 * assumed:
 *
 * - `cdn.weglot.com` — the script, its stylesheet, the project settings
 *   (`/projects-settings/{key}.json`, a `fetch`) and the switcher's flags
 *   (images).
 * - `cdn-api-weglot.com` — `/translate` and `/translations/slugs`, the
 *   translations themselves (`fetch`).
 * - `api.weglot.com` — `/project-settings` for a key that does not start with
 *   `wg_`, and `/pageviews` when the merchant's Weglot project counts page
 *   views (`sendBeacon`/`fetch`).
 *
 * Not here, on purpose: `browser-intake-datadoghq.com`, where the library
 * posts its own error logs. That is Weglot's telemetry, not something the
 * translation needs, so a published page's policy refuses it.
 *
 * These are compiled into the site's `connect-src`/`img-src` through the
 * plugin's `siteIntegration` declaration in `plugins.config.json`; this list
 * is what the plugin's spec holds that declaration to.
 */
export const WEGLOT_CONNECT_HOSTS = [
  'cdn.weglot.com',
  'cdn-api-weglot.com',
  'api.weglot.com',
] as const
export const WEGLOT_IMAGE_HOSTS = ['cdn.weglot.com'] as const

/** The `<script>` element ids the page uses, stable for specs. */
export const WEGLOT_BOOT_ELEMENT_ID = 'aglyn-weglot-boot'
export const WEGLOT_SCRIPT_ELEMENT_ID = 'aglyn-weglot-src'
/** Where Weglot's own switcher is told to draw itself, when the merchant picks it. */
export const WEGLOT_SWITCHER_TARGET_ID = 'aglyn-weglot-switcher'

/**
 * Where Weglot keeps the visitor's chosen language (`localStorage`, key
 * `wglang` — read out of the library, which falls back to a cookie of the
 * same name when storage is unavailable).
 */
export const WEGLOT_LANGUAGE_STORAGE_KEY = 'wglang'

/** The page-props key the server enricher writes and the runtime reads. */
export const WEGLOT_PAGE_PROP = 'weglotIntegration'

/**
 * The entitlement translating a site needs: the same `multilingual` key
 * that prices "Multilingual sites" on the plan table (Business and above).
 * No new key and no price change.
 */
export const WEGLOT_ENTITLEMENT = 'multilingual'
