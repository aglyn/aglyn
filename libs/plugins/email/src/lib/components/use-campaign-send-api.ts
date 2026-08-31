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
'use client'

import { useUser } from '@aglyn/tenant-feature-instance'
import { useCallback, useRef } from 'react'
import { resolveIdToken, type TokenSource } from './authorized-token'

/** What one call to the campaign API answered with. */
export interface CampaignSendApiResult {
  response: Response
  payload: Record<string, any>
}

/**
 * ONE AUTHORIZED POST TO THE CAMPAIGN API.
 *
 * Every action the surface takes against a send — the audience count, the
 * message render, the test send, the send itself, and asking an email that
 * has already gone out to reach more people — is the same request with a
 * different `action`, so it is one caller rather than one per screen. The
 * route decides authorization from the token; nothing here does.
 *
 * ## The user is read through a REF, and that is load-bearing
 *
 * This callback is a dependency of the composer's two preview effects, so
 * anything that changes its identity re-issues their requests — and the user
 * object is a new object on most renders. Depending on it directly made the
 * count effect fire on every keystroke: clear the count, resolve the whole
 * audience again, for a number that cannot have moved. The token is fetched
 * at call time either way, so the ref costs nothing and the callback depends
 * on the one thing that really identifies the request.
 */
export function useCampaignSendApi(hostId: string) {
  return useCampaignApi(hostId, '/api/campaigns/send')
}

/**
 * ONE AUTHORIZED POST TO THE CAMPAIGN MANAGEMENT API.
 *
 * A second endpoint rather than a second action on the send route, because
 * nothing it does sends: it removes a campaign container, or discards a draft
 * that was never mailed. The route is what decides whether either is allowed
 * — a draft's state and a container's emails are read there — so this is the
 * same one-POST caller pointed at a different path.
 */
export function useCampaignManageApi(hostId: string) {
  return useCampaignApi(hostId, '/api/campaigns/manage')
}

/**
 * The POST both callers above make: the site id, the caller's ID token, and
 * whatever the action carries.
 *
 * The user is read through a ref for the reason given above, and the path is
 * a plain argument so the two hooks are one implementation. A hook taking the
 * URL from a component would be a way for a caller to post the console's
 * credentials somewhere the console does not own, which is why neither
 * exported hook accepts one.
 *
 * ## The token is obtained under a deadline, and its absence is an ERROR
 *
 * `resolveIdToken` throws rather than answering with nothing, and it gives up
 * rather than waiting forever. Both matter here because the token is awaited
 * IN FRONT of the request: a refresh that never answers means this call never
 * reaches `fetch` at all — no request, no response, no failure to report —
 * and a token that came back empty would otherwise post the send
 * unauthenticated and turn "you are signed out" into a refusal from the
 * route. Callers are expected to let the error reach the person.
 */
function useCampaignApi(hostId: string, path: string) {
  const { data: user } = useUser()
  const userRef = useRef(user)
  userRef.current = user
  return useCallback(
    async (payload: Record<string, unknown>): Promise<CampaignSendApiResult> => {
      const idToken = await resolveIdToken(
        userRef.current as TokenSource | null | undefined,
      )
      const response = await fetch(path, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({ hostId, ...payload }),
      })
      const json = await response.json().catch(() => ({}))
      return { response, payload: json as Record<string, any> }
    },
    [hostId, path],
  )
}
