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

import { Box } from '@mui/material'
import type { ReactElement } from 'react'
import { AppLink } from './app-link'
import { BlockedControl } from './blocked-control.component'

export interface PlanLockedControlProps {
  /** The plan has settled and does not include the feature. */
  locked: boolean
  /** Why, in one sentence: "Writing with AI is included from Starter." */
  reason: string
  /** The cheapest plan that includes it ("Starter"), when one does. */
  planLabel: string | undefined
  /** The plan grid on the Billing page. */
  upgradeHref: string | undefined
  /** A single control that accepts a `disabled` prop. */
  children: ReactElement<{ disabled?: boolean }>
}

/**
 * A plan-gated control for a place with no room for a notice — a toolbar, a
 * table row, a card header: the control disabled with the reason, and a small
 * "Included from Starter" link beside it to the plan grid.
 *
 * The link is the half `BlockedControl` cannot carry. A tooltip on a disabled
 * button can name the plan but cannot hold a link anybody can press, and a
 * reason with nowhere to act on it is the dead end this replaces.
 */
export function PlanLockedControl(props: PlanLockedControlProps) {
  const { locked, reason, planLabel, upgradeHref, children } = props
  if (!locked) return children
  return (
    <Box
      component="span"
      sx={{ display: 'inline-flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}
    >
      <BlockedControl blocked reason={reason}>
        {children}
      </BlockedControl>
      {upgradeHref ? (
        <AppLink href={upgradeHref} variant="caption" aria-label={`${reason} Upgrade`}>
          {planLabel ? `Included from ${planLabel}` : 'Upgrade'}
        </AppLink>
      ) : null}
    </Box>
  )
}

PlanLockedControl.displayName = 'PlanLockedControl'

export default PlanLockedControl
