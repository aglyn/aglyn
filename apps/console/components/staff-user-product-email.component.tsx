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

import type { PlatformMarketingConsentState } from '@aglyn/aglyn/app-utils/platform-marketing-consent'
import { PLATFORM_BRAND_NAME } from '@aglyn/aglyn/app-utils/platform-brand'
import { AppLink } from '@aglyn/shared-ui-jsx'
import type { PlatformMarketingReach } from '@aglyn/tenant-data-admin/server/platform-marketing-consent'
import { Chip, Stack, Typography } from '@mui/material'
import { buildRoute, Route } from '../constants/route-links'
import { formatStaffTimestamp } from '../utils/staff-timestamps'

/** What `/api/admin/users/detail` answers under `marketing` (AGL-3292). */
export interface StaffUserMarketing {
  answer: PlatformMarketingConsentState
  reach: PlatformMarketingReach
}

/** The console door a decision came through, as a staffer would say it. */
const DOOR: Record<string, string> = {
  'console-signup': 'at sign-up',
  'console-prompt': 'in the console prompt',
  'console-preferences': 'in their account settings',
}

/** One line for what the person said, from their own document. */
export function describeAnswer(answer: PlatformMarketingConsentState): string {
  if (answer.decision) {
    const door = answer.sourceKind ? DOOR[answer.sourceKind] : null
    return [
      answer.decision === 'granted' ? 'Yes' : 'No',
      [door, formatStaffTimestamp(answer.atMs)].filter(Boolean).join(', '),
    ].join(' — ')
  }
  return answer.promptDismissedAtMs
    ? `Not answered — dismissed the prompt ${formatStaffTimestamp(answer.promptDismissedAtMs)}`
    : 'Not answered'
}

/** The marketing site's own list: what the person did to be on it. */
const SITE_SUPPRESSION: Record<string, string> = {
  unsubscribe: 'unsubscribed from the marketing site',
  erasure: 'erased at their request',
}

/** The platform list: what the mailbox did. */
const PLATFORM_SUPPRESSION: Record<string, string> = {
  bounce: 'hard bounce',
  complaint: 'spam complaint',
  staff: 'suppressed by staff',
}

type ReachChip = {
  label: string
  color: 'success' | 'error' | 'warning' | 'default'
}

/** What a campaign from the marketing site would do, as one chip. */
export function describeReach(reach: PlatformMarketingReach): ReachChip | null {
  if (reach.status === 'unconfigured' || reach.status === 'no-email') return null
  if (reach.status === 'unreadable') {
    // Unknown is not "no": a failed read says nothing about the person.
    return { label: 'Could not read the marketing contact — unknown, not "no"', color: 'warning' }
  }
  if (reach.suppression) {
    const { list, reason } = reach.suppression
    return {
      label: `Won’t send — ${
        list === 'site'
          ? (SITE_SUPPRESSION[reason] ?? `on the marketing site’s list (${reason})`)
          : `${PLATFORM_SUPPRESSION[reason] ?? reason}, for every sender`
      }`,
      color: 'error',
    }
  }
  if (reach.verdict === 'consented') {
    return {
      label:
        reach.assertedBy === 'operator'
          ? `Can send — consent asserted by an operator ${formatStaffTimestamp(reach.basisAtMs)}`
          : `Can send — consented ${formatStaffTimestamp(reach.basisAtMs)}`,
      color: 'success',
    }
  }
  if (reach.verdict === 'grandfathered') {
    return { label: 'Can send — grandfathered, no consent recorded', color: 'success' }
  }
  const why: Record<string, string> = {
    declined: 'declined',
    'other-host': 'consent given to another site',
  }
  return {
    label: `Won’t send — ${why[reach.reason] ?? 'no consent on file'}`,
    color: reach.reason === 'declined' ? 'error' : 'default',
  }
}

/** Whether a send would go out, when that can be told at all. */
function reachSends(reach: PlatformMarketingReach): boolean | null {
  if (reach.status !== 'read') return null
  return !reach.suppression && reach.verdict !== 'withheld'
}

/**
 * Product email on the staff user page (AGL-3292).
 *
 * Two answers, because the product keeps two records and nothing keeps them in
 * step. "Their answer" is the person's own document — what the console
 * asked and shows them. The chip is what a campaign from the operator's
 * marketing site would actually do: that site's CRM contact, the org's consent
 * rule and both suppression lists. An unsubscribe link changes only the
 * lists, so the two can disagree, and when they do the line under them says
 * which one the mail follows.
 */
export default function StaffUserProductEmail({
  marketing,
}: {
  marketing: StaffUserMarketing | null | undefined
}) {
  if (!marketing) return null
  const { answer, reach } = marketing
  const chip = describeReach(reach)
  const sends = reachSends(reach)
  // The organization-level CRM hub's contact record (AGL-2630).
  const contactHref =
    reach.status === 'read' && reach.contactId && reach.orgSlug
      ? `${buildRoute(Route.ORG_CRM, { orgSlug: reach.orgSlug })}/contacts/${reach.contactId}`
      : null
  const disagreement =
    answer.decision === 'granted' && sends === false
      ? 'They said yes in the console, but their marketing contact will not be mailed — sends follow the contact and the suppression lists, not the answer above.'
      : answer.decision === 'declined' && sends === true
        ? 'They said no in the console, but their marketing contact can still be mailed — check the contact.'
        : null

  return (
    <Stack spacing={0.5}>
      <Typography variant="caption" color="text.secondary">
        {`Product updates, their answer: ${describeAnswer(answer)}`}
      </Typography>
      <Stack
        direction="row"
        spacing={1}
        sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 1 }}
      >
        <Typography variant="caption" color="text.secondary">
          {`${PLATFORM_BRAND_NAME} marketing email:`}
        </Typography>
        {chip ? (
          <Chip size="small" color={chip.color} label={chip.label} />
        ) : (
          <Typography variant="caption" color="text.secondary">
            {reach.status === 'no-email'
              ? 'no address to look up'
              : 'no marketing site is configured on this deployment'}
          </Typography>
        )}
        {contactHref ? (
          <AppLink href={contactHref} variant="caption" underline="always">
            {'Open contact'}
          </AppLink>
        ) : null}
      </Stack>
      {disagreement ? (
        <Typography variant="caption" color="warning.main">
          {disagreement}
        </Typography>
      ) : null}
    </Stack>
  )
}
StaffUserProductEmail.displayName = 'StaffUserProductEmail'
