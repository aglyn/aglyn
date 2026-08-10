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

import { canManageOrg, checkEntitlement } from '@aglyn/aglyn'
import { CardDisplay, useConfirmationContext } from '@aglyn/shared-ui-jsx'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import {
  Alert,
  Button,
  Chip,
  Divider,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material'
import { type ReactNode, useCallback, useEffect, useState } from 'react'
import { useUser } from '@aglyn/tenant-feature-instance'
import { docsHelp } from '../constants/docs-links'
import useCurrentOrg from '../hooks/use-current-org'
import { useOrgScope } from '../hooks/use-org-scope'

interface DomainClaim {
  domain: string
  verified: boolean
  /**
   * Governing sign-in today on the strength of a staff attestation made before
   * self-serve existed, with no DNS proof behind it. Shown, never silently
   * dropped (it is live), never counted as verified (nobody checked).
   */
  attested: boolean
  recordHost: string
  recordValue: string
  lastRecords: string[] | null
}

interface SsoConfig {
  tenantId?: string
  providerId?: string
  displayName?: string
  status?: 'configuring' | 'active' | 'disabled'
  enforced?: boolean
  domains?: string[]
  idp?: { entityId: string; ssoUrl: string; certificates: string[] }
}

interface ServiceMetadata {
  acsUrl: string
  entityId: string
  authDomain: string
}

interface EnforcementPreview {
  scanned: number
  changed: number
  accounts: Array<{
    uid: string
    email: string | null
    unlinked: string[]
    kept: string[]
    skipped?: string
  }>
}

/** A read-only value the customer has to copy into their IdP. */
function CopyField({ label, value }: { label: string; value: string }) {
  const { enqueueSnackbar } = useSnackbar()
  return (
    <TextField
      label={label}
      value={value}
      size="small"
      fullWidth
      slotProps={{ input: { readOnly: true } }}
      onFocus={(event) => event.target.select()}
      onClick={() => {
        void navigator.clipboard?.writeText(value).then(() =>
          enqueueSnackbar('Copied', { variant: 'success', persist: false }),
        )
      }}
      helperText="Click to copy"
    />
  )
}

/** The card chrome, identical in every state the card can be in. */
function SsoCardShell({ children }: { children: ReactNode }) {
  return (
    <CardDisplay
      header="Single sign-on"
      help={docsHelp('sso')}
      contentGutterX
      contentGutterY
      sx={{ mt: 3 }}
    >
      {children}
    </CardDisplay>
  )
}

/**
 * Self-serve enterprise SSO (AGL-1210).
 *
 * Every step an org needs to stand up SAML without talking to us: prove a
 * domain by DNS TXT, exchange metadata with the IdP, go live, and rehearse
 * enforcement. The gate is the `ssoEnabled` entitlement alone — getting onto
 * Enterprise is the conversation, and nothing after it is.
 *
 * The order on screen is the order the security model requires. Domains come
 * first because a verified domain is what makes any of the rest safe: the
 * routing doc for a domain sends that domain's sign-ins to this org's IdP, so
 * publishing one for a domain the org does not own would intercept another
 * company's logins. The activate button stays disabled until a domain has
 * actually passed a DNS lookup, and the server re-checks the claim anyway —
 * this ordering is the explanation, not the enforcement.
 */
export function OrgSsoCard() {
  const { data: user } = useUser()
  const { currentOrg } = useOrgScope()
  const { org, ready: orgReady } = useCurrentOrg()
  const { enqueueSnackbar } = useSnackbar()
  const { confirm } = useConfirmationContext()
  const orgId = currentOrg?.$id
  const canManage = canManageOrg(currentOrg?.role)
  const entitled = checkEntitlement(org, 'ssoEnabled')

  const [sso, setSso] = useState<SsoConfig>({})
  const [claims, setClaims] = useState<DomainClaim[]>([])
  const [metadata, setMetadata] = useState<ServiceMetadata | null>(null)
  const [newDomain, setNewDomain] = useState('')
  const [entityId, setEntityId] = useState('')
  const [ssoUrl, setSsoUrl] = useState('')
  const [certificate, setCertificate] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [preview, setPreview] = useState<EnforcementPreview | null>(null)
  const [busy, setBusy] = useState(false)
  /**
   * Three states, not two (AGL-1376). `sso = {}` is the value BEFORE an answer
   * as much as it is the value of an org that never set SSO up, so rendering
   * "Not set up" off an empty config is a claim about the org's security
   * posture made without having asked anything. On a failed or hanging status
   * request that claim is confidently wrong — and wrong in the direction that
   * invites an admin to turn SSO on, which for an attested org is a one-way
   * door (AGL-1375). Only `loaded` may speak about the org's actual state.
   */
  const [loadState, setLoadState] = useState<'pending' | 'error' | 'loaded'>(
    'pending',
  )

  const request = useCallback(
    async (body: Record<string, unknown>) => {
      if (!orgId) return null
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const idToken = await (user as any)?.getIdToken?.()
      const response = await fetch('/api/orgs/sso', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
        },
        body: JSON.stringify({ ...body, orgId }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        enqueueSnackbar(payload?.error ?? 'Single sign-on request failed', {
          variant: 'warning',
          persist: false,
        })
        return null
      }
      return payload
    },
    [orgId, user, enqueueSnackbar],
  )

  const refresh = useCallback(async () => {
    let payload: Awaited<ReturnType<typeof request>> = null
    try {
      payload = await request({ action: 'status' })
    } catch {
      // A rejected fetch — offline, a wedged route, a dev server mid-restart —
      // throws straight past the snackbar inside `request`, so this is the
      // only place it can be turned into something the card can render.
      payload = null
    }
    if (!payload) {
      setLoadState('error')
      return
    }
    setSso(payload.sso ?? {})
    setClaims(payload.claims ?? [])
    setMetadata(payload.metadata ?? null)
    const idp = payload.sso?.idp
    if (idp) {
      setEntityId(idp.entityId ?? '')
      setSsoUrl(idp.ssoUrl ?? '')
      setCertificate((idp.certificates ?? [])[0] ?? '')
    }
    setDisplayName(payload.sso?.displayName ?? '')
    setLoadState('loaded')
  }, [request])

  const retry = useCallback(() => {
    setLoadState('pending')
    void refresh()
  }, [refresh])

  useEffect(() => {
    if (orgId && user && entitled) void refresh()
  }, [orgId, user, entitled, refresh])

  const run = async (body: Record<string, unknown>, done?: string) => {
    setBusy(true)
    try {
      const result = await request(body)
      if (result && done) {
        enqueueSnackbar(done, { variant: 'success', persist: false })
      }
      if (result) await refresh()
      return result
    } finally {
      setBusy(false)
    }
  }

  // The entitlement branch is the same shape of claim (AGL-1376): `org` is
  // undefined both while the billing doc is loading and while the read is
  // failing, and `checkEntitlement` on undefined answers "no". Telling an
  // Enterprise org the feature it pays for is not part of its plan is the
  // recorded "a loading default answers a question" bug, so wait for `ready`.
  if (!orgReady) {
    return (
      <SsoCardShell>
        <Typography variant="body2" color="text.secondary">
          {'Checking your plan…'}
        </Typography>
      </SsoCardShell>
    )
  }

  if (!entitled) {
    // Deliberately NOT "email us to enable SSO". The self-serve rule carves out
    // exactly one conversation — the pricing plan — so this points at that and
    // promises the rest is theirs.
    return (
      <SsoCardShell>
        <Stack spacing={2} sx={{ maxWidth: 560 }}>
          <Alert severity="info">
            {'Single sign-on is part of Enterprise.'}
          </Alert>
          <Typography variant="body2" color="text.secondary">
            {'Once your organization is on an Enterprise plan, you set SSO up ' +
              'yourself here — verify your domain, paste your identity ' +
              'provider’s details, and turn it on. There is no provisioning ' +
              'step on our side and nothing to wait for.'}
          </Typography>
        </Stack>
      </SsoCardShell>
    )
  }

  if (loadState === 'error') {
    // No status chip: every label it could carry — "On", "Off", "Not set up" —
    // asserts something we did not manage to find out. Whatever SSO is doing
    // right now, it carries on doing while this renders; nothing below is
    // reachable, so nothing below can be acted on against a config we do not
    // have.
    return (
      <SsoCardShell>
        <Stack spacing={2} sx={{ maxWidth: 560 }}>
          <Alert
            severity="error"
            action={
              <Button color="inherit" size="small" onClick={retry}>
                {'Retry'}
              </Button>
            }
          >
            {'We couldn’t load your single sign-on settings.'}
          </Alert>
          <Typography variant="body2" color="text.secondary">
            {'This says nothing about whether single sign-on is on — we ' +
              'could not reach the setting to find out. Nothing has changed.'}
          </Typography>
        </Stack>
      </SsoCardShell>
    )
  }

  if (loadState === 'pending') {
    return (
      <SsoCardShell>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
          <Chip size="small" label="Checking…" />
        </Stack>
      </SsoCardShell>
    )
  }

  const verifiedDomains = claims.filter((claim) => claim.verified)
  // Attested domains govern sign-in today even though no DNS record backs
  // them, so they count for "can this org be live" — otherwise an already-live
  // org is told to verify a domain before turning on something already on.
  const governedDomains = claims.filter(
    (claim) => claim.verified || claim.attested,
  )
  const isActive = sso.status === 'active'

  return (
    <SsoCardShell>
      <Stack spacing={4} sx={{ maxWidth: 720 }}>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
          <Chip
            size="small"
            color={isActive ? 'success' : 'default'}
            label={
              isActive
                ? 'On'
                : sso.status === 'disabled'
                  ? 'Off'
                  : 'Not set up'
            }
          />
          {sso.enforced ? (
            <Chip size="small" color="warning" label="Enforced" />
          ) : null}
        </Stack>

        {/* ---------- 1. Domains ---------- */}
        <Stack spacing={2}>
          <Typography variant="subtitle2">{'1. Verify your domain'}</Typography>
          <Typography variant="body2" color="text.secondary">
            {'Add each email domain your team signs in with. Publish the DNS ' +
              'record we give you, then verify — we only route a domain’s ' +
              'sign-ins to your identity provider once we have seen that record.'}
          </Typography>
          <Stack direction="row" spacing={1}>
            <TextField
              label="Domain"
              placeholder="acme.com"
              value={newDomain}
              size="small"
              disabled={busy || !canManage}
              onChange={(event) => setNewDomain(event.target.value)}
              sx={{ flex: 1 }}
            />
            <Button
              variant="outlined"
              disabled={busy || !canManage || !newDomain.trim()}
              onClick={() =>
                void run({ action: 'add-domain', domain: newDomain }).then(
                  () => setNewDomain(''),
                )
              }
            >
              {'Add'}
            </Button>
          </Stack>

          {claims.map((claim) => (
            <Stack
              key={claim.domain}
              spacing={1}
              sx={{ p: 2, border: 1, borderColor: 'divider', borderRadius: 1 }}
            >
              <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                <Typography variant="body2" sx={{ fontWeight: 600, flex: 1 }}>
                  {claim.domain}
                </Typography>
                <Chip
                  size="small"
                  color={
                    claim.verified ? 'success' : claim.attested ? 'info' : 'default'
                  }
                  label={
                    claim.verified
                      ? 'Verified'
                      : claim.attested
                        ? 'Live — set up by us'
                        : 'Pending'
                  }
                />
              </Stack>
              {claim.attested ? (
                <Alert severity="info">
                  {'This domain is signing your team in today. We set it up ' +
                    'for you before self-serve existed, so there is no DNS ' +
                    'record behind it yet. Add one to bring it under the same ' +
                    'proof as everything else — nothing changes until you do.'}
                </Alert>
              ) : !claim.verified ? (
                <>
                  <Typography variant="caption" color="text.secondary">
                    {'Add this TXT record at your DNS provider, then verify. ' +
                      'It can take a few minutes to propagate.'}
                  </Typography>
                  <CopyField label="Record name" value={claim.recordHost} />
                  <CopyField label="Record value" value={claim.recordValue} />
                  {claim.lastRecords?.length ? (
                    <Alert severity="warning">
                      {'We found a record but the value did not match. Seen: ' +
                        claim.lastRecords.join(', ')}
                    </Alert>
                  ) : null}
                </>
              ) : null}
              <Stack direction="row" spacing={1}>
                <Button
                  size="small"
                  variant="outlined"
                  disabled={busy || !canManage}
                  onClick={() =>
                    // An attested domain has no claim document yet, so there is
                    // no token to check against — issue one first, which is
                    // what surfaces the TXT record to publish.
                    claim.attested
                      ? void run(
                          { action: 'add-domain', domain: claim.domain },
                          'Added — publish the DNS record shown, then verify',
                        )
                      : void run({
                          action: 'verify-domain',
                          domain: claim.domain,
                        }).then((result) => {
                          if (result && !result.verified) {
                            enqueueSnackbar(
                              'No matching TXT record yet — DNS can take a few minutes.',
                              { variant: 'warning', persist: false },
                            )
                          }
                        })
                  }
                >
                  {claim.attested
                    ? 'Set up DNS proof'
                    : claim.verified
                      ? 'Re-check'
                      : 'Verify'}
                </Button>
                <Button
                  size="small"
                  color="error"
                  disabled={busy || !canManage}
                  onClick={async () => {
                    // confirm() REJECTS on cancel and carries no boolean, so
                    // the catch is the cancel path.
                    try {
                      await confirm({
                        title: `Remove ${claim.domain}?`,
                        description:
                          'People with this email domain will stop signing in ' +
                          'through your identity provider.',
                        confirmationButtonProps: { color: 'error' },
                      })
                    } catch {
                      return
                    }
                    void run(
                      { action: 'remove-domain', domain: claim.domain },
                      'Domain removed',
                    )
                  }}
                >
                  {'Remove'}
                </Button>
              </Stack>
            </Stack>
          ))}
        </Stack>

        <Divider />

        {/* ---------- 2. Metadata exchange ---------- */}
        <Stack spacing={2}>
          <Typography variant="subtitle2">
            {'2. Connect your identity provider'}
          </Typography>
          {metadata ? (
            <>
              <Typography variant="body2" color="text.secondary">
                {'Give these to your identity provider when you create the ' +
                  'Aglyn application.'}
              </Typography>
              <CopyField label="Reply / ACS URL" value={metadata.acsUrl} />
              <CopyField label="Entity ID / Audience" value={metadata.entityId} />
            </>
          ) : null}
          <Typography variant="body2" color="text.secondary" sx={{ pt: 1 }}>
            {'Then paste your provider’s details back here.'}
          </Typography>
          <TextField
            label="Display name"
            placeholder="Okta"
            value={displayName}
            size="small"
            disabled={busy || !canManage}
            onChange={(event) => setDisplayName(event.target.value)}
            helperText="Shown on the sign-in button"
          />
          <TextField
            label="IdP Entity ID"
            value={entityId}
            size="small"
            disabled={busy || !canManage}
            onChange={(event) => setEntityId(event.target.value)}
          />
          <TextField
            label="IdP sign-in URL"
            placeholder="https://..."
            value={ssoUrl}
            size="small"
            disabled={busy || !canManage}
            onChange={(event) => setSsoUrl(event.target.value)}
          />
          <TextField
            label="X.509 signing certificate"
            value={certificate}
            size="small"
            multiline
            minRows={4}
            disabled={busy || !canManage}
            onChange={(event) => setCertificate(event.target.value)}
            helperText="The public certificate from your IdP, PEM or base64"
          />
          <Button
            variant="contained"
            disabled={busy || !canManage || !entityId || !ssoUrl || !certificate}
            onClick={() =>
              void run(
                {
                  action: 'save-idp',
                  entityId,
                  ssoUrl,
                  certificates: [certificate],
                  displayName: displayName || 'Single sign-on',
                },
                'Identity provider saved',
              )
            }
            sx={{ alignSelf: 'flex-start' }}
          >
            {sso.tenantId ? 'Update provider' : 'Create provider'}
          </Button>
        </Stack>

        <Divider />

        {/* ---------- 3. Go live ---------- */}
        <Stack spacing={2}>
          <Typography variant="subtitle2">{'3. Turn it on'}</Typography>
          {!governedDomains.length ? (
            <Alert severity="info">
              {'Verify at least one domain before turning single sign-on on.'}
            </Alert>
          ) : !verifiedDomains.length && isActive ? (
            <Alert severity="info">
              {'Single sign-on is on. None of your domains have DNS proof yet ' +
                '— add it above when you get the chance.'}
            </Alert>
          ) : null}
          <Stack direction="row" spacing={1}>
            <Button
              variant="contained"
              disabled={
                busy ||
                !canManage ||
                !governedDomains.length ||
                !sso.tenantId ||
                isActive
              }
              onClick={() => void run({ action: 'activate' }, 'Single sign-on is on')}
            >
              {'Turn on'}
            </Button>
            <Button
              variant="outlined"
              color="error"
              disabled={busy || !canManage || !isActive}
              onClick={async () => {
                try {
                  await confirm({
                    title: 'Turn single sign-on off?',
                    description:
                      'Your team will go back to signing in with a password. ' +
                      'Your identity pool and its accounts are kept, so you can ' +
                      'turn it back on without anyone losing their account.',
                    confirmationButtonProps: { color: 'error' },
                  })
                } catch {
                  return
                }
                void run({ action: 'disable' }, 'Single sign-on is off')
              }}
            >
              {'Turn off'}
            </Button>
          </Stack>
        </Stack>

        <Divider />

        {/* ---------- 4. Enforcement ---------- */}
        <Stack spacing={2}>
          <Typography variant="subtitle2">{'4. Enforce single sign-on'}</Typography>
          <Typography variant="body2" color="text.secondary">
            {'Enforcing removes every other way into an account in your ' +
              'identity pool — passwords and linked social logins stop ' +
              'working. Rehearse it first: the rehearsal changes nothing and ' +
              'shows you exactly which accounts are affected.'}
          </Typography>
          <Stack direction="row" spacing={1}>
            <Button
              variant="outlined"
              disabled={busy || !canManage || !isActive}
              onClick={async () => {
                const result = await run({ action: 'enforce-preview' })
                if (result?.preview) setPreview(result.preview)
              }}
            >
              {'Rehearse'}
            </Button>
            <Button
              variant="contained"
              color="warning"
              disabled={busy || !canManage || !isActive || sso.enforced}
              onClick={async () => {
                try {
                  await confirm({
                    title: 'Enforce single sign-on?',
                    description:
                      'Passwords and linked social logins will be removed from ' +
                      'every account in your identity pool. Anyone who has only ' +
                      'those will need your identity provider to get back in. ' +
                      'This cannot be undone by turning enforcement off.',
                    confirmationButtonProps: { color: 'warning' },
                  })
                } catch {
                  return
                }
                void run(
                  { action: 'enforce-apply', confirm: true },
                  'Single sign-on enforced',
                )
              }}
            >
              {'Enforce'}
            </Button>
            {sso.enforced ? (
              <Button
                variant="outlined"
                disabled={busy || !canManage}
                onClick={() =>
                  void run({ action: 'enforce-off' }, 'Enforcement stopped')
                }
              >
                {'Stop enforcing'}
              </Button>
            ) : null}
          </Stack>

          {preview ? (
            <Stack spacing={1}>
              <Alert severity={preview.changed ? 'warning' : 'success'}>
                {preview.changed
                  ? `${preview.changed} of ${preview.scanned} accounts would change.`
                  : `Nothing would change — all ${preview.scanned} accounts already sign in through your identity provider only.`}
              </Alert>
              {preview.accounts.length ? (
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>{'Account'}</TableCell>
                      <TableCell>{'Would lose'}</TableCell>
                      <TableCell>{'Keeps'}</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {preview.accounts.map((account) => (
                      <TableRow key={account.uid}>
                        <TableCell>{account.email ?? account.uid}</TableCell>
                        <TableCell>
                          {account.skipped
                            ? 'Nothing — it would be left with no way in'
                            : account.unlinked.join(', ') || '—'}
                        </TableCell>
                        <TableCell>{account.kept.join(', ') || '—'}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : null}
            </Stack>
          ) : null}
        </Stack>
      </Stack>
    </SsoCardShell>
  )
}

export default OrgSsoCard
