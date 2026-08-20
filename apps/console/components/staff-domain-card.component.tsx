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

import { CardDisplay } from '@aglyn/shared-ui-jsx'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { Alert, Button, Chip, Stack, Typography } from '@mui/material'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useUser } from '@aglyn/tenant-feature-instance'
import { docsHelp } from '../constants/docs-links'
import {
  domainChipFor,
  staffDomainNoteFor,
  type DomainStatus,
} from '../utils/domain-status'
import { SuperStaffOnly } from './staff-super-only.component'

export interface StaffDomainCardProps {
  /** The site whose custom domain this is. */
  hostId: string
  /**
   * The host document the page already holds. Read rather than re-fetched so
   * the pending flags come from the same snapshot as everything else on the
   * page — two reads of the same doc a second apart is how a staff page ends
   * up disagreeing with itself in a screenshot.
   */
  host: {
    cname?: string | null
    cnameAttachmentPending?: boolean | null
    cnameDetachmentPending?: boolean | null
  } | null
}

/**
 * What a customer's custom domain is actually doing, for support (AGL-2011).
 *
 * `/api/domains/status` has admitted staff since AGL-1913 — `decoded.staff`
 * passes the membership check and the lockdown verdict's un-panic invariant
 * passes a locked org — precisely so support could answer "why is this
 * customer's domain not working" without impersonating them. Nothing called
 * it. The staff host page rendered `domain: {cname}` and nothing else, so the
 * support-facing view of a broken domain was identical to the support-facing
 * view of a working one: the exact defect AGL-1913 fixed on the customer side,
 * left standing on the side that answers the phone.
 *
 * The chip vocabulary is SHARED with the customer's card rather than
 * re-written here (`utils/domain-status.ts`), so a support conversation is two
 * people reading the same sentence. What is added beside it is the half the
 * customer's card does not show:
 *
 *  - `cnameAttachmentPending` / `cnameDetachmentPending`, which the customer's
 *    card only ever implies. The first is what `liveCustomDomain` reads to
 *    decide whether visitors may be sent to the domain at all, so it answers
 *    "DNS is fine, why is the site still on the subdomain".
 *  - Re-attach, super-only, because until now the only way for staff to unstick
 *    a domain was to impersonate the customer and press their button.
 */
export function StaffDomainCard(props: StaffDomainCardProps) {
  const { hostId, host } = props
  const { data: user } = useUser()
  const { enqueueSnackbar } = useSnackbar()
  /*
   * The signed-in user is read through a REF, so neither callback below takes
   * it as a dependency (AGL-2011).
   *
   * `refresh` is invoked from an effect keyed on its own identity, so a `user`
   * that changes identity per render makes that effect a loop: fetch, set
   * state, re-render, fetch. Firebase's `User` instance happens to be
   * referentially stable while signed in, which is why the customer's card has
   * survived the same shape — but "happens to be" is the whole risk, and this
   * endpoint is not free. Each call costs the platform up to three upstream
   * API requests, so a card that quietly refetched per render would be a
   * self-inflicted rate limit discovered in production. The ref removes the
   * dependency instead of relying on the guarantee.
   */
  const userRef = useRef(user)
  userRef.current = user
  const connected = String(host?.cname ?? '').trim()
  const [status, setStatus] = useState<DomainStatus | null>(null)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(async () => {
    if (!connected) return void setStatus(null)
    setLoading(true)
    try {
      const idToken = await (userRef.current as any)?.getIdToken?.()
      const response = await fetch(
        `/api/domains/status?hostId=${encodeURIComponent(hostId)}`,
        idToken ? { headers: { Authorization: `Bearer ${idToken}` } } : undefined,
      )
      // Same rule as the customer's card: a status read that did not answer
      // leaves the card saying what it said before, never "broken". A staff
      // page asserting a fault it did not observe is worse than one that says
      // nothing, because it becomes what support tells the customer.
      setStatus(response.ok ? await response.json() : null)
    } catch {
      setStatus(null)
    } finally {
      setLoading(false)
    }
  }, [connected, hostId])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const handleReattach = useCallback(async () => {
    if (!connected || busy) return
    setBusy(true)
    try {
      const idToken = await (userRef.current as any)?.getIdToken?.()
      const response = await fetch('/api/admin/host', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
        },
        body: JSON.stringify({ hostId, action: 'reattach-domain' }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        return void enqueueSnackbar(payload?.error ?? 'Re-attach failed', {
          variant: response.status === 501 ? 'info' : 'error',
          allowDuplicate: true,
        })
      }
      // What the re-attach ACHIEVED, not that it returned 200 — the same
      // distinction the customer's attach path draws (AGL-1913). A domain held
      // pending an ownership challenge is re-attached and still not serving,
      // and saying "done" here is how support tells a customer to go look at a
      // site that is still dark.
      enqueueSnackbar(
        payload?.serving
          ? `"${connected}" re-attached and serving`
          : `"${connected}" re-attached — still not serving, see the status`,
        { variant: payload?.serving ? 'success' : 'warning', persist: false },
      )
    } catch (error) {
      console.error(error)
      enqueueSnackbar('An error has occurred', {
        variant: 'error',
        allowDuplicate: true,
      })
    } finally {
      setBusy(false)
      void refresh()
    }
  }, [connected, busy, hostId, enqueueSnackbar, refresh])

  const chip = connected
    ? domainChipFor(connected, status, host?.cnameAttachmentPending === true)
    : null
  const note = connected ? staffDomainNoteFor(status) : null

  return (
    <CardDisplay
      header={'Custom domain'}
      help={docsHelp('connectADomain', {
        anchor: '#steps',
        excerpt:
          "The live verdict for this site's custom domain, read from the " +
          'hosting platform on every load — the same words the customer sees ' +
          'on their own setup card, plus the attachment flags only staff can ' +
          'see.',
      })}
      contentGutterX
      contentGutterY
    >
      {!connected ? (
        <Typography variant="body2" color="text.secondary">
          {'No custom domain on this site.'}
        </Typography>
      ) : (
        <Stack spacing={1}>
          <Stack
            direction="row"
            spacing={1}
            sx={{ alignItems: 'center', flexWrap: 'wrap', gap: 0.5 }}
          >
            <Chip size="small" label={chip?.label} color={chip?.color} />
            {/*
              Staff-only facts. `cnameAttachmentPending` is what
              `liveCustomDomain` reads before sending visitors to the domain,
              so it is the difference between "DNS is correct" and "the site is
              actually being served there" — the customer's card only implies
              it, and a support answer that skips it is wrong in the one case
              that generates the ticket.
            */}
            {host?.cnameAttachmentPending ? (
              <Chip
                size="small"
                variant="outlined"
                color="warning"
                label="attachment pending"
              />
            ) : null}
            {host?.cnameDetachmentPending ? (
              <Chip
                size="small"
                variant="outlined"
                color="warning"
                label="detachment pending"
              />
            ) : null}
            <Button size="small" disabled={loading} onClick={() => void refresh()}>
              {loading ? 'Checking…' : 'Check status'}
            </Button>
            {/*
              Re-attach writes, so it carries the same super-only gate the
              subdomain Save on this page carries, and for the same reason
              recorded there (AGL-2131): support staff saw a live control and
              got a raw 403. The READ above is deliberately not gated — every
              staff role can see the verdict, which is the whole point of the
              card.
            */}
            <SuperStaffOnly>
              <Button size="small" disabled={busy} onClick={() => void handleReattach()}>
                {busy ? 'Re-attaching…' : 'Re-attach'}
              </Button>
            </SuperStaffOnly>
          </Stack>
          {note ? <Alert severity={note.severity}>{note.text}</Alert> : null}
          {/*
            The exact record the platform is waiting for. Support is asked for
            this by name, and reading it off the staff page beats walking the
            customer through finding it on theirs.
          */}
          {status?.state === 'ownership-pending' && status.verification?.length ? (
            <Stack spacing={0.5}>
              {status.verification.map((record) => (
                <Typography
                  key={`${record.type}-${record.domain}-${record.value}`}
                  variant="body2"
                  component="code"
                  sx={{
                    p: 1,
                    bgcolor: 'action.hover',
                    borderRadius: 1,
                    fontFamily: 'monospace',
                    whiteSpace: 'pre-wrap',
                    overflowWrap: 'anywhere',
                  }}
                >
                  {`${record.type}  ${record.domain}  →  ${record.value}`}
                </Typography>
              ))}
            </Stack>
          ) : null}
          {/*
            Records answering for this name that are not ours. Shown even when
            the domain is serving, because that is exactly the "it works for
            me" report: a stale A record from a previous host answering
            alongside a correct ALIAS, winning some of the time.
          */}
          {status?.conflicts?.length ? (
            <Alert severity="warning">
              {'Other DNS records answer for this name, so the site loads ' +
                'intermittently — the customer has to remove them at their ' +
                'registrar: '}
              {status.conflicts
                .map((conflict) =>
                  [conflict.type, conflict.name, conflict.value]
                    .filter(Boolean)
                    .join(' '),
                )
                .join(', ')}
            </Alert>
          ) : null}
        </Stack>
      )}
    </CardDisplay>
  )
}
StaffDomainCard.displayName = 'StaffDomainCard'

export default StaffDomainCard
