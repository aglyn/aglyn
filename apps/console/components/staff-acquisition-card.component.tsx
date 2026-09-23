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
  describeAccountAcquisition,
  providerLabel,
  type AccountAcquisition,
  type AcquisitionDoor,
} from '@aglyn/aglyn/app-utils/account-acquisition'
import { PLATFORM_HOME_URL } from '@aglyn/aglyn/app-utils/platform-brand'
import type { AcquisitionChannel } from '@aglyn/shared-util-first-touch'
import { AppLink, CardDisplay } from '@aglyn/shared-ui-jsx'
import { authorizedFetch } from '@aglyn/shared-util-http/authorized-token'
import { useUser } from '@aglyn/tenant-feature-instance'
import { Alert, Chip, Divider, Stack, Typography } from '@mui/material'
import { useEffect, useState, type ReactNode } from 'react'
import { docsHelp } from '../constants/docs-links'
import { buildRoute, Route } from '../constants/route-links'
import type { StaffAcquisitionView } from '../utils/staff-acquisition'

/**
 * WHERE AN ACCOUNT CAME FROM, on the staff user and organization pages
 * (AGL-3289).
 *
 * One card instead of five tools: the record the platform wrote when the
 * account was created, said first as one sentence and then field by field,
 * the account's newest sign-in, and whether the sales workspace already knew
 * the person. On an organization's page it is the record of the account that
 * created the workspace, and says so.
 *
 * ## Loading is a state, and so is "could not check"
 *
 * Nothing renders as an answer until the route has answered. The cross-check
 * keeps three outcomes apart — found, not found, and could not ask — because
 * "not in the CRM" read off a check that never ran is the kind of confident
 * wrong answer that sends sales after nobody.
 */

const CHANNEL_LABELS: Record<AcquisitionChannel, string> = {
  'organic-search': 'Organic search',
  'paid-search': 'Paid search',
  social: 'Social',
  referral: 'Referral',
  email: 'Email',
  direct: 'Direct',
  unknown: 'Unknown',
}

const DOOR_LABELS: Record<AcquisitionDoor, string> = {
  'signup-password': 'Sign-up form, password',
  'signup-google': 'Sign-up form, Google',
  invite: 'Invitation',
  sso: 'Single sign-on',
  unknown: 'Unknown',
}

function primaryHost(): string | null {
  try {
    return PLATFORM_HOME_URL ? new URL(PLATFORM_HOME_URL).hostname : null
  } catch {
    return null
  }
}

function when(ms: number | null | undefined): string {
  if (!ms) return '—'
  try {
    return new Date(ms).toLocaleString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    })
  } catch {
    return '—'
  }
}

function place(geo: AccountAcquisition['geo']): string {
  if (!geo) return 'Not reported'
  return [geo.city, geo.region, geo.country].filter(Boolean).join(', ') || 'Not reported'
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={{ xs: 0, sm: 2 }}>
      <Typography variant="body2" color="text.secondary" sx={{ minWidth: 150, flexShrink: 0 }}>
        {label}
      </Typography>
      <Typography variant="body2" component="div" sx={{ wordBreak: 'break-word' }}>
        {children}
      </Typography>
    </Stack>
  )
}

function Record({ view }: { view: StaffAcquisitionView }) {
  const record = view.acquisition
  if (!record) {
    return (
      <Typography variant="body2" color="text.secondary">
        {'No acquisition record yet. Accounts created before capture existed are ' +
          'stamped by the backfill; until then there is nothing to read.'}
      </Typography>
    )
  }
  const utmExtras = [
    record.utm?.content ? `content: ${record.utm.content}` : null,
    record.utm?.term ? `term: ${record.utm.term}` : null,
  ].filter(Boolean)
  return (
    <Stack spacing={1}>
      <Row label="Channel">{CHANNEL_LABELS[record.channel] ?? record.channel}</Row>
      <Row label="Source / medium">
        {record.medium ? `${record.source} / ${record.medium}` : record.source}
      </Row>
      {record.campaign ? <Row label="Campaign">{record.campaign}</Row> : null}
      {utmExtras.length ? <Row label="Other tags">{utmExtras.join(' · ')}</Row> : null}
      <Row label="Landing page">
        {record.landing ? `${record.landing.host}${record.landing.path}` : '—'}
      </Row>
      <Row label="Referrer">{record.referrerHost ?? 'None'}</Row>
      {record.viaHost ? (
        <Row label="Arrived from">
          {`${record.viaHost} — one of our own hosts that does not capture yet`}
        </Row>
      ) : null}
      <Row label="Ad click ids">
        {record.clickIds.length ? (
          <Stack direction="row" spacing={0.5}>
            {record.clickIds.map((id) => (
              <Chip key={id} size="small" label={id} />
            ))}
          </Stack>
        ) : (
          'None'
        )}
      </Row>
      <Row label="Door">
        {[DOOR_LABELS[record.door], providerLabel(record.provider)].filter(Boolean).join(' · ')}
      </Row>
      {record.invitedToOrgId ? (
        <Row label="Invited to">
          <AppLink href={buildRoute(Route.ADMIN_ORG_DETAIL, { orgId: record.invitedToOrgId })}>
            {record.invitedToOrgId}
          </AppLink>
        </Row>
      ) : null}
      <Row label="First visit">{when(record.capturedAt)}</Row>
      <Row label="Account created">{when(view.subject.createdAtMs ?? record.recordedAt)}</Row>
      <Row label={record.recordedBy === 'backfill' ? 'First device, last seen' : 'Signed up from'}>
        {place(record.geo)}
      </Row>
      <Row label="Latest sign-in">
        {view.latestSignIn
          ? `${view.latestSignIn.location ?? 'Unknown location'} · ${when(view.latestSignIn.atMs)}`
          : '—'}
      </Row>
      {view.cityLevel ? null : (
        <Typography variant="caption" color="text.secondary">
          {'Locations show the country only; the region and city need the super staff role.'}
        </Typography>
      )}
      {view.scope === 'org' && view.subject.uid ? (
        <Row label="Record of">
          <AppLink href={buildRoute(Route.ADMIN_USER_DETAIL, { uid: view.subject.uid })}>
            {view.subject.email ?? view.subject.uid}
          </AppLink>
          {' — the account that created this workspace'}
        </Row>
      ) : null}
    </Stack>
  )
}

function CrossCheck({ view }: { view: StaffAcquisitionView }) {
  const { matches } = view
  const workspace = matches.workspace?.name ?? 'the sales workspace'
  if (matches.status === 'unconfigured') {
    return (
      <Typography variant="body2" color="text.secondary">
        {'No sales workspace is configured (PLATFORM_MARKETING_HOST_ID), so no CRM was checked.'}
      </Typography>
    )
  }
  if (matches.status === 'no-matchers') {
    return (
      <Typography variant="body2" color="text.secondary">
        {`No plugin that keeps people is active for ${workspace}, so nothing was checked.`}
      </Typography>
    )
  }
  const certain = matches.items.filter((match) => match.basis === 'email')
  const possible = matches.items.filter((match) => match.basis === 'name')
  return (
    <Stack spacing={1}>
      {matches.failed.length ? (
        <Alert severity="warning">
          {`Could not check ${matches.failed.join(', ')} — an absence below is not an answer for ${
            matches.failed.length === 1 ? 'it' : 'them'
          }.`}
        </Alert>
      ) : null}
      {!matches.items.length ? (
        <Typography variant="body2" color="text.secondary">
          {`Not known to ${workspace} by this address or by a similar name.`}
        </Typography>
      ) : null}
      {[...certain, ...possible].map((match) => (
        <Stack
          key={`${match.pluginId}:${match.kind}:${match.id}`}
          direction="row"
          spacing={1}
          sx={{ alignItems: 'baseline' }}
        >
          <Chip
            size="small"
            color={match.basis === 'email' ? 'primary' : 'default'}
            variant={match.basis === 'email' ? 'filled' : 'outlined'}
            label={match.basis === 'email' ? 'Same address' : 'Possible'}
          />
          <Typography variant="body2" component="div">
            {match.href ? <AppLink href={match.href}>{match.label}</AppLink> : match.label}
            {` · ${match.kind}`}
            {match.email && match.email !== view.subject.email ? ` · ${match.email}` : ''}
            {match.firstSeenAtMs ? ` · known since ${when(match.firstSeenAtMs)}` : ''}
            {match.sources.length ? ` · via ${match.sources.join(', ')}` : ''}
          </Typography>
        </Stack>
      ))}
    </Stack>
  )
}

export interface StaffAcquisitionCardProps {
  /** The account to read; pass this or `orgId`. */
  uid?: string
  /** The workspace to read, which carries its creator's record. */
  orgId?: string
}

export default function StaffAcquisitionCard({ uid, orgId }: StaffAcquisitionCardProps) {
  const { data: user } = useUser()
  const [view, setView] = useState<StaffAcquisitionView | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!user || (!uid && !orgId)) return
    let cancelled = false
    const query = uid ? `uid=${encodeURIComponent(uid)}` : `orgId=${encodeURIComponent(String(orgId))}`
    void (async () => {
      try {
        const response = await authorizedFetch(user, `/api/admin/acquisition?${query}`)
        const payload = await response.json().catch(() => ({}))
        if (cancelled) return
        if (!response.ok) {
          setError(payload?.error ?? 'Could not load where this account came from')
          return
        }
        setError(null)
        setView(payload as StaffAcquisitionView)
      } catch {
        if (!cancelled) setError('Could not load where this account came from')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [user, uid, orgId])

  const help = docsHelp('staffConsole', {
    anchor: '#acquisition',
    excerpt:
      'Where the account came from: the first visit, the door it signed up ' +
      'through, and whether the sales workspace already knew the person.',
  })

  return (
    <CardDisplay header="Acquisition" help={help} contentGutterX contentGutterY>
      {error ? (
        <Alert severity="warning">{error}</Alert>
      ) : !view ? (
        <Typography variant="body2" color="text.secondary">
          {'Loading…'}
        </Typography>
      ) : (
        <Stack spacing={2}>
          <Typography variant="subtitle1">
            {describeAccountAcquisition(view.acquisition, { primaryHost: primaryHost() })}
          </Typography>
          <Record view={view} />
          <Divider />
          <Typography variant="subtitle2">{'Already known?'}</Typography>
          <CrossCheck view={view} />
        </Stack>
      )}
    </CardDisplay>
  )
}
