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

import { siteCareSupportAddress } from '@aglyn/aglyn/app-utils/site-care'
import { ICON_VARIANT_CLOSE } from '@aglyn/shared-data-enums'
import { AppLink, Container, MdiIcon, SrOnly } from '@aglyn/shared-ui-jsx'
import { BlockedControl } from '@aglyn/shared-ui-jsx/components/blocked-control.component'
import { NavigationDrawerComponent } from '@aglyn/shared-ui-jsx/components/navigation-drawer.component'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { authorizedFetch } from '@aglyn/shared-util-http/authorized-token'
import { useUser } from '@aglyn/tenant-feature-instance'
import { Alert, Button, IconButton, Stack, TextField, Typography } from '@mui/material'
import { useCallback, useEffect, useState } from 'react'
import { buildRoute, Route } from '@aglyn/aglyn/app-utils/console/route-links'
import useCurrentOrg from '../../hooks/use-current-org'
import { useOrgSlug } from '../../hooks/use-org-scope'

/** Why the button is disabled on a workspace without Site Care. */
export const SITE_CARE_MISSING_REASON =
  'Site Care is not on this workspace. With it, our team makes your site changes for you.'

export interface SiteCareRequestButtonProps {
  hostId: string | null
}

/**
 * "Request a change" on a site's dashboard (AGL-3959): opens the same tagged
 * Site Care request a member's email to the support address does. On a workspace
 * without Site Care the button stays, disabled with the reason, beside a
 * link to Billing where it is added — never hidden. Nothing renders until
 * the answer arrives, so nobody sees a refusal flash.
 */
export function SiteCareRequestButton({ hostId }: SiteCareRequestButtonProps) {
  const { data: user } = useUser()
  const { orgId } = useCurrentOrg()
  const orgSlug = useOrgSlug()
  const { enqueueSnackbar } = useSnackbar()
  const [siteCare, setSiteCare] = useState<boolean | null>(null)
  const [open, setOpen] = useState(false)
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState<string | null>(null)
  const supportEmail = siteCareSupportAddress()

  const uid = (user as { uid?: string } | null | undefined)?.uid
  useEffect(() => {
    if (!uid || !orgId) return undefined
    let active = true
    void authorizedFetch(user, `/api/site-care/requests?orgId=${encodeURIComponent(orgId)}&view=status`)
      .then((response) => (response.ok ? response.json() : null))
      .then((payload) => {
        if (active && payload) setSiteCare(payload.siteCare === true)
      })
      .catch(() => undefined)
    return () => {
      active = false
    }
    // Keyed on who is signed in and which workspace; `user` changes identity per render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid, orgId])

  const close = useCallback(() => {
    setOpen(false)
    setSent(null)
  }, [])

  const submit = useCallback(async () => {
    if (!orgId) return
    setBusy(true)
    try {
      const response = await authorizedFetch(user, '/api/site-care/requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orgId, hostId, subject, body }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        enqueueSnackbar(payload?.error ?? 'The request could not be sent', { variant: 'warning', persist: false })
        return
      }
      setSent(String(payload?.dueAt ?? ''))
      setSubject('')
      setBody('')
    } catch {
      enqueueSnackbar('An error has occurred', { variant: 'error' })
    } finally {
      setBusy(false)
    }
  }, [orgId, hostId, subject, body, user, enqueueSnackbar])

  if (siteCare === null) return null
  return (
    <>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
        <BlockedControl blocked={!siteCare} reason={SITE_CARE_MISSING_REASON}>
          <Button variant="outlined" color="primary" onClick={() => setOpen(true)}>
            {'Request a change'}
          </Button>
        </BlockedControl>
        {!siteCare && orgSlug ? (
          <AppLink href={`${buildRoute(Route.MANAGE_BILLING, { orgSlug })}#addons`} variant="body2">
            {'Add Site Care'}
          </AppLink>
        ) : null}
      </Stack>
      <NavigationDrawerComponent
        open={open}
        anchor="right"
        variant="temporary"
        onClose={close}
        AppBarProps={{ color: 'surface' }}
        appBarLeft={
          <>
            <IconButton color="inherit" edge="start" onClick={close} sx={{ mr: 2 }}>
              <MdiIcon path={ICON_VARIANT_CLOSE.path} />
              <SrOnly>close drawer</SrOnly>
            </IconButton>
            <Typography variant="h6" component="div">
              {'Request a change'}
            </Typography>
          </>
        }
        appBarRight={
          sent === null ? (
            <Button
              variant="contained"
              color="primary"
              disabled={busy || !subject.trim() || !body.trim()}
              onClick={() => void submit()}
            >
              {'Send request'}
            </Button>
          ) : (
            <Button variant="outlined" color="inherit" onClick={close}>
              {'Done'}
            </Button>
          )
        }
      >
        <Container gutterY>
          {sent !== null ? (
            <Alert severity="success">
              {`We have your request and will have it done by ${sent || 'two business days from now'}. ` +
                'We will email you when it is done.'}
            </Alert>
          ) : (
            <Stack spacing={2.5}>
              <Typography variant="body2" color="text.secondary">
                {'Tell us what to change, in your own words. Small changes to what your site already has ' +
                  'are part of Site Care.' +
                  (supportEmail
                    ? ` You can also email the change to ${supportEmail} any time, from the address you sign in with.`
                    : '')}
              </Typography>
              <TextField
                label="What should change?"
                placeholder="Update our holiday hours"
                value={subject}
                onChange={(event) => setSubject(event.target.value)}
                slotProps={{ htmlInput: { maxLength: 150 } }}
                required
              />
              <TextField
                label="Details"
                placeholder="Saturday becomes 9 to 2 for December, and add a note that we are closed on the 25th."
                value={body}
                onChange={(event) => setBody(event.target.value)}
                multiline
                minRows={5}
                slotProps={{ htmlInput: { maxLength: 5000 } }}
                required
              />
            </Stack>
          )}
        </Container>
      </NavigationDrawerComponent>
    </>
  )
}

SiteCareRequestButton.displayName = 'SiteCareRequestButton'

export default SiteCareRequestButton
