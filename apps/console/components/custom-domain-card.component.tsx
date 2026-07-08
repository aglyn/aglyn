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

import { CardDisplay, useLoading } from '@aglyn/shared-ui-jsx'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import {
  Alert,
  Button,
  Chip,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { deleteField, doc, updateDoc } from 'firebase/firestore'
import { useCallback, useState } from 'react'
import { useFirestore, useFirestoreDocData, useUser } from 'reactfire'
import { hasEntitlement } from '../constants/entitlements'
import useCurrentTenant from '../hooks/use-current-tenant'

const CNAME_TARGET =
  process.env['NEXT_PUBLIC_AGLYN_TENANT_HOST_CNAME'] ?? 'sites.aglyn.app'

export interface CustomDomainCardProps {
  hostId: string
}

/**
 * Connect-a-domain wizard (Custom Domain Self-Service): DNS instructions,
 * server-side CNAME verification, `host.cname` persistence, and Vercel
 * attachment (501-tolerant). Gated on the Starter+ customDomain
 * entitlement.
 */
export function CustomDomainCard(props: CustomDomainCardProps) {
  const { hostId } = props
  const firestore = useFirestore()
  const { data: user } = useUser()
  const { tenant } = useCurrentTenant()
  const { enqueueSnackbar } = useSnackbar()
  const { queueLoading } = useLoading()
  const { data: host } = useFirestoreDocData<any>(
    doc(firestore, 'hosts', hostId),
    { idField: '$id' },
  )
  const connected = host?.cname as string | undefined
  const [domain, setDomain] = useState('')
  const [checking, setChecking] = useState(false)
  const entitled = hasEntitlement('custom-domain', tenant)

  const handleConnect = useCallback(async () => {
    const value = domain.trim().toLowerCase()
    if (!value) return
    setChecking(true)
    const dequeue = queueLoading()
    try {
      const verifyResponse = await fetch(
        `/api/domains/verify?domain=${encodeURIComponent(value)}`,
      )
      const verify = await verifyResponse.json()
      if (!verifyResponse.ok) {
        return void enqueueSnackbar(verify?.error ?? 'Verification failed', {
          variant: 'error',
          allowDuplicate: true,
        })
      }
      if (!verify.verified) {
        return void enqueueSnackbar(
          verify.records?.length
            ? `Domain points at ${verify.records.join(', ')} — expected ${
                verify.expected ?? CNAME_TARGET
              }. DNS changes can take a while to propagate.`
            : 'No CNAME record found yet — DNS changes can take a while to ' +
                'propagate.',
          { variant: 'warning', persist: false },
        )
      }
      await updateDoc(doc(firestore, 'hosts', hostId), { cname: value })
      // Vercel attachment provisions SSL; 501 means the platform env isn't
      // configured yet — DNS side is done either way.
      const idToken = await (user as any)?.getIdToken?.()
      const attachResponse = await fetch('/api/domains/attach', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
        },
        body: JSON.stringify({ hostId, domain: value }),
      })
      if (attachResponse.status === 501) {
        enqueueSnackbar(
          'Domain saved — platform attachment pending (Vercel env not set)',
          { variant: 'info', persist: false },
        )
      } else if (!attachResponse.ok) {
        enqueueSnackbar('Domain saved, but platform attachment failed', {
          variant: 'warning',
          persist: false,
        })
      } else {
        enqueueSnackbar(`"${value}" connected`, {
          variant: 'success',
          persist: false,
        })
      }
      setDomain('')
    } catch (error) {
      console.error(error)
      enqueueSnackbar('An error has occurred', {
        variant: 'error',
        allowDuplicate: true,
      })
    } finally {
      setChecking(false)
      dequeue()
    }
  }, [domain, firestore, hostId, user, queueLoading, enqueueSnackbar])

  // Retry attachment (AGL-166): re-runs the Vercel attach for a saved
  // cname whose platform attachment never happened (501/5xx path).
  const handleRetryAttach = useCallback(async () => {
    if (!connected) return
    setChecking(true)
    try {
      const idToken = await (user as any)?.getIdToken?.()
      const response = await fetch('/api/domains/attach', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
        },
        body: JSON.stringify({ hostId, domain: connected }),
      })
      const payload = await response.json().catch(() => ({}))
      if (response.ok) {
        enqueueSnackbar(`"${connected}" attached — SSL provisions shortly`, {
          variant: 'success',
          persist: false,
        })
      } else {
        enqueueSnackbar(payload?.error ?? 'Attachment failed', {
          variant: response.status === 501 ? 'info' : 'error',
          allowDuplicate: true,
        })
      }
    } catch (error) {
      console.error(error)
      enqueueSnackbar('An error has occurred', {
        variant: 'error',
        allowDuplicate: true,
      })
    } finally {
      setChecking(false)
    }
  }, [connected, hostId, user, enqueueSnackbar])

  const handleDisconnect = useCallback(async () => {
    await updateDoc(doc(firestore, 'hosts', hostId), {
      cname: deleteField(),
    })
    enqueueSnackbar('Custom domain disconnected', {
      variant: 'success',
      persist: false,
    })
  }, [firestore, hostId, enqueueSnackbar])

  return (
    <CardDisplay header="Custom domain" contentGutterX contentGutterY>
      <Stack spacing={2}>
        {connected ? (
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            <Chip
              label={
                host?.cnameAttachmentPending
                  ? `${connected} — attachment pending`
                  : connected
              }
              color={host?.cnameAttachmentPending ? 'warning' : 'success'}
            />
            {/*
              Always offer re-attach for a connected domain (AGL-166):
              domains connected before the pending flag existed never got
              cnameAttachmentPending set, so gating the button on it hid it
              for exactly the domains that need attaching. Attach is
              idempotent (Vercel returns domain_already_in_use), so it's
              safe to run even when already attached.
            */}
            <Button
              size="small"
              disabled={checking}
              onClick={handleRetryAttach}
            >
              {host?.cnameAttachmentPending
                ? 'Retry attachment'
                : 'Re-attach'}
            </Button>
            <Button size="small" color="error" onClick={handleDisconnect}>
              {'Disconnect'}
            </Button>
          </Stack>
        ) : null}
        {!entitled ? (
          <Alert severity="info">
            {'Custom domains are included from the Starter plan — see ' +
              'Billing to upgrade.'}
          </Alert>
        ) : (
          <>
            <Typography variant="body2" color="text.secondary">
              {'Point your domain at Aglyn with a CNAME record, then verify:'}
            </Typography>
            <Typography
              variant="body2"
              component="code"
              sx={{
                p: 1,
                bgcolor: 'action.hover',
                borderRadius: 1,
                fontFamily: 'monospace',
              }}
            >
              {`CNAME  ${domain.trim() || 'www.your-domain.com'}  →  ${CNAME_TARGET}`}
            </Typography>
            <Stack direction="row" spacing={1}>
              <TextField
                size="small"
                label="Domain"
                placeholder="www.your-domain.com"
                value={domain}
                onChange={(event) => setDomain(event.target.value)}
                sx={{ flex: 1, maxWidth: 360 }}
              />
              <Button
                variant="contained"
                color="secondary"
                disabled={!domain.trim() || checking}
                onClick={handleConnect}
              >
                {checking ? 'Verifying…' : 'Verify & connect'}
              </Button>
            </Stack>
          </>
        )}
      </Stack>
    </CardDisplay>
  )
}
CustomDomainCard.displayName = 'CustomDomainCard'

export default CustomDomainCard
