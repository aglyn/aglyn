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
import { Alert, Box, Button, CircularProgress, Stack, Typography } from '@mui/material'
import type { ReactNode } from 'react'
import type { ReadOutcome } from '../utils/read-outcome'

export interface EmptyStateProps {
  /** MDI path (e.g. `ICON_VARIANT_HOST_GROUP.path`) shown above the title. */
  iconPath?: string
  /** Headline — the one-line "what this is / what to do" message. */
  title: ReactNode
  /** Supporting copy under the title; keep it to a sentence or two. */
  description?: ReactNode
  /** Primary call to action (usually a `<Button>`), rendered below the copy. */
  action?: ReactNode
  /**
   * Did the read behind this list actually succeed? REQUIRED, and
   * deliberately not defaulted (AGL-1066).
   *
   * A list is empty for three different reasons and only one of them is
   * "there is nothing here". Passing `loaded` is an assertion that the read
   * reached the server and came back with zero rows; anything else renders
   * the loading or degraded branch below and `title`/`description`/`action`
   * are never shown. See `utils/read-outcome`.
   */
  read: ReadOutcome
  /**
   * What could not be loaded, for the degraded copy — a lower-case noun
   * phrase in the customer's terms: `'your sites'`, `'your workspaces'`.
   */
  subject?: string
  /** Re-runs the failed read. Omit only when nothing can retry it. */
  onRetry?: () => void
}

/**
 * Reusable zero-state block: a centered icon, title, supporting copy and an
 * optional call to action inside the standard `CardDisplay` framing. Use it
 * wherever a list/grid can legitimately be empty (no sites yet, no org yet,
 * empty media library) instead of leaving a blank content area.
 *
 * ## The zero-state is GATED, not merely offered (AGL-1066, AGL-1062)
 *
 * "No sites yet — Create a site to start building" is a statement of fact
 * about someone's account, and it was reachable from a read that never
 * reached the server: a stale session denies every server read while
 * `persistentLocalCache` keeps listeners painting, so the list rendered, then
 * emptied, then asserted the emptiness. On a page whose zero-state carries a
 * **Create site** button that is not just wrong, it invites a customer to
 * rebuild sites they still own.
 *
 * So the copy and the call to action live behind `read === 'loaded'`. This is
 * a required prop rather than a caller-side `if` because the caller-side `if`
 * is exactly what every surface forgot; putting it here means a new list
 * cannot render a zero-state without answering the question first.
 *
 * The degraded branch deliberately borrows the shape and the promises of the
 * AGL-1063 session banner — "nothing has been deleted", signing in again
 * fixes it — rather than restating its diagnosis. The banner knows whether
 * the SESSION is at fault; a single list does not, and a list that guessed
 * would be the AGL-1179 mistake at the surface instead of in a log.
 */
export function EmptyState({
  iconPath,
  title,
  description,
  action,
  read,
  subject = 'this list',
  onRetry,
}: EmptyStateProps) {
  // A read still in flight is not an answer. Rendering the frame with a
  // spinner keeps the page from jumping when the rows arrive, and — more to
  // the point — keeps the zero-state's sentence out of the load window.
  if (read === 'loading') {
    return (
      <CardDisplay contentGutterX contentGutterY>
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
          <CircularProgress aria-label={`Loading ${subject}`} />
        </Box>
      </CardDisplay>
    )
  }

  if (read === 'unavailable') {
    return (
      <Alert
        severity="warning"
        action={
          onRetry ? (
            <Button color="inherit" size="small" onClick={onRetry}>
              {'Try again'}
            </Button>
          ) : null
        }
      >
        {`${subject.charAt(0).toUpperCase()}${subject.slice(1)} could not be ` +
          'loaded, so this list is incomplete. Nothing has been deleted. If ' +
          'the banner above asks you to sign in again, that fixes it.'}
      </Alert>
    )
  }

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
