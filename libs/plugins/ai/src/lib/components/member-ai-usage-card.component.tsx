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

import { aiAddonName, aiUsageMonthKeys, topAiUsageKinds } from '@aglyn/aglyn'
import { buildRoute, Route } from '@aglyn/aglyn/app-utils/console-routes'
import { pluginDocsHelp } from '@aglyn/aglyn/app-utils/docs-help'
import { AppLink, CardDisplay } from '@aglyn/shared-ui-jsx'
import { authorizedFetch } from '@aglyn/shared-util-http/authorized-token'
import { useUser } from '@aglyn/tenant-feature-instance'
import {
  Alert,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  aiUsageMonthLabel,
  formatAiUsageShare,
  type UserAiUsageMonthWire,
  type UserAiUsageWire,
} from '../usage/ai-usage-wire'

export interface MemberAiUsageCardProps {
  orgId: string
  uid: string
  orgSlug?: string
  /** The org's sites, for naming the per-site split. */
  hosts?: ReadonlyArray<{ $id: string; displayName?: string; subdomain?: string }>
}

/**
 * ONE MEMBER'S AI USAGE (AGL-2928) — this month and last, on their page.
 *
 * Credits and the share of the workspace's pool, requests, the kinds they
 * mostly asked for, and the split by site — the agency question, answered
 * for one person. Read through `/api/ai/usage?uid=`, which admits the
 * person themselves and members holding `billing.view` or `org.auditLog`.
 *
 * A refusal renders NOTHING rather than a warning: the page is open to a
 * manager who may not hold either permission, and for them an absent card
 * is the correct answer, not a broken one.
 */
export function MemberAiUsageCard(props: MemberAiUsageCardProps) {
  const { orgId, uid } = props
  const orgSlug = props.orgSlug ?? ''
  const hosts = props.hosts ?? []
  const { data: user } = useUser()
  // Keyed on who is signed in, not on the user object's identity (AGL-2928).
  const signedInUid = user?.uid ?? null
  const userRef = useRef(user)
  userRef.current = user
  const [state, setState] = useState<{
    status: 'loading' | 'ready' | 'refused' | 'error'
    months: UserAiUsageMonthWire[]
  }>({ status: 'loading', months: [] })
  const name = aiAddonName()
  const [thisMonth, lastMonth] = useMemo(() => aiUsageMonthKeys(new Date(), 2), [])

  useEffect(() => {
    const user = userRef.current
    if (!orgId || !uid || !signedInUid || !user) return undefined
    let active = true
    void (async () => {
      try {
        const params = new URLSearchParams({ orgId, uid, limit: '2' })
        const response = await authorizedFetch(
          user,
          `/api/ai/usage?${params.toString()}`,
        )
        if (!active) return
        if (response.status === 403) {
          setState({ status: 'refused', months: [] })
          return
        }
        const payload = (await response.json().catch(() => null)) as UserAiUsageWire | null
        if (!active) return
        if (!response.ok || !payload) {
          setState({ status: 'error', months: [] })
          return
        }
        setState({ status: 'ready', months: payload.months })
      } catch {
        if (active) setState({ status: 'error', months: [] })
      }
    })()
    return () => {
      active = false
    }
  }, [orgId, uid, signedInUid])

  if (state.status === 'refused') return null

  const hostName = (hostId: string) => {
    const host = hosts.find((entry) => entry.$id === hostId)
    return host?.displayName ?? host?.subdomain ?? hostId
  }
  const byMonth = new Map(state.months.map((entry) => [entry.month, entry]))
  const shown = [thisMonth, lastMonth].map(
    (month) =>
      byMonth.get(month) ?? {
        month,
        credits: 0,
        share: 0,
        requests: 0,
        refusals: 0,
        byKind: {},
        byHost: {},
      },
  )
  const sites = shown.flatMap((entry) =>
    Object.entries(entry.byHost).map(([hostId, credits]) => ({
      month: entry.month,
      hostId,
      credits,
    })),
  )

  return (
    <CardDisplay
      header={'AI usage'}
      help={pluginDocsHelp('inviteTeammates', {
        anchor: '#ai-usage',
        excerpt:
          `This member's ${name} credits this month and last, their share of the workspace's pool, and the split by site and by kind.`,
      })}
      contentGutterX
      contentGutterY
    >
      {state.status === 'error' ? (
        <Alert severity="warning">
          {'Could not read this member’s AI usage — a failed read, not zero usage.'}
        </Alert>
      ) : state.status === 'loading' ? (
        <Typography variant="body2" color="text.secondary">
          {'Loading…'}
        </Typography>
      ) : (
        <Stack spacing={1.5}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>{'Month'}</TableCell>
                <TableCell align="right">{'Credits'}</TableCell>
                <TableCell align="right">{'Share of pool'}</TableCell>
                <TableCell align="right">{'Requests'}</TableCell>
                <TableCell>{'Mostly'}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {shown.map((entry) => (
                <TableRow key={entry.month}>
                  <TableCell>{aiUsageMonthLabel(entry.month)}</TableCell>
                  <TableCell align="right">{entry.credits.toLocaleString()}</TableCell>
                  <TableCell align="right">{formatAiUsageShare(entry.share)}</TableCell>
                  <TableCell align="right">{entry.requests.toLocaleString()}</TableCell>
                  <TableCell>
                    {topAiUsageKinds(entry.byKind, 3)
                      .map((kind) => `${kind.kind} ${kind.credits.toLocaleString()}`)
                      .join(', ') || '—'}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {sites.length ? (
            <Stack spacing={0.5}>
              <Typography variant="caption" color="text.secondary">
                {'By site'}
              </Typography>
              {sites.map((entry) => (
                <Typography key={`${entry.month}-${entry.hostId}`} variant="body2">
                  {`${hostName(entry.hostId)} — ${entry.credits.toLocaleString()} credits in ${aiUsageMonthLabel(entry.month)}`}
                </Typography>
              ))}
            </Stack>
          ) : null}
          <Typography variant="caption" color="text.secondary">
            {'Every member for the month is on '}
            <AppLink href={buildRoute(Route.MANAGE_BILLING_USAGE, { orgSlug })}>
              {'Billing → Usage'}
            </AppLink>
            {'.'}
          </Typography>
        </Stack>
      )}
    </CardDisplay>
  )
}
MemberAiUsageCard.displayName = 'MemberAiUsageCard'

export default MemberAiUsageCard
