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

import { lockdownRefusalText, parseLockdownRefusal } from '@aglyn/aglyn'
import { INSIGHT_DIGESTS_FIELD, insightDigestSubscribed } from '@aglyn/aglyn/app-utils/notifications'
import { AppLink } from '@aglyn/shared-ui-jsx'
import { authorizedFetch } from '@aglyn/shared-util-http/authorized-token'
import { useFirestore } from '@aglyn/tenant-feature-instance'
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material'
import { doc, getDoc, setDoc } from 'firebase/firestore'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  AI_INSIGHT_DEFAULT_DAYS,
  AI_INSIGHT_QUESTION_MAX_CHARS,
  AI_INSIGHT_WINDOWS,
  aiInsightRowText,
  aiInsightSourceHref,
  type AiInsightAnswerWire,
  type AiInsightSurface,
} from '../model/ai-insight'
import { AI_JOB_TERMINAL_STATUSES, type AiJobSummary } from '../model/ai-jobs.types'
import { readEventFrames } from './assist-jobs-drawer.component'

/**
 * "Ask about your numbers" (AGL-2915): the Assist panel's question box on a
 * site's Analytics, Data and CRM Reports pages and the workspace's Data page,
 * and the answer an `insight` job wrote.
 *
 * A question starts a job, which reads the figures and answers on the jobs
 * beat; the dialog watches the job and then reads the answer through
 * `/api/ai/insights/{jobId}`, the only door to it. Every insight shows the
 * rows it was traced to and links the console page they come from, so a
 * person can check a number before acting on it. Nothing here writes anything
 * but the person's own weekly-insights switch.
 */

/** Placeholder questions by surface, in the words a person would use. */
const PLACEHOLDERS: Record<Exclude<AiInsightSurface, 'digest'>, string> = {
  analytics: 'Which pages brought in the most visitors, and did anything change?',
  datasets: 'What is the average order total by state?',
  'crm-reports': 'Which campaign or form brought in the most people this month?',
}

export interface AiInsightDialogProps {
  open: boolean
  onClose: () => void
  orgId: string
  /** The org's slug, for the links to the pages a table's figures come from. */
  orgSlug: string
  /** The site the question is about; `null` on the workspace's Data page. */
  hostId: string | null
  /** The site's subdomain, which a console link names a site by. */
  host: string | null
  surface: Exclude<AiInsightSurface, 'digest'>
  user: Parameters<typeof authorizedFetch>[0]
  /** The signed-in person, whose weekly-insights switch the dialog shows. */
  uid: string | null
  /** An answered job to show rather than a question to ask. */
  jobId?: string | null
}

type Phase = 'ask' | 'working' | 'answer'

export function AiInsightDialog(props: AiInsightDialogProps) {
  const { open, onClose, orgId, orgSlug, hostId, host, surface, jobId } = props
  // Held in a ref: a request reads who is signed in, and nothing keys on the
  // identity of the object that says so.
  const userRef = useRef(props.user)
  userRef.current = props.user
  const uid = props.uid
  const firestore = useFirestore()
  const [phase, setPhase] = useState<Phase>('ask')
  const [question, setQuestion] = useState('')
  const [days, setDays] = useState(AI_INSIGHT_DEFAULT_DAYS)
  const [notice, setNotice] = useState<string | null>(null)
  const [answer, setAnswer] = useState<AiInsightAnswerWire | null>(null)
  const [openCitations, setOpenCitations] = useState<number | null>(null)
  const [subscribed, setSubscribed] = useState<boolean | null>(null)
  const watchRef = useRef<AbortController | null>(null)

  const readAnswer = useCallback(
    async (id: string) => {
      const response = await authorizedFetch(
        userRef.current,
        `/api/ai/insights/${encodeURIComponent(id)}?orgId=${encodeURIComponent(orgId)}`,
      )
      const payload = await response.json().catch(() => null)
      if (!response.ok || !payload?.answer) {
        setNotice(String(payload?.error ?? 'The answer could not be loaded. Try again.'))
        setPhase('ask')
        return
      }
      setAnswer(payload.answer as AiInsightAnswerWire)
      setPhase('answer')
    },
    [orgId],
  )

  /** Follows a job until it settles, then reads its answer or says why there is none. */
  const follow = useCallback(
    async (job: AiJobSummary) => {
      const settle = async (settled: AiJobSummary) => {
        if (settled.status === 'done') await readAnswer(settled.id)
        else {
          setNotice(settled.error ?? 'The question could not be answered. Try again.')
          setPhase('ask')
        }
      }
      if (AI_JOB_TERMINAL_STATUSES.includes(job.status)) return settle(job)
      setPhase('working')
      const controller = new AbortController()
      watchRef.current?.abort()
      watchRef.current = controller
      let again = true
      while (again && !controller.signal.aborted) {
        again = false
        let settled: AiJobSummary | null = null
        try {
          const response = await authorizedFetch(
            userRef.current,
            `/api/ai/jobs/${encodeURIComponent(job.id)}/events?orgId=${encodeURIComponent(orgId)}`,
            { signal: controller.signal },
          )
          if (!response.ok || !response.body) break
          await readEventFrames(response.body, (event) => {
            if (event['type'] === 'reconnect') again = true
            if (event['type'] !== 'state') return
            const next = event['job'] as AiJobSummary
            if (next.status === 'needs_input') {
              setNotice(next.error ?? 'This workspace cannot run AI jobs right now.')
            }
            if (AI_JOB_TERMINAL_STATUSES.includes(next.status)) settled = next
          })
        } catch {
          if (controller.signal.aborted) return
          break
        }
        if (settled) return settle(settled)
      }
      if (!controller.signal.aborted) {
        setNotice('The answer is still being written. Find it under AI jobs in a minute.')
        setPhase('ask')
      }
    },
    [orgId, readAnswer],
  )

  useEffect(() => {
    if (!open) {
      watchRef.current?.abort()
      return
    }
    setNotice(null)
    setOpenCitations(null)
    if (jobId) {
      setPhase('working')
      void readAnswer(jobId)
    } else {
      setAnswer(null)
      setPhase('ask')
    }
  }, [open, jobId, readAnswer])

  // The person's own weekly-insights switch, read when the dialog opens.
  useEffect(() => {
    if (!open || !uid || !orgId) return
    let active = true
    void getDoc(doc(firestore, 'users', uid))
      .then((snapshot) => {
        if (active) {
          setSubscribed(
            insightDigestSubscribed(snapshot.get(INSIGHT_DIGESTS_FIELD) as Record<string, boolean>, orgId),
          )
        }
      })
      .catch(() => undefined)
    return () => {
      active = false
    }
  }, [open, uid, orgId, firestore])

  const toggleDigest = useCallback(async () => {
    if (!uid || subscribed === null) return
    const next = !subscribed
    setSubscribed(next)
    try {
      await setDoc(doc(firestore, 'users', uid), { [INSIGHT_DIGESTS_FIELD]: { [orgId]: next } }, { merge: true })
    } catch {
      setSubscribed(!next)
      setNotice('Your weekly insights setting could not be saved. Try again.')
    }
  }, [uid, subscribed, firestore, orgId])

  const ask = useCallback(async () => {
    const text = question.trim()
    if (!text) return
    setNotice(null)
    setPhase('working')
    try {
      const response = await authorizedFetch(userRef.current, '/api/ai/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orgId,
          hostId,
          kind: 'insight',
          brief: text,
          inputs: { surface, days },
        }),
      })
      const payload = await response.json().catch(() => null)
      if (!response.ok || !payload?.job) {
        const locked = parseLockdownRefusal(response.status, payload)
        setNotice(locked ? lockdownRefusalText(locked) : String(payload?.error ?? 'The question could not be asked. Try again.'))
        setPhase('ask')
        return
      }
      await follow(payload.job as AiJobSummary)
    } catch {
      setNotice('The question could not be asked. Try again.')
      setPhase('ask')
    }
  }, [question, orgId, hostId, surface, days, follow])

  const tableByRef = (ref: string) => answer?.tables.find((table) => table.ref === ref) ?? null

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm" aria-labelledby="ai-insight-title">
      <DialogTitle id="ai-insight-title">{'Ask about your numbers'}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          {phase === 'ask' ? (
            <>
              <TextField
                label="What do you want to know?"
                placeholder={PLACEHOLDERS[surface]}
                multiline
                minRows={2}
                value={question}
                onChange={(event) => setQuestion(event.target.value.slice(0, AI_INSIGHT_QUESTION_MAX_CHARS))}
                autoFocus
              />
              {surface !== 'datasets' ? (
                <Stack spacing={1}>
                  <Typography variant="body2" color="text.secondary" id="ai-insight-window-label">
                    {'Over the last'}
                  </Typography>
                  <Stack direction="row" useFlexGap role="group" aria-labelledby="ai-insight-window-label" sx={{ flexWrap: 'wrap', gap: 1 }}>
                    {AI_INSIGHT_WINDOWS.map((window) => (
                      <Chip
                        key={window}
                        label={`${window} days`}
                        color={days === window ? 'primary' : 'default'}
                        variant={days === window ? 'filled' : 'outlined'}
                        onClick={() => setDays(window)}
                        aria-pressed={days === window}
                      />
                    ))}
                  </Stack>
                </Stack>
              ) : null}
              <Typography variant="body2" color="text.secondary">
                {'The answer is read from your own figures, and every number in it links to where it comes from. '}
                {'Nothing is changed or sent.'}
              </Typography>
            </>
          ) : null}
          {phase === 'working' ? (
            <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }} role="status">
              <CircularProgress size={18} />
              <Typography variant="body2">{'Reading your figures. This usually takes a minute.'}</Typography>
            </Stack>
          ) : null}
          {phase === 'answer' && answer ? (
            <Stack spacing={1.5}>
              <Typography variant="subtitle2">{answer.question}</Typography>
              {answer.insights.length ? (
                <Stack component="ol" spacing={1.5} sx={{ pl: 2.5, m: 0 }}>
                  {answer.insights.map((insight, index) => (
                    <Box component="li" key={index}>
                      <Typography variant="body2">{insight.text}</Typography>
                      <Button
                        size="small"
                        onClick={() => setOpenCitations((current) => (current === index ? null : index))}
                        aria-expanded={openCitations === index}
                      >
                        {openCitations === index ? 'Hide the figures' : 'Show the figures'}
                      </Button>
                      {openCitations === index ? (
                        <Stack spacing={1} sx={{ pl: 1, borderLeft: 2, borderColor: 'divider' }}>
                          {insight.cites.map((cite) => {
                            const table = tableByRef(cite.table)
                            if (!table) return null
                            const href = aiInsightSourceHref(table, { orgSlug, host })
                            return (
                              <Box key={cite.table}>
                                <Typography variant="caption" color="text.secondary" component="div">
                                  {table.period
                                    ? `${table.title} · ${table.period.from} to ${table.period.to}`
                                    : table.title}
                                  {href ? (
                                    <>
                                      {' · '}
                                      <AppLink componentVariant="naked" href={href}>
                                        {`Open ${table.source.label}`}
                                      </AppLink>
                                    </>
                                  ) : null}
                                </Typography>
                                {cite.rows.map((row) => (
                                  <Typography key={row} variant="caption" component="div">
                                    {aiInsightRowText(table, row)}
                                  </Typography>
                                ))}
                              </Box>
                            )
                          })}
                        </Stack>
                      ) : null}
                    </Box>
                  ))}
                </Stack>
              ) : (
                <Alert severity="info">{'The figures read here did not answer this question.'}</Alert>
              )}
              {answer.gap ? <Alert severity="info">{answer.gap}</Alert> : null}
              {answer.left > 0 ? (
                <Typography variant="caption" color="text.secondary">
                  {`${answer.left} ${answer.left === 1 ? 'insight was' : 'insights were'} left out because ${
                    answer.left === 1 ? 'its numbers' : 'their numbers'
                  } could not be traced to the figures.`}
                </Typography>
              ) : null}
            </Stack>
          ) : null}
          {notice ? <Alert severity="warning">{notice}</Alert> : null}
          {surface !== 'datasets' && subscribed !== null ? (
            <FormControlLabel
              control={<Switch checked={subscribed} onChange={() => void toggleDigest()} />}
              label="Send me weekly insights for this workspace every Monday"
            />
          ) : null}
        </Stack>
      </DialogContent>
      <DialogActions>
        {phase === 'answer' && !jobId ? (
          <Button
            onClick={() => {
              setAnswer(null)
              setQuestion('')
              setPhase('ask')
            }}
          >
            {'Ask another'}
          </Button>
        ) : null}
        <Button onClick={onClose}>{'Close'}</Button>
        {phase === 'ask' ? (
          <Button variant="contained" onClick={() => void ask()} disabled={!question.trim()}>
            {'Ask'}
          </Button>
        ) : null}
      </DialogActions>
    </Dialog>
  )
}

export default AiInsightDialog
