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
  Checkbox,
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
import useBranding from '../hooks/use-branding'
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
  /**
   * What `publishSsoDomains` will accept for this domain — DNS-verified, or
   * carrying a staff attestation (AGL-1887 part 2). Sent by the server rather
   * than derived here, because the gate is the server's rule and a copy of it
   * on the client is a copy that drifts.
   */
  publishable: boolean
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
  /**
   * Accounts the org designated to keep a non-IdP way in (AGL-1888).
   *
   * The server has read this since the pre-flight landed, and
   * `enforce-apply` refuses outright while it names nobody effective — so
   * without a control here, step 4 of a self-serve setup dead-ended in a
   * refusal the admin could do nothing about except email us. That is the
   * one shape a self-serve flow may not have.
   */
  breakGlassUids?: string[]
}

interface ServiceMetadata {
  acsUrl: string
  entityId: string
  authDomain: string
}

interface EnforcementAccount {
  uid: string
  email: string | null
  unlinked: string[]
  kept: string[]
  skipped?: string
}

interface EnforcementPreview {
  scanned: number
  changed: number
  accounts: EnforcementAccount[]
  /** The rehearsal carries the assessment too — that is what it is for. */
  lockout?: LockoutAssessment
}

/**
 * An org owner who signs in OUTSIDE the identity pool (AGL-1888 option (a)).
 *
 * The enforcement sweep lists the org's GCIP tenant and nothing else, so
 * these accounts are not merely spared — they are invisible to it. That is
 * what makes them a way back in when the identity provider is the thing that
 * failed, and it is why they need no designation: nobody has to be told to
 * keep a key they already hold.
 */
interface OutsidePoolOwner {
  uid: string
  email: string | null
  providers: string[]
}

/** The refusal body `enforce-apply` answers 400 with (AGL-1888). */
interface LockoutAssessment {
  safe: boolean
  /** Designated uids that genuinely hold a non-IdP method. */
  retainedBy: string[]
  /** Designated uids that protect nothing — the ones to replace. */
  ineffective: string[]
  /** Org owners the sweep cannot reach, because they are not in the pool. */
  ownersOutsidePool?: OutsidePoolOwner[]
  /**
   * The owner lookup did not complete. The list above is then INCOMPLETE, not
   * empty — telling an admin "you have nobody" on the strength of a failed
   * check is the shape where a swallowed error renders as a measured zero.
   */
  ownerLookupFailed?: boolean
}

/**
 * Would designating this account actually keep a way in?
 *
 * Mirrors `assessSsoLockoutRisk` deliberately, and over the same fact it
 * uses: an account protects the org only when it holds a provider that is
 * NOT the org's IdP. Designating an account whose sole credential is the SAML
 * link is the most natural way to get this wrong, because it looks exactly
 * like protection and fails in precisely the situation it exists for.
 *
 * The plan is read BEFORE designation, so both halves count: `unlinked` is
 * what enforcement would strip (all non-IdP by construction), and `kept` is
 * what it would leave — which for an already-designated or would-orphan
 * account is the whole set.
 */
function protectsIfDesignated(
  account: EnforcementAccount,
  providerId: string | undefined,
): boolean {
  return [...account.unlinked, ...account.kept].some((id) => id !== providerId)
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
  // Org-scoped chrome reads the org's RESOLVED product name, never a
  // literal (AGL-2319): a white-label org's admins see their own brand.
  const { branding } = useBranding()
  const { enqueueSnackbar } = useSnackbar()
  const { confirm } = useConfirmationContext()
  const orgId = currentOrg?.$id
  const canManage = canManageOrg(currentOrg?.role)
  const entitled = checkEntitlement(org, 'ssoEnabled')

  const [sso, setSso] = useState<SsoConfig>({})
  const [claims, setClaims] = useState<DomainClaim[]>([])
  const [metadata, setMetadata] = useState<ServiceMetadata | null>(null)
  /**
   * Why there is no ACS URL to show (AGL-2020). Null on every correctly
   * configured deployment; set only when the server could not resolve an auth
   * origin at all, which used to silently render OURS.
   */
  const [metadataError, setMetadataError] = useState<string | null>(null)
  const [newDomain, setNewDomain] = useState('')
  const [entityId, setEntityId] = useState('')
  const [ssoUrl, setSsoUrl] = useState('')
  const [certificate, setCertificate] = useState('')
  /**
   * The SECOND certificate, and the reason the field exists at all.
   *
   * An IdP signing certificate expires, and every IdP rotates by publishing
   * the next one alongside the current one for an overlap window. GCIP takes
   * a LIST — `x509Certificates` — and the route has always accepted
   * `certificates: []`, but the card sent exactly one, so the only rotation
   * this UI could express was "replace it at the instant it expires". Get
   * that instant wrong in either direction and every assertion fails
   * signature validation: too early and the old one is gone while the IdP is
   * still signing with it, too late and the new one is unknown. For an org
   * that has enforced SSO that is not a degraded sign-in, it is a lockout,
   * and the only way out was to email us.
   */
  const [certificateNext, setCertificateNext] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [preview, setPreview] = useState<EnforcementPreview | null>(null)
  /** Selected break-glass uids, seeded from the server and edited here. */
  const [breakGlass, setBreakGlass] = useState<string[]>([])
  /** The last refusal's assessment, so it can name the ineffective picks. */
  const [lockout, setLockout] = useState<LockoutAssessment | null>(null)
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

  /**
   * @param options.keepErrorBody return the REFUSAL BODY rather than null.
   *
   * `enforce-apply` answers 400 with a `lockout` assessment naming which
   * designated accounts protect nothing — the only information that tells an
   * admin which account to pick instead. Collapsing every failure to `null`
   * threw that away and left the card with a sentence it could not act on.
   * Opt-in, because every other caller routes through `run()`, which reads a
   * truthy result as success.
   */
  const request = useCallback(
    async (
      body: Record<string, unknown>,
      options?: { keepErrorBody?: boolean },
    ) => {
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
        return options?.keepErrorBody ? { ...payload, ok: false } : null
      }
      return payload
    },
    [orgId, user, enqueueSnackbar],
  )

  const refresh = useCallback(async () => {
    let payload: Awaited<ReturnType<typeof request>>
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
    setMetadataError(payload.metadataError ?? null)
    const idp = payload.sso?.idp
    if (idp) {
      setEntityId(idp.entityId ?? '')
      setSsoUrl(idp.ssoUrl ?? '')
      setCertificate((idp.certificates ?? [])[0] ?? '')
      setCertificateNext((idp.certificates ?? [])[1] ?? '')
    }
    setDisplayName(payload.sso?.displayName ?? '')
    // Seeded from the server rather than kept only in local state: the
    // designation outlives this page, and an admin returning to it must see
    // what is already designated instead of an empty picker that reads as
    // "nothing is protecting you".
    setBreakGlass(
      Array.isArray(payload.sso?.breakGlassUids)
        ? (payload.sso.breakGlassUids as string[])
        : [],
    )
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

  // Attested domains govern sign-in today even though no DNS record backs
  // them, so they count for "can this org be live" — otherwise an already-live
  // org is told to verify a domain before turning on something already on.
  const governedDomains = claims.filter(
    (claim) => claim.verified || claim.attested,
  )
  const isActive = sso.status === 'active'
  /**
   * What `activate` will actually publish (AGL-1375, AGL-1887).
   *
   * `publishSsoDomains` re-reads each claim document and admits on two
   * positive markers: `verified === true`, or a staff attestation. The server
   * reports that verdict per domain as `publishable`, and this gate is exactly
   * it — not a client-side re-derivation, which is what would drift.
   *
   * Part 1 gated on `verifiedDomains` because at the time that WAS the
   * server's rule. Part 2 widened the server, and leaving this on `verified`
   * would have kept the door shut from the console for the very orgs part 2
   * unstranded: attested, publishable, and still looking at a disabled button.
   *
   * `governedDomains` stays the wider set — right for "is this org live",
   * wrong for "will the server accept this".
   */
  const canActivate = claims.some((claim) => claim.publishable)
  /**
   * Governed today, and nothing here can be re-published — the one-way door's
   * actual precondition (AGL-1375).
   *
   * NOT "attested" any more: an attestation is now a way THROUGH the door. What
   * strands an org is having no claim document at all, which is the shape every
   * pre-self-serve org is in until staff attest it. Keyed on `canActivate` so
   * this and the button can never disagree about which side of the door the org
   * is on.
   */
  const cannotRestore = Boolean(governedDomains.length) && !canActivate

  /**
   * What the SERVER has stored, not what is ticked on screen. An unsaved
   * selection protects nobody, and gating the Enforce button on it would put
   * the button back on the wrong side of the same door AGL-1375 was about.
   */
  const savedBreakGlass = sso.breakGlassUids ?? []
  /**
   * With nothing designated the refusal is CERTAIN — `assessSsoLockoutRisk`
   * over an empty list can only answer unsafe — so the button is disabled and
   * the reason is shown instead of being discovered by clicking. Where a
   * designation exists but may be ineffective we do NOT guess: only the
   * server re-plans the pool, so the click is allowed and the refusal is
   * rendered with its list.
   */
  const hasBreakGlass = savedBreakGlass.length > 0
  /**
   * The other way the org can be safe (AGL-1888 option (a)) — and for a pool
   * we provisioned, the only one available: nothing inside it can hold a
   * password, so no tick in the table below can ever be effective.
   *
   * Read from the SERVER's assessment, never inferred here. Whether an owner
   * qualifies depends on which Auth pool their uid lives in, whether their
   * address is verified, and whether the operator requires SSO for their
   * domain — none of which this component can see. Guessing would put the
   * Enforce button on the wrong side of a one-way door.
   */
  const ownersOutsidePool = lockout?.ownersOutsidePool ?? []
  const hasOutsideOwner = ownersOutsidePool.length > 0
  /** The check itself failed — distinct from "your org has nobody". */
  const ownerCheckFailed = lockout?.ownerLookupFailed === true
  const emailForUid = (uid: string) =>
    preview?.accounts.find((account) => account.uid === uid)?.email ?? null
  /** Pool accounts a designation would actually protect the org with. */
  const eligibleBreakGlass = (preview?.accounts ?? []).filter((account) =>
    protectsIfDesignated(account, sso.providerId),
  )
  /** Designations that have not been saved yet — the Save button's whole job. */
  const breakGlassDirty =
    [...breakGlass].sort().join('\x00') !==
    [...savedBreakGlass].sort().join('\x00')

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
                    // An attested domain has no TOKEN to check against — the
                    // fallback shape has no claim document at all, and the
                    // attestation `attestSsoDomain` writes deliberately does
                    // not mint one. Either way `add-domain` is the right first
                    // step: `issueDomainClaim` persists a token onto whichever
                    // of the two it finds and surfaces the TXT record to
                    // publish, without disturbing the attestation.
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
                {'Give these to your identity provider when you create ' +
                  `the ${branding.productName} application.`}
              </Typography>
              <CopyField label="Reply / ACS URL" value={metadata.acsUrl} />
              <CopyField label="Entity ID / Audience" value={metadata.entityId} />
            </>
          ) : metadataError ? (
            // AGL-2020. Before this, an unconfigured deployment printed
            // Aglyn's own auth origin here and the operator pasted it into
            // their IdP. Showing the reason is the only honest option: there
            // is no ACS URL this deployment can serve.
            <Alert severity="error">{metadataError}</Alert>
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
          <TextField
            label="Second signing certificate (optional)"
            value={certificateNext}
            size="small"
            multiline
            minRows={4}
            disabled={busy || !canManage}
            onChange={(event) => setCertificateNext(event.target.value)}
            helperText={
              'For certificate rotation. When your identity provider issues a ' +
              'replacement, add it here while the current one is still live — ' +
              'we accept assertions signed by either, so there is no instant ' +
              'you have to get exactly right. Remove the old one once your ' +
              'provider has switched over.'
            }
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
                  // Both, filtered — the route requires at least one and GCIP
                  // takes a list. An empty second field must not become an
                  // empty string in `x509Certificates`.
                  certificates: [certificate, certificateNext]
                    .map((value) => value.trim())
                    .filter(Boolean),
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
          ) : cannotRestore && isActive ? (
            // The one-way door, stated before it is opened rather than after
            // (AGL-1375). "Add DNS proof when you get the chance" was true of
            // everything except the button sitting next to it.
            <Alert severity="warning">
              {'Single sign-on is on, but none of your domains have DNS proof ' +
                'yet — we set yours up for you. Turning it off would be ' +
                'permanent for now: turning it back on needs a domain we have ' +
                'seen a DNS record for. Add that proof above first.'}
            </Alert>
          ) : cannotRestore ? (
            <Alert severity="warning">
              {'Single sign-on cannot be turned on until one of your domains ' +
                'has DNS proof. Use “Set up DNS proof” above, publish the ' +
                'record, then verify.'}
            </Alert>
          ) : null}
          <Stack direction="row" spacing={1}>
            <Button
              variant="contained"
              disabled={
                busy || !canManage || !canActivate || !sso.tenantId || isActive
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
                    title: cannotRestore
                      ? 'Turn single sign-on off? You will not be able to turn it back on'
                      : 'Turn single sign-on off?',
                    description: cannotRestore
                      ? // The old copy — "you can turn it back on" — was the
                        // single most misleading sentence on the card for
                        // exactly the orgs this applies to (AGL-1375). Turning
                        // on republishes the routing docs, and that step only
                        // accepts a domain with DNS proof, which this org has
                        // none of. Anyone signing in ONLY through the identity
                        // provider is locked out until the proof exists.
                        'Your domains are live on an attestation we made for ' +
                        'you, not on a DNS record. Turning single sign-on back ' +
                        'on needs a domain we have seen a record for, so this ' +
                        'cannot be undone here until you add that proof. ' +
                        'Anyone who signs in only through your identity ' +
                        'provider will have no way in. Add DNS proof first.'
                      : 'Your team will go back to signing in with a password. ' +
                        'Your identity pool and its accounts are kept, so you ' +
                        'can turn it back on without anyone losing their ' +
                        'account.',
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

          {/* The precondition, stated first — and now satisfiable two ways. */}
          <Alert
            severity={hasOutsideOwner || hasBreakGlass ? 'success' : 'info'}
          >
            {hasOutsideOwner
              ? 'Your organization keeps a way in that does not depend on ' +
                'your identity provider: ' +
                ownersOutsidePool
                  .map((owner) => owner.email ?? owner.uid)
                  .join(', ') +
                ` — owner${ownersOutsidePool.length > 1 ? 's' : ''} who sign ` +
                'in outside your identity pool. Enforcement never touches ' +
                'those accounts, so an expired certificate or a deleted ' +
                'application cannot lock your organization out of itself.'
              : hasBreakGlass
                ? `${savedBreakGlass.length} break-glass account(s) designated. ` +
                  'They keep their password even after enforcement, so a lapsed ' +
                  'certificate or a removed application in your identity ' +
                  'provider cannot lock your organization out of itself.'
                : 'Before you can enforce, your organization needs one way ' +
                  'in that survives your identity provider failing — an ' +
                  'expired certificate, a deleted application. Either an ' +
                  'owner who signs in outside your identity pool (they keep ' +
                  'their own password or social login, and enforcement never ' +
                  'touches them), or a break-glass account inside the pool ' +
                  'that keeps a password. Rehearse to see where you stand: ' +
                  'without one of the two, nobody could sign in and we could ' +
                  'not let you back in either.'}
          </Alert>
          {/*
            "We could not check" is not "you have nobody". Enforcement is
            refused either way, but only one of those is the org's problem to
            fix, and an error swallowed into an empty list reads exactly like
            the other one.
          */}
          {ownerCheckFailed ? (
            <Alert severity="warning">
              {'We could not finish checking whether your organization has an ' +
                'owner outside the identity pool, so enforcement is refused ' +
                'until we can. Nothing has changed. Rehearse again in a ' +
                'moment, and contact us if it keeps happening.'}
            </Alert>
          ) : null}
          {/*
            The refusal, rendered where it can be acted on (AGL-1888). The
            snackbar carries the sentence; this carries the LIST — which of
            the accounts you designated protects nothing. Naming an account
            whose only credential is the SAML link is the natural mistake,
            and it is invisible without this.
          */}
          {lockout && !lockout.safe && lockout.ineffective.length ? (
            <Alert severity="error">
              {'These designated accounts hold nothing but your identity ' +
                'provider, so they would be locked out along with everyone ' +
                'else: ' +
                lockout.ineffective
                  .map((uid) => emailForUid(uid) ?? uid)
                  .join(', ') +
                '. Pick an account that also has a password.'}
            </Alert>
          ) : null}
          {/*
            The honest empty state — now with something the admin can DO.

            A pool created by `provisionSsoPool` is made with
            `emailSignInConfig.enabled: false`, no console path can set a
            password on an account inside a pool (`/api/orgs/members/password`
            refuses on `tenantId`), and social logins cannot be linked to a
            governed account at all. So for an org whose pool we provisioned,
            EVERY account holds nothing but the SAML link and no tick in the
            table below can ever be effective.

            That used to end in "talk to us", which is the one shape a
            self-serve flow may not have. The way out (AGL-1888 option (a)) is
            an owner who is not in the pool at all, and making someone an owner
            is something the org does for itself — so this says so, rather than
            pointing at a checkbox that cannot be ticked.
          */}
          {preview && !eligibleBreakGlass.length && !hasOutsideOwner ? (
            <Alert severity="warning">
              {'No account in your identity pool can serve as break-glass: ' +
                'every one of them signs in through your identity provider ' +
                'and holds nothing else, which is exactly the credential ' +
                'that stops working in the situation break-glass is for. ' +
                'Give your organization an owner who signs in outside the ' +
                'pool instead — an owner whose email is not routed to your ' +
                'identity provider, with their own password or social login ' +
                '— then rehearse again. Enforcement stays unavailable until ' +
                'then, and the rehearsal costs nothing to re-run.'}
            </Alert>
          ) : null}

          <Stack direction="row" spacing={1}>
            <Button
              variant="outlined"
              disabled={busy || !canManage || !isActive}
              onClick={async () => {
                const result = await run({ action: 'enforce-preview' })
                if (result?.preview) {
                  setPreview(result.preview)
                  // The rehearsal carries the same assessment `enforce-apply`
                  // would refuse on, so it becomes the card's answer about
                  // where the org stands. One source, refreshed by the action
                  // that re-plans the pool — the alternative is a refusal
                  // banner that outlives the state it described.
                  setLockout(
                    (result.preview as EnforcementPreview).lockout ?? null,
                  )
                }
              }}
            >
              {'Rehearse'}
            </Button>
            <Button
              variant="contained"
              color="warning"
              disabled={
                busy ||
                !canManage ||
                !isActive ||
                sso.enforced ||
                // Either route out of the lockout will do, and with NEITHER
                // the refusal is certain — so it is stated above rather than
                // discovered by clicking. An owner outside the pool needs no
                // designation, which is why this is not just `hasBreakGlass`.
                (!hasBreakGlass && !hasOutsideOwner)
              }
              onClick={async () => {
                try {
                  await confirm({
                    title: 'Enforce single sign-on?',
                    description:
                      'Passwords and linked social logins will be removed from ' +
                      'every account in your identity pool, except the ' +
                      'break-glass accounts you designated. Accounts outside ' +
                      'the pool are not touched. Anyone who has only a pool ' +
                      'account will need your identity provider to get back ' +
                      'in. This cannot be undone by turning enforcement off.',
                    confirmationButtonProps: { color: 'warning' },
                  })
                } catch {
                  return
                }
                setBusy(true)
                try {
                  // NOT through `run()`: the refusal body is the point. A
                  // designation can be present and still protect nobody, and
                  // only the server knows which — it re-plans the whole pool
                  // to find out.
                  const result = await request(
                    { action: 'enforce-apply', confirm: true },
                    { keepErrorBody: true },
                  )
                  if (result && result.ok === false) {
                    setLockout((result.lockout as LockoutAssessment) ?? null)
                    return
                  }
                  if (result) {
                    setLockout(null)
                    enqueueSnackbar('Single sign-on enforced', {
                      variant: 'success',
                      persist: false,
                    })
                    await refresh()
                  }
                } finally {
                  setBusy(false)
                }
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
                <>
                  <Typography variant="body2" color="text.secondary">
                    {'Tick the accounts that should keep their password as a ' +
                      'way back in. Only an account that already has one ' +
                      'other than your identity provider can be ticked — ' +
                      'anything else would look like protection and provide ' +
                      'none.'}
                  </Typography>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell padding="checkbox">{'Break-glass'}</TableCell>
                        <TableCell>{'Account'}</TableCell>
                        <TableCell>{'Would lose'}</TableCell>
                        <TableCell>{'Keeps'}</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {preview.accounts.map((account) => {
                        const eligible = protectsIfDesignated(
                          account,
                          sso.providerId,
                        )
                        return (
                          <TableRow key={account.uid}>
                            <TableCell padding="checkbox">
                              <Checkbox
                                size="small"
                                // An account holding nothing but the SAML link
                                // cannot be a way back in when the SAML link
                                // is what stopped working. The server refuses
                                // it either way; disabling here means the
                                // admin never has to discover that by being
                                // refused.
                                disabled={busy || !canManage || !eligible}
                                checked={breakGlass.includes(account.uid)}
                                slotProps={{
                                  input: {
                                    'aria-label': `Break-glass: ${account.email ?? account.uid}`,
                                  },
                                }}
                                onChange={(event) =>
                                  setBreakGlass((current) =>
                                    event.target.checked
                                      ? [...new Set([...current, account.uid])]
                                      : current.filter(
                                          (uid) => uid !== account.uid,
                                        ),
                                  )
                                }
                              />
                            </TableCell>
                            <TableCell>{account.email ?? account.uid}</TableCell>
                            <TableCell>
                              {account.skipped === 'break-glass'
                                ? 'Nothing — designated break-glass'
                                : account.skipped
                                  ? 'Nothing — it would be left with no way in'
                                  : account.unlinked.join(', ') || '—'}
                            </TableCell>
                            <TableCell>{account.kept.join(', ') || '—'}</TableCell>
                          </TableRow>
                        )
                      })}
                    </TableBody>
                  </Table>
                  <Button
                    variant="outlined"
                    size="small"
                    disabled={busy || !canManage || !breakGlassDirty}
                    sx={{ alignSelf: 'flex-start' }}
                    onClick={async () => {
                      const saved = await run(
                        { action: 'set-break-glass', uids: breakGlass },
                        breakGlass.length
                          ? 'Break-glass accounts saved'
                          : 'Break-glass accounts cleared',
                      )
                      // A saved designation changes the plan, so the table on
                      // screen now describes a sweep that will not happen.
                      // Re-rehearse rather than leave a stale one that shows
                      // the designated account still losing its password.
                      if (saved) {
                        const again = await run({ action: 'enforce-preview' })
                        if (again?.preview) setPreview(again.preview)
                        setLockout(null)
                      }
                    }}
                  >
                    {'Save break-glass accounts'}
                  </Button>
                </>
              ) : null}
            </Stack>
          ) : null}
        </Stack>
      </Stack>
    </SsoCardShell>
  )
}

export default OrgSsoCard
