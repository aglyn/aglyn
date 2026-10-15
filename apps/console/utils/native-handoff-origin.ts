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

import { isSafeContinueUrl } from '@aglyn/shared-util-next'

/**
 * Where the native apps' sign-in hand-off has to run (AGL-3836): on the
 * Firebase auth origin itself, `auth.<workspaceDomain>`, which serves the
 * console as well as Firebase's `/__/auth/*` helpers.
 *
 * The apps open `/auth/native` in the platform's sign-in sheet
 * (ASWebAuthenticationSession on iOS). A redirect sign-in started on any other
 * console host reads its result back through an iframe on the auth origin, and
 * the sheet keeps that iframe's storage apart from the page that embeds it, so
 * the result never arrives: single sign-on came back to the `/sso` email form
 * every time, with the person signed in at the identity provider and nowhere
 * else. Started on the auth origin, the page, the handler and the iframe are
 * one origin and nothing has to cross.
 *
 * @returns the same path and query on the auth origin, or null when the page
 *   is already there or the auth origin is not a console host this deployment
 *   serves (a self-hosted install whose auth domain is `*.firebaseapp.com`).
 */
export function nativeHandoffAuthOrigin(
  location: Pick<Location, 'protocol' | 'host' | 'pathname' | 'search'>,
  authDomain: string | undefined,
): string | null {
  const authHost = (authDomain ?? '').trim().toLowerCase()
  if (!authHost || location.protocol !== 'https:') return null
  if (location.host.toLowerCase() === authHost) return null
  const target = `https://${authHost}${location.pathname}${location.search}`
  return isSafeContinueUrl(target) ? target : null
}
