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

import { Alert, Box, Tooltip } from '@mui/material'
import { cloneElement, isValidElement, type ReactElement } from 'react'
import { useStaffRole } from '../hooks/use-is-staff'

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

/** The single sentence every blocked super-only control says. */
export const SUPER_STAFF_ONLY_REASON =
  'This action requires the super staff role. Ask someone who holds it.'

export interface StaffRoleGate {
  /**
   * `false` while the claim is still resolving. Nothing may be BLOCKED in
   * that window: rendering a refusal there would flash a disabled button at
   * every super-staff member on every admin page load, which is the flicker
   * `useStaffRole`'s own `null` state exists to prevent.
   */
  ready: boolean
  /** Whether the viewer's role is one the route admits. `false` until `ready`. */
  admitted: boolean
  /**
   * The one thing call sites actually branch on: a RESOLVED claim the route
   * would refuse. Deliberately not `!admitted` — that is true during the
   * unresolved window too, and would disable the control for everyone for a
   * beat.
   */
  blocked: boolean
  /** The reason to show when `blocked`, else `undefined`. */
  reason?: string
}

/**
 * Resolves the viewer's standing against the set of roles a route admits.
 *
 * Not every gated act is super-only: /api/admin/org-override admits `billing`
 * for plan and quota writes and reserves only `releaseFlags` for `super`. A
 * gate that could only say "super" would disable that dialog for the role
 * whose entire purpose it is — trading one dishonest control for another.
 */
export function useStaffRoleGate(allowed: readonly string[]): StaffRoleGate {
  // `null` means "still reading the token", and it is also what the hook
  // returns for a non-staff viewer — who never reaches an /admin page at all,
  // because StaffOnly 404s them first. Treating both as "not yet resolved" is
  // therefore right for the only population that gets here.
  const role = useStaffRole()
  const ready = role !== null
  const admitted = ready && allowed.includes(String(role))
  const blocked = ready && !admitted
  return {
    ready,
    admitted,
    blocked,
    reason: blocked
      ? `This action requires the ${allowed.join(' or ')} staff role. ` +
        'Ask someone who holds it.'
      : undefined,
  }
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
  if (!blocked || !isValidElement(children)) return children
  return (
    <Tooltip title={reason ?? SUPER_STAFF_ONLY_REASON}>
      {/* The reason also lands on the span as a real `aria-label` and
          `title`, not only inside the Tooltip's popper. A disabled control
          whose only explanation appears on hover says nothing at all to a
          screen reader, and nothing to anyone on a touch device — which
          would leave exactly the dead button this component exists to
          replace. */}
      <Box
        component="span"
        aria-label={reason ?? SUPER_STAFF_ONLY_REASON}
        title={reason ?? SUPER_STAFF_ONLY_REASON}
        sx={{ display: 'inline-flex' }}
      >
        {cloneElement(children, { disabled: true })}
      </Box>
    </Tooltip>
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
  if (!blocked || !isValidElement(children)) return children
  return (
    <Tooltip title={reason ?? SUPER_STAFF_ONLY_REASON}>
      {/* The reason also lands on the span as a real `aria-label` and
          `title`, not only inside the Tooltip's popper. A disabled control
          whose only explanation appears on hover says nothing at all to a
          screen reader, and nothing to anyone on a touch device — which
          would leave exactly the dead button this component exists to
          replace. */}
      <Box
        component="span"
        aria-label={reason ?? SUPER_STAFF_ONLY_REASON}
        title={reason ?? SUPER_STAFF_ONLY_REASON}
        sx={{ display: 'inline-flex' }}
      >
        {cloneElement(children, { disabled: true })}
      </Box>
    </Tooltip>
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
