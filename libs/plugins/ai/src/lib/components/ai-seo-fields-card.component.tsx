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

import { lockdownRefusalText, parseLockdownRefusal } from '@aglyn/aglyn'
import { pluginDocsHelp } from '@aglyn/aglyn/app-utils/docs-help'
import {
  SEO_LISTING_FIELDS,
  seoListingFieldCount,
  seoListingFieldTooLong,
  type SeoListingFieldKey,
} from '@aglyn/aglyn/app-utils/seo-listing-fields'
import type {
  ConsoleSeoFieldsZoneProps,
  ConsoleSeoFieldValues,
} from '@aglyn/aglyn/plugin-manager/feature-plugins'
import { authorizedFetch } from '@aglyn/shared-util-http/authorized-token'
import { useHostOrgId, useUser } from '@aglyn/tenant-feature-instance'
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Link,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { useCallback, useEffect, useRef, useState } from 'react'
import { AI_JOB_TERMINAL_STATUSES, type AiJobSummary } from '../model/ai-jobs.types'
import {
  aiSeoAuditView,
  aiSeoFieldsProposalOf,
  type AiSeoFieldValues,
  type AiSeoKeywordCoverage,
} from '../model/ai-seo'
import { readEventFrames } from './assist-jobs-drawer.component'

/**
 * "Write SEO" (AGL-2910), inside a search listing editor through the
 * `seoFields` zone: the screen detail page's SEO card, and the product
 * editor's search engine listing. A person asks; an `seo` job writes the
 * listing from what the page or the product says; the proposal is shown with
 * each field's count, and "Put in the fields" stages it in the editor above
 * as unsaved changes. The editor's own Save is the write — this card never
 * writes a listing, and a page's listing is what its live head serves.
 *
 * On a page, the card also offers what a site audit proposed for it, once
 * that audit was applied: its listing values wait here rather than being
 * written by the audit.
 *
 * It renders nothing until the jobs route has answered for this workspace:
 * the shell has decided the plan and the permission, but the release flag is
 * the route's, and a 404 there is this card staying absent.
 */

/** How many recent jobs the card reads to find this listing's proposals. */
const RECENT_JOBS_READ = 20

/** How much of a product's description a job carries. */
const PRODUCT_TEXT_MAX_CHARS = 2_000

const KEYWORDS_MAX_CHARS = 300

type Verdict = 'checking' | 'ready' | 'hidden'

const isTerminal = (job: AiJobSummary) => AI_JOB_TERMINAL_STATUSES.includes(job.status)

/** The proposed values this editor can take: its own fields, and an image description only beside an image. */
export function aiSeoValuesForEditor(
  values: AiSeoFieldValues,
  fields: readonly SeoListingFieldKey[],
  hasImage: boolean,
): ConsoleSeoFieldValues {
  const out: ConsoleSeoFieldValues = {}
  for (const key of fields) {
    const value = values[key]
    if (typeof value !== 'string' || !value.trim()) continue
    if (key === 'imageAlt' && !hasImage) continue
    out[key] = value
  }
  return out
}

function Coverage({ keywords }: { keywords: readonly AiSeoKeywordCoverage[] }) {
  if (!keywords.length) return null
  return (
    <Stack direction="row" spacing={0.5} sx={{ flexWrap: 'wrap', rowGap: 0.5 }} aria-label="Keyword coverage">
      {keywords.map((entry) => {
        const covered = entry.inTitle || entry.inDescription
        return (
          <Chip
            key={entry.keyword}
            size="small"
            variant="outlined"
            color={covered ? 'success' : 'default'}
            label={covered ? entry.keyword : `${entry.keyword} — not used`}
          />
        )
      })}
    </Stack>
  )
}

function ProposedValues(props: {
  heading: string
  values: ConsoleSeoFieldValues
  fields: readonly SeoListingFieldKey[]
}) {
  return (
    <Stack spacing={1}>
      <Typography variant="subtitle2">{props.heading}</Typography>
      {props.fields
        .filter((key) => props.values[key])
        .map((key) => (
          <Stack key={key} spacing={0.25}>
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
              <Typography variant="caption" color="text.secondary" sx={{ flexGrow: 1 }}>
                {SEO_LISTING_FIELDS[key].label}
              </Typography>
              <Chip
                size="small"
                variant="outlined"
                color={seoListingFieldTooLong(key, props.values[key]) ? 'error' : 'default'}
                label={seoListingFieldCount(key, props.values[key])}
              />
            </Stack>
            <Typography variant="body2" sx={{ wordBreak: 'break-word' }}>
              {props.values[key]}
            </Typography>
          </Stack>
        ))}
    </Stack>
  )
}

export function AiSeoFieldsCard(props: ConsoleSeoFieldsZoneProps) {
  const { hostId, subject, fields, values, hasImage, proposeValues } = props
  // A plugin-hosted editor may not know the org; the site does.
  const hostOrgId = useHostOrgId(props.orgId ? undefined : hostId)
  const orgId = props.orgId ?? hostOrgId ?? undefined
  const { data: user } = useUser()
  // Held in a ref so the reads below key on WHO is signed in, never on the
  // identity of the object that says so.
  const userRef = useRef(user)
  userRef.current = user
  const uid = user?.uid ?? null
  const subjectKind = subject.kind
  const subjectId = subject.id ?? null

  const [verdict, setVerdict] = useState<Verdict>('checking')
  const [notice, setNotice] = useState<string | null>(null)
  const [keywords, setKeywords] = useState('')
  const [busy, setBusy] = useState(false)
  const [job, setJob] = useState<AiJobSummary | null>(null)
  const [fromAudit, setFromAudit] = useState<{ jobId: string; values: AiSeoFieldValues } | null>(null)
  const [staged, setStaged] = useState<string | null>(null)
  const watchRef = useRef<AbortController | null>(null)

  useEffect(() => () => watchRef.current?.abort(), [])

  useEffect(() => {
    if (!orgId || !hostId || !uid) return
    let active = true
    setVerdict('checking')
    setJob(null)
    setFromAudit(null)
    void (async () => {
      try {
        const response = await authorizedFetch(
          userRef.current,
          `/api/ai/jobs?orgId=${encodeURIComponent(orgId)}&limit=${RECENT_JOBS_READ}`,
        )
        if (!active) return
        // The flag off (404) and the plan without generation (403): the
        // feature is not this workspace's, so the card is not here at all.
        if (response.status === 404 || response.status === 403) {
          setVerdict('hidden')
          return
        }
        const payload = await response.json().catch(() => null)
        if (!active) return
        if (!response.ok) {
          const locked = parseLockdownRefusal(response.status, payload)
          setNotice(
            locked
              ? lockdownRefusalText(locked)
              : String(payload?.error ?? 'Recent SEO proposals could not be loaded.'),
          )
        } else if (subjectId) {
          const jobs = ((payload?.jobs ?? []) as AiJobSummary[]).filter(
            (entry) => entry.kind === 'seo' && entry.hostId === hostId,
          )
          const latest = jobs.find((entry) => {
            const proposal = aiSeoFieldsProposalOf(entry)
            return proposal?.subject.kind === subjectKind && proposal.subject.id === subjectId
          })
          if (latest) setJob(latest)
          if (subjectKind === 'screen') {
            const audit = jobs.find((entry) => entry.applied?.staged.includes(subjectId))
            const fix = audit ? aiSeoAuditView(audit.outputs)?.fixes[subjectId] : undefined
            if (audit && fix && Object.keys(fix.values).length) {
              setFromAudit({ jobId: audit.id, values: fix.values })
            }
          }
        }
        setVerdict('ready')
      } catch {
        if (!active) return
        setNotice('Recent SEO proposals could not be loaded.')
        setVerdict('ready')
      }
    })()
    return () => {
      active = false
    }
  }, [orgId, hostId, uid, subjectKind, subjectId])

  /** Follows a job through the events route until it settles. */
  const watch = useCallback(async (jobId: string, org: string) => {
    watchRef.current?.abort()
    const controller = new AbortController()
    watchRef.current = controller
    let again = true
    while (again && !controller.signal.aborted) {
      again = false
      try {
        const response = await authorizedFetch(
          userRef.current,
          `/api/ai/jobs/${encodeURIComponent(jobId)}/events?orgId=${encodeURIComponent(org)}`,
          { signal: controller.signal },
        )
        if (!response.ok || !response.body) return
        await readEventFrames(response.body, (event) => {
          if (event['type'] === 'state') setJob(event['job'] as AiJobSummary)
          else if (event['type'] === 'reconnect') again = true
        })
      } catch {
        return
      }
    }
  }, [])

  const write = useCallback(async () => {
    if (!orgId) return
    setBusy(true)
    setNotice(null)
    setStaged(null)
    const common = { fields: fields.join(','), keywords: keywords.trim() }
    const inputs =
      subject.kind === 'screen'
        ? { target: 'screen', screenId: subject.id, versionId: subject.versionId ?? '', ...common }
        : {
            target: 'product',
            productId: subject.id ?? '',
            name: subject.name.trim(),
            text: subject.description.slice(0, PRODUCT_TEXT_MAX_CHARS),
            currentTitle: values.title ?? '',
            currentDescription: values.description ?? '',
            ...common,
          }
    try {
      const response = await authorizedFetch(userRef.current, '/api/ai/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orgId,
          hostId,
          kind: 'seo',
          brief: `Write the search listing for ${subject.name.trim() || 'this page'}`,
          inputs,
        }),
      })
      const payload = await response.json().catch(() => null)
      if (!response.ok) {
        const locked = parseLockdownRefusal(response.status, payload)
        setNotice(
          locked
            ? lockdownRefusalText(locked)
            : String(payload?.error ?? 'The SEO proposal could not be started — try again.'),
        )
        return
      }
      const next = payload?.job as AiJobSummary | undefined
      if (!next) return
      setJob(next)
      if (!isTerminal(next)) await watch(next.id, orgId)
    } catch {
      setNotice('The SEO proposal could not be started — try again.')
    } finally {
      setBusy(false)
    }
  }, [orgId, hostId, subject, fields, keywords, values.title, values.description, watch])

  if (verdict !== 'ready') return null

  const proposal = aiSeoFieldsProposalOf(job)
  const offered = proposal ? aiSeoValuesForEditor(proposal.values, fields, hasImage) : {}
  const audited = fromAudit ? aiSeoValuesForEditor(fromAudit.values, fields, hasImage) : {}
  const running = Boolean(job && !isTerminal(job))
  const saveWord = subject.kind === 'product' ? 'Save product' : 'Save SEO'
  const unnamed = subject.kind === 'product' && !subject.name.trim()
  const help = pluginDocsHelp('aiSeo', {
    excerpt: 'Write a search listing from what the page says. It is put in the fields as unsaved changes; nothing is saved until you save.',
  })

  const stage = (offer: ConsoleSeoFieldValues, key: string) => {
    proposeValues(offer, key)
    setStaged(key)
  }

  return (
    <Box sx={{ border: 1, borderColor: 'divider', borderRadius: 1, p: 1.5 }} aria-label="SEO assistant">
      <Stack spacing={1.5}>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'baseline' }}>
          <Typography variant="subtitle2" sx={{ flexGrow: 1 }}>
            {'Write with AI'}
          </Typography>
          <Link href={help.href} target="_blank" rel="noopener" variant="caption" title={help.excerpt}>
            {'How it works'}
          </Link>
        </Stack>
        <TextField
          size="small"
          label="Target keywords (optional)"
          placeholder="brass desk lamps, dimmable"
          helperText="Comma-separated. Used only where the page is about them, never repeated to rank."
          value={keywords}
          onChange={(event) => setKeywords(event.target.value.slice(0, KEYWORDS_MAX_CHARS))}
          disabled={busy || running}
        />
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
          <Button size="small" variant="outlined" disabled={busy || running || unnamed || !orgId} onClick={() => void write()}>
            {proposal ? 'Write again' : 'Write SEO'}
          </Button>
          {running ? <CircularProgress size={16} aria-label="Writing the listing" /> : null}
          {unnamed ? (
            <Typography variant="caption" color="text.secondary">
              {'Name the product first.'}
            </Typography>
          ) : null}
        </Stack>
        {notice ? <Alert severity="warning">{notice}</Alert> : null}
        {job?.error && !proposal ? (
          <Alert severity={job.status === 'failed' ? 'error' : 'warning'}>{job.error}</Alert>
        ) : null}

        {!proposal && fromAudit && Object.keys(audited).length ? (
          <Stack spacing={1}>
            <ProposedValues heading="Proposed by the site audit" values={audited} fields={fields} />
            <Button
              size="small"
              variant="contained"
              sx={{ alignSelf: 'flex-start' }}
              disabled={staged === `audit:${fromAudit.jobId}`}
              onClick={() => stage(audited, `audit:${fromAudit.jobId}`)}
            >
              {'Put in the fields'}
            </Button>
          </Stack>
        ) : null}

        {proposal && job ? (
          <Stack spacing={1}>
            <ProposedValues heading="Proposed listing" values={offered} fields={fields} />
            <Coverage keywords={proposal.keywords} />
            {proposal.notes.map((note) => (
              <Typography key={note} variant="caption" color="text.secondary">
                {note}
              </Typography>
            ))}
            {job.creditsSpent > 0 ? (
              <Typography variant="caption" color="text.secondary">
                {`Used ${job.creditsSpent} ${job.creditsSpent === 1 ? 'credit' : 'credits'}.`}
              </Typography>
            ) : null}
            <Button
              size="small"
              variant="contained"
              sx={{ alignSelf: 'flex-start' }}
              disabled={!Object.keys(offered).length || staged === job.id}
              onClick={() => stage(offered, job.id)}
            >
              {'Put in the fields'}
            </Button>
          </Stack>
        ) : null}

        {staged ? (
          <Alert severity="success">
            {`In the fields as unsaved changes. Review them, then press ${saveWord}.`}
          </Alert>
        ) : null}
      </Stack>
    </Box>
  )
}
AiSeoFieldsCard.displayName = 'AiSeoFieldsCard'

export default AiSeoFieldsCard
