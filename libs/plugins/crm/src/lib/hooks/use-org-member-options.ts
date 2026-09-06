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

import { type CrmMemberOption, crmMemberOption, findOrgMember } from '@aglyn/aglyn'
import { authorizedFetch } from '@aglyn/shared-util-http/authorized-token'
import { useUser } from '@aglyn/tenant-feature-instance'
import { useEffect, useMemo, useState } from 'react'

/** One teammate, as an owner picker or an owner column needs them. */
export type OrgMemberOption = CrmMemberOption

export interface OrgMemberOptions {
  options: OrgMemberOption[]
  /**
   * Label for a stored reference — a uid, or an address the roster has — or
   * the reference's own tail when the roster does not know it.
   */
  labelFor: (ref: string | null | undefined) => string
  /**
   * The member's ADDRESS for a stored reference — what a CSV export writes
   * in an owner column, because an import resolves an owner by email —
   * falling back to the label and then to the reference itself.
   */
  emailFor: (ref: string | null | undefined) => string
  /** The roster has answered — with people, or with a refusal. */
  ready: boolean
  /** The roster was refused or unreachable; `options` is then empty. */
  error: string | null
}

/**
 * The org's team, for choosing and naming a record's OWNER (AGL-2597).
 *
 * Read through `GET /api/orgs/members` rather than by listening to
 * `orgs/{orgId}/members`, because the rules on that collection admit a list
 * only to an org-wide member: a scoped editor — precisely the person an
 * agency has running one client's CRM — is refused, and a picker that is
 * empty for them cannot assign an owner. The route re-derives membership
 * with the Admin SDK and answers any member of the org.
 *
 * Fetched once per org and held; the roster changes on a settings page, not
 * while somebody is filing a company. A signed-out mount fetches nothing.
 */
export function useOrgMemberOptions(
  orgId: string | null | undefined,
): OrgMemberOptions {
  const { data: user } = useUser()
  /*
   * The effect is keyed on WHO is signed in, not on the object that says so.
   * `useUser` hands back one `User` per session, but the contract here is
   * one fetch per org, and that must hold under any provider — a test double
   * that mints a fresh object per render, or a listener that re-emits on a
   * token refresh — or the roster is fetched in a loop. The object itself is
   * only the bearer of the token, read from the closure at fetch time.
   */
  const uid = user?.uid ?? null
  const [state, setState] = useState<{
    orgId: string
    options: OrgMemberOption[]
    error: string | null
  } | null>(null)

  useEffect(() => {
    if (!orgId || !user) return undefined
    let active = true
    void authorizedFetch(
      user,
      `/api/orgs/members?orgId=${encodeURIComponent(orgId)}`,
    )
      .then(async (response) => {
        const payload = await response.json().catch(() => ({}))
        if (!response.ok) {
          throw new Error(
            String(payload?.error ?? 'The team could not be loaded'),
          )
        }
        const members: Array<Record<string, unknown>> = Array.isArray(
          payload?.members,
        )
          ? payload.members
          : []
        const options = members
          .map((member) => crmMemberOption(member))
          // A member with no uid cannot own anything. One with no name and
          // no address is still on the team and is listed by uid — dropping
          // them made them the one member nobody could assign to.
          .filter((option): option is OrgMemberOption => option !== null)
          .sort((left, right) =>
            left.label.localeCompare(right.label, undefined, {
              sensitivity: 'base',
            }),
          )
        if (active) setState({ orgId, options, error: null })
      })
      .catch((error: unknown) => {
        if (active) {
          setState({
            orgId,
            options: [],
            error:
              error instanceof Error
                ? error.message
                : 'The team could not be loaded',
          })
        }
      })
    return () => {
      active = false
    }
    // `user` is read for its token only; `uid` is the identity that decides
    // the answer — see the note above the state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, uid])

  // An answer for a different org is a stale one: the section that asked for
  // it has moved on, and naming last org's people as this one's owners is a
  // disclosure as well as a mistake.
  const current = state && state.orgId === orgId ? state : null
  const options = useMemo(() => current?.options ?? [], [current])
  const labelFor = useMemo(
    () => (ref: string | null | undefined) =>
      ref ? (findOrgMember(options, ref)?.label ?? `Member ${ref.slice(-6)}`) : '',
    [options],
  )
  const emailFor = useMemo(
    () => (ref: string | null | undefined) => {
      if (!ref) return ''
      const member = findOrgMember(options, ref)
      return member?.email || member?.label || ref
    },
    [options],
  )

  // One object per answer, so a column list or a drawer that lists this in
  // its dependencies recomputes when the roster changes and not per render.
  return useMemo(
    () => ({
      options,
      labelFor,
      emailFor,
      ready: current !== null,
      error: current?.error ?? null,
    }),
    [options, labelFor, emailFor, current],
  )
}

export default useOrgMemberOptions
