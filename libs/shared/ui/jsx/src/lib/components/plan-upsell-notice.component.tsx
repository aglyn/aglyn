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

import type { AlertProps } from '@mui/material'
import type { ReactNode } from 'react'
import { PrerequisiteNotice } from './prerequisite-notice.component'

export interface PlanUpsellNoticeProps {
  /**
   * What the feature does, in the operator's terms, so the notice sells
   * something: "Schedule a version to go live at a set time."
   */
  children: ReactNode
  /** The cheapest plan that includes it ("Business"), when one does. */
  planLabel: string | undefined
  /** The plan grid on the Billing page. */
  upgradeHref: string | undefined
  /** Extra layout on the alert (margins in a stack, mostly). */
  sx?: AlertProps['sx']
}

/**
 * The locked state of a plan feature: what it does, which plan includes it,
 * and one click to the plan grid.
 *
 * The plan name is not decoration. "This is a paid feature" is a dead end;
 * "Included from Business" beside an Upgrade button is the path. It is a
 * {@link PrerequisiteNotice} — a plan is one more prerequisite a workspace
 * can fix itself — so it looks and reads like every other one.
 *
 * Pair it with `BlockedControl` (or `PlanLockedControl` where there is no
 * room for a notice) so the control stays on screen, disabled, with the
 * same reason on hover and for a screen reader.
 */
export function PlanUpsellNotice(props: PlanUpsellNoticeProps) {
  const { children, planLabel, upgradeHref, sx } = props
  return (
    <PrerequisiteNotice href={upgradeHref} actionLabel="Upgrade" sx={sx}>
      {children}
      {planLabel ? ` Included from ${planLabel}.` : null}
    </PrerequisiteNotice>
  )
}

export default PlanUpsellNotice
