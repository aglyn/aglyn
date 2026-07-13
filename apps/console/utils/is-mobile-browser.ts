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
 * OAuth flow selector (AGL-462): mobile browsers turn `signInWithPopup`
 * into a new tab whose handle the SDK loses (COOP + partitioned storage),
 * so sign-in completes on Google's side but never reaches the app —
 * those environments must use the redirect flow instead. Heuristic, not
 * biometric: prefer UA-Client-Hints, fall back to UA sniffing, and catch
 * iPadOS masquerading as macOS via its touch surface.
 */
export function isMobileBrowser(): boolean {
  if (typeof navigator === 'undefined') return false
  const uaData = (
    navigator as Navigator & { userAgentData?: { mobile?: boolean } }
  ).userAgentData
  if (typeof uaData?.mobile === 'boolean') return uaData.mobile
  if (/Android|iPhone|iPad|iPod|Mobile|IEMobile|Opera Mini/i.test(navigator.userAgent)) {
    return true
  }
  return /Macintosh/i.test(navigator.userAgent) && navigator.maxTouchPoints > 1
}

export default isMobileBrowser
