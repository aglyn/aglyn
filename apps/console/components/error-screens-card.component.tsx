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

import { HOST_ERROR_SCREEN_SLOTS, type HostErrorScreenSlot } from '@aglyn/aglyn'
import { CardDisplay } from '@aglyn/shared-ui-jsx'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import {
  Alert,
  Button,
  FormControlLabel,
  MenuItem,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material'
import {
  collection,
  deleteField,
  doc,
  limit,
  query,
  updateDoc,
} from 'firebase/firestore'
import { useCallback } from 'react'
import { useFirestore, useUser } from '@aglyn/tenant-feature-instance'
import { docsHelp } from '../constants/docs-links'
import { unpublishScreenRoute } from '../constants/screen-publishing'
import useFirestoreCollection from '../hooks/use-firestore-collection'
import useFirestoreDoc from '../hooks/use-firestore-doc'

export interface ErrorScreensCardProps {
  hostId: string
}

/**
 * Built by mapping the shared slot list rather than repeating it (AGL-2092):
 * the slot COUNT is the bound on how many screens a host may take off its plan
 * with `kind: 'error'`, so a picker this card forgot would be an exemption
 * nobody could reach, and a picker it invented would be one nothing bounds.
 */
const ERROR_SLOT_COPY: Record<
  HostErrorScreenSlot,
  { label: string; hint: string }
> = {
  notFound: { label: '404 · Not found', hint: 'Missing addresses' },
  unauthorized: {
    label: '401 · Members only',
    hint: 'Members-only pages when signed out',
  },
  forbidden: {
    label: '403 · Forbidden',
    hint: 'Reserved for future access rules',
  },
  unavailable: {
    label: '503 · Maintenance',
    hint: 'Shown everywhere while maintenance mode is on',
  },
}

const ERROR_SLOTS = HOST_ERROR_SCREEN_SLOTS.map((key) => ({
  key,
  ...ERROR_SLOT_COPY[key],
}))

/**
 * Error screens (AGL-131, grown from the AGL-87 404 card): assign a
 * designed screen per status code, plus the site-wide maintenance toggle.
 * The 404 pick also writes the legacy `notFoundScreenId` so older tenant
 * builds keep working.
 *
 * ## The empty option used to be a lie (AGL-2074)
 *
 * It read "Built-in default", which sounds like the platform ships a designed
 * page for anyone who does not pick one. It did not. Leaving a slot empty
 * meant the visitor got **Next.js's own unstyled `404 | This page could not
 * be found`** — no brand, no navigation. Measured 2026-08-18: `errorScreens`
 * was unset on 6 of 6 production hosts, so that framework page was the live
 * behaviour of every site on the platform, and this card said it was the
 * intended default.
 *
 * AGL-2074 built the fallback the label was describing, so the option is
 * finally truthful — but truthful is not the same as informative, and an
 * operator reading "default" has no reason to pick anything. The copy now
 * says what the fallback actually is and what assigning a screen buys.
 *
 * AGL-2187 moved that line again, and it has to keep moving with the tenant:
 * the fallback now carries the site's logo, links to its public top-level
 * pages and site search, so "logo and a link home" had become the same kind
 * of stale promise "Built-in default" was. What assigning a screen buys is
 * now the narrower and permanent thing — the header, nav and footer the
 * operator DESIGNED, which no boundary can reconstruct because they live in
 * the nodes of the screen that was not found.
 *
 * ## Why the pick is a fetch and not an `updateDoc` (AGL-2092)
 *
 * Assigning a screen here is what takes it off `screensPerHost` — the route
 * stamps `kind: 'error'` on the screen's own document, which the Firestore
 * rules have frozen against the client since AGL-1383 for exactly this reason:
 * a field a paid limit subtracts on, writable by the party the limit is
 * enforced against, is the bypass that arc found four times. So the write that
 * carries the billing consequence is server-side, and it writes the pointer in
 * the same batch (including the legacy flat `notFoundScreenId`, which older
 * tenant builds still read).
 *
 * ## Why an assigned screen can still be counted
 *
 * The exclusion is "this screen has no URL of its own", and the routing map —
 * not this card — is what decides that. A screen that is ALSO published at an
 * address keeps the address, keeps serving, and keeps counting; that is what
 * makes assigning one of the error screens that already exist on the platform
 * safe (nothing 404s, no link breaks). The alert below is the migration: it
 * says the screen is still spending an allowance slot and offers the unpublish
 * that frees it.
 */
export function ErrorScreensCard(props: ErrorScreensCardProps) {
  const { hostId } = props
  const firestore = useFirestore()
  const { data: user } = useUser()
  const { enqueueSnackbar } = useSnackbar()
  const { data: host } = useFirestoreDoc<any>(
    () => doc(firestore, 'hosts', hostId),
    [firestore, hostId],
    { idField: '$id' },
  )
  const { data: screenDocs } = useFirestoreCollection<any>(
    () => query(collection(firestore, 'hosts', hostId, 'screens'), limit(200)),
    [firestore, hostId],
    { idField: '$id' },
  )
  const screens = [...(screenDocs ?? [])]
    .filter((screen: any) => !screen.deletedAt)
    .sort((a: any, b: any) =>
      String(a.displayName ?? '').localeCompare(String(b.displayName ?? '')),
    )

  const handleChange = useCallback(
    (slot: string) => async (value: string) => {
      // The route owns BOTH halves — the `kind: 'error'` stamp on the screen
      // and the pointer on the host — so they can never disagree, and the
      // stamp is bounded by the four slots (AGL-2092).
      const idToken = await (user as any)?.getIdToken?.()
      const response = await fetch('/api/hosts/screens', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
        },
        body: JSON.stringify({
          hostId,
          action: 'error-screen',
          slot,
          id: value || null,
        }),
      })
      const result = await response.json().catch(() => ({}))
      if (!response.ok) {
        enqueueSnackbar(result?.error ?? 'Could not set the error screen', {
          variant: 'error',
        })
        return
      }
      enqueueSnackbar(value ? 'Error screen set' : 'Error screen cleared', {
        variant: 'success',
        persist: false,
      })
    },
    [hostId, user, enqueueSnackbar],
  )

  /**
   * Unpublish the address an assigned error screen is still served at — the
   * act that actually frees the allowance slot, because the routing map is
   * what the count reads (AGL-2092). Offered rather than done automatically:
   * every error screen on the platform today reached this card ALREADY
   * published, and silently un-addressing somebody's `/404` would break links
   * they may be sending people to.
   */
  const handleUnpublish = useCallback(
    async (screenId: string) => {
      await unpublishScreenRoute(firestore, { hostId, screenId })
      enqueueSnackbar(
        'Address removed — this screen no longer counts against your plan',
        { variant: 'success', persist: false },
      )
    },
    [firestore, hostId, enqueueSnackbar],
  )

  const handleMaintenance = useCallback(
    async (enabled: boolean) => {
      await updateDoc(doc(firestore, 'hosts', hostId), {
        maintenance: enabled || deleteField(),
      })
      enqueueSnackbar(
        enabled
          ? 'Maintenance mode on — visitors see the 503 screen'
          : 'Maintenance mode off',
        { variant: enabled ? 'warning' : 'success', persist: false },
      )
    },
    [firestore, hostId, enqueueSnackbar],
  )

  const errorScreens = host?.errorScreens ?? {}
  /** Screen id → route path, as `publishScreenRoute` writes it. */
  const routingMap: Record<string, unknown> = host?.screens ?? {}

  return (
    <CardDisplay
      header="Error pages"
      help={docsHelp('errorScreens', {
        excerpt:
          'Assign a designed screen per status code — the maintenance ' +
          'toggle shows the 503 screen everywhere while it is on.',
      })}
      contentGutterX
      contentGutterY
    >
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        {'Design these like any screen, then assign them here. Assigned ' +
          'screens are kept out of search results, and they do not count ' +
          'against your plan\u2019s screen allowance.'}
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        {'Leave a slot on the built-in fallback and visitors still get a ' +
          'page under your theme, carrying your logo, links to your public ' +
          'top-level pages and site search — but only a screen you design ' +
          'here can show the header, navigation and footer you built.'}
      </Typography>
      <Stack spacing={2}>
        {ERROR_SLOTS.map((slot) => {
          const assigned =
            errorScreens[slot.key] ??
            (slot.key === 'notFound' ? (host?.notFoundScreenId ?? '') : '')
          // Still published at an address of its own, so the count still
          // charges for it — the routing map outranks the `kind: 'error'`
          // stamp, which is what keeps the count and the serve path agreeing.
          const routedAt = assigned ? routingMap[assigned] : undefined
          return (
            <Stack key={slot.key} spacing={1}>
              <TextField
                select
                size="small"
                label={slot.label}
                helperText={slot.hint}
                value={assigned}
                onChange={(event) =>
                  void handleChange(slot.key)(event.target.value)
                }
                sx={{ minWidth: 280 }}
              >
                {/* Not "default" (AGL-2074). This is the fallback the
                    tenant app renders when nothing is assigned — the site's
                    logo, the status, its public top-level pages and search
                    (AGL-2187). Naming it that way is the difference between
                    an operator thinking the slot is already handled and
                    knowing there is a better page to be had. */}
                <MenuItem value="">{'Built-in fallback page'}</MenuItem>
                {screens.map((screen: any) => (
                  <MenuItem key={screen.$id} value={screen.$id}>
                    {screen.displayName ?? screen.$id}
                  </MenuItem>
                ))}
              </TextField>
              {routedAt !== undefined && (
                <Alert
                  severity="info"
                  action={
                    <Button
                      color="inherit"
                      size="small"
                      onClick={() => void handleUnpublish(String(assigned))}
                    >
                      {'Remove address'}
                    </Button>
                  }
                >
                  {`This screen is also published at ${
                    routedAt === '/' ? '/' : `/${routedAt}`
                  }, so it still counts against your screen allowance. ` +
                    'Remove its address and it stops counting — it will ' +
                    'still render for this status.'}
                </Alert>
              )}
            </Stack>
          )
        })}
        <FormControlLabel
          control={
            <Switch
              color="warning"
              checked={Boolean(host?.maintenance)}
              onChange={(event) =>
                void handleMaintenance(event.target.checked)
              }
            />
          }
          label="Maintenance mode — show the 503 screen on every page"
        />
      </Stack>
    </CardDisplay>
  )
}
ErrorScreensCard.displayName = 'ErrorScreensCard'

export default ErrorScreensCard
