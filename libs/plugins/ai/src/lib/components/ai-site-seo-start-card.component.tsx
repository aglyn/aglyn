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

import type { ConsoleHostSeoZoneProps } from '@aglyn/aglyn/plugin-manager/feature-plugins'
import { CardDisplay } from '@aglyn/shared-ui-jsx'
import { authorizedFetch } from '@aglyn/shared-util-http/authorized-token'
import { useUser } from '@aglyn/tenant-feature-instance'
import { Alert, Button, Stack, Typography } from '@mui/material'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AiJobSummary } from '../model/ai-jobs.types'
import {
  AI_SITE_SEO_FORM_FIELDS,
  aiSiteSeoProposalOf,
  type AiSiteSeoProposal,
} from '../model/ai-site-start-seo'

/**
 * The site's own search listing, from the guided start's answers (AGL-2918),
 * on the site's SEO section through the `hostSeo` zone.
 *
 * The guided start asks what kind of site this is and who it is for. Those
 * two answers are exactly the site-wide search title and description every
 * page with none of its own falls back to, and until now they reached
 * neither: a scaffolded site published its pages listed under whatever its
 * creation seeded. The scaffold now carries the pair as an output of the
 * `site` job (`aiSiteSeoProposal`), and this card is where a person reads it
 * and puts it in the form.
 *
 * ── It writes nothing, and it asks for nothing ───────────────────────────
 *
 * "Put in the form" is the zone's own `proposeDraft`: the two values land in
 * the SEO form below as unsaved edits and the form's Update is the write. No
 * job is started from here and no model is asked anything — the card only
 * reads jobs the site already ran.
 *
 * ── Absent unless there is something to offer ────────────────────────────
 *
 * Nothing renders until the jobs route has admitted this workspace, so a
 * workspace whose release flag is off sees the ordinary SEO section and no
 * trace of this. Nothing renders either when no scaffold ever ran here, or
 * when the site's stored SEO already says what the proposal would say —
 * a card whose only button does nothing is worse than no card.
 */

/** How many recent jobs the card reads to find this site's guided start. */
const RECENT_JOBS_READ = 20

type Verdict = 'checking' | 'ready' | 'hidden'

/** What each value is called where the card lists it. */
const FIELD_LABELS: Record<string, string> = {
  [AI_SITE_SEO_FORM_FIELDS.title]: 'Title',
  [AI_SITE_SEO_FORM_FIELDS.description]: 'Description',
}

/** What the site's settings hold for one field now, read as the form seeded it. */
function storedValue(seo: Record<string, unknown> | undefined, field: string): string {
  const key = field.replace(/^seo\./, '')
  const value = seo?.[key]
  return typeof value === 'string' ? value.trim() : ''
}

/**
 * Whether the site's settings already say what the proposal says. Both values
 * have to match: a site whose title was applied and whose description was
 * then rewritten still has something to take.
 */
export function aiSiteSeoAlreadySaid(
  proposal: AiSiteSeoProposal,
  seo: Record<string, unknown> | undefined,
): boolean {
  return Object.entries(proposal.values).every(
    ([field, value]) => storedValue(seo, field) === value.trim(),
  )
}

export function AiSiteSeoStartCard({ hostId, orgId, seo, proposeDraft }: ConsoleHostSeoZoneProps) {
  const { data: user } = useUser()
  // Held in a ref so a request reads WHO is signed in, never the identity of
  // the object that says so.
  const userRef = useRef(user)
  userRef.current = user
  const uid = user?.uid ?? null
  const [verdict, setVerdict] = useState<Verdict>('checking')
  const [job, setJob] = useState<AiJobSummary | null>(null)
  const [staged, setStaged] = useState(false)

  useEffect(() => {
    if (!orgId || !hostId || !uid) return
    let active = true
    void (async () => {
      try {
        const response = await authorizedFetch(
          userRef.current,
          `/api/ai/jobs?orgId=${encodeURIComponent(orgId)}&limit=${RECENT_JOBS_READ}`,
        )
        if (!active) return
        if (!response.ok) {
          setVerdict('hidden')
          return
        }
        const payload = await response.json().catch(() => null)
        if (!active) return
        // The scaffold that ran for THIS site and reported a listing; the
        // route answers newest first, so the first match is the last start.
        const latest = ((payload?.jobs ?? []) as AiJobSummary[]).find(
          (entry) =>
            entry.kind === 'site' &&
            entry.hostId === hostId &&
            aiSiteSeoProposalOf(entry.outputs) !== null,
        )
        if (latest) setJob(latest)
        setVerdict('ready')
      } catch {
        if (active) setVerdict('hidden')
      }
    })()
    return () => {
      active = false
    }
  }, [orgId, hostId, uid])

  const proposal = useMemo(() => (job ? aiSiteSeoProposalOf(job.outputs) : null), [job])

  const stage = useCallback(() => {
    if (!job || !proposal) return
    proposeDraft(proposal.values, `${job.id}:site-listing`)
    setStaged(true)
  }, [job, proposal, proposeDraft])

  if (verdict !== 'ready' || !proposal) return null
  if (!staged && aiSiteSeoAlreadySaid(proposal, seo)) return null

  return (
    <CardDisplay
      contentGutterX
      contentGutterY
      HeaderProps={{
        title: 'The listing your answers describe',
        subheader:
          'What you said this site is, and who it is for, as the title and description every ' +
          'page without its own falls back to. Nothing is saved until you press Update below.',
      }}
    >
      <Stack spacing={2}>
        {Object.entries(proposal.values).map(([field, value]) => (
          <Stack key={field} spacing={0.25}>
            <Typography variant="caption" color="text.secondary">
              {FIELD_LABELS[field] ?? field}
            </Typography>
            <Typography variant="body2" sx={{ wordBreak: 'break-word' }}>
              {value}
            </Typography>
          </Stack>
        ))}
        {proposal.notes.map((note) => (
          <Typography key={note} variant="caption" color="text.secondary">
            {note}
          </Typography>
        ))}
        <Button
          size="small"
          variant="outlined"
          sx={{ alignSelf: 'flex-start' }}
          disabled={staged}
          onClick={stage}
        >
          {'Put in the form'}
        </Button>
        {staged && (
          <Alert severity="success">
            {'In the SEO form below as unsaved changes. Read them, then press Update.'}
          </Alert>
        )}
      </Stack>
    </CardDisplay>
  )
}

export default AiSiteSeoStartCard
