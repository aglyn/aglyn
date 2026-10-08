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
  WEGLOT_LANGUAGE_STORAGE_KEY,
  WEGLOT_SCRIPT_ELEMENT_ID,
  WEGLOT_SCRIPT_SRC,
  WEGLOT_SWITCHER_TARGET_ID,
} from './constants'
import type { WeglotSiteSettings } from './model/weglot-settings'

/**
 * How a published page loads Weglot (AGL-3700), and why it is not the way
 * Weglot's install guide does it.
 *
 * Weglot documents a plain `<script src>` followed by an inline
 * `Weglot.initialize(...)`, both render-blocking. Its library is ~219 KB
 * (~73 KB gzipped, measured 2026-10-08) from a third-party origin, so that
 * install puts a new connection, the download and the parse in front of first
 * paint for EVERY visitor — including the large majority who read the site in
 * the language it is written in and never needed a translation.
 *
 * Deferring it to the same "loaded and idle" moment the platform's tags wait
 * for (`page-idle.ts`, AGL-3581) fixes that, and costs exactly one group: a
 * visitor who already chose another language would read the original text for
 * a second or more before Weglot swapped it. So the page splits the two:
 *
 * 1. **A returning visitor who chose a translation** — Weglot's own stored
 *    choice (`localStorage.wglang`) names one of the site's target languages.
 *    The inline boot starts the script at once, while the HTML is still
 *    parsing, `async` so it never blocks it. Weglot's default
 *    `wait_transition` then keeps the text transparent until it is translated,
 *    which is the least flashing a client-side translation can do.
 * 2. **Everyone else** — the runtime asks for it when the page has loaded and
 *    gone idle, so first paint, LCP and hydration are not charged for it; and
 *    at once if the visitor opens the switcher first.
 *
 * Partytown is not an option here for the reason it is not one for the tags
 * (AGL-3581): Weglot rewrites the DOM, which a worker cannot do.
 *
 * Nothing about consent gates this. Weglot stores the visitor's chosen
 * language and a cache of the translations it fetched — preference and
 * function storage serving a translation the visitor asked for — and sets no
 * analytics or advertising cookie, so it sits with the cart and the consent
 * record in the strictly necessary group (see the docs page).
 */

/** What `Weglot.initialize` is handed. */
export interface WeglotInitOptions {
  api_key: string
  /** Translations kept in the browser between pages; Weglot refreshes them. */
  cache: boolean
  hide_switcher: boolean
  switchers?: Array<{ location: { target: string; sibling: null } }>
}

export function weglotInitOptions(settings: WeglotSiteSettings): WeglotInitOptions {
  const options: WeglotInitOptions = {
    api_key: settings.apiKey,
    cache: true,
    hide_switcher: settings.switcher !== 'weglot',
  }
  if (settings.switcher === 'weglot') {
    // Weglot draws its switcher inside the element the page positions, so the
    // merchant's corner applies to Weglot's switcher too.
    options.switchers = [
      { location: { target: `#${WEGLOT_SWITCHER_TARGET_ID}`, sibling: null } },
    ]
  }
  return options
}

/**
 * JSON that is safe inside an inline `<script>`: `<` cannot open a closing
 * tag, and the two line separators JavaScript string literals once refused
 * are escaped. The values are format-checked before they get here; this is
 * the second lock, not the first.
 */
export function inlineJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029')
}

/** How long the loader waits for Weglot to say it initialized. */
export const WEGLOT_INIT_TIMEOUT_MS = 10_000

/** The global the boot defines; the runtime and the switcher call it. */
export const WEGLOT_LOADER_GLOBAL = 'aglynWeglotLoad'

/**
 * The inline boot. ES5 on purpose: it runs before any bundle, in whatever
 * browser the visitor has.
 *
 * It defines one idempotent loader, `window.aglynWeglotLoad()`, that appends
 * the script once and resolves with `window.Weglot` when Weglot reports it
 * initialized (or with whatever is there after a failure or the timeout — a
 * caller never waits forever). Then it starts the loader immediately only for
 * case 1 above.
 */
export function buildWeglotBoot(settings: WeglotSiteSettings): string {
  const options = inlineJson(weglotInitOptions(settings))
  const targets = inlineJson(settings.targetLanguages)
  return (
    '(function(w,d){' +
    `if(w.${WEGLOT_LOADER_GLOBAL})return;` +
    `var o=${options},t=${targets},p=null;` +
    `w.${WEGLOT_LOADER_GLOBAL}=function(){` +
    'if(p)return p;' +
    'p=new Promise(function(r){' +
    'var f=false,done=function(){if(f)return;f=true;r(w.Weglot||null)};' +
    `setTimeout(done,${WEGLOT_INIT_TIMEOUT_MS});` +
    "var s=d.createElement('script');" +
    `s.id=${inlineJson(WEGLOT_SCRIPT_ELEMENT_ID)};s.async=true;s.src=${inlineJson(WEGLOT_SCRIPT_SRC)};` +
    's.onload=function(){try{var W=w.Weglot;' +
    'if(!W||W.initialized){done();return}' +
    "W.on('initialized',done);W.initialize(o)}catch(e){done()}};" +
    's.onerror=done;' +
    '(d.head||d.documentElement).appendChild(s)});' +
    'return p};' +
    'var c=null;' +
    `try{c=w.localStorage.getItem(${inlineJson(WEGLOT_LANGUAGE_STORAGE_KEY)})}catch(e){}` +
    `if(c&&t.indexOf(c)>=0)w.${WEGLOT_LOADER_GLOBAL}()` +
    '})(window,document);'
  )
}

/** The slice of Weglot's client API the switcher uses. */
export interface WeglotApi {
  initialized?: boolean
  options?: {
    language_from?: string
    languages?: Array<{ language_to?: string; enabled?: boolean }>
  }
  getCurrentLang?: () => string
  switchTo?: (code: string) => void
  on?: (event: string, callback: (...args: unknown[]) => void) => void
  off?: (event: string, callback?: (...args: unknown[]) => void) => boolean
}

type WeglotWindow = Window & {
  Weglot?: WeglotApi
  [WEGLOT_LOADER_GLOBAL]?: () => Promise<WeglotApi | null>
}

/**
 * Load Weglot through the boot's loader, defining the loader first when the
 * boot never ran — a page this runtime mounted on the client, where React
 * does not execute an inline script it renders. Same string, executed by a
 * script element, so there is exactly one implementation of the loader.
 */
export function loadWeglot(
  settings: WeglotSiteSettings,
  win: Window = window,
): Promise<WeglotApi | null> {
  const target = win as WeglotWindow
  if (typeof target[WEGLOT_LOADER_GLOBAL] !== 'function') {
    const script = win.document.createElement('script')
    script.text = buildWeglotBoot(settings)
    win.document.head.appendChild(script)
  }
  const loader = target[WEGLOT_LOADER_GLOBAL]
  return typeof loader === 'function' ? loader() : Promise.resolve(null)
}

/** The resident Weglot, once its script has run. */
export function residentWeglot(win: Window = window): WeglotApi | null {
  return (win as WeglotWindow).Weglot ?? null
}
