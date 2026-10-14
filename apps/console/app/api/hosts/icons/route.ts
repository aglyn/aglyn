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

import { getMdiAllIcons, MDI_ICON_SEARCH_LIMIT, searchMdiIcons } from '@aglyn/shared-data-mdi'
import { firebaseAdmin } from '@aglyn/tenant-data-admin'
import { invalidIdTokenResponse } from '../../_lib/invalid-id-token-response'

/**
 * The icon catalog a component's icon is picked from (AGL-3668), searched for the native apps.
 *
 * The console's picker holds the whole Material Design icon set in the page
 * and filters it in the browser. A phone should not carry six thousand SVG
 * paths to pick one, so this answers the matches for what was typed (at most
 * `MDI_ICON_SEARCH_LIMIT`) with the id a component stores (`iconId`), the name
 * to show and the SVG path to draw (`iconPath`). Static data, no site or
 * workspace involved: any signed-in person may ask.
 *
 * GET `?search=…&limit=…`. Auth: Firebase ID token.
 */
async function handler(request: Request): Promise<Response> {
  if (request.method !== 'GET') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 })
  }
  const authorization = request.headers.get('authorization') ?? ''
  const idToken = authorization.startsWith('Bearer ') ? authorization.slice('Bearer '.length) : undefined
  if (!idToken) {
    return Response.json({ error: 'Unauthenticated' }, { status: 401 })
  }
  try {
    await firebaseAdmin.app().auth().verifyIdToken(idToken)
  } catch (error) {
    // A refused credential is a 401, not a fault of ours (AGL-1993).
    const unauthenticated = invalidIdTokenResponse(error)
    if (unauthenticated) return unauthenticated
    console.error(error)
    return Response.json({ error: 'The icons could not be searched' }, { status: 500 })
  }
  const { searchParams } = new URL(request.url)
  const requested = Number(searchParams.get('limit'))
  const icons = searchMdiIcons(
    getMdiAllIcons().values(),
    (searchParams.get('search') ?? '').slice(0, 80),
    Number.isFinite(requested) && requested > 0 ? requested : MDI_ICON_SEARCH_LIMIT,
  )
  return Response.json(
    { icons: icons.map(({ id, name, path }) => ({ id, name, path })) },
    { status: 200, headers: { 'Cache-Control': 'private, max-age=3600' } },
  )
}

export const dynamic = 'force-dynamic'
export { handler as GET }
