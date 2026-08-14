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

import type { LockdownRefusalNotice } from '@aglyn/aglyn'
import {
  Alert,
  AlertTitle,
  type AlertProps as MuiAlertProps,
  Link,
  Typography,
} from '@mui/material'

/**
 * A parsed 423 refusal, rendered WHOLE (AGL-1558).
 *
 * `parseLockdownRefusal` returns `{title, message, contact?, until?, …}`, but
 * `lockdownRefusalText` — the one-line flattener the snackbar surfaces use —
 * emits `title — message [until]` and drops `contact` on the floor. That
 * dropped field is the entire "how do I get out of this" affordance: the
 * server builds the notice so a staff-typed custom `message` replaces the
 * BODY only, leaving `title` and `contact` per-reason constants precisely so
 * a staff member in a hurry cannot strip the support address. A snackbar
 * throws it away anyway.
 *
 * So this is the structured half, for any surface with room for it:
 *
 *  - the **message** as the body,
 *  - the **expiry** as its own quieter line (`until` is already a local-time
 *    sentence — never a raw epoch, never the UTC string the server body
 *    carries), and
 *  - the **contact** as a real `mailto:` link.
 *
 * `PlatformLockdownGate` is the precedent for the markup and the tone; this
 * is the same three lines inside an `Alert` instead of a full-page takeover,
 * because a feature lock is narrow by construction and must not read as an
 * outage of the page it appears on.
 *
 * Deliberately presentational and lives in the console app rather than a
 * shared lib: `LockdownRefusalNotice` is exported from `@aglyn/aglyn`
 * (`scope:aglyn`), and the shared UI libs are `scope:shared`, which the nx
 * boundary rules forbid from depending on it. The console is where the
 * surfaces with room for a structured notice live.
 *
 * NOTE: distinct from the `LockdownNotice` INTERFACE in
 * `@aglyn/aglyn` app-utils/lockdown — that is the server's per-reason copy
 * ({title, body, contact}); this is the client component that renders the
 * parsed refusal.
 */
export interface LockdownNoticeProps
  extends Omit<Partial<MuiAlertProps>, 'children'> {
  /** The parsed refusal. `null`/`undefined` renders nothing. */
  notice?: LockdownRefusalNotice | null
}

function LockdownNotice(props: LockdownNoticeProps) {
  const { notice, severity = 'warning', ...rest } = props
  if (!notice) return null
  return (
    <Alert
      severity={severity}
      // A lockdown notice is an answer to something the visitor just did, and
      // it can appear well below the fold of a long page; announce it rather
      // than rely on it being seen.
      role="alert"
      {...rest}
    >
      <AlertTitle>{notice.title}</AlertTitle>
      <Typography component="div" variant="body2">
        {notice.message}
      </Typography>
      {notice.until ? (
        <Typography
          component="div"
          variant="body2"
          color="text.secondary"
          sx={{ mt: 0.5 }}
        >
          {notice.until}
        </Typography>
      ) : null}
      {notice.contact ? (
        <Typography
          component="div"
          variant="body2"
          color="text.secondary"
          sx={{ mt: 0.5 }}
        >
          {'Questions? '}
          <Link href={`mailto:${notice.contact}`}>{notice.contact}</Link>
        </Typography>
      ) : null}
    </Alert>
  )
}
LockdownNotice.displayName = 'LockdownNotice'

export { LockdownNotice }
export default LockdownNotice
