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
  type AglynOrgBilling,
  buildRoute,
  checkEntitlement,
  planLabelGrantingFeature,
  Route,
} from '@aglyn/aglyn'
import { mdiLockOutline } from '@aglyn/shared-data-mdi'
import { AppLink, MdiIcon } from '@aglyn/shared-ui-jsx'
import { Alert, Button, type ButtonProps, Tooltip } from '@mui/material'
import { useParams } from 'next/navigation'
import type { ReactNode } from 'react'

/**
 * THE CRM'S LOCK AND NOTICE, AS A SURFACE'S OWN CONTROLS DRAW THEM (AGL-2788).
 *
 * The CRM is included from Starter (AGL-2851), and the shell refuses all of
 * it on a plan without `features.crm`: every section is drawn locked beside
 * the upgrade notice, and no CRM page mounts. These are a page's second
 * answer, not its first. When a CRM surface renders for an org whose plan
 * lacks the CRM, its acts — adding a person by hand, importing a file, a
 * saved view, an owner, a stage, a company, a task, a logged call, an email,
 * a merge — are drawn in the shell's own terms: the lock the rail draws, on a
 * control that stays where it is and cannot be pressed, and the notice and
 * link the shell ends a locked section with.
 *
 * ## Not hidden, and not pressable
 *
 * A control that vanished would hide the CRM from the plan being asked to buy
 * it, and one that opened and then failed would spend the reader's work on a
 * refusal. The routes behind these acts refuse the same plans either way
 * (`server/suite-gate.ts`).
 *
 * ## An answer, not a loading state
 *
 * The plan is read from the org document the shell hands a plugin page, and
 * the shell mounts the page only once that document has settled — so a lock
 * drawn here is a fact about the plan, never one paint of an org still in
 * flight read as Free (AGL-1380).
 */

/** The entitlement the suite is sold under. */
const CRM_SUITE_FEATURE = 'crm'

/** Whether the org's plan carries the CRM suite. */
export function crmSuiteIncluded(org: unknown): boolean {
  return checkEntitlement(
    org as Partial<AglynOrgBilling> | null | undefined,
    CRM_SUITE_FEATURE,
  )
}

/** What a locked control says about itself, on hover and to assistive tech. */
export function crmSuiteLockedReason(): string {
  const plan = planLabelGrantingFeature(CRM_SUITE_FEATURE)
  return plan
    ? `Part of the CRM, included from ${plan}`
    : 'Part of the CRM, which your plan does not include'
}

/**
 * The notice a surface with locked controls carries: what is locked, the
 * plan that includes it, and the way to the plans — the alert and the link
 * the shell ends a locked section with.
 */
export function CrmSuiteNotice(props: { children: ReactNode }) {
  const params = useParams<{ orgSlug?: string }>()
  const orgSlug = params?.orgSlug ? String(params.orgSlug) : ''
  const plan = planLabelGrantingFeature(CRM_SUITE_FEATURE)
  return (
    <Alert
      severity="info"
      action={
        orgSlug ? (
          <AppLink
            componentVariant="button"
            size="small"
            color="inherit"
            href={buildRoute(Route.MANAGE_BILLING, { orgSlug })}
          >
            {'View plans'}
          </AppLink>
        ) : undefined
      }
    >
      {props.children}
      {plan ? ` Included from ${plan}.` : null}
    </Alert>
  )
}
CrmSuiteNotice.displayName = 'CrmSuiteNotice'

export type CrmSuiteLockedButtonProps = Omit<
  ButtonProps,
  'disabled' | 'onClick' | 'startIcon' | 'href'
>

/**
 * A control the plan has locked: standing where the working one stands,
 * with the rail's lock, disabled, and its reason as the description.
 *
 * The span carries the tooltip because a disabled button fires no pointer
 * events, so a tooltip on the button itself would never open.
 */
export function CrmSuiteLockedButton(props: CrmSuiteLockedButtonProps) {
  const { children, size = 'small', ...rest } = props
  return (
    <Tooltip title={crmSuiteLockedReason()} describeChild>
      <span>
        <Button
          {...rest}
          size={size}
          disabled
          startIcon={<MdiIcon path={mdiLockOutline.path} size={0.7} />}
        >
          {children}
        </Button>
      </span>
    </Tooltip>
  )
}
CrmSuiteLockedButton.displayName = 'CrmSuiteLockedButton'
