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

import {
  bundleDomainLine,
  describeBundle,
  normalizeBundleDomain,
} from '@aglyn/aglyn/app-utils/bundle-intent'
import type { ClientBuildIntent } from '@aglyn/aglyn/app-utils/client-build'
import { mdiContentCopy, mdiQrcode } from '@aglyn/shared-data-mdi'
import { CardDisplay } from '@aglyn/shared-ui-jsx'
import { MdiIcon } from '@aglyn/shared-ui-jsx/components/mdi-icon'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { authorizedFetch } from '@aglyn/shared-util-http/authorized-token'
import { useUser } from '@aglyn/tenant-feature-instance'
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  InputAdornment,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { QRCodeSVG } from 'qrcode.react'
import { type FocusEvent, useEffect, useState } from 'react'
import { docsHelp } from '../constants/docs-links'
import {
  bundleDraftBody,
  DEFAULT_BUNDLE_DRAFT,
  StaffBundleFields,
  type BundleDraft,
} from './staff-bundle-fields.component'

/** A domain chosen with the owner, as staff type it from the registrar's search. */
export interface BundleDomainDraft {
  name: string
  /** Dollars, as typed. */
  firstYear: string
  renewal: string
  hostId: string
}

export const EMPTY_BUNDLE_DOMAIN: BundleDomainDraft = {
  name: '',
  firstYear: '',
  renewal: '',
  hostId: '',
}

/** A site a domain can be for. */
export interface BundleSiteOption {
  hostId: string
  name: string
}

const toCents = (dollars: string): number => Math.round(Number(dollars.replace(/[$,\s]/g, '')) * 100)

/** The domain as the mint route takes it, or null when none is chosen. */
export function bundleDomainBody(domain: BundleDomainDraft | null | undefined) {
  if (!domain?.name.trim()) return null
  return {
    name: domain.name.trim(),
    firstYearCents: toCents(domain.firstYear),
    renewalCents: toCents(domain.renewal),
    hostId: domain.hostId,
  }
}

/** Why a typed domain cannot go on a link yet, or null when it can (or none is typed). */
export function bundleDomainProblem(domain: BundleDomainDraft | null | undefined): string | null {
  if (!domain?.name.trim()) return null
  if (!normalizeBundleDomain(domain.name)) return 'Enter a domain name, like example.com'
  if (!(toCents(domain.firstYear) > 0) || !(toCents(domain.renewal) > 0)) {
    return 'Enter both prices from the domain search'
  }
  if (!domain.hostId) return 'Choose the site the domain is for'
  return null
}

/**
 * The domain line a build for a client left for its hand-off (AGL-3958): the
 * name the owner picked to register, with both prices its search quoted, for
 * the site the build made (`hostId`, empty when that site is not one staff
 * can pick here). A domain the owner already has is connected rather than
 * bought, so it puts nothing on the link, and neither does no domain at all.
 */
export function bundleDomainFromClientBuildIntent(
  intent: Pick<ClientBuildIntent, 'domain'> | null | undefined,
  hostId?: string | null,
): BundleDomainDraft {
  const domain = intent?.domain
  if (!domain) return EMPTY_BUNDLE_DOMAIN
  return {
    name: domain.name,
    firstYear: domain.firstYearUsd.toFixed(2),
    renewal: domain.renewalUsd.toFixed(2),
    hostId: hostId ?? '',
  }
}

/**
 * Whether this deployment sells domains, from the mint route; null while the
 * answer is on its way. The domain fields wait on it rather than offering a
 * line the link could not carry.
 */
export function useDomainsAvailable(): boolean | null {
  const { data: user } = useUser()
  const [available, setAvailable] = useState<boolean | null>(null)
  useEffect(() => {
    if (!user) return
    let cancelled = false
    void authorizedFetch(user, '/api/admin/bundle-link', { method: 'GET' })
      .then((response) => response.json().catch(() => ({})))
      .then((payload) => {
        if (!cancelled) setAvailable(payload?.domainsAvailable === true)
      })
      .catch(() => {
        if (!cancelled) setAvailable(false)
      })
    return () => {
      cancelled = true
    }
  }, [user])
  return available
}

export interface StaffBundleDomainFieldsProps {
  value: BundleDomainDraft
  onChange: (next: BundleDomainDraft) => void
  sites: readonly BundleSiteOption[]
  /** From {@link useDomainsAvailable}. */
  available: boolean | null
  disabled?: boolean
}

/**
 * The optional domain line of a bundle link (AGL-3955): a name searched with
 * the owner on the site's Custom Domain page, and the prices that search
 * quoted. The owner buys it themselves after subscribing, on their own phone;
 * the purchase re-checks the price. Shown disabled with the reason on a
 * deployment that does not sell domains yet.
 */
export function StaffBundleDomainFields(props: StaffBundleDomainFieldsProps) {
  const { value, onChange, sites, available, disabled } = props
  const off = disabled || available !== true
  const set = (patch: Partial<BundleDomainDraft>) => onChange({ ...value, ...patch })
  const problem = bundleDomainProblem(value)
  return (
    <Stack spacing={1.5}>
      <Typography variant="overline" color="text.secondary">
        {'Domain (optional)'}
      </Typography>
      {available === false ? (
        <Alert severity="info">
          {'Buying a domain is not live on this deployment yet, so a link cannot ' +
            'carry one. The site hands off on its free address.'}
        </Alert>
      ) : null}
      <TextField
        size="small"
        label="Domain name"
        placeholder="example.com"
        value={value.name}
        disabled={off}
        onChange={(event) => set({ name: event.target.value.trim().toLowerCase() })}
        error={!!problem && !!value.name}
        helperText={
          problem ?? 'Search it on the site’s Custom Domain page first; the price is checked again at purchase.'
        }
      />
      <Stack direction="row" spacing={1.5}>
        <TextField
          size="small"
          label="First year"
          value={value.firstYear}
          disabled={off}
          onChange={(event) => set({ firstYear: event.target.value })}
          slotProps={{ input: { startAdornment: <InputAdornment position="start">{'$'}</InputAdornment> } }}
          sx={{ flex: 1 }}
        />
        <TextField
          size="small"
          label="Renews yearly at"
          value={value.renewal}
          disabled={off}
          onChange={(event) => set({ renewal: event.target.value })}
          slotProps={{ input: { startAdornment: <InputAdornment position="start">{'$'}</InputAdornment> } }}
          sx={{ flex: 1 }}
        />
      </Stack>
      <TextField
        select
        size="small"
        label="For the site"
        value={value.hostId}
        disabled={off || sites.length === 0}
        onChange={(event) => set({ hostId: event.target.value })}
        helperText={sites.length === 0 ? 'This workspace has no site yet.' : undefined}
      >
        {sites.map((site) => (
          <MenuItem key={site.hostId} value={site.hostId}>
            {site.name}
          </MenuItem>
        ))}
      </TextField>
    </Stack>
  )
}

interface MintedLink {
  url: string
  expiresAt: number
  summary: string
  domainLine: string | null
}

export interface StaffBundleLinkActionsProps {
  orgId: string
  draft: BundleDraft
  domain?: BundleDomainDraft | null
  /** Why no link can be made right now; the buttons show disabled with it. */
  disabledReason?: string | null
}

/**
 * "Copy bundle link" and "QR", for a card or a dialog header (AGL-3955).
 * Each press mints a fresh link through `/api/admin/bundle-link` — one
 * workspace, 24 hours, audited with the staff member's uid — so a link is
 * never shown that the record does not stand behind.
 */
export function StaffBundleLinkActions(props: StaffBundleLinkActionsProps) {
  const { orgId, draft, domain, disabledReason } = props
  const { data: user } = useUser()
  const { enqueueSnackbar } = useSnackbar()
  const [busy, setBusy] = useState(false)
  const [shown, setShown] = useState<MintedLink | null>(null)
  const domainProblem = bundleDomainProblem(domain)
  const blocked = disabledReason || domainProblem

  const mint = async (): Promise<MintedLink | null> => {
    setBusy(true)
    try {
      const response = await authorizedFetch(user, '/api/admin/bundle-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orgId,
          ...bundleDraftBody(draft),
          ...(bundleDomainBody(domain) ? { domain: bundleDomainBody(domain) } : {}),
        }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok || typeof payload?.url !== 'string') {
        enqueueSnackbar(payload?.error ?? 'The bundle link could not be made', {
          variant: 'warning',
          persist: false,
        })
        return null
      }
      if (Array.isArray(payload.droppedAddons) && payload.droppedAddons.length) {
        enqueueSnackbar('Some add-ons are not sold on this plan and were left off the link', {
          variant: 'info',
          persist: false,
        })
      }
      return {
        url: payload.url,
        expiresAt: Number(payload.expiresAt ?? 0),
        summary: describeBundle({
          plan: payload.intent?.plan ?? draft.plan,
          addons: payload.intent?.addons ?? null,
          interval: payload.intent?.interval ?? null,
          coupon: payload.intent?.coupon ?? null,
        }),
        domainLine: payload.domain ? bundleDomainLine(payload.domain) : null,
      }
    } finally {
      setBusy(false)
    }
  }

  const copy = async () => {
    const minted = await mint()
    if (!minted) return
    try {
      await navigator.clipboard.writeText(minted.url)
      enqueueSnackbar('Bundle link copied. It works for 24 hours.', {
        variant: 'success',
        persist: false,
      })
    } catch {
      // A browser that refuses the clipboard still gets the link, on screen.
      setShown(minted)
    }
  }

  const showQr = async () => {
    const minted = await mint()
    if (minted) setShown(minted)
  }

  return (
    <>
      <Stack direction="row" spacing={1} title={blocked || undefined}>
        <Button
          size="small"
          variant="outlined"
          disabled={busy || !!blocked}
          startIcon={<MdiIcon path={mdiContentCopy.path} fontSize="small" />}
          onClick={() => void copy()}
        >
          {'Copy bundle link'}
        </Button>
        <Button
          size="small"
          variant="contained"
          disabled={busy || !!blocked}
          startIcon={<MdiIcon path={mdiQrcode.path} fontSize="small" />}
          onClick={() => void showQr()}
        >
          {'QR'}
        </Button>
      </Stack>
      <Dialog open={!!shown} onClose={() => setShown(null)} maxWidth="xs" fullWidth>
        <DialogTitle>{'Scan to subscribe'}</DialogTitle>
        <DialogContent>
          {shown ? (
            <Stack spacing={2} sx={{ pt: 1 }}>
              <DialogContentText>
                {'The owner scans this with their phone, signs in, and Billing opens with ' +
                  'everything chosen. One tap pays with the card they add.'}
              </DialogContentText>
              <Box
                sx={{
                  display: 'flex',
                  justifyContent: 'center',
                  bgcolor: 'common.white',
                  borderRadius: 1,
                  py: 1,
                }}
              >
                <QRCodeSVG
                  value={shown.url}
                  size={240}
                  level="M"
                  marginSize={2}
                  title="Bundle checkout link QR code"
                  role="img"
                />
              </Box>
              <Typography variant="subtitle2">{shown.summary}</Typography>
              {shown.domainLine ? (
                <Typography variant="body2" color="text.secondary">
                  {`Domain: ${shown.domainLine}`}
                </Typography>
              ) : null}
              <TextField
                size="small"
                label="Link"
                value={shown.url}
                fullWidth
                slotProps={{
                  input: { readOnly: true },
                  htmlInput: { onFocus: (event: FocusEvent<HTMLInputElement>) => event.target.select() },
                }}
              />
              <Typography variant="caption" color="text.secondary">
                {`Works until ${new Date(shown.expiresAt).toLocaleString()}.`}
              </Typography>
            </Stack>
          ) : null}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setShown(null)}>{'Done'}</Button>
        </DialogActions>
      </Dialog>
    </>
  )
}

export interface StaffBundleLinkCardProps {
  orgId: string
  sites: readonly BundleSiteOption[]
  /** The workspace already pays: a link would open a checkout it refuses. */
  subscriptionLive?: boolean
}

/**
 * The staff organization page's bundle link card (AGL-3955): choose the
 * bundle, then copy the link or show its QR from the card header.
 */
export function StaffBundleLinkCard({ orgId, sites, subscriptionLive }: StaffBundleLinkCardProps) {
  const [draft, setDraft] = useState<BundleDraft>(DEFAULT_BUNDLE_DRAFT)
  const [domain, setDomain] = useState<BundleDomainDraft>(EMPTY_BUNDLE_DOMAIN)
  const available = useDomainsAvailable()
  const disabledReason = subscriptionLive
    ? 'This workspace already has a live subscription; change its plan from Billing.'
    : null
  return (
    <CardDisplay
      header={'Bundle checkout link'}
      subheader={'Plan, add-ons, cadence and coupon chosen for the owner, one tap from paid.'}
      help={docsHelp('staffConsole', { anchor: '#bundle-link' })}
      HeaderProps={{
        action: (
          <StaffBundleLinkActions
            orgId={orgId}
            draft={draft}
            domain={domain}
            disabledReason={disabledReason}
          />
        ),
      }}
      contentGutterX
      contentGutterY
    >
      <Stack spacing={2}>
        {disabledReason ? <Alert severity="info">{disabledReason}</Alert> : null}
        <StaffBundleFields value={draft} onChange={setDraft} disabled={!!disabledReason} />
        <StaffBundleDomainFields
          value={domain}
          onChange={setDomain}
          sites={sites}
          available={available}
          disabled={!!disabledReason}
        />
      </Stack>
    </CardDisplay>
  )
}

export default StaffBundleLinkCard
