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
  appHandleJsonError,
  appHandleJsonSuccess,
} from '@aglyn/shared-util-rest-api'
import getAllScreens from '../../../utils/get-all-screens'
import { publicReadApiGate, withPublicReadHeaders } from '../_public-read-api'

export const dynamic = 'force-dynamic'

/**
 * Published screens for a host (`?host=&cursor=`). GET only.
 *
 * Anonymous by design — a site's page list is public — so what bounds it is
 * the RESPONSE, not the caller. `getAllScreens` returns an allow-listed
 * projection, never the screen documents; see the note there (AGL-2191) before
 * widening what this hands back.
 */
export async function GET(request: Request): Promise<Response> {
  const gate = publicReadApiGate(request)
  if (gate.refusal) return gate.refusal

  const params = new URL(request.url).searchParams
  /*
    `?host=` first, then the domain the request was ADDRESSED to (AGL-2716) —
    the same fallback `/api/host` takes, and for the same reason: an agent
    already talking to `acme.com` should not have to name it again, and a
    parameter it has to guess is a parameter it gets wrong.
  */
  const host =
    params.get('host') ||
    request.headers.get('x-aglyn-tenant-host') ||
    request.headers.get('host')
  /*
    `cursor` is the canonical spelling (AGL-2751); `nextPageToken` is the
    spelling this route shipped with and is still accepted.

    Not a deprecation that can be completed on a schedule: `@aglyn/cli@0.1.2`
    is published on npm and its `pages` command sends the old name, so every
    copy already installed sends it until its owner upgrades — which is not an
    event we get to observe. The alias costs one `??`.
  */
  const cursor =
    params.get('cursor') ?? params.get('nextPageToken') ?? undefined
  const limit = params.get('limit') ?? undefined
  if (!host) return appHandleJsonError(new Error('Bad request'))

  let data = null
  let error = null
  try {
    data = await getAllScreens(
      host,
      cursor,
      limit == null ? undefined : Number(limit),
    )
    if (data?.error) error = data?.error
  } catch (err) {
    console.error(err)
    error = err
  }

  if (error) return withPublicReadHeaders(appHandleJsonError(error), gate.headers)
  /*
    BOTH SPELLINGS GO OUT. `cursor` is what `/openapi.json` documents and what
    a new caller should read; `nextPageToken` is what the published CLI reads,
    and dropping it would break every installed copy on the day this deployed.
    `getAllScreens` keeps its own field name — the rename is a fact about this
    route's public contract, not about the reader underneath it.
  */
  return withPublicReadHeaders(
    appHandleJsonSuccess(data && { ...data, cursor: data.nextPageToken }),
    gate.headers,
  )
}
