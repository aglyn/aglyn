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

import { CAPTURED_BY_HOST_FIELD, CONTACT_SOURCE_LABELS, pluginDocsHelp } from '@aglyn/aglyn'
// The component path and NOT the marketing barrel, for the reason the Inbox
// and the contacts list give: the barrel is the tenant loader's entry point
// for the plugin's SITE half, and a console card named there ships to every
// published page.
import { default as ConversionAttribution } from '@aglyn/plugins-marketing/components/conversion-attribution.component'
import { CardDisplay } from '@aglyn/shared-ui-jsx'
import { Chip, Stack, Typography } from '@mui/material'

/**
 * The surfaces `addHostLead` names — `signup`, `booking`, `form:{formId}` —
 * as they read on screen. A form's id is not a name, so it is shown as the
 * kind with the id beside it rather than as an opaque token. The bare kind
 * `form` is the lifecycle backfill's spelling for a person whose timeline
 * kept no form id (AGL-2631), and reads as the kind, the way the contact's
 * own source chip does.
 */
export function leadSourceLabel(source: string): string {
  if (source === 'signup') return 'Sign-up'
  if (source === 'booking') return 'Booking'
  if (source === 'form') return CONTACT_SOURCE_LABELS.form
  if (source.startsWith('form:')) return `Form ${source.slice('form:'.length)}`
  return source
}

/** Every surface that produced a capture — the array, or the older single field. */
export function leadSources(lead: Record<string, unknown>): string[] {
  const sources = lead['sources']
  if (Array.isArray(sources) && sources.length) {
    return sources.map((source) => String(source))
  }
  return typeof lead['source'] === 'string' && lead['source'] ? [lead['source']] : []
}

/** Epoch millis or a Firestore timestamp, as a local date-time, or a dash. */
export function leadTimeLabel(value: unknown): string {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return new Date(value).toLocaleString()
  }
  const asDate = (value as { toDate?: () => Date } | null | undefined)?.toDate?.()
  return asDate ? asDate.toLocaleString() : '—'
}

function Fact(props: { label: string; children: React.ReactNode }) {
  return (
    <Stack spacing={0.25}>
      <Typography variant="caption" color="text.secondary">
        {props.label}
      </Typography>
      <Typography variant="body2" component="div">
        {props.children}
      </Typography>
    </Stack>
  )
}

export interface LeadHistoryCardProps {
  hostId: string
  leadId: string
  lead: Record<string, unknown>
}

/**
 * What the capture door recorded about this person (AGL-2608): every
 * surface that produced a capture, how many times, and when the first and
 * the latest happened — the fields `addHostLead` keeps on the one document
 * per person — plus the campaign the first capture is credited to.
 *
 * Read-only by construction. Nothing here is the team's to edit: it is what
 * the visitor did, and the CRM's working state lives on the card above it.
 */
export function LeadHistoryCard(props: LeadHistoryCardProps) {
  const { hostId, leadId, lead } = props
  const sources = leadSources(lead)
  const capturedBy = lead[CAPTURED_BY_HOST_FIELD]
  const count = Number(lead['submissionCount'] ?? 0) || (sources.length ? 1 : 0)
  return (
    <CardDisplay
      header={'Captured history'}
      help={pluginDocsHelp('crmLeads', { anchor: '#a-leads-page' })}
      contentGutterX
      contentGutterY
    >
      <Stack spacing={3}>
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={3}>
          <Fact label="First seen">
            {leadTimeLabel(lead['firstSeenAtMs'] ?? lead['createdAt'])}
          </Fact>
          <Fact label="Last seen">
            {leadTimeLabel(lead['lastSeenAtMs'] ?? lead['createdAt'])}
          </Fact>
          <Fact label="Captures">{count ? String(count) : '—'}</Fact>
          <Fact label="Captured on">
            {Array.isArray(capturedBy) && capturedBy.length
              ? capturedBy.map(String).join(', ')
              : hostId}
          </Fact>
        </Stack>
        <Fact label="Sources">
          {sources.length ? (
            <Stack direction="row" spacing={0.5} sx={{ flexWrap: 'wrap', rowGap: 0.5 }}>
              {sources.map((source) => (
                <Chip key={source} size="small" variant="outlined" label={leadSourceLabel(source)} />
              ))}
            </Stack>
          ) : (
            '—'
          )}
        </Fact>
        <Stack spacing={1}>
          <Typography variant="caption" color="text.secondary">
            {'Where this lead came from'}
          </Typography>
          <ConversionAttribution hostId={hostId} kind="lead" refId={leadId} />
        </Stack>
      </Stack>
    </CardDisplay>
  )
}
LeadHistoryCard.displayName = 'LeadHistoryCard'

export default LeadHistoryCard
