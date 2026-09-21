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

import { Box, Tooltip } from '@mui/material'
import { cloneElement, isValidElement, type ReactElement } from 'react'

export interface BlockedControlProps {
  /**
   * Whether the viewer's standing is RESOLVED and refused. Never true while
   * a claim is still loading: rendering the refusal in that window flashes a
   * disabled button at everybody, including the people who may use it.
   */
  blocked: boolean
  /** Why, in one sentence. Shown on hover, and to a screen reader. */
  reason: string
  /**
   * A single control that accepts a `disabled` prop — MUI's Button,
   * IconButton, Switch, TextField and friends all do.
   */
  children: ReactElement<{ disabled?: boolean }>
}

/**
 * Renders a control disabled with the reason attached, or passes it through
 * untouched.
 *
 * DISABLED WITH THE REASON, NOT HIDDEN. Both are defensible and the choice is
 * made here once rather than at every gate. Hiding leaves a reader unable to
 * see that the capability exists at all, and the commonest support act is
 * routing — "this needs someone with the super role" is an answer they can
 * give in one message; "I see no such button" turns into an investigation of
 * whether the feature shipped.
 *
 * ## Two details that are the whole reason this is shared
 *
 * The tooltip wraps a `span`, not the control: MUI does not fire pointer
 * events on a disabled button, so a tooltip attached directly to one never
 * appears — which would leave a dead button and no reason at all, the exact
 * failure this exists to stop.
 *
 * And the reason lands on the span as a real `aria-label` and `title`, not
 * only inside the Tooltip's popper. An explanation that appears only on
 * hover says nothing to a screen reader and nothing on a touch device.
 *
 * Both were got right once and then copied; AGL-2113 is the precedent for
 * what copies do — five quota readouts grew their own phrasing and stopped
 * agreeing. THIS IS NOT A SECURITY BOUNDARY: the server refuses regardless
 * of what rendered. It exists so a console stops promising what the server
 * will refuse.
 */
export function BlockedControl({ blocked, reason, children }: BlockedControlProps) {
  if (!blocked || !isValidElement(children)) return children
  return (
    <Tooltip title={reason}>
      <Box
        component="span"
        aria-label={reason}
        title={reason}
        sx={{ display: 'inline-flex' }}
      >
        {cloneElement(children, { disabled: true })}
      </Box>
    </Tooltip>
  )
}

BlockedControl.displayName = 'BlockedControl'
BlockedControl.aglyn = true

export default BlockedControl
