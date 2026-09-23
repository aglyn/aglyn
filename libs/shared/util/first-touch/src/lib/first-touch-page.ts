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

import type { FirstTouchRuntime } from './first-touch'

/**
 * The bridge between a SERVED capture script and the page's own code.
 *
 * A surface that includes the capture as a script tag has no import to call
 * it through, and its consent code — which decides whether the record may be
 * written to the device — runs in a bundle that never loaded the capture. So
 * the served script leaves its runtime on `window`, and this module is the
 * one place that knows where. It imports nothing but a type, which is the
 * point: a page pays for these few lines, not for the capture.
 *
 * Consent can be decided before the script has booted (the script is loaded
 * `async`), so a decision is also left where the script reads it at boot.
 */

/** Where a served script leaves its runtime. */
export const FIRST_TOUCH_PAGE_GLOBAL = 'aglynFirstTouch'

/** Where a storage decision made before the script booted waits for it. */
export const FIRST_TOUCH_PAGE_STORAGE_GLOBAL = '__aglynFirstTouchStorage'

function pageWindow(): Record<string, unknown> | null {
  return typeof window === 'undefined'
    ? null
    : (window as unknown as Record<string, unknown>)
}

/** The runtime a served script booted on this page, or null. */
export function pageFirstTouchRuntime(): FirstTouchRuntime | null {
  const runtime = pageWindow()?.[FIRST_TOUCH_PAGE_GLOBAL] as
    | Partial<FirstTouchRuntime>
    | undefined
  return runtime &&
    typeof runtime.read === 'function' &&
    typeof runtime.setStorage === 'function'
    ? (runtime as FirstTouchRuntime)
    : null
}

/**
 * Tell the page's capture whether it may keep the record on the device:
 * `true` to grant, `false` to refuse (and erase what it kept), `null` while
 * the visitor's consent is unresolved. Reaches a runtime that is already
 * running and waits for one that has not booted yet.
 */
export function setPageFirstTouchStorage(allowed: boolean | null): void {
  const page = pageWindow()
  if (!page) return
  const value = allowed === true ? true : allowed === false ? false : null
  page[FIRST_TOUCH_PAGE_STORAGE_GLOBAL] = value
  pageFirstTouchRuntime()?.setStorage(value)
}
