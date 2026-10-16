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

import { Alert, type AlertProps } from '@mui/material'
import type { ReactNode } from 'react'
import { AppLink } from './app-link'

export interface PrerequisiteNoticeProps {
  /**
   * What the feature needs first and what it unlocks, in one or two
   * sentences: "Connect Stripe to take card payments at the register."
   */
  children: ReactNode
  /**
   * Where the operator fixes it. Without one the notice still names the
   * step; a notice that cannot link is better than a control that vanishes.
   */
  href?: string
  /** The link's label — the page or action it opens. Defaults to "Set it up". */
  actionLabel?: string
  /**
   * `info` for a step that unlocks something optional, `warning` when a
   * setting already saved cannot work until the step is done (a deposit set
   * on a store that cannot charge).
   */
  severity?: Extract<AlertProps['severity'], 'info' | 'warning'>
  /** Extra layout on the alert (margins in a stack, mostly). */
  sx?: AlertProps['sx']
}

/**
 * Says what a feature needs before it can work, and links to where that is
 * done.
 *
 * A control that silently disappears or fails only after it is pressed reads
 * as a missing feature, and the operator has no way to learn that one setup
 * step stands between them and it. This is the one place the console states a
 * prerequisite an operator can fix themselves: connecting Stripe, adding a
 * ship-from address, a plan that includes the feature. A gate the operator
 * cannot act on — a deployment that has not configured a vendor — stays
 * hidden instead, since naming it would point at a step nobody on the
 * workspace can take.
 *
 * Pair it with `BlockedControl` when the gated control stays on screen: the
 * notice carries the link, the disabled control carries the same reason on
 * hover and for a screen reader.
 */
export function PrerequisiteNotice(props: PrerequisiteNoticeProps) {
  const { children, href, actionLabel = 'Set it up', severity = 'info', sx } = props
  return (
    <Alert
      severity={severity}
      sx={sx}
      action={
        href ? (
          <AppLink componentVariant="button" color="inherit" size="small" href={href}>
            {actionLabel}
          </AppLink>
        ) : undefined
      }
    >
      {children}
    </Alert>
  )
}

export default PrerequisiteNotice
