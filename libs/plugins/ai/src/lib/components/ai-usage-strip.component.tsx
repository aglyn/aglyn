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

import { buildRoute, Route } from '@aglyn/aglyn/app-utils/console-routes'
import { pluginDocsHelp } from '@aglyn/aglyn/app-utils/docs-help'
import { AppLink, HelpTip } from '@aglyn/shared-ui-jsx'
import { Box, LinearProgress, Stack, Typography } from '@mui/material'
import type { AiUsageMeterWire } from '../usage/ai-usage-wire'
import { useAiUsageMeter } from './use-ai-usage-meter'

export interface AiUsageStripProps {
  /** The workspace the strip speaks for; nothing renders without one. */
  orgId?: string | null
  /** For the link to who can raise an allotment; the link is omitted without it. */
  orgSlug?: string | null
}

const credits = (value: number): string => value.toLocaleString()

/** The usage line's own section of the allotments guide (AGL-3660). */
const AI_USAGE_STRIP_HELP = pluginDocsHelp('aiAllotments', {
  anchor: '#usage-strip',
  excerpt:
    'Your credits this month against your allotment, the workspace pool, and what your last request cost. It warns from 80%.',
})

/**
 * What a Free reader has left this month (AGL-3722): the less of their own
 * allowance — 300 credits a month across every Free workspace they hold, net
 * of give-backs — and this workspace's band. The same two walls the credits
 * prompt reads, so the strip and the prompt say one number. `null` off the
 * Free plan.
 */
export function aiUsageStripFreeLeft(meter: AiUsageMeterWire): number | null {
  const { mine, pool } = meter
  if (!mine.free || mine.limit === null) return null
  const balances = [mine.limit - mine.used, ...(pool.limit === null ? [] : [pool.limit - pool.used])]
  return Math.max(0, Math.min(...balances))
}

/**
 * The line about the reader's own month, in the words the strip uses. On the
 * Free plan it is what is LEFT (`aiUsageStripFreeLeft`), the figure the
 * credits prompt quotes, and the second line says which two meters it is
 * the less of (AGL-3722).
 */
export function aiUsageStripMineLabel(meter: AiUsageMeterWire): string {
  const { mine } = meter
  const freeLeft = aiUsageStripFreeLeft(meter)
  if (freeLeft !== null) return `You have ${credits(freeLeft)} free AI credits left this month`
  if (mine.limit === null) return `You: ${credits(mine.used)} credits this month`
  const who = mine.scope === 'host' ? 'This site' : mine.scope === 'collab' ? 'You, on this site' : 'You'
  return `${who}: ${credits(mine.used)} of ${credits(mine.limit)} credits this month`
}

/**
 * The line about the workspace's pool. On the Free plan both meters a Free
 * step is held to, each used of its limit and each for this month: the
 * person's across their Free workspaces, and this workspace's (AGL-3722).
 */
export function aiUsageStripPoolLabel(meter: AiUsageMeterWire): string {
  const { mine, pool } = meter
  const of = (used: number, limit: number | null) => `${credits(used)}${limit === null ? '' : ` of ${credits(limit)}`}`
  return mine.free
    ? `Used: you ${of(mine.used, mine.limit)} across your Free workspaces · this workspace ${of(pool.used, pool.limit)}`
    : `Workspace: ${of(pool.used, pool.limit)} credits`
}

/**
 * THE USAGE STRIP (AGL-2942): the reader's AI credits while they use AI —
 * in the assistant panel and every generation dialog, with no dashboard to
 * visit and no read of its own.
 *
 * It shows the reader's month against the allotment that binds them (or
 * their month alone and the workspace's pool when none does), the pool, what
 * the last request cost, and the model that answered. From 80% it warns; at
 * a hard allotment it says who can raise it. It renders nothing until a door
 * has answered this reader in this workspace — see `use-ai-usage-meter.ts`.
 */
export function AiUsageStrip({ orgId, orgSlug }: AiUsageStripProps) {
  const meter = useAiUsageMeter(orgId)
  if (!meter) return null
  const { mine, pool } = meter
  const bound = mine.limit !== null
  const freeLeft = aiUsageStripFreeLeft(meter)
  // On the Free plan the bar is what is used of the wall nearest to running out (AGL-3722).
  const used = freeLeft !== null && mine.limit !== null ? mine.limit - freeLeft : bound ? mine.used : pool.used
  const limit = bound ? mine.limit : pool.limit
  const pct = limit ? Math.min(100, Math.round((used / limit) * 100)) : null
  const tone = meter.state === 'capped' ? 'error' : meter.state === 'warn' ? 'warning' : 'primary'
  const allotmentReached =
    freeLeft !== null ? freeLeft <= 0 : bound && mine.mode === 'hard' && mine.limit !== null && mine.used >= mine.limit
  const raiseHref =
    orgSlug && mine.scope !== 'collab'
      ? `${buildRoute(Route.MANAGE_BILLING_USAGE, { orgSlug })}#ai-allotments`
      : null
  const whose = !bound
    ? 'the workspace’s credits'
    : mine.free
      ? 'your free AI credits'
      : mine.scope === 'host'
      ? 'this site’s AI allotment'
      : 'your AI allotment'

  return (
    <Box
      role="status"
      aria-live="polite"
      data-testid="ai-usage-strip"
      sx={{ px: 1, py: 0.75, borderRadius: 1, bgcolor: 'action.hover' }}
    >
      <Stack useFlexGap direction="row" spacing={1} sx={{ alignItems: 'baseline', flexWrap: 'wrap' }}>
        <Typography variant="caption" sx={{ flexGrow: 1 }}>
          {aiUsageStripMineLabel(meter)}
        </Typography>
        {meter.last !== null ? (
          <Typography variant="caption" color="text.secondary">
            {`Last request: ${credits(meter.last)} credits`}
          </Typography>
        ) : null}
        <HelpTip sx={{ alignSelf: 'center' }} {...AI_USAGE_STRIP_HELP} />
      </Stack>
      {pct !== null ? (
        <LinearProgress
          variant="determinate"
          value={pct}
          color={tone}
          aria-label={`${pct}% of ${whose} used`}
          sx={{ my: 0.5, height: 4, borderRadius: 2 }}
        />
      ) : null}
      <Typography variant="caption" color="text.secondary" component="div">
        {aiUsageStripPoolLabel(meter)}
        {bound ? '' : ' this month'}
        {meter.model ? ` · ${meter.model.label}${meter.model.auto ? ' (Auto)' : ''}` : ''}
      </Typography>
      {meter.state === 'warn' ? (
        <Typography variant="caption" color="warning.main" component="div">
          {`Past 80% of ${whose}.`}
          {bound && mine.mode === 'soft' ? ' It is soft, so requests keep working.' : ''}
        </Typography>
      ) : null}
      {meter.state === 'capped' ? (
        <Typography variant="caption" color="error" component="div">
          {allotmentReached && mine.free
            ? 'Your free AI credits for this month are used. They renew on the 1st.'
            : allotmentReached
            ? mine.scope === 'collab'
              ? 'Your AI allotment on this site is used for the month. The site’s admin, or an organization admin, can raise it.'
              : mine.scope === 'host'
                ? 'This site’s AI allotment is used for the month. An organization admin can raise it'
                : 'Your AI allotment is used for the month. An organization admin can raise it'
            : 'That request was stopped by a limit on this workspace.'}
          {allotmentReached && mine.free ? null : allotmentReached && raiseHref ? (
            <>
              {' under '}
              <AppLink componentVariant="naked" href={raiseHref}>
                {'Billing → Usage'}
              </AppLink>
              {'.'}
            </>
          ) : allotmentReached && mine.scope !== 'collab' ? (
            '.'
          ) : null}
        </Typography>
      ) : null}
    </Box>
  )
}
AiUsageStrip.displayName = 'AiUsageStrip'

export default AiUsageStrip
