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
 * Watchdog for OAuth popup flows (AGL-459): if the user closes the
 * provider's popup, `signInWithPopup` normally rejects with
 * `auth/popup-closed-by-user` — but when the popup handle is severed
 * (COOP, some browsers), the promise never settles and the loading
 * overlay wedges forever. Our window regaining focus is the reliable
 * "user is back" signal: give the SDK a short grace period to settle,
 * then release the overlay. Dequeue is idempotent, so the normal
 * `finally` path and this guard can both fire safely.
 *
 * Returns a cleanup to call once the sign-in promise settles.
 */
export function guardPopupLoading(
  dequeue: () => void,
  graceMs = 2_500,
): () => void {
  let timer: number | undefined
  const handleFocus = () => {
    window.clearTimeout(timer)
    timer = window.setTimeout(dequeue, graceMs)
  }
  window.addEventListener('focus', handleFocus)
  return () => {
    window.removeEventListener('focus', handleFocus)
    window.clearTimeout(timer)
  }
}

export default guardPopupLoading
