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

import { aiAddonName } from '@aglyn/aglyn'
import { buildRoute, Route } from '@aglyn/aglyn/app-utils/console-routes'
import { pluginDocsHelp } from '@aglyn/aglyn/app-utils/docs-help'
import { AppLink, CardDisplay } from '@aglyn/shared-ui-jsx'
import { useUser } from '@aglyn/tenant-feature-instance'
import { authorizedFetch } from '@aglyn/shared-util-http/authorized-token'
import {
  Alert,
  Chip,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material'
import { useEffect, useRef, useState } from 'react'
import type {
  StaffOrgAiJobs,
  StaffOrgAiMargin,
  StaffOrgAiOverage,
  StaffOrgAiPool,
  StaffOrgAiRefusals,
  StaffOrgAiResponse,
} from '../usage/staff-org-ai'

/**
 * THE STAFF AI CARD (AGL-2930): everything about one org's AI usage on the
 * page staff already open to look at that org.
 *
 * Read through `/api/ai/admin/org`, one request on mount. Every figure on it
 * is the route's, and every figure the route serves is composed from the
 * same helpers the meter refuses with — see `usage/staff-org-ai.ts`. This
 * file only lays them out.
 *
 * ## What each section is for
 *
 *  - **Add-on** — is the org paying for AI, at what, since when.
 *  - **Credit pool** — the band as three NAMED parts, because "why does
 *    this org have 13,000 credits" has three answers (the plan, an override,
 *    the add-on) and a single total cannot say which.
 *  - **Overage** — what is past the band, what it is sold at, and the two
 *    controls the org itself holds over it.
 *  - **Refusals** — how often, and why, the gate said no this month.
 *  - **Jobs** and **Top users** — the generative and per-person halves,
 *    each of which says plainly when its rollup has nothing yet.
 *  - **Margin** — spend against what AI brings in, red when it is over.
 *  - **Actions** — where the override editor and the AI pause live.
 */

const credits = (value: number | null | undefined): string =>
  value == null ? '—' : Math.round(value).toLocaleString()

/**
 * Four decimals under a dollar, two above (the assist-signals page's rule):
 * a month that really cost eight cents must not read as `$0.00`.
 */
const usd = (value: number | null | undefined): string => {
  if (value == null) return '—'
  const amount = Number(value) || 0
  return `$${amount.toFixed(Math.abs(amount) < 1 ? 4 : 2)}`
}

const when = (iso: string | null): string =>
  iso ? new Date(iso).toLocaleDateString() : '—'

/** The pool as one sentence naming every part that is non-zero. */
export function poolPartsSentence(pool: StaffOrgAiPool): string {
  const parts: string[] = []
  if (pool.overrideCredits !== null) {
    parts.push(`${credits(pool.overrideCredits)} staff override`)
  } else {
    parts.push(`${credits(pool.planCredits)} plan band`)
  }
  if (pool.addonCredits > 0) {
    parts.push(`${credits(pool.addonCredits)} ${aiAddonName()} add-on`)
  }
  return parts.join(' + ')
}

/** The overage's state as one line: sold, walled, or capped. */
export function overageStateSentence(overage: StaffOrgAiOverage): string {
  if (overage.hardCap) return 'Stopped at the band — the org’s band switch is on.'
  if (!overage.sellsOverage) return 'Not sold past the band on this plan.'
  const rate =
    overage.rateUsdPer1k === null ? '' : ` at ${usd(overage.rateUsdPer1k)} per 1,000`
  if (overage.capUsd !== null) {
    return overage.capReached
      ? `Stopped — the org’s ${usd(overage.capUsd)} overage ceiling is reached.`
      : `Sold${rate}, up to the org’s ${usd(overage.capUsd)} ceiling.`
  }
  return `Sold${rate}, no ceiling set.`
}

/** Whether the margin section renders red. */
export function marginTone(margin: StaffOrgAiMargin): 'error' | 'warning' | 'success' {
  if (margin.underwater) return 'error'
  if (margin.multiple >= 1) return 'warning'
  return 'success'
}

function RefusalsRow({ refusals }: { refusals: StaffOrgAiRefusals }) {
  const labels: Record<keyof Omit<StaffOrgAiRefusals, 'total'>, string> = {
    band: 'band',
    cap: 'ceiling',
    messages: 'messages',
    budget: 'operator backstop',
    // A hard allotment a manager set on a member, a collaborator or a site
    // (AGL-2942).
    allotment: 'allotments',
    // The Free taste's rungs (AGL-2925): only a Free workspace collects these.
    account: 'free account',
    requests: 'free requests/day',
    refusals: 'free refusals/day',
    platform: 'platform ceiling',
  }
  return (
    <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
      {(Object.keys(labels) as Array<keyof typeof labels>).map((reason) => {
        // A reason the answering server does not yet count reads as zero,
        // so a console newer than its route draws the row rather than
        // failing the card.
        const count = Number(refusals[reason] ?? 0)
        return (
          <Chip
            key={reason}
            size="small"
            variant={count > 0 ? 'filled' : 'outlined'}
            color={count > 0 ? 'warning' : 'default'}
            label={`${labels[reason]} ${count.toLocaleString()}`}
          />
        )
      })}
    </Stack>
  )
}

function JobsSection({ jobs }: { jobs: StaffOrgAiJobs | null }) {
  if (jobs === null) {
    return (
      <Alert severity="warning">
        {'Could not read the generation jobs — a failed read, not an idle org.'}
      </Alert>
    )
  }
  const total = Object.values(jobs.counts).reduce((sum, n) => sum + n, 0)
  if (total === 0) {
    return (
      <Typography variant="body2" color="text.secondary">
        {'No generation jobs yet.'}
      </Typography>
    )
  }
  return (
    <Stack spacing={1}>
      <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
        {(['queued', 'running', 'needs_input', 'failed'] as const).map((status) => (
          <Chip
            key={status}
            size="small"
            color={
              status === 'failed' && jobs.counts[status] > 0
                ? 'error'
                : status === 'needs_input' && jobs.counts[status] > 0
                  ? 'warning'
                  : 'default'
            }
            label={`${status.replace('_', ' ')} ${jobs.counts[status]}`}
          />
        ))}
        <Chip size="small" variant="outlined" label={`done ${jobs.counts.done}`} />
      </Stack>
      {jobs.truncated ? (
        <Typography variant="caption" color="text.secondary">
          {'Counted from the newest jobs only — these counts are a floor.'}
        </Typography>
      ) : null}
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>{'Job'}</TableCell>
            <TableCell>{'Kind'}</TableCell>
            <TableCell>{'Status'}</TableCell>
            <TableCell align="right">{'Credits'}</TableCell>
            <TableCell>{'Started'}</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {jobs.recent.map((job) => (
            <TableRow key={job.id}>
              <TableCell sx={{ fontFamily: 'monospace' }}>{job.id}</TableCell>
              <TableCell>{job.kind || '—'}</TableCell>
              <TableCell>{job.status.replace('_', ' ')}</TableCell>
              <TableCell align="right">
                {`${credits(job.creditsSpent)} / ${credits(job.creditsReserved)}`}
              </TableCell>
              <TableCell>
                {when(job.createdAt)}
                {job.createdBy ? (
                  <AppLink
                    href={buildRoute(Route.ADMIN_USER_DETAIL, { uid: job.createdBy })}
                    variant="caption"
                    underline="hover"
                    sx={{ ml: 1, fontFamily: 'monospace' }}
                  >
                    {job.createdBy}
                  </AppLink>
                ) : null}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Stack>
  )
}

const StaffOrgAiCard = ({ orgId }: { orgId: string }) => {
  const { data: user } = useUser()
  // Keyed on who is signed in, not on the user object's identity.
  const signedInUid = user?.uid ?? null
  const userRef = useRef(user)
  userRef.current = user
  const [data, setData] = useState<StaffOrgAiResponse | null>(null)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    // Mounted only for a confirmed staff reader — the `staffOrg` zone sits
    // inside the page's `StaffOnly`, which renders nothing while the claim
    // loads — because the route records an access row on every successful
    // open, and an open the page did not mean to make would be an access
    // nobody made.
    const user = userRef.current
    if (!orgId || !signedInUid || !user) return undefined
    let active = true
    setReady(false)
    setError(null)
    void (async () => {
      try {
        const response = await authorizedFetch(
          user,
          `/api/ai/admin/org?orgId=${encodeURIComponent(orgId)}`,
        )
        const payload = await response.json().catch(() => null)
        if (!active) return
        if (!response.ok) {
          setError(payload?.error ?? 'AI lookup failed')
          setData(null)
        } else {
          setData(payload as StaffOrgAiResponse)
        }
      } catch {
        if (active) {
          setError('AI lookup failed')
          setData(null)
        }
      } finally {
        if (active) setReady(true)
      }
    })()
    return () => {
      active = false
    }
  }, [orgId, signedInUid])

  const name = aiAddonName()
  return (
    <CardDisplay
      header={name}
      help={pluginDocsHelp('aiMonitoring', {
        anchor: '#the-ai-card',
        excerpt:
          'The add-on, the credit pool and its parts, this month’s overage and refusals, generation jobs, the people spending the most, and the margin — for this organization.',
      })}
      contentGutterX
      contentGutterY
    >
      {!ready ? (
        <Typography variant="body2" color="text.secondary">
          {'Loading…'}
        </Typography>
      ) : error || !data ? (
        <Alert severity="warning">
          {`Could not read this organization’s AI usage — ${error ?? 'a failed read'}, not zero usage.`}
        </Alert>
      ) : (
        <Stack spacing={2}>
          {/* Add-on */}
          <Stack spacing={0.5}>
            <Typography variant="overline" color="text.secondary">
              {'Add-on'}
            </Typography>
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
              <Chip
                size="small"
                color={data.addon.on ? 'primary' : 'default'}
                label={data.addon.on ? `${name} on` : `${name} off`}
              />
              {data.addon.priceUsd !== null ? (
                <Typography variant="body2">
                  {`${usd(data.addon.priceUsd)}/mo on this plan`}
                </Typography>
              ) : (
                <Typography variant="body2" color="text.secondary">
                  {'Not sold on this plan'}
                </Typography>
              )}
              {data.addon.on ? (
                <Typography variant="body2" color="text.secondary">
                  {data.addon.since
                    ? `since ${when(data.addon.since)}`
                    : data.addon.sinceSource === 'unavailable'
                      ? 'since — (Stripe not reachable)'
                      : 'since — (no subscription item)'}
                </Typography>
              ) : null}
            </Stack>
          </Stack>

          {/* Credit pool */}
          <Stack spacing={0.5}>
            <Typography variant="overline" color="text.secondary">
              {`Credit pool · ${data.month}`}
            </Typography>
            {data.pool.totalCredits === null ? (
              <Typography variant="body2" color="text.secondary">
                {'No AI credit band on this plan — bounded by the message cap and the operator backstop.'}
              </Typography>
            ) : (
              <Typography variant="body2">
                {`${credits(data.pool.totalCredits)} credits = ${poolPartsSentence(data.pool)}`}
              </Typography>
            )}
            <Typography variant="body2">
              {`Used ${credits(data.pool.usedCredits)} credits (${usd(data.pool.providerUsd)} provider spend)`}
              {data.pool.remainingCredits !== null
                ? ` · ${credits(data.pool.remainingCredits)} remaining`
                : ''}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {`Projected month-end at this pace: ${credits(data.pool.projectedCredits)} credits (${usd(data.pool.projectedUsd)}) · ${data.pool.messages.toLocaleString()} model turns, ${data.pool.deflected.toLocaleString()} answered from the docs`}
            </Typography>
          </Stack>

          {/* Overage */}
          <Stack spacing={0.5}>
            <Typography variant="overline" color="text.secondary">
              {'Overage'}
            </Typography>
            <Typography variant="body2">
              {`${credits(data.overage.overageCredits)} credits over the band · ${usd(data.overage.accruedUsd)} accrued`}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {overageStateSentence(data.overage)}
            </Typography>
          </Stack>

          {/* Refusals */}
          <Stack spacing={0.5}>
            <Typography variant="overline" color="text.secondary">
              {`Refusals this month · ${data.refusals.total.toLocaleString()}`}
            </Typography>
            <RefusalsRow refusals={data.refusals} />
          </Stack>

          {/* Jobs */}
          <Stack spacing={0.5}>
            <Typography variant="overline" color="text.secondary">
              {'Generation jobs'}
            </Typography>
            <JobsSection jobs={data.jobs} />
          </Stack>

          {/* Top users */}
          <Stack spacing={0.5}>
            <Typography variant="overline" color="text.secondary">
              {'Top users this month'}
            </Typography>
            {data.users.length === 0 ? (
              <Typography variant="body2" color="text.secondary">
                {'No AI usage attributed to a person this month.'}
              </Typography>
            ) : (
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>{'Person'}</TableCell>
                    <TableCell align="right">{'Credits'}</TableCell>
                    <TableCell align="right">{'Share'}</TableCell>
                    <TableCell align="right">{'Provider $'}</TableCell>
                    <TableCell align="right">{'Requests'}</TableCell>
                    <TableCell align="right">{'Refusals'}</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {data.users.map((row) => (
                    <TableRow key={row.uid}>
                      <TableCell>
                        <AppLink
                          href={buildRoute(Route.ADMIN_USER_DETAIL, { uid: row.uid })}
                          underline="hover"
                        >
                          {row.name}
                        </AppLink>
                        {/* The uid beside the name, because the name is the
                            roster's and two people can share one. */}
                        {row.name !== row.uid ? (
                          <Typography
                            variant="caption"
                            color="text.secondary"
                            component="div"
                            sx={{ fontFamily: 'monospace' }}
                          >
                            {row.uid}
                          </Typography>
                        ) : null}
                      </TableCell>
                      <TableCell align="right">{credits(row.credits)}</TableCell>
                      <TableCell align="right">{`${Math.round(row.share * 100)}%`}</TableCell>
                      <TableCell align="right">{usd(row.estCostUsd)}</TableCell>
                      <TableCell align="right">{row.requests.toLocaleString()}</TableCell>
                      <TableCell align="right">{row.refusals.toLocaleString()}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Stack>

          {/* Margin */}
          <Stack spacing={0.5}>
            <Typography variant="overline" color="text.secondary">
              {'Margin'}
            </Typography>
            <Alert severity={marginTone(data.margin)}>
              {`Spend ${usd(data.margin.spendUsd)} against ${usd(data.margin.revenueUsd)} in — ` +
                `${usd(data.margin.addonRevenueUsd)} add-on, ${usd(data.margin.planAssistShareUsd)} plan assist share, ` +
                `${usd(data.margin.overageRevenueUsd)} overage.`}
              {data.margin.underwater
                ? ' Spend exceeds the add-on plus the plan’s assist share.'
                : ''}
              {data.margin.multiple >= 1
                ? ` ${data.margin.multiple}× the ${usd(data.margin.thresholdUsd)} staff review threshold.`
                : ''}
            </Alert>
            {data.margin.contribution.marginPct !== null ? (
              <Typography variant="caption" color="text.secondary">
                {`Whole-org contribution margin ${Math.round(data.margin.contribution.marginPct * 100)}% on the ${data.margin.contribution.month} rollup with this month’s AI spend.`}
              </Typography>
            ) : null}
          </Stack>

          {/* Actions */}
          <Stack spacing={0.5}>
            <Typography variant="overline" color="text.secondary">
              {'Actions'}
            </Typography>
            <Typography variant="body2">
              {'Credit override and feature toggles: '}
              <AppLink href={buildRoute(Route.ADMIN_ORGS)} underline="hover">
                {'the entitlement override editor'}
              </AppLink>
              {' (also under Staff actions above). Pause AI for this org: '}
              <AppLink href={buildRoute(Route.ADMIN_LOCKDOWN)} underline="hover">
                {'Lockdown'}
              </AppLink>
              {', feature keys ai-assist and ai-generate scoped to the org.'}
            </Typography>
          </Stack>
        </Stack>
      )}
    </CardDisplay>
  )
}
StaffOrgAiCard.displayName = 'StaffOrgAiCard'

export default StaffOrgAiCard
