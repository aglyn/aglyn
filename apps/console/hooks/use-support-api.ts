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

import { describeResponseWindow, supportForPlan, type SupportCommitment } from '@aglyn/aglyn'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { useUser } from '@aglyn/tenant-feature-instance'
import { useCallback } from 'react'
import supportRequest from '../utils/support-request'
import useCurrentOrg from './use-current-org'

/**
 * The wiring both Support channels share (AGL-1158).
 *
 * The transport itself is `utils/support-request`, extracted and unit-tested
 * already. What lives here is the part that was ALSO duplicated and is just
 * as easy to get wrong — the org scoping and the load gate:
 *
 * * every call carries the CURRENT org (AGL-1147). Threaded through the deps
 *   rather than passed at each call site, because that bug was one omission
 *   repeated: with no `orgId` the routes fall back to `getOrgForUser(uid)`,
 *   which is the caller's FIRST org, so an Enterprise workspace filed tickets
 *   against a personal one and inherited its response commitment;
 * * `canLoad` waits for `orgId`, not merely for `user` (AGL-1154). `user`
 *   resolves FIRST — the orgs are queried by it — so gating on `user` alone
 *   leaves a window where the request goes out unscoped and hits exactly the
 *   fallback above, on every cold load.
 *
 * Splitting the page into two would have forked both rules. One hook means a
 * third Support surface inherits them instead of re-deriving them.
 */
export interface SupportApi {
  /**
   * Makes one Support API call. Resolves `null` when the call failed AND the
   * user has been told — never "the server returned nothing".
   */
  request: (
    path: string,
    method: string,
    body?: Record<string, unknown>,
  ) => Promise<any | null>
  /**
   * True once a request would be correctly scoped. Loaders MUST check this:
   * asking while the question is unanswerable is what AGL-1154 was.
   */
  canLoad: boolean
  orgId: string | undefined
  /** True once the org's plan is a trustworthy answer (AGL-887). */
  ready: boolean
  /** What this org is owed. Fails closed to the weakest tier. */
  commitment: SupportCommitment
  /** "7–14 business days" · `null` when no ticket channel is committed. */
  responseWindow: string | null
  /** Whether this tier has a ticket channel at all. */
  canOpenTickets: boolean
}

export function useSupportApi(): SupportApi {
  const { data: user } = useUser()
  const { enqueueSnackbar } = useSnackbar()
  const { org, orgId, ready } = useCurrentOrg()

  // `supportForPlan` fails closed to the weakest tier, so this is safe to
  // compute before `ready` — but NOT safe to render before it, which is why
  // `ready` is handed back rather than folded in. Quoting the free tier's
  // "no commitment" to a paying customer is the failure this separation
  // exists to prevent.
  const commitment = supportForPlan(org?.plan)
  const responseWindow = describeResponseWindow(commitment.firstResponse)

  const request = useCallback(
    (path: string, method: string, body?: Record<string, unknown>) =>
      supportRequest(
        {
          getIdToken: () => (user as any)?.getIdToken?.(),
          orgId,
          onError: (message) =>
            enqueueSnackbar(message, { variant: 'warning', persist: false }),
        },
        path,
        method,
        body,
      ) as Promise<any | null>,
    [user, orgId, enqueueSnackbar],
  )

  return {
    request,
    canLoad: Boolean(user && orgId),
    orgId,
    ready,
    commitment,
    responseWindow,
    canOpenTickets: commitment.firstResponse !== null,
  }
}

export default useSupportApi
