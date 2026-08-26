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

import { Box, Button, CircularProgress, Typography } from '@mui/material'
import { notFound } from 'next/navigation'
import { type ReactNode } from 'react'
import {
  useHostAuthError,
  useHostError,
  useHostId,
  useHostOrgError,
  useHostReady,
  useHostRetry,
  useHostSubdomain,
} from './host-id-provider'

/**
 * `/[orgSlug]/hosts/[host]/…` resolution gate (AGL-622). The URL addresses the
 * host by SUBDOMAIN; HostIdProvider resolves it to a doc id. This guard lives
 * INSIDE the host route tree — below the route not-found boundary — so:
 *  - it holds a spinner until resolution settles (so useHostId() consumers
 *    never build a Firestore ref with a null id), then
 *  - renders the designed 404 for an unknown subdomain (one that is not one of
 *    the current org's hosts). Never a sign-out.
 * The provider can't do the 404 itself: it is global, above the boundaries, so
 * a notFound() there escapes to the error boundary instead.
 *
 * A transient read failure is NOT a 404 (AGL-813): if the host list gave up
 * after retries the subdomain resolves to no match too, but the site may well
 * exist — a pasted deep link or refresh can hit `permission-denied` before the
 * ID token attaches. That case shows a retry, so a valid site is never
 * declared missing.
 *
 * The ORG read failing terminally lands here too (AGL-1260): resolution never
 * runs without an org, so the provider settles readiness with the error flag
 * up rather than leaving the spinner standing forever. The copy names the
 * right failure — the workspaces couldn't load, not this workspace's sites —
 * and "Try again" re-runs the membership listen.
 *
 * A SESSION failure names itself too, and mostly never gets read: an
 * auth-caused failure re-runs itself when the token comes back
 * (`useAuthRecovery`), so this branch is what the user sees only while the
 * session is still down. What it must not do is what it used to do — tell a
 * tab whose token expired overnight to check a connection that was never the
 * problem, beside a Try again for something the browser had already fixed.
 */
export function HostGuard({ children }: { children?: ReactNode }) {
  const subdomain = useHostSubdomain()
  const ready = useHostReady()
  const hostId = useHostId()
  const errored = useHostError()
  const orgErrored = useHostOrgError()
  const authErrored = useHostAuthError()
  const retry = useHostRetry()

  if (subdomain && !ready) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
        <CircularProgress />
      </Box>
    )
  }
  if (subdomain && !hostId) {
    if (errored) {
      // Subject × cause, composed rather than enumerated: four hand-written
      // strings drift, and the two axes are genuinely independent (either
      // read can die of either cause).
      const subject = orgErrored
        ? "Couldn't load your workspaces"
        : "Couldn't load this workspace's sites"
      const cause = authErrored
        ? 'Your session expired. This retries itself as soon as you are ' +
          'signed in again.'
        : 'Check your connection and try again.'
      return (
        <Box
          sx={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 2,
            py: 8,
            textAlign: 'center',
          }}
        >
          <Typography variant="body1" color="text.secondary">
            {`${subject}. ${cause}`}
          </Typography>
          {/*
            Retries in place, never `window.location.reload()` (AGL-1200). A
            reload re-enters the same cold-load window that failed, so the
            button reproduced the error every time it was pressed. Retrying
            from a warm page is the one thing that has a chance of working.
          */}
          <Button variant="contained" color="primary" onClick={retry}>
            {'Try again'}
          </Button>
        </Box>
      )
    }
    notFound()
  }
  return <>{children}</>
}
HostGuard.displayName = 'HostGuard'

export default HostGuard
