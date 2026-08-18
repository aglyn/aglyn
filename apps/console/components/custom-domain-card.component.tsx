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
import { doc } from 'firebase/firestore'
import { useCallback, useEffect, useState } from 'react'
import { useFirestore, useUser } from '@aglyn/tenant-feature-instance'
import { docsHelp } from '../constants/docs-links'
import { hasEntitlement } from '../constants/entitlements'
import useCurrentOrg from '../hooks/use-current-org'
import useFirestoreDoc from '../hooks/use-firestore-doc'
// The target, the apex address, and the instruction copy come from the SAME
// module the verify route reads (AGL-1275). They used to be private constants
// here, and the apex one had its own `NEXT_PUBLIC_AGLYN_TENANT_APEX_A` that
// nothing else looked at — so "must stay a member of the route's pool" was an
// invariant held by a comment, and widening the pool by env var would have
// printed an address the route rejects.
import {
  CNAME_TARGET,
  DNS_INSTRUCTIONS_INTRO,
  dnsInstructionsFor,
  formatDnsInstruction,
} from '../utils/tenant-dns'

export interface CustomDomainCardProps {
  hostId: string
}

/**
 * What `/api/domains/status` reports (AGL-1913). `none` is a site with no
 * custom domain; `unknown`/`skipped` mean the platform could not be asked.
 */
interface DomainStatus {
  domain: string | null
  state:
    | 'none'
    | 'serving'
    | 'certificate-pending'
    | 'ownership-pending'
    | 'dns-misconfigured'
    | 'not-attached'
    | 'skipped'
    | 'unknown'
  verification?: { type: string; domain: string; value: string }[]
  conflicts?: { type?: string; name?: string; value?: string }[]
  attachmentPending?: boolean
}

/**
 * The chip, per state.
 *
 * Every state here used to render as the same green chip, which is the bug:
 * a certificate still issuing and a domain that will never work are not the
 * same news, and the customer is the one who has to act on the difference.
 * `unknown` deliberately falls back to the old label rather than inventing a
 * problem — a status call that could not answer is not evidence of one.
 */
function chipFor(
  domain: string,
  status: DomainStatus | null,
  attachmentPending: boolean,
): { label: string; color: 'success' | 'warning' | 'error' | 'info' } {
  switch (status?.state) {
    case 'serving':
      return { label: `${domain} — live`, color: 'success' }
    case 'certificate-pending':
      return { label: `${domain} — issuing certificate`, color: 'info' }
    case 'ownership-pending':
      return { label: `${domain} — ownership check needed`, color: 'warning' }
    case 'dns-misconfigured':
      return { label: `${domain} — DNS not pointing here`, color: 'warning' }
    case 'not-attached':
      return { label: `${domain} — not attached`, color: 'error' }
    default:
      return attachmentPending
        ? { label: `${domain} — attachment pending`, color: 'warning' }
        : { label: domain, color: 'success' }
  }
}

/** The one thing to do next, in the customer's own terms. */
function explanationFor(
  status: DomainStatus | null,
): { severity: 'success' | 'info' | 'warning' | 'error'; text: string } | null {
  switch (status?.state) {
    case 'certificate-pending':
      return {
        severity: 'info',
        text:
          'DNS checks out and the domain is attached. The certificate is ' +
          'still being issued — this usually takes a few minutes, and there ' +
          'is nothing to do but wait. Until it finishes, the domain may show ' +
          'a security warning.',
      }
    case 'ownership-pending':
      return {
        severity: 'warning',
        text:
          'Your domain is registered to another account on our hosting ' +
          'platform, so it has to be proven yours before it will serve. Add ' +
          'the record below at your registrar, then press Re-attach.',
      }
    case 'dns-misconfigured':
      return {
        severity: 'warning',
        text:
          'The domain is attached, but it no longer resolves to us — check ' +
          'the record at your registrar. This is what you see if DNS was ' +
          'changed after connecting, or if another record is answering for ' +
          'the same name.',
      }
    case 'not-attached':
      return {
        severity: 'error',
        text:
          'This domain is saved here but is not attached to our hosting ' +
          'platform, so it serves nothing. Press Retry attachment; if it ' +
          'keeps failing, the domain is likely held by another account and ' +
          'support will need the domain name.',
      }
    default:
      return null
  }
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
  const { org, ready: orgReady } = useCurrentOrg()
  const { enqueueSnackbar } = useSnackbar()
  const { queueLoading } = useLoading()
  const { data: host } = useFirestoreDoc<any>(
    () => doc(firestore, 'hosts', hostId),
    [firestore, hostId],
    { idField: '$id' },
  )
  const connected = host?.cname as string | undefined
  const [domain, setDomain] = useState('')
  // The LIVE state of the connected domain (AGL-1913), refreshed on mount and
  // after every action. Not stored on the host document on purpose: it is a
  // fact about the customer's DNS and the platform's certificate, both of
  // which change without us, and a cached copy of either is how the console
  // ends up asserting a domain is fine hours after it stopped being.
  const [status, setStatus] = useState<DomainStatus | null>(null)
  const [statusLoading, setStatusLoading] = useState(false)

  const refreshStatus = useCallback(async () => {
    if (!connected) return void setStatus(null)
    setStatusLoading(true)
    try {
      const idToken = await (user as any)?.getIdToken?.()
      const response = await fetch(
        `/api/domains/status?hostId=${encodeURIComponent(hostId)}`,
        idToken ? { headers: { Authorization: `Bearer ${idToken}` } } : undefined,
      )
      // A failed status read leaves the card saying what it said before —
      // never "broken", which would be a claim this request did not earn.
      setStatus(response.ok ? await response.json() : null)
    } catch {
      setStatus(null)
    } finally {
      setStatusLoading(false)
    }
  }, [connected, hostId, user])

  useEffect(() => {
    void refreshStatus()
  }, [refreshStatus])
  // Which records to offer for the name typed so far, and in which order —
  // ALIAS leads for a bare apex, CNAME for everything else (AGL-1327). The
  // derivation lives in `utils/tenant-dns.ts` beside the values the verify
  // route reads, so the card cannot drift from what the route accepts.
  const records = dnsInstructionsFor(domain)
  const [checking, setChecking] = useState(false)
  const entitled = hasEntitlement('custom-domain', org)

  const handleConnect = useCallback(async () => {
    const value = domain.trim().toLowerCase()
    if (!value) return
    setChecking(true)
    const dequeue = queueLoading()
    try {
      const idToken = await (user as any)?.getIdToken?.()
      const verifyResponse = await fetch(
        `/api/domains/verify?domain=${encodeURIComponent(value)}`,
        idToken
          ? { headers: { Authorization: `Bearer ${idToken}` } }
          : undefined,
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
            : 'No CNAME found, and the domain does not resolve to Aglyn ' +
                'yet — add one of the records above. DNS changes can take a ' +
                'while to propagate.',
          { variant: 'warning', persist: false },
        )
      }
      // The verify route says WHICH rule passed (AGL-1264 added
      // `matchedBy: 'apex-address'` precisely so this wizard could explain
      // itself); until now nothing read it and apex customers got a bare tick.
      //
      // The message names the ADDRESSES, not the record type: the same rule
      // passes for an ALIAS — which a registrar flattens to those addresses —
      // and calling that "your A record" would name a record the customer
      // never created (AGL-1327).
      if (verify.matchedBy === 'apex-address') {
        enqueueSnackbar('Apex verified by the addresses it resolves to.', {
          variant: 'info',
          persist: false,
        })
      }
      // `/api/domains/attach` claims the domain and persists `host.cname` in a
      // single transaction (AGL-743) — the client must NOT write `cname` itself,
      // or a losing 409 leaves this host still holding another org's domain.
      // Attachment also provisions SSL; 501 means the platform env isn't
      // configured yet, but the domain is saved either way.
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
      } else if (attachResponse.status === 409) {
        const conflict = await attachResponse.json().catch(() => undefined)
        return void enqueueSnackbar(
          conflict?.error ?? 'That domain is already connected to another site',
          { variant: 'error', allowDuplicate: true },
        )
      } else if (!attachResponse.ok) {
        enqueueSnackbar('Could not connect the domain — please try again', {
          variant: 'error',
          allowDuplicate: true,
        })
      } else {
        // What attach ACTUALLY achieved, not that the request returned 200
        // (AGL-1913). A domain held pending an ownership challenge, or one the
        // platform cannot resolve, is connected and not serving — and the card
        // below says which, so this only has to avoid claiming otherwise.
        const attached = await attachResponse.json().catch(() => undefined)
        const serving =
          attached?.state !== 'ownership-pending' &&
          attached?.state !== 'dns-misconfigured'
        enqueueSnackbar(
          serving
            ? `"${value}" connected`
            : `"${value}" connected — one more step before it serves`,
          { variant: serving ? 'success' : 'warning', persist: false },
        )
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
      void refreshStatus()
    }
  }, [domain, hostId, user, queueLoading, enqueueSnackbar, refreshStatus])

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
        // "SSL provisions shortly" was said unconditionally, including for the
        // two states where it never would (AGL-1913).
        const serving =
          payload?.state !== 'ownership-pending' &&
          payload?.state !== 'dns-misconfigured'
        enqueueSnackbar(
          serving
            ? `"${connected}" attached — SSL provisions shortly`
            : `"${connected}" attached, but it will not serve yet — see below`,
          { variant: serving ? 'success' : 'warning', persist: false },
        )
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
      void refreshStatus()
    }
  }, [connected, hostId, user, enqueueSnackbar, refreshStatus])

  const handleDisconnect = useCallback(async () => {
    // Goes through the server (AGL-742) so the hostname is also removed from
    // the tenant Vercel project. Clearing `host.cname` alone left the domain
    // attached there indefinitely — still served, but resolving to no host.
    const dequeue = queueLoading()
    try {
      const idToken = await (user as any)?.getIdToken?.()
      const response = await fetch('/api/domains/detach', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
        },
        body: JSON.stringify({ hostId }),
      })
      if (!response.ok) {
        const payload = await response.json().catch(() => undefined)
        return void enqueueSnackbar(
          payload?.error ?? 'Could not disconnect the domain — please try again',
          { variant: 'error', allowDuplicate: true },
        )
      }
      enqueueSnackbar('Custom domain disconnected', {
        variant: 'success',
        persist: false,
      })
    } catch (error) {
      console.error(error)
      enqueueSnackbar('An error has occurred', {
        variant: 'error',
        allowDuplicate: true,
      })
    } finally {
      dequeue()
    }
  }, [hostId, user, enqueueSnackbar, queueLoading])

  return (
    <CardDisplay
      header="Custom domain"
      help={docsHelp('connectADomain', { anchor: '#steps' })}
      contentGutterX
      contentGutterY
    >
      <Stack spacing={2}>
        {connected ? (
          <Stack spacing={1}>
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
              {(() => {
                const chip = chipFor(
                  connected,
                  status,
                  host?.cnameAttachmentPending === true,
                )
                return <Chip label={chip.label} color={chip.color} />
              })()}
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
              {/*
                A certificate arrives on its own a few minutes later, and the
                card has no way to know when. Without this the customer's only
                move is a page reload, which reads like the product does not
                know either (AGL-1913).
              */}
              <Button
                size="small"
                disabled={statusLoading}
                onClick={() => void refreshStatus()}
              >
                {statusLoading ? 'Checking…' : 'Check status'}
              </Button>
              <Button size="small" color="error" onClick={handleDisconnect}>
                {'Disconnect'}
              </Button>
            </Stack>
            {(() => {
              const explanation = explanationFor(status)
              return explanation ? (
                <Alert severity={explanation.severity}>{explanation.text}</Alert>
              ) : null
            })()}
            {/*
              The exact record Vercel is waiting for. Without it "prove you own
              the domain" is a dead end: nothing else in the product says which
              record, on which name, with which value.
            */}
            {status?.state === 'ownership-pending' &&
            status.verification?.length ? (
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
              Records answering for the same name that are not ours, as the
              platform sees them — the stale A record left behind by a previous
              host, which answers alongside a correct ALIAS and wins some of the
              time. Shown even when the domain is serving, because that is
              exactly when it looks fine and is not.
            */}
            {status?.conflicts?.length ? (
              <Alert severity="warning">
                {'Other DNS records are answering for this name and will make ' +
                  'the site load intermittently. Remove them at your ' +
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
        ) : null}
        {/*
          `hasEntitlement` on an undefined org answers "no", and `org` is
          undefined both in flight and on a failed read (AGL-1380). This
          branch replaces the connected domain and its Disconnect control, so
          a paying site's live custom domain read as a feature it had not
          bought. Hold until the plan is known.
        */}
        {!orgReady ? (
          <Typography variant="body2" color="text.secondary">
            {'Checking your plan…'}
          </Typography>
        ) : !entitled ? (
          <Alert severity="info">
            {'Custom domains are included from the Starter plan — see ' +
              'Billing to upgrade.'}
          </Alert>
        ) : (
          <>
            <Typography variant="body2" color="text.secondary">
              {DNS_INSTRUCTIONS_INTRO}
            </Typography>
            {records.map((record) => (
              <Stack key={record.type} spacing={0.5}>
                <Typography
                  variant="body2"
                  component="code"
                  sx={{
                    p: 1,
                    bgcolor: 'action.hover',
                    borderRadius: 1,
                    fontFamily: 'monospace',
                    whiteSpace: 'pre',
                    overflowX: 'auto',
                  }}
                >
                  {formatDnsInstruction(record)}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {record.note}
                </Typography>
              </Stack>
            ))}
            <Stack direction="row" spacing={1}>
              <TextField
                size="small"
                label="Domain"
                placeholder="your-domain.com or www.your-domain.com"
                value={domain}
                onChange={(event) => setDomain(event.target.value)}
                sx={{ flex: 1, maxWidth: 360 }}
              />
              <Button
                variant="contained"
                color="primary"
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
