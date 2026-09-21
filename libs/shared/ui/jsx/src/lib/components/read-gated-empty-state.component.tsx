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

import { Alert, Box, Button, CircularProgress, Stack, Typography } from '@mui/material'
import type { ReactNode } from 'react'
import CardDisplay from './card-display'
import MdiIcon from './mdi-icon/mdi-icon'
import type { ReadOutcome } from '../utils/read-outcome'

export interface ReadGatedEmptyStateProps {
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
  /**
   * An action for the degraded branch that OUTRANKS the retry button
   * (AGL-3080) — for a caller that knows retrying cannot work.
   *
   * The case it exists for is the console's stale session: every server read
   * is being refused, so "Try again" is an invitation to fail, and what the
   * reader needs is the way back into the sign-in dialog. Only the app knows
   * that, because only the app holds the session store — which is exactly why
   * this is a prop rather than a branch in here. A caller that passes nothing
   * gets the retry button, which is the right answer for every read whose
   * failure is not the session.
   */
  degradedAction?: ReactNode
}

/**
 * Reusable zero-state block: a centered icon, title, supporting copy and an
 * optional call to action inside the standard `CardDisplay` framing. Use it
 * wherever a list/grid can legitimately be empty (no sites yet, no org yet,
 * empty media library) instead of leaving a blank content area.
 *
 * Distinct from {@link EmptyState} in this same library, which is the
 * illustrated "nothing here" block for a panel that has no read behind it.
 * This one is for a LIST, and the difference that matters is the gate.
 *
 * ## Lives here so a plugin can state the rule too (AGL-3080)
 *
 * It was the console's, at `apps/console/components/empty-state.component`,
 * and the rule below is not an app's rule — the marketplace's own licence
 * list asserts "this workspace holds no licenses" off the same three-valued
 * evidence. A plugin may not import an app, so the choice was to move this or
 * to let each plugin hand-roll a zero-state that forgets the gate, which is
 * the defect AGL-1066 already found in every console surface that had one.
 * The console keeps a wrapper at the old path that supplies
 * {@link ReadGatedEmptyStateProps.degradedAction}, so its own call sites are
 * unchanged.
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
 * ## The degraded branch says only what a list can know (AGL-2486)
 *
 * It used to end "if the banner above asks you to sign in again, that fixes
 * it". There is no banner above any more — a stale session opens the re-auth
 * dialog directly — and pointing at it was already the weaker half of a
 * message told twice. What survives is the part only this surface knows:
 * THIS list is incomplete, and nothing has been deleted. The diagnosis stays
 * where the evidence is; a list that guessed at it would be the AGL-1179
 * mistake at the surface instead of in a log.
 */
export function ReadGatedEmptyState({
  iconPath,
  title,
  description,
  action,
  read,
  subject = 'this list',
  onRetry,
  degradedAction,
}: ReadGatedEmptyStateProps) {
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
          degradedAction ??
          (onRetry ? (
            <Button color="inherit" size="small" onClick={onRetry}>
              {'Try again'}
            </Button>
          ) : null)
        }
      >
        {`${subject.charAt(0).toUpperCase()}${subject.slice(1)} could not be ` +
          'loaded, so this list is incomplete. Nothing has been deleted.'}
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

ReadGatedEmptyState.displayName = 'ReadGatedEmptyState'
ReadGatedEmptyState.aglyn = true

export default ReadGatedEmptyState
