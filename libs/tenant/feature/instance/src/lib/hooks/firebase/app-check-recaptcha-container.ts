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
 * Keeps App Check's reCAPTCHA container in the page until, and after, the
 * widget renders into it.
 *
 * The only reCAPTCHA the console and tenant pages run is App Check's
 * `ReCaptchaV3Provider` (there is no `RecaptchaVerifier` anywhere). Inside
 * `initializeAppCheck` the SDK appends `<div id="fire_app_check_<app>">` to
 * `<body>` at once, but renders the invisible widget into it only later, from
 * `grecaptcha.ready()`, once Google's script has loaded. That gap is a whole
 * network round trip, and on the console Firebase now boots before hydration
 * (AGL-3660), so it spans hydration. Anything that clears `<body>` in that
 * window takes the div with it: React's client-render fallback after a
 * hydration mismatch (it clears the body of every node it did not render),
 * `global-error` replacing `<body>`, a translator moving nodes. The render
 * then throws `reCAPTCHA placeholder element must be an element or id`
 * inside Google's code, where nothing of ours can catch it, so it lands as
 * an `unhandledrejection` — and the SDK's `initialized` promise never
 * resolves, so every later App Check token request for that app waits on a
 * widget that will never exist.
 *
 * Seen in production on 2026-10-09 (translator, guarded since #1342) and on
 * 2026-10-10 18:11Z on `/verify-email` and then `/` during a real password
 * sign-up.
 *
 * The keeper answers exactly that: it holds the SDK's own element and, the
 * moment a mutation leaves no element with that id in the document, puts it
 * back under the current `<body>`. MutationObserver callbacks run as
 * microtasks, so the element is back before `grecaptcha.ready()` (a script
 * load or timer, i.e. a later task) can render. It keeps watching after the
 * render as well, because `execute()` for every later token needs the
 * widget's iframe to still be in the page.
 *
 * Framework-free, browser-only, once per app name; a no-op during SSR.
 */

/** The id `@firebase/app-check` gives the container it renders into. */
export function appCheckRecaptchaContainerId(appName: string): string {
  return `fire_app_check_${appName}`
}

const keepers = new Map<string, () => void>()

/**
 * Start keeping `appName`'s App Check reCAPTCHA container in the document.
 * Call it right after `initializeAppCheck` for that app. Returns a stop
 * function (tests; a page never needs to stop it).
 */
export function keepAppCheckRecaptchaContainer(appName: string): () => void {
  const existing = keepers.get(appName)
  if (existing) return existing
  if (
    typeof document === 'undefined' ||
    typeof MutationObserver !== 'function'
  ) {
    return () => undefined
  }

  const id = appCheckRecaptchaContainerId(appName)
  let held: HTMLElement | null = document.getElementById(id)

  const restore = () => {
    const current = document.getElementById(id)
    if (current) {
      held = current
      return
    }
    const body = document.body
    if (!body) return
    if (!held) {
      // Same shape the SDK makes, for the case where it was removed before
      // this keeper ever saw it.
      held = document.createElement('div')
      held.id = id
      held.style.display = 'none'
    }
    body.appendChild(held)
  }

  const observer = new MutationObserver(restore)
  observer.observe(document, { childList: true, subtree: true })
  restore()

  const stop = () => {
    observer.disconnect()
    keepers.delete(appName)
  }
  keepers.set(appName, stop)
  return stop
}
