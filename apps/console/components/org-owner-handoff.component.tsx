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

import type { AglynOrgBilling, OwnerHandoffPreviousOwner } from '@aglyn/aglyn'
import { describeBundle } from '@aglyn/aglyn/app-utils/bundle-intent'
import {
  readClientBuildIntent,
  type ClientBuildRecord,
} from '@aglyn/aglyn/app-utils/client-build'
import { isLiveSubscriptionStatus } from '@aglyn/aglyn/app-utils/org-billing-doc'
import {
  OWNER_HANDOFF_PREVIOUS_OWNER,
  OWNER_HANDOFF_PREVIOUS_OWNER_LABELS,
} from '@aglyn/aglyn/app-utils/organizations'
import { UPGRADE_PROPOSAL_NOTE_MAX } from '@aglyn/aglyn/app-utils/upgrade-proposal'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { authorizedFetch } from '@aglyn/shared-util-http/authorized-token'
import { useUser } from '@aglyn/tenant-feature-instance'
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Divider,
  MenuItem,
  Stack,
  TextField,
} from '@mui/material'
import { useEffect, useRef, useState } from 'react'
import {
  bundleDraftBody,
  bundleDraftFromClientBuildIntent,
  DEFAULT_BUNDLE_DRAFT,
  StaffBundleFields,
  type BundleDraft,
} from './staff-bundle-fields.component'
import {
  bundleDomainFromClientBuildIntent,
  EMPTY_BUNDLE_DOMAIN,
  StaffBundleDomainFields,
  StaffBundleLinkActions,
  useDomainsAvailable,
  type BundleDomainDraft,
  type BundleSiteOption,
} from './staff-bundle-link.component'

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** What the outgoing owner keeps, said once for every surface that asks. */
export const OWNER_HANDOFF_HINT =
  'They become the owner once they accept. Nothing changes until then, and ' +
  'the invitation reserves no seat.'

/**
 * The outgoing owner's choice for an owner handoff (AGL-3466): stay on as an
 * admin, or leave. The Team page's invite row and the staff dialog below
 * both draw it, so the two cannot word the choice differently.
 */
export function OwnerHandoffPreviousOwnerField(props: {
  value: OwnerHandoffPreviousOwner
  onChange: (value: OwnerHandoffPreviousOwner) => void
  disabled?: boolean
}) {
  const { value, onChange, disabled } = props
  return (
    <TextField
      size="small"
      select
      label="Current owner"
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value as OwnerHandoffPreviousOwner)}
      sx={{ minWidth: 280 }}
    >
      {OWNER_HANDOFF_PREVIOUS_OWNER.map((option) => (
        <MenuItem key={option} value={option}>
          {OWNER_HANDOFF_PREVIOUS_OWNER_LABELS[option]}
        </MenuItem>
      ))}
    </TextField>
  )
}

/**
 * Send an owner handoff through `/api/orgs/invites` (AGL-3466). Resolves the
 * route's answer so each surface can word its own confirmation; a refusal is
 * returned, not thrown, because the seat refusal is an expected answer that
 * names its own way out.
 */
export async function sendOwnerHandoff(
  user: Parameters<typeof authorizedFetch>[0],
  options: {
    orgId: string
    email: string
    previousOwner: OwnerHandoffPreviousOwner
    /**
     * The plan proposed in the same act (AGL-3956), staff only: the
     * invitation and the proposal commit together, and the invitation email
     * carries the bundle checkout link.
     */
    proposal?: ReturnType<typeof bundleDraftBody> & { note?: string }
  },
): Promise<{ ok: boolean; emailed?: boolean; error?: string }> {
  const response = await authorizedFetch(user, '/api/orgs/invites', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      orgId: options.orgId,
      action: 'create',
      email: options.email.trim().toLowerCase(),
      role: 'owner',
      handoff: { previousOwner: options.previousOwner },
      ...(options.proposal ? { proposal: options.proposal } : {}),
    }),
  })
  const payload = await response.json().catch(() => ({}))
  return response.ok
    ? { ok: true, emailed: payload?.emailed === true }
    : { ok: false, error: payload?.error ?? 'The handoff could not be sent' }
}

/** What a build for a client leaves its hand-off (AGL-3958): the intent, and the site it made. */
export type ClientBuildHandoff = Pick<ClientBuildRecord, 'intent' | 'hostId'>

/**
 * The build for a client a workspace has (AGL-3958), read through
 * `/api/admin/client-build`: the record is closed to clients by the rules, so
 * staff read it only through that route. `null` while it is on its way, for
 * a workspace that was not built for a client, and when the read fails; each
 * opens the hand-off on the default bundle, as before.
 */
export function useStaffClientBuild(orgId: string | null | undefined): ClientBuildHandoff | null {
  const { data: user } = useUser()
  // `user` identity churns with token refreshes; the uid names the reader.
  const userRef = useRef(user)
  userRef.current = user
  const uid = user?.uid ?? null
  const [build, setBuild] = useState<ClientBuildHandoff | null>(null)
  useEffect(() => {
    if (!uid || !orgId) return
    let cancelled = false
    void authorizedFetch(userRef.current, '/api/admin/client-build', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orgId, action: 'get' }),
    })
      .then((response) => (response.ok ? response.json() : null))
      .then((payload) => {
        if (cancelled) return
        const record = payload?.record
        const intent = readClientBuildIntent(record?.intent)
        setBuild(
          intent
            ? { intent, hostId: typeof record?.hostId === 'string' ? record.hostId : null }
            : null,
        )
      })
      .catch(() => {
        if (!cancelled) setBuild(null)
      })
    return () => {
      cancelled = true
    }
  }, [uid, orgId])
  return build
}

export interface StaffOrgOwnerHandoffProps {
  orgId: string
  /** The organization's name, for the dialog. */
  orgName?: string | null
  /**
   * The org document as the staff page read it. A workspace with a live
   * subscription has nothing to propose, so its handoff goes without one.
   */
  org?: Partial<AglynOrgBilling> | null
  /** The workspace's sites, for a bundle link that carries a domain. */
  sites?: readonly BundleSiteOption[]
  /**
   * The workspace's build for a client, when it has one (AGL-3958): the
   * dialog opens on its plan, add-ons, cadence, coupon and domain. Without
   * one it opens on the default bundle.
   */
  build?: ClientBuildHandoff | null
  /** Called once the invitation is sent. */
  onSent?: () => void
}

/**
 * Hand a workspace to a client from the staff pages (AGL-3466, AGL-3956):
 * the staff organization page and the staff site page.
 *
 * A transfer moves the workspace to somebody already on its roster. A
 * handoff invites an address — the client the site was built for usually
 * has no account yet — and moves the workspace when they accept. Staff take
 * no seat, so a Free workspace staff built needs no override for it.
 *
 * For a site built for a client the handoff and the plan are always asked
 * together, so this is ONE act (AGL-3956): the plan, its add-ons (Site Care
 * on by default), the cadence and a coupon ride the same request, the
 * invitation and the proposal commit together, and the email carries the
 * bundle checkout link. The dialog header copies that link or shows its QR
 * for an owner standing in front of you (AGL-3955). "Ask to upgrade" stays
 * for an owner who already exists. A workspace built for a client opens the
 * dialog on what its build agreed with the owner (AGL-3958).
 */
export function StaffOrgOwnerHandoff(props: StaffOrgOwnerHandoffProps) {
  const { orgId, orgName, org, sites = [], build, onSent } = props
  const { data: user } = useUser()
  const { enqueueSnackbar } = useSnackbar()
  const [open, setOpen] = useState(false)
  const [email, setEmail] = useState('')
  const [previousOwner, setPreviousOwner] =
    useState<OwnerHandoffPreviousOwner>('stay')
  const [draft, setDraft] = useState<BundleDraft>(DEFAULT_BUNDLE_DRAFT)
  const [domain, setDomain] = useState<BundleDomainDraft>(EMPTY_BUNDLE_DOMAIN)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  // The build the fields were last opened on, so what staff change survives
  // closing and reopening the dialog until the build itself changes.
  const [seeded, setSeeded] = useState<string | null>(null)
  const emailValid = EMAIL_PATTERN.test(email.trim())
  // A paying workspace has nothing to propose: the handoff goes alone.
  const subscriptionLive = isLiveSubscriptionStatus(org?.billingStatus)
  const domainsAvailable = useDomainsAvailable()
  const existingDomain = build?.intent.existingDomain ?? null

  const openDialog = () => {
    const seed = build ? JSON.stringify([build.intent, build.hostId]) : null
    if (build && seed !== seeded) {
      // The domain is for the site the build made, where staff can pick it.
      const hostId = sites.some((site) => site.hostId === build.hostId) ? build.hostId : null
      setDraft(bundleDraftFromClientBuildIntent(build.intent))
      setDomain(bundleDomainFromClientBuildIntent(build.intent, hostId))
      setSeeded(seed)
    }
    setOpen(true)
  }

  const send = async () => {
    if (!emailValid || busy) return
    setBusy(true)
    try {
      const result = await sendOwnerHandoff(user, {
        orgId,
        email,
        previousOwner,
        ...(subscriptionLive
          ? {}
          : { proposal: { ...bundleDraftBody(draft), ...(note.trim() ? { note: note.trim() } : {}) } }),
      })
      if (!result.ok) {
        enqueueSnackbar(result.error, { variant: 'warning', persist: false })
        return
      }
      const what = subscriptionLive ? 'Handoff' : `Handoff with ${describeBundle(bundleDraftBody(draft))}`
      enqueueSnackbar(
        result.emailed
          ? `${what} sent to ${email.trim()} — email sent`
          : `${what} sent to ${email.trim()} — they'll see it when they sign in`,
        { variant: 'success' },
      )
      setOpen(false)
      setEmail('')
      setNote('')
      onSent?.()
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Button
        size="small"
        variant="outlined"
        onClick={openDialog}
        sx={{ alignSelf: 'flex-start' }}
      >
        {'Hand off'}
      </Button>
      <Dialog
        open={open}
        onClose={() => (busy ? undefined : setOpen(false))}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 1,
            flexWrap: 'wrap',
          }}
        >
          {`Hand off ${orgName ?? 'this workspace'}`}
          {subscriptionLive ? null : (
            <StaffBundleLinkActions orgId={orgId} draft={draft} domain={domain} />
          )}
        </DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <DialogContentText>{OWNER_HANDOFF_HINT}</DialogContentText>
            <TextField
              size="small"
              label="New owner's email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              error={Boolean(email.trim()) && !emailValid}
              helperText={
                Boolean(email.trim()) && !emailValid
                  ? 'Enter a valid email address'
                  : undefined
              }
              autoFocus
            />
            <OwnerHandoffPreviousOwnerField
              value={previousOwner}
              onChange={setPreviousOwner}
              disabled={busy}
            />
            <Divider />
            {subscriptionLive ? (
              <Alert severity="info">
                {'This workspace already pays for a plan, so the handoff goes ' +
                  'without a proposal.'}
              </Alert>
            ) : (
              <>
                <DialogContentText>
                  {'The plan is proposed with the handoff: the email carries a link ' +
                    'to Billing with all of it chosen, and accepting opens it.'}
                </DialogContentText>
                <StaffBundleFields value={draft} onChange={setDraft} disabled={busy} />
                <TextField
                  size="small"
                  label="Note to the owner (optional)"
                  value={note}
                  onChange={(event) =>
                    setNote(event.target.value.slice(0, UPGRADE_PROPOSAL_NOTE_MAX))
                  }
                  multiline
                  minRows={2}
                  disabled={busy}
                />
                <StaffBundleDomainFields
                  value={domain}
                  onChange={setDomain}
                  sites={sites}
                  available={domainsAvailable}
                  disabled={busy}
                />
                {existingDomain ? (
                  <Alert severity="info">
                    {`${existingDomain} is the owner’s own domain, so the link carries none to ` +
                      'buy. Connect it with them on the site’s Custom Domain page.'}
                  </Alert>
                ) : null}
              </>
            )}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button disabled={busy} onClick={() => setOpen(false)}>
            {'Cancel'}
          </Button>
          <Button
            variant="contained"
            disabled={busy || !emailValid}
            onClick={() => void send()}
          >
            {busy ? 'Sending…' : subscriptionLive ? 'Send handoff' : 'Hand off and propose'}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  )
}

export default StaffOrgOwnerHandoff
