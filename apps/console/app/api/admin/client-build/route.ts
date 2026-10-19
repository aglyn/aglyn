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
import { pluginRequestFromWeb } from '@aglyn/aglyn/server'
import { domainSearchRegistered, searchDomains } from '@aglyn/aglyn/plugin-manager/plugin-domain-search'
import { pluginSmsAvailable } from '@aglyn/aglyn/plugin-manager/plugin-sms-messaging'
import { isEmailConfigured } from '@aglyn/shared-util-email'
import {
  ClientBuildError,
  consumeRateLimit,
  emailUnverifiedResponse,
  firebaseAdmin,
  isImpersonationSession,
  loadClientBuild,
  saveClientBuild,
  sendClientBuildPreview,
} from '@aglyn/tenant-data-admin'
import { invalidIdTokenResponse } from '../../_lib/invalid-id-token-response'

/** Searches one staff member may run a minute: typing, throttled by the screen. */
const CLIENT_BUILD_SEARCH_LIMIT = 40
/** Previews one workspace may send an hour: a resend or two, never a stream. */
const CLIENT_BUILD_PREVIEW_LIMIT = 5

/** The shortest and longest query a domain search is asked. */
const QUERY_MIN = 2
const QUERY_MAX = 63

/**
 * THE ONE-SCREEN BUILD FOR A CLIENT (AGL-3958), staff only.
 *
 * `{orgId, action}`, as the staff member whose token signs the request:
 *
 * - `get`: the workspace's build record, and what this deployment can do
 *   for it — whether a domain search is offered, and whether a text and an
 *   email can be sent — so the screen shows only the choices that work.
 * - `save`: the business details, the Domain step's answer, the site the
 *   build made and the guided start's job, merged over what is stored. The
 *   intent the hand-off carries is derived here, never taken from the body.
 * - `search-domains`: `{query}`, through the `core.domain-search` slot.
 *   Search only; nothing is bought here. Throttled per staff member.
 * - `send-preview`: texts and emails the owner the site's link and the
 *   address it will live at, once the site has a published page. Throttled
 *   per workspace, and an Audit Log row.
 *
 * The record lives at `orgs/{orgId}/clientBuild/current`, which the rules
 * open to no client, and is written only here, through the Admin SDK.
 */
async function handler(request: Request): Promise<Response> {
  const { method, body, headers: rawHeaders } = await pluginRequestFromWeb(request)
  const headers = rawHeaders as Partial<Record<string, string>>
  if (method !== 'POST') return Response.json({ error: 'Method not allowed' }, { status: 405 })
  const authorization = headers.authorization ?? ''
  const idToken = authorization.startsWith('Bearer ') ? authorization.slice('Bearer '.length) : undefined
  if (!idToken) return Response.json({ error: 'Unauthenticated' }, { status: 401 })
  const orgId = String(body?.['orgId'] ?? '')
  const action = String(body?.['action'] ?? '')
  if (!orgId) return Response.json({ error: 'Missing orgId' }, { status: 400 })

  try {
    const decoded = await firebaseAdmin.app().auth().verifyIdToken(idToken)
    if (!decoded.email_verified && !isImpersonationSession(decoded)) {
      return emailUnverifiedResponse()
    }
    if (decoded['staff'] !== true) {
      return Response.json({ error: 'Staff only' }, { status: 403 })
    }

    if (action === 'get') {
      return Response.json(
        {
          record: await loadClientBuild(orgId),
          capabilities: {
            domainSearch: domainSearchRegistered(),
            text: pluginSmsAvailable(),
            email: isEmailConfigured(),
          },
        },
        { status: 200 },
      )
    }

    if (action === 'save') {
      const record = await saveClientBuild({
        orgId,
        actorUid: decoded.uid,
        patch: {
          ...(body?.['intake'] !== undefined ? { intake: body['intake'] } : {}),
          ...(body?.['domain'] !== undefined ? { domain: body['domain'] } : {}),
          ...(body?.['hostId'] !== undefined ? { hostId: body['hostId'] } : {}),
          ...(body?.['jobId'] !== undefined ? { jobId: body['jobId'] } : {}),
        },
      })
      return Response.json({ record }, { status: 200 })
    }

    if (action === 'search-domains') {
      const query = String(body?.['query'] ?? '').trim().toLowerCase()
      if (query.length < QUERY_MIN || query.length > QUERY_MAX) {
        return Response.json({ error: `Type ${QUERY_MIN} to ${QUERY_MAX} characters` }, { status: 400 })
      }
      const limited = await consumeRateLimit(`client-build-domain-search:${decoded.uid}`, {
        limit: CLIENT_BUILD_SEARCH_LIMIT,
        windowMs: 60_000,
      })
      if (!limited.allowed) {
        return Response.json({ error: 'Too many searches. Wait a moment and try again.' }, { status: 429 })
      }
      const outcome = await searchDomains(query)
      if (outcome.status === 'unavailable') {
        return Response.json({ error: 'Domain search is not set up here', unavailable: true }, { status: 501 })
      }
      if (outcome.status === 'failed') {
        return Response.json({ error: 'The search failed. Try again.' }, { status: 502 })
      }
      return Response.json({ results: outcome.results }, { status: 200 })
    }

    if (action === 'send-preview') {
      const limited = await consumeRateLimit(`client-build-preview:${orgId}`, {
        limit: CLIENT_BUILD_PREVIEW_LIMIT,
        windowMs: 60 * 60_000,
      })
      if (!limited.allowed) {
        return Response.json(
          { error: `The preview was sent ${CLIENT_BUILD_PREVIEW_LIMIT} times in the last hour. Try again later.` },
          { status: 429 },
        )
      }
      const outcome = await sendClientBuildPreview({ orgId, actorUid: decoded.uid })
      return Response.json(outcome, { status: 200 })
    }

    return Response.json({ error: 'Unknown action' }, { status: 400 })
  } catch (error) {
    // An unverifiable credential is a 401, not a fault of ours (AGL-1993).
    const unauthenticated = invalidIdTokenResponse(error)
    if (unauthenticated) return unauthenticated
    if (error instanceof ClientBuildError) {
      return Response.json({ error: error.message }, { status: error.status })
    }
    console.error(error)
    return Response.json({ error: 'Client build failed' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
export { handler as POST }
