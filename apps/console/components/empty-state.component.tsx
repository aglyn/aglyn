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

import { CardDisplay, MdiIcon } from '@aglyn/shared-ui-jsx'
import { Stack, Typography } from '@mui/material'
import type { ReactNode } from 'react'

export interface EmptyStateProps {
  /** MDI path (e.g. `ICON_VARIANT_HOST_GROUP.path`) shown above the title. */
  iconPath?: string
  /** Headline — the one-line "what this is / what to do" message. */
  title: ReactNode
  /** Supporting copy under the title; keep it to a sentence or two. */
  description?: ReactNode
  /** Primary call to action (usually a `<Button>`), rendered below the copy. */
  action?: ReactNode
}

/**
 * Reusable zero-state block: a centered icon, title, supporting copy and an
 * optional call to action inside the standard `CardDisplay` framing. Use it
 * wherever a list/grid can legitimately be empty (no sites yet, no org yet,
 * empty media library) instead of leaving a blank content area.
 */
export function EmptyState({
  iconPath,
  title,
  description,
  action,
}: EmptyStateProps) {
  return (
    <CardDisplay contentGutterX contentGutterY>
      <Stack
        spacing={2}
        sx={{ alignItems: 'center', textAlign: 'center', py: 6, px: 2 }}
      >
        {iconPath ? (
          <MdiIcon color="primary" fontSize="large" path={iconPath} />
        ) : null}
        <Typography variant="h6">{title}</Typography>
        {description ? (
          <Typography
            color="textSecondary"
            sx={{ maxWidth: 440 }}
          >
            {description}
          </Typography>
        ) : null}
        {action ? <div>{action}</div> : null}
      </Stack>
    </CardDisplay>
  )
}

EmptyState.displayName = 'EmptyState'
EmptyState.aglyn = true

export default EmptyState
