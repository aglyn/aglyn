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

import type { FormContractViolation } from '@aglyn/aglyn'
import { useUser } from '@aglyn/tenant-feature-instance'
import { authorizedFetch } from '@aglyn/shared-util-http/authorized-token'
import { useCallback } from 'react'

/**
 * What the route refused with, or what it did.
 *
 * ONE shape rather than a discriminated union: `strictNullChecks` is off in
 * this repo, so narrowing on an `ok: true | false` discriminant does not
 * happen and every read of `message` would need a cast. A caller reads
 * `message` and `violations` only after seeing `ok === false`, and both are
 * always populated on a refusal — `violations` as an empty array when the
 * refusal was not about the contract at all (a role denial, a lockdown, a
 * version with no design).
 */
export interface PromoteFormResult {
  ok: boolean
  /**
   * Author-facing, and stated by the ROUTE. Present on a refusal.
   */
  message?: string
  /**
   * The contract violations, verbatim.
   *
   * The codes and sentences are `checkFormContract`'s own, so the page renders
   * exactly what the besigner renders and neither side parses prose.
   */
  violations?: FormContractViolation[]
}

/** Promote one version of one form, by id — no design crosses the wire. */
export type PromoteForm = (options: {
  hostId: string
  formId: string
  versionId: string
}) => Promise<PromoteFormResult>

/**
 * Makes one version of a form the version the site serves.
 *
 * Server-side, and never a client `updateDoc`, because promotion is where the
 * form's contract is enforced: `/api/hosts/forms/promote` re-reads the stored
 * version, runs `checkFormContract` on the tree it is about to write, and
 * refuses with a 422 rather than publishing a design whose submissions would
 * silently stop arriving. A console-side check is advice; that route is the
 * enforcement, so this hook sends three ids and no design at all.
 *
 * Resolves rather than throws on a refusal: a broken contract is an ordinary
 * outcome an author is expected to see and fix, and the violations are the
 * payload, not an error message.
 */
export function useFormPromoteApi(): PromoteForm {
  const { data: user } = useUser()
  return useCallback<PromoteForm>(
    async ({ hostId, formId, versionId }) => {
      const response = await authorizedFetch(user, '/api/hosts/forms/promote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hostId, formId, versionId }),
      })
      const payload = await response.json().catch(() => ({}))
      if (response.ok) return { ok: true }
      return {
        ok: false,
        message: String(payload?.error ?? 'Publish failed'),
        violations: Array.isArray(payload?.violations)
          ? (payload.violations as FormContractViolation[])
          : [],
      }
    },
    [user],
  )
}

export default useFormPromoteApi
