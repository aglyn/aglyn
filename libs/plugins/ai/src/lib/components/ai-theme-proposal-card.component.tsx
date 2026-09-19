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
import type { HostThemeSource } from '@aglyn/aglyn/app-utils/marketplace-theme'
import type { ConsoleHostThemeZoneProps } from '@aglyn/aglyn/plugin-manager/feature-plugins'
import type { HostThemeScheme } from '@aglyn/shared-data-types'
import { CardDisplay } from '@aglyn/shared-ui-jsx'
import { ScrollTable } from '@aglyn/shared-ui-jsx/components/scroll-table.component'
import { themeEditorControl } from '@aglyn/shared-ui-theme/util/theme-editor-fields'
import { authorizedFetch } from '@aglyn/shared-util-http/authorized-token'
import { useUser } from '@aglyn/tenant-feature-instance'
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Grid,
  Stack,
  Tab,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Tabs,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AI_JOB_TERMINAL_STATUSES,
  type AiJobSummary,
} from '../model/ai-jobs.types'
import {
  aiThemeColorToken,
  aiThemeProposalAfter,
  aiThemeStaleChanges,
  readAiThemeProposal,
  type AiThemeControlChange,
  type AiThemeCorrection,
  type AiThemeProposal,
  type AiThemeProposalMode,
} from '../model/ai-theme-proposal'
import { readEventFrames } from './assist-jobs-drawer.component'

/**
 * The theme assistant (AGL-2938), on the site's Theme section through the
 * `hostTheme` zone: a brief in, a theme proposal out, previewed before and
 * after with the editor's own preview, and put in the editor below as
 * unsaved changes when the person chooses. It never writes the theme — the
 * editor's Save does, through the same guarded path every edit takes.
 *
 * It renders nothing until the jobs route has answered for this workspace.
 * The shell has already decided the plan and the member's permission before
 * mounting it, but a released-off feature does not exist, and the release
 * flag is the route's to decide: a 404 there is this card staying absent.
 * The same read lists the site's recent proposals, so one made while the
 * person was elsewhere is still here to preview.
 */

/** How many recent jobs the card reads to find this site's proposals. */
const RECENT_JOBS_READ = 20

/** How many of this site's proposals the card offers again. */
const RECENT_PROPOSALS_SHOWN = 3

const BRIEF_MAX_CHARS = 4_000

const SOURCE_COPY: Record<HostThemeSource, string> = {
  installed:
    'Saved as your changes on top of the installed theme. The publisher’s version stays as it is and can still take an update.',
  custom: 'Changes this site’s own theme.',
  default:
    'Only these values are stored. Everything else keeps following the default theme.',
}

type Verdict = 'checking' | 'ready' | 'hidden'

const isTerminal = (job: AiJobSummary) => AI_JOB_TERMINAL_STATUSES.includes(job.status)

/** The proposal a theme job produced, when it produced one. */
function proposalOf(job: AiJobSummary | null): AiThemeProposal | null {
  const output = job?.outputs.find((entry) => entry.resource === 'theme')
  return output ? readAiThemeProposal(output.proposal) : null
}

/** A control's label, with its scheme when it has one. */
function changeLabel(change: Pick<AiThemeControlChange, 'control' | 'scheme'>): string {
  return themeEditorControl(change.control).label
}

function Swatch({ value }: { value: string | number | null }) {
  if (value === null) {
    return (
      <Typography variant="caption" color="text.secondary">
        {'Default'}
      </Typography>
    )
  }
  const text = String(value)
  const color = typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value)
  return (
    <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
      {color ? (
        <Box
          aria-hidden
          sx={{
            width: 14,
            height: 14,
            borderRadius: 0.5,
            border: 1,
            borderColor: 'divider',
            backgroundColor: text,
            flexShrink: 0,
          }}
        />
      ) : null}
      <Typography variant="body2" sx={{ fontFamily: 'monospace', wordBreak: 'break-all' }}>
        {text}
      </Typography>
    </Stack>
  )
}

function correctionText(correction: AiThemeCorrection): string {
  const label = `${changeLabel(correction)} (${correction.scheme})`
  if (correction.reason === 'dark-value') {
    return `${label} set to ${correction.to} so the color keeps reading on the dark background.`
  }
  return (
    `${label} moved to ${correction.to} to reach ${correction.required}:1` +
    (correction.against?.length ? ` against ${correction.against.join(' and ')}` : '') +
    (correction.ratio ? ` (it was ${correction.ratio}:1).` : '.')
  )
}

export function AiThemeProposalCard(props: ConsoleHostThemeZoneProps) {
  const { hostId, orgId, theme, themeSource, ThemePreview, proposeDraft } = props
  const { data: user } = useUser()
  // Held in a ref so the reads below key on WHO is signed in, never on the
  // identity of the object that says so.
  const userRef = useRef(user)
  userRef.current = user
  const uid = user?.uid ?? null

  const [verdict, setVerdict] = useState<Verdict>('checking')
  const [notice, setNotice] = useState<string | null>(null)
  const [recent, setRecent] = useState<AiJobSummary[]>([])
  const [brief, setBrief] = useState('')
  const [mode, setMode] = useState<AiThemeProposalMode>('modify')
  const [busy, setBusy] = useState(false)
  const [job, setJob] = useState<AiJobSummary | null>(null)
  const [scheme, setScheme] = useState<HostThemeScheme>('light')
  const [applied, setApplied] = useState<string | null>(null)
  const watchRef = useRef<AbortController | null>(null)

  useEffect(() => () => watchRef.current?.abort(), [])

  useEffect(() => {
    if (!orgId || !hostId || !uid) return
    let active = true
    setVerdict('checking')
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
              : String(payload?.error ?? 'Recent theme proposals could not be loaded.'),
          )
        } else {
          const jobs = (payload?.jobs ?? []) as AiJobSummary[]
          setRecent(
            jobs
              .filter((entry) => entry.kind === 'theme' && entry.hostId === hostId)
              .filter((entry) => proposalOf(entry) !== null)
              .slice(0, RECENT_PROPOSALS_SHOWN),
          )
        }
        setVerdict('ready')
      } catch {
        if (!active) return
        setNotice('Recent theme proposals could not be loaded.')
        setVerdict('ready')
      }
    })()
    return () => {
      active = false
    }
  }, [orgId, hostId, uid])

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

  const propose = useCallback(async () => {
    if (!orgId || !brief.trim()) return
    setBusy(true)
    setNotice(null)
    setApplied(null)
    try {
      const response = await authorizedFetch(userRef.current, '/api/ai/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orgId,
          hostId,
          kind: 'theme',
          brief: brief.trim(),
          inputs: { mode },
        }),
      })
      const payload = await response.json().catch(() => null)
      if (!response.ok) {
        const locked = parseLockdownRefusal(response.status, payload)
        setNotice(
          locked
            ? lockdownRefusalText(locked)
            : String(payload?.error ?? 'The theme proposal could not be started — try again.'),
        )
        return
      }
      const next = payload?.job as AiJobSummary | undefined
      if (!next) return
      setJob(next)
      if (!isTerminal(next)) await watch(next.id, orgId)
    } catch {
      setNotice('The theme proposal could not be started — try again.')
    } finally {
      setBusy(false)
    }
  }, [orgId, hostId, brief, mode, watch])

  const proposal = useMemo(() => proposalOf(job), [job])
  const after = useMemo(
    () => (proposal ? aiThemeProposalAfter(theme, proposal) : null),
    [theme, proposal],
  )
  const stale = useMemo(
    () => (proposal ? aiThemeStaleChanges(theme, proposal).length > 0 : false),
    [theme, proposal],
  )

  const apply = useCallback(() => {
    if (!job || !after) return
    proposeDraft(after.theme, job.id)
    setApplied(job.id)
  }, [job, after, proposeDraft])

  if (verdict !== 'ready') return null

  const running = Boolean(job && !isTerminal(job))

  return (
      <CardDisplay
        contentGutterX
        contentGutterY
        header="Theme assistant"
        help={pluginDocsHelp('aiThemes', {
          excerpt:
            'Describe the change and get a proposal for every control the editor has, previewed before and after. Nothing is saved until you save it in the editor.',
        })}
      >
        <Stack spacing={2}>
          <ToggleButtonGroup
            exclusive
            size="small"
            value={mode}
            onChange={(_, value: AiThemeProposalMode | null) => value && setMode(value)}
            aria-label="What to propose"
          >
            <ToggleButton value="modify">{'Change what I describe'}</ToggleButton>
            <ToggleButton value="create">{'Design a new theme'}</ToggleButton>
          </ToggleButtonGroup>
          <TextField
            multiline
            minRows={2}
            fullWidth
            label="Describe the change"
            placeholder="Warmer, with a deep green primary and bigger headings on mobile"
            helperText="A hex color in your description is used exactly. Paste a link to borrow a page’s colors."
            value={brief}
            onChange={(event) => setBrief(event.target.value.slice(0, BRIEF_MAX_CHARS))}
            disabled={busy}
          />
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            <Button variant="contained" disabled={busy || !brief.trim()} onClick={() => void propose()}>
              {'Propose changes'}
            </Button>
            {running ? <CircularProgress size={18} aria-label="Working on a proposal" /> : null}
          </Stack>
          {notice ? <Alert severity="warning">{notice}</Alert> : null}

          {job && job.error && !proposal ? (
            <Alert severity={job.status === 'failed' ? 'error' : 'warning'}>{job.error}</Alert>
          ) : null}

          {!job && recent.length ? (
            <Stack spacing={1}>
              <Typography variant="subtitle2">{'Recent proposals for this site'}</Typography>
              {recent.map((entry) => (
                <Stack key={entry.id} direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                  <Typography variant="body2" sx={{ flexGrow: 1, minWidth: 0 }} noWrap>
                    {entry.brief}
                  </Typography>
                  <Button size="small" onClick={() => setJob(entry)}>
                    {'Show'}
                  </Button>
                </Stack>
              ))}
            </Stack>
          ) : null}

          {proposal && after ? (
            <Stack spacing={2} aria-label="Theme proposal">
              {proposal.summary ? <Typography variant="body1">{proposal.summary}</Typography> : null}
              <Typography variant="body2" color="text.secondary">
                {SOURCE_COPY[proposal.source]}
              </Typography>
              {stale ? (
                <Alert severity="info">
                  {'The theme has changed since this proposal was made. The preview and the editor apply it to the theme as it is now.'}
                </Alert>
              ) : null}

              {proposal.changes.length || proposal.components.length || proposal.resetComponents ? (
                <Box>
                  <ScrollTable size="small" aria-label="Proposed changes">
                    <TableHead>
                      <TableRow>
                        <TableCell>{'Control'}</TableCell>
                        <TableCell>{'Now'}</TableCell>
                        <TableCell>{'Proposed'}</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {proposal.changes.map((change) => (
                        <TableRow key={`${change.control}:${change.scheme ?? ''}`}>
                          <TableCell>
                            <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                              <Typography variant="body2">{changeLabel(change)}</Typography>
                              {aiThemeColorToken(change.control) && change.scheme ? (
                                <Chip size="small" variant="outlined" label={change.scheme} />
                              ) : null}
                            </Stack>
                          </TableCell>
                          <TableCell>
                            <Swatch value={change.before} />
                          </TableCell>
                          <TableCell>
                            <Swatch value={change.value} />
                          </TableCell>
                        </TableRow>
                      ))}
                      {proposal.resetComponents ? (
                        <TableRow>
                          <TableCell>{themeEditorControl('components').label}</TableCell>
                          <TableCell>{'This site’s overrides'}</TableCell>
                          <TableCell>{'Theme defaults'}</TableCell>
                        </TableRow>
                      ) : null}
                      {proposal.components.map((leaf) => (
                        <TableRow key={`${leaf.component}:${leaf.target}:${leaf.slot}:${leaf.media}:${leaf.property}`}>
                          <TableCell>
                            <Typography variant="body2">
                              {[
                                leaf.component,
                                leaf.target === 'defaultProps' ? 'default' : leaf.slot,
                                leaf.property,
                              ].join(' · ')}
                            </Typography>
                            {leaf.media ? <Chip size="small" variant="outlined" label={leaf.media} /> : null}
                          </TableCell>
                          <TableCell>{'—'}</TableCell>
                          <TableCell>
                            <Swatch value={typeof leaf.value === 'boolean' ? String(leaf.value) : leaf.value} />
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </ScrollTable>
                </Box>
              ) : (
                <Typography variant="body2">{'No changes proposed.'}</Typography>
              )}

              {[...proposal.corrections, ...after.corrections].length ? (
                <Stack spacing={0.5}>
                  <Typography variant="subtitle2">{'Adjusted for readability'}</Typography>
                  {[...proposal.corrections, ...after.corrections].map((correction) => (
                    <Typography
                      key={`${correction.control}:${correction.scheme}:${correction.to}`}
                      variant="body2"
                    >
                      {correctionText(correction)}
                    </Typography>
                  ))}
                </Stack>
              ) : null}

              {[...proposal.notes, ...after.notes, ...proposal.dropped].length ? (
                <Stack spacing={0.5}>
                  <Typography variant="subtitle2">{'Worth knowing'}</Typography>
                  {[...proposal.notes, ...after.notes].map((line) => (
                    <Typography key={`note:${line}`} variant="body2" color="text.secondary">
                      {line}
                    </Typography>
                  ))}
                  {proposal.dropped.map((line) => (
                    <Typography key={`dropped:${line}`} variant="body2" color="text.secondary">
                      {`Left out — ${line}`}
                    </Typography>
                  ))}
                </Stack>
              ) : null}

              <Tabs
                value={scheme}
                onChange={(_, value: HostThemeScheme) => setScheme(value)}
                aria-label="Preview scheme"
              >
                <Tab label="Light" value="light" />
                <Tab label="Dark" value="dark" />
              </Tabs>
              <Grid container spacing={2}>
                <Grid size={{ xs: 12, md: 6 }}>
                  <Typography variant="subtitle2" gutterBottom>
                    {'Before'}
                  </Typography>
                  <Box data-preview="before">
                    <ThemePreview theme={theme ?? {}} scheme={scheme} />
                  </Box>
                </Grid>
                <Grid size={{ xs: 12, md: 6 }}>
                  <Typography variant="subtitle2" gutterBottom>
                    {'After'}
                  </Typography>
                  <Box data-preview="after">
                    <ThemePreview theme={after.theme} scheme={scheme} />
                  </Box>
                </Grid>
              </Grid>

              {applied === job?.id ? (
                <Alert severity="success">
                  {'In the editor below as unsaved changes. Review them there, then Save — or Discard changes to go back.'}
                </Alert>
              ) : null}
              <Stack direction="row" spacing={1}>
                <Button variant="contained" onClick={apply} disabled={applied === job?.id}>
                  {'Put in the editor'}
                </Button>
                <Button
                  onClick={() => {
                    setJob(null)
                    setApplied(null)
                  }}
                >
                  {'Dismiss'}
                </Button>
              </Stack>
            </Stack>
          ) : null}
        </Stack>
      </CardDisplay>
  )
}
AiThemeProposalCard.displayName = 'AiThemeProposalCard'

export default AiThemeProposalCard
