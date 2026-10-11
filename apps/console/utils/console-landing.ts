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

import { isConsoleRouteSegment } from '../constants/console-routes'
import {
  CONSOLE_HOSTNAME,
  hostnameOf,
  WORKSPACE_DOMAIN,
} from '../constants/workspace-domain'

/**
 * Where a console path really lands when the page asking is on the auth host.
 *
 * `auth.<workspace domain>` serves only its own family, `/`, `/signin`,
 * `/signup` and the handoff legs. The middleware refuses everything else
 * with a 404 (AGL-3090), and it does so without asking which workspace a
 * slug names. But a Google sign-up can FINISH there. The redirect returns
 * to `auth.`, the sign-up page or the home page under it creates the
 * workspace, and both then navigated to `/{slug}/hosts` relative to the
 * page they stood on. That is `auth.aglyn.com/{slug}/hosts`: a 404, after
 * the workspace existed and before any site did. Three sign-ups stopped
 * there on 2026-10-10/11 (AGL-3724).
 *
 * So a root-relative path the auth host will not serve is sent to the
 * console host, with its query and fragment intact. Everything else is
 * returned unchanged: an absolute URL, a path in the auth family, and any
 * path on any other host. The `__session` cookie is minted for the whole
 * workspace domain, so the console host reads the same session.
 */
export function consoleLandingHref(
  url: string,
  host: string | null | undefined,
): string {
  if (!url.startsWith('/') || url.startsWith('//')) return url
  if (hostnameOf(host) !== `auth.${WORKSPACE_DOMAIN}`) return url
  const first = url.split(/[?#]/, 1)[0].split('/').filter(Boolean)[0] ?? ''
  if (isConsoleRouteSegment(first)) return url
  return `https://${CONSOLE_HOSTNAME}${url}`
}

/** {@link consoleLandingHref} for the page this runs on. */
export function currentConsoleLandingHref(url: string): string {
  return consoleLandingHref(
    url,
    typeof window === 'undefined' ? null : window.location.host,
  )
}
