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

import {
  resolveStaffRoleGate,
  SUPER_STAFF_ONLY_REASON,
  type StaffRoleGate,
} from '@aglyn/aglyn/app-utils/staff-role-gate'
import BlockedControl from '@aglyn/shared-ui-jsx/components/blocked-control.component'
import { Alert } from '@mui/material'
import { type ReactElement } from 'react'
import { useStaffRole } from '../hooks/use-is-staff'

export { SUPER_STAFF_ONLY_REASON }
export type { StaffRoleGate }

/**
 * The ONE affordance for a super-only staff control (AGL-2131).
 *
 * Six capabilities are enforced `super`-only on the server — publishing a
 * feature flag, lockdown at every scope, retargeting a host subdomain,
 * granting realm trust, granting/revoking staff, and the per-org release-flag
 * override — and every one of them rendered its live control to `support`
 * staff, who clicked it and got a raw 403. Nothing was exploitable; the cost
 * was a console that told a support engineer they could do six things they
 * could not.
 *
 * DISABLED WITH THE REASON, NOT HIDDEN. Both are defensible and the choice is
 * made here once rather than six times:
 *
 * - Hiding leaves a support engineer unable to see that the capability exists
 *   at all. The commonest support act is routing — "this needs someone with
 *   the super role" is an answer they can give in one message; "I see no such
 *   button" turns into an investigation of whether the feature shipped.
 * - Disabling states the boundary in the place the boundary applies, which is
 *   what the two surfaces that already got this right do
 *   (media-quarantine, staff-user-erase-card).
 *
 * The divergence risk is the real argument for a shared component. AGL-2113
 * is the precedent: five quota readouts each grew their own phrasing and
 * threshold and stopped agreeing with one another. One wrapper, one sentence,
 * one predicate.
 *
 * THIS IS NOT THE SECURITY BOUNDARY. The routes verify the decoded token per
 * request and refuse regardless of what rendered. This exists so the console
 * stops promising what the server will refuse.
 */

/**
 * Resolves the viewer's standing against the set of roles a route admits.
 *
 * The VERDICT moved to `@aglyn/aglyn/app-utils/staff-role-gate` in AGL-3080,
 * so a plugin's staff page can reach the same answer from the role the shell
 * hands it. What stays here is the only part that is this app's: reading the
 * claim off the session.
 */
export function useStaffRoleGate(allowed: readonly string[]): StaffRoleGate {
  return resolveStaffRoleGate(useStaffRole(), allowed)
}

const SUPER: readonly string[] = ['super']

/** Resolves the viewer's super-staff standing for a control or a page. */
export function useSuperStaffGate(): StaffRoleGate {
  return useStaffRoleGate(SUPER)
}

export interface StaffRoleOnlyProps {
  /** The roles the wrapped control's route admits. */
  roles: readonly string[]
  children: ReactElement<{ disabled?: boolean }>
}

/** {@link SuperStaffOnly} for a gate that is not super-only. */
export function StaffRoleOnly({ roles, children }: StaffRoleOnlyProps) {
  const { blocked, reason } = useStaffRoleGate(roles)
  return (
    <BlockedControl blocked={blocked} reason={reason ?? SUPER_STAFF_ONLY_REASON}>
      {children}
    </BlockedControl>
  )
}

export interface SuperStaffOnlyProps {
  /**
   * A single control that accepts a `disabled` prop — MUI's Button,
   * IconButton, Switch, TextField and friends all do.
   */
  children: ReactElement<{ disabled?: boolean }>
}

/**
 * Renders its control disabled, with the reason on hover, for staff who are
 * not `super`. Passes the control through untouched for super staff and while
 * the claim is still resolving.
 *
 * The tooltip wraps a `span`, not the control: MUI does not fire pointer
 * events on a disabled button, so a tooltip attached directly to one never
 * appears — which would leave a dead button and no reason at all, the exact
 * failure this component exists to stop.
 */
export function SuperStaffOnly({ children }: SuperStaffOnlyProps) {
  const { blocked, reason } = useSuperStaffGate()
  return (
    <BlockedControl blocked={blocked} reason={reason ?? SUPER_STAFF_ONLY_REASON}>
      {children}
    </BlockedControl>
  )
}

/**
 * A page- or section-level statement of the same boundary, for surfaces whose
 * controls are numerous enough that a per-control tooltip is not where a
 * reader looks first. Renders nothing for super staff and nothing while the
 * claim resolves, so it never flashes.
 */
export function SuperStaffOnlyNotice({ what }: { what: string }) {
  const { blocked } = useSuperStaffGate()
  if (!blocked) return null
  return (
    <Alert severity="info" sx={{ mb: 2 }}>
      {`${what} requires the super staff role. You can read everything on ` +
        'this page; the controls that change it are disabled for your role.'}
    </Alert>
  )
}

export default SuperStaffOnly
