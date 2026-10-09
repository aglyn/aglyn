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

import type { ConsoleWidgetEntitlementProps } from '@aglyn/aglyn/plugin-manager/feature-plugins'
import { lockdownRefusalText, parseLockdownRefusal } from '@aglyn/aglyn'
import { pluginDocsHelp } from '@aglyn/aglyn/app-utils/docs-help'
import { checkQuota } from '@aglyn/aglyn/app-utils/plan-entitlements'
import { mdiCreation } from '@aglyn/shared-data-mdi'
import { MdiIcon } from '@aglyn/shared-ui-jsx'
import { authorizedFetch } from '@aglyn/shared-util-http/authorized-token'
import { useHostOrgId, useOrgPlan, useUser } from '@aglyn/tenant-feature-instance'
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Link,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { AiJobSummary } from '../model/ai-jobs.types'
import { AiJobFollow } from './ai-job-follow.component'
import { publishAiJob } from './ai-jobs-store'
import { AiUpsellButton } from './ai-upsell-dialog.component'

/**
 * "Create with AI" on the Campaigns section (AGL-3603), in the zone the
 * marketing plugin hosts beside Create campaign: a brief starts the
 * `campaign` job, which writes an email design and the DRAFT campaign that
 * would send it — aimed at nobody, scheduled for nothing, sent by nobody until
 * a member does — or, where the workspace's plan sends no campaign email, the
 * `email` job, which writes the design on its own.
 *
 * The choice is the runner's own: the campaign step and its admission ask
 * `checkQuota(org, 'emailSendsPerMonth', 0)`, and this widget asks the same of
 * the same org document before it offers either. A plan that changes between
 * the two is the door's to refuse, and the dialog then offers the design on
 * its own rather than a dead end.
 *
 * The campaign is the marketing plugin's and neither plugin imports the other:
 * the props below restate the half of the zone's contract this widget reads.
 */

/** One site a campaign could be placed on, as the zone hands it over. */
export interface AiCampaignSite {
  id: string
  name: string
}

/** What the `hostCampaigns` zone hands this widget. */
export interface AiCreateCampaignButtonProps extends ConsoleWidgetEntitlementProps {
  hostId: string | null
  orgId: string | null
  sites: readonly AiCampaignSite[]
}

/** The longest brief a job admits. */
const BRIEF_MAX_CHARS = 4_000

/** The longest name a campaign job reads. */
const NAME_MAX_CHARS = 120

const FAILED_COPY = 'The campaign could not be started. Try again.'

/**
 * The campaign door's refusal for a plan that sends no campaign email, as the
 * campaign step words it, so a plan that changed after the dialog opened is
 * recognized and answered with the design-only path.
 */
const PLAN_REFUSAL_PREFIX = 'Campaign email is not included'

/** What the dialog says for each of the two jobs it can start. */
export const AI_CAMPAIGN_CREATE_COPY = {
  campaign: {
    title: 'Create a campaign with AI',
    next:
      'It writes an email design with three subject lines and three preheaders, and a draft ' +
      'campaign that would send it. Nothing is sent or scheduled, and the campaign is aimed at ' +
      'nobody until you pick its lists.',
    submit: 'Write the campaign',
    started:
      'The campaign is being written. When it is done, open the draft campaign to pick who ' +
      'receives it, check the email and schedule it.',
  },
  email: {
    title: 'Write a campaign email with AI',
    next:
      'This workspace’s plan does not send campaign email, so this writes the email design on ' +
      'its own, with three subject lines and three preheaders. Upgrade in Billing to draft a ' +
      'campaign around it.',
    submit: 'Plan the email',
    started:
      'The email is being planned. Review the plan here or in AI jobs, and confirm it to build. ' +
      'The design is built as a draft and sent to nobody.',
  },
} as const

export type AiCampaignJobKind = keyof typeof AI_CAMPAIGN_CREATE_COPY

/** Which job a workspace's plan allows: a campaign where it sends campaign email, else the design alone. */
export function aiCampaignJobKind(org: object | null | undefined): AiCampaignJobKind {
  return checkQuota(org as never, 'emailSendsPerMonth', 0).allowed ? 'campaign' : 'email'
}

/** The job's inputs: the name the member gave it, when they gave one. */
export function aiCampaignJobInputs(name: string): Record<string, string> {
  const trimmed = name.replace(/\s+/g, ' ').trim().slice(0, NAME_MAX_CHARS)
  return trimmed ? { name: trimmed } : {}
}

export function AiCreateCampaignButton(props: AiCreateCampaignButtonProps) {
  const { hostId, sites } = props
  const { data: user } = useUser()
  const userRef = useRef(user)
  userRef.current = user
  const [open, setOpen] = useState(false)
  const [siteId, setSiteId] = useState<string>(hostId ?? sites[0]?.id ?? '')
  const site = hostId ?? siteId
  const siteOrgId = useHostOrgId(site || undefined) ?? undefined
  const orgId = props.orgId ?? siteOrgId
  const { org, ready } = useOrgPlan(site || undefined)
  const [refusedPlan, setRefusedPlan] = useState(false)
  const kind: AiCampaignJobKind = refusedPlan ? 'email' : aiCampaignJobKind(org)
  const copy = AI_CAMPAIGN_CREATE_COPY[kind]
  const [name, setName] = useState('')
  const [brief, setBrief] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [started, setStarted] = useState<AiJobSummary | null>(null)

  // The org hub's sites settle after the widget mounts; take the first once they do.
  useEffect(() => {
    if (!hostId && !siteId && sites[0]) setSiteId(sites[0].id)
  }, [hostId, siteId, sites])

  useEffect(() => {
    if (!open) return
    setNotice(null)
    setStarted(null)
    setRefusedPlan(false)
  }, [open])

  const start = useCallback(async () => {
    if (!orgId || !site || !brief.trim()) return
    setBusy(true)
    setNotice(null)
    try {
      const response = await authorizedFetch(userRef.current, '/api/ai/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orgId,
          hostId: site,
          kind,
          brief: brief.trim(),
          inputs: aiCampaignJobInputs(name),
        }),
      })
      const payload = await response.json().catch(() => null)
      if (!response.ok) {
        const locked = parseLockdownRefusal(response.status, payload)
        const error = String(payload?.error ?? FAILED_COPY)
        if (kind === 'campaign' && response.status === 403 && error.startsWith(PLAN_REFUSAL_PREFIX)) {
          setRefusedPlan(true)
        }
        setNotice(locked ? lockdownRefusalText(locked) : error)
        return
      }
      const job = (payload?.job as AiJobSummary | undefined) ?? null
      if (!job) {
        setNotice(FAILED_COPY)
        return
      }
      publishAiJob(job)
      setStarted(job)
      setBrief('')
      setName('')
    } catch {
      setNotice(FAILED_COPY)
    } finally {
      setBusy(false)
    }
  }, [orgId, site, kind, brief, name])

  if (!hostId && !sites.length) return null
  // Drawn from the shell's gates alone (AGL-3601): nothing asks a server until
  // it is used, and a plan without the add-on gets the add-on's dialog.
  if (props.entitled === false) {
    return props.upgrade ? <AiUpsellButton kind="campaign" upgrade={props.upgrade} /> : null
  }

  const help = pluginDocsHelp('aiMarketing', {
    anchor: '#create-a-campaign',
    excerpt:
      'Writes an email design and a draft campaign that would send it, from a brief. Nothing is sent or scheduled, and the campaign is aimed at nobody until you pick its lists.',
  })

  return (
    <>
      <Button
        size="small"
        variant="outlined"
        startIcon={<MdiIcon path={mdiCreation.path} />}
        onClick={() => setOpen(true)}
      >
        {'Create with AI'}
      </Button>
      <Dialog open={open} onClose={busy ? undefined : () => setOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>{copy.title}</DialogTitle>
        <DialogContent>
          {started && orgId ? (
            <AiJobFollow
              job={started}
              orgId={orgId}
              user={user}
              intro={AI_CAMPAIGN_CREATE_COPY[started.kind === 'email' ? 'email' : 'campaign'].started}
              onOpenJobs={() => setOpen(false)}
            />
          ) : (
            <Stack spacing={2} sx={{ pt: 1 }}>
              {hostId ? null : (
                <TextField
                  select
                  size="small"
                  label="Site"
                  helperText="The site the campaign is placed on and sent as."
                  value={siteId}
                  onChange={(event) => setSiteId(event.target.value)}
                  disabled={busy}
                >
                  {sites.map((entry) => (
                    <MenuItem key={entry.id} value={entry.id}>
                      {entry.name || entry.id}
                    </MenuItem>
                  ))}
                </TextField>
              )}
              <TextField
                size="small"
                label="Campaign name (optional)"
                value={name}
                onChange={(event) => setName(event.target.value.slice(0, NAME_MAX_CHARS))}
                disabled={busy}
              />
              <TextField
                label="What is the campaign for?"
                placeholder="Announce the autumn menu to our regulars, and point them at the class page to book the Tuesday bread class"
                multiline
                minRows={4}
                value={brief}
                onChange={(event) => setBrief(event.target.value.slice(0, BRIEF_MAX_CHARS))}
                disabled={busy}
                autoFocus
              />
              <Typography variant="body2" color="text.secondary">
                {copy.next}{' '}
                <Link href={help.href} target="_blank" rel="noopener" title={help.excerptText}>
                  {'How it works'}
                </Link>
              </Typography>
              {notice ? <Alert severity="warning">{notice}</Alert> : null}
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)} disabled={busy}>
            {started ? 'Close' : 'Cancel'}
          </Button>
          {started ? null : (
            <Button
              variant="contained"
              onClick={() => void start()}
              disabled={busy || !ready || !orgId || !site || !brief.trim()}
            >
              {copy.submit}
            </Button>
          )}
        </DialogActions>
      </Dialog>
    </>
  )
}
AiCreateCampaignButton.displayName = 'AiCreateCampaignButton'

export default AiCreateCampaignButton
