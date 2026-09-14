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

import { checkEntitlement } from '@aglyn/aglyn'
import { trackEvent } from '@aglyn/aglyn/app-utils/analytics-events'
import {
  AI_JOB_TERMINAL_STATUSES,
  type AiJobOutput,
  type AiJobStatus,
  type AiJobSummary,
} from '@aglyn/aglyn/foundation/definitions/ai-jobs.types'
import type { AglynOrgBilling } from '@aglyn/aglyn/foundation/definitions/org-billing.types'
import { mdiChevronDown, mdiChevronUp } from '@aglyn/shared-data-mdi'
import { AppLink, MdiIcon } from '@aglyn/shared-ui-jsx'
import { authorizedFetch } from '@aglyn/shared-util-http/authorized-token'
import {
  Box,
  Button,
  Chip,
  CircularProgress,
  Collapse,
  IconButton,
  Stack,
  Typography,
} from '@mui/material'
import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * The AI jobs drawer inside the Assist panel (AGL-2904): the workspace's
 * running and recent generation jobs, each step's progress, an "open
 * draft" link per output, and cancel.
 *
 * Reads through the routes, never Firestore directly, so the same
 * membership, flag and entitlement rungs answer every read; progress comes
 * from the events route's server-sent stream, re-opened when the server
 * says `reconnect`. Everything loads on EXPAND rather than on mount: the
 * panel opens on every console page, and a list nobody asked for is a read
 * on every page view.
 *
 * Hidden — not disabled — unless the flag shows it AND the plan carries
 * `aiGenerative`: a released-off feature does not exist, and a plan without
 * it is sold the add-on on the Billing page, not here.
 */

/** Jobs the drawer lists; the route caps higher, the drawer is a glance. */
const LIST_LIMIT = 10

/** How much of a brief a row shows. */
const BRIEF_PREVIEW_CHARS = 90

const STATUS_LABEL: Record<AiJobStatus, string> = {
  queued: 'Queued',
  running: 'Running',
  needs_input: 'Needs attention',
  done: 'Done',
  failed: 'Failed',
  canceled: 'Canceled',
}

const STATUS_COLOR: Record<
  AiJobStatus,
  'default' | 'primary' | 'success' | 'error' | 'warning'
> = {
  queued: 'default',
  running: 'primary',
  needs_input: 'warning',
  done: 'success',
  failed: 'error',
  canceled: 'default',
}

/** The besigner segment each versioned resource lives under. */
const BESIGNER_SEGMENT: Partial<Record<AiJobOutput['resource'], string>> = {
  screen: 'screens',
  reusableComponent: 'components',
  layout: 'layouts',
  template: 'templates',
  emailScreen: 'emails',
}

/**
 * Where "open draft" goes, or `null` when the output has no page of its
 * own — a `text` output carries its copy on the job and is shown inline.
 * A versioned resource opens in the besigner on the version the job wrote;
 * one the console lists without a detail page opens its list.
 */
export function aiJobOutputHref(output: AiJobOutput, orgSlug: string): string | null {
  if (!orgSlug) return null
  const segment = BESIGNER_SEGMENT[output.resource]
  if (segment) {
    if (!output.hostId) return null
    const base = `/${orgSlug}/hosts/${output.hostId}/${segment}/${output.id}`
    return output.versionId ? `${base}/versions/${output.versionId}/besigner` : base
  }
  if (output.resource === 'product' && output.hostId) {
    return `/${orgSlug}/hosts/${output.hostId}/products`
  }
  if (output.resource === 'workflow' && output.hostId) {
    return `/${orgSlug}/hosts/${output.hostId}/automation?tab=workflows`
  }
  return null
}

/** `data:` frames out of an SSE body, one parsed event per frame. */
async function readEventFrames(
  body: ReadableStream<Uint8Array>,
  onEvent: (event: Record<string, unknown>) => void,
): Promise<void> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const frames = buffer.split('\n\n')
    buffer = frames.pop() ?? ''
    for (const frame of frames) {
      const line = frame.split('\n').find((part) => part.startsWith('data: '))
      if (!line) continue
      try {
        onEvent(JSON.parse(line.slice('data: '.length)))
      } catch {
        // A torn frame is dropped; the next state event carries the whole job.
      }
    }
  }
}

export interface AssistJobsDrawerProps {
  /** The org the panel is scoped to — `undefined` where the page named none. */
  orgId: string | undefined
  org: Partial<AglynOrgBilling> | undefined
  orgReady: boolean
  orgSlug: string
  user: Parameters<typeof authorizedFetch>[0]
  /** The `release_ai_generative` verdict, staff bypass applied (the shell's). */
  visible: boolean
}

export function AssistJobsDrawer({
  orgId,
  org,
  orgReady,
  orgSlug,
  user,
  visible,
}: AssistJobsDrawerProps): JSX.Element | null {
  const entitled = orgReady && checkEntitlement(org as never, 'aiGenerative')
  const [expanded, setExpanded] = useState(false)
  const [jobs, setJobs] = useState<AiJobSummary[]>([])
  const [loading, setLoading] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  /** Job ids whose terminal event has been tracked, so a re-read does not count twice. */
  const trackedRef = useRef(new Set<string>())
  /** The job whose stream is open, so a re-render does not open a second. */
  const watchingRef = useRef<string | null>(null)

  const patchJob = useCallback((next: AiJobSummary) => {
    setJobs((prior) => {
      const index = prior.findIndex((job) => job.id === next.id)
      if (index === -1) return [next, ...prior].slice(0, LIST_LIMIT)
      const copy = [...prior]
      copy[index] = next
      return copy
    })
    if (
      AI_JOB_TERMINAL_STATUSES.includes(next.status) &&
      !trackedRef.current.has(next.id)
    ) {
      trackedRef.current.add(next.id)
      if (next.status === 'done') {
        trackEvent('ai_job_completed', { kind: next.kind, credits: next.creditsSpent })
      } else if (next.status === 'failed') {
        trackEvent('ai_job_failed', { kind: next.kind })
      }
    }
  }, [])

  const load = useCallback(async () => {
    if (!orgId) return
    setLoading(true)
    setNotice(null)
    try {
      const response = await authorizedFetch(
        user,
        `/api/ai/jobs?orgId=${encodeURIComponent(orgId)}&limit=${LIST_LIMIT}`,
      )
      if (!response.ok) {
        const payload = await response.json().catch(() => null)
        setNotice(String(payload?.error ?? 'The AI jobs could not be loaded — try again.'))
        return
      }
      const payload = (await response.json()) as { jobs: AiJobSummary[] }
      // Every job that arrives already terminal is one the drawer did not
      // watch finish, so its outcome is not this session's to count.
      for (const job of payload.jobs) {
        if (AI_JOB_TERMINAL_STATUSES.includes(job.status)) trackedRef.current.add(job.id)
      }
      setJobs(payload.jobs)
    } catch {
      setNotice('The AI jobs could not be loaded — try again.')
    } finally {
      setLoading(false)
    }
  }, [orgId, user])

  useEffect(() => {
    if (expanded) void load()
  }, [expanded, load])

  // Reset when the panel's org changes: a list from one workspace must not
  // show under another's key while the new one loads.
  useEffect(() => {
    setJobs([])
    setExpanded(false)
    watchingRef.current = null
  }, [orgId])

  // Watch the most recent job that is still moving. One stream at a time:
  // the route re-reads a document every two seconds per open stream, and a
  // drawer with three running jobs does not need three of them.
  const watched = jobs.find((job) => !AI_JOB_TERMINAL_STATUSES.includes(job.status))
  const watchedId = watched?.id ?? null
  useEffect(() => {
    if (!expanded || !orgId || !watchedId || watchingRef.current === watchedId) return
    watchingRef.current = watchedId
    const controller = new AbortController()
    const watch = async () => {
      // The server closes a stream at its deadline with `reconnect`; the
      // loop here re-opens it until the job settles or the drawer unmounts.
      let again = true
      while (again && !controller.signal.aborted) {
        again = false
        try {
          const response = await authorizedFetch(
            user,
            `/api/ai/jobs/${encodeURIComponent(watchedId)}/events?orgId=${encodeURIComponent(orgId)}`,
            { signal: controller.signal },
          )
          if (!response.ok || !response.body) return
          await readEventFrames(response.body, (event) => {
            if (event['type'] === 'state') patchJob(event['job'] as AiJobSummary)
            else if (event['type'] === 'reconnect') again = true
            else if (event['type'] === 'gone') {
              setJobs((prior) => prior.filter((job) => job.id !== watchedId))
            }
          })
        } catch {
          // The stream ended without a terminal state — a network blip or
          // the drawer closing. The next expand reloads the list.
          return
        }
      }
    }
    void watch().finally(() => {
      if (watchingRef.current === watchedId) watchingRef.current = null
    })
    return () => {
      controller.abort()
      if (watchingRef.current === watchedId) watchingRef.current = null
    }
  }, [expanded, orgId, watchedId, user, patchJob])

  const cancel = useCallback(
    async (jobId: string) => {
      if (!orgId) return
      try {
        const response = await authorizedFetch(
          user,
          `/api/ai/jobs/${encodeURIComponent(jobId)}/cancel`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ orgId }),
          },
        )
        const payload = await response.json().catch(() => null)
        if (!response.ok) {
          setNotice(String(payload?.error ?? 'The job could not be canceled — try again.'))
          return
        }
        if (payload?.job) patchJob(payload.job as AiJobSummary)
      } catch {
        setNotice('The job could not be canceled — try again.')
      }
    },
    [orgId, user, patchJob],
  )

  if (!visible || !orgId || !entitled) return null

  const active = jobs.filter((job) => !AI_JOB_TERMINAL_STATUSES.includes(job.status)).length

  return (
    <Box sx={{ mb: 2, borderBottom: 1, borderColor: 'divider', pb: 1 }}>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
        <Typography variant="subtitle2" sx={{ flexGrow: 1 }}>
          AI jobs
          {active > 0 && (
            <Chip size="small" color="primary" label={`${active} running`} sx={{ ml: 1 }} />
          )}
        </Typography>
        <IconButton
          size="small"
          aria-label={expanded ? 'Hide AI jobs' : 'Show AI jobs'}
          aria-expanded={expanded}
          onClick={() => setExpanded((prior) => !prior)}
        >
          <MdiIcon
            path={expanded ? mdiChevronUp.path : mdiChevronDown.path}
            sx={{ fontSize: 18 }}
          />
        </IconButton>
      </Stack>
      <Collapse in={expanded} unmountOnExit>
        {notice && (
          <Typography variant="caption" color="error" component="div" sx={{ mt: 0.5 }}>
            {notice}
          </Typography>
        )}
        {loading && !jobs.length && (
          <CircularProgress size={16} sx={{ mt: 1 }} aria-label="Loading AI jobs" />
        )}
        {!loading && !jobs.length && !notice && (
          <Typography variant="caption" color="text.secondary" component="div" sx={{ mt: 0.5 }}>
            No AI jobs yet.
          </Typography>
        )}
        <Stack spacing={1} sx={{ mt: 1 }} role="list" aria-label="AI jobs">
          {jobs.map((job) => {
            const stepsDone = job.steps.filter((step) => step.status === 'done').length
            const current = job.steps.find((step) => step.status === 'running')
            const terminal = AI_JOB_TERMINAL_STATUSES.includes(job.status)
            return (
              <Box
                key={job.id}
                role="listitem"
                sx={{ borderRadius: 1, bgcolor: 'action.hover', px: 1.5, py: 1 }}
              >
                <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                  <Chip size="small" variant="outlined" label={job.kind} />
                  <Chip size="small" color={STATUS_COLOR[job.status]} label={STATUS_LABEL[job.status]} />
                  <Typography variant="caption" color="text.secondary" sx={{ flexGrow: 1 }}>
                    {stepsDone}/{job.steps.length} steps
                    {current ? ` — ${current.name}` : ''}
                    {job.creditsSpent > 0 ? ` · ${job.creditsSpent} credits` : ''}
                  </Typography>
                  {!terminal && (
                    <Button size="small" onClick={() => void cancel(job.id)}>
                      Cancel
                    </Button>
                  )}
                </Stack>
                <Typography variant="body2" sx={{ mt: 0.5, wordBreak: 'break-word' }}>
                  {job.brief.length > BRIEF_PREVIEW_CHARS
                    ? `${job.brief.slice(0, BRIEF_PREVIEW_CHARS)}…`
                    : job.brief}
                </Typography>
                {job.error && (
                  <Typography variant="caption" color={job.status === 'failed' ? 'error' : 'warning.main'} component="div">
                    {job.error}
                  </Typography>
                )}
                {job.outputs.map((output, index) => {
                  const href = aiJobOutputHref(output, orgSlug)
                  return (
                    <Box key={`${output.resource}:${output.id}:${index}`} sx={{ mt: 0.5 }}>
                      {href ? (
                        <AppLink componentVariant="naked" href={href}>
                          Open draft — {output.label}
                        </AppLink>
                      ) : output.text ? (
                        <Typography
                          variant="body2"
                          component="pre"
                          sx={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit', m: 0 }}
                        >
                          {output.text}
                        </Typography>
                      ) : (
                        <Typography variant="caption" color="text.secondary">
                          {output.label}
                        </Typography>
                      )}
                    </Box>
                  )
                })}
              </Box>
            )
          })}
        </Stack>
      </Collapse>
    </Box>
  )
}

export default AssistJobsDrawer
