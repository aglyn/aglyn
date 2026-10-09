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

import { PLATFORM_BRAND_NAME } from '@aglyn/aglyn'
import { pluginDocsHelp } from '@aglyn/aglyn/app-utils/docs-help'
import { CardDisplay } from '@aglyn/shared-ui-jsx'
import { ListPagination } from '@aglyn/shared-ui-jsx/components/list-pagination.component'
import { authorizedFetch } from '@aglyn/shared-util-http/authorized-token'
import { useUser } from '@aglyn/tenant-feature-instance'
import {
  Alert,
  Box,
  Button,
  Chip,
  Divider,
  Stack,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material'
import { buildRoute, Route } from '@aglyn/aglyn/app-utils/console-routes'
import { AppLink } from '@aglyn/shared-ui-jsx'
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import {
  STAFF_AI_CONVERSATIONS_PAGE,
  type StaffAiAssistRow,
  type StaffAiConversationKind,
  type StaffAiConversationPerson,
  type StaffAiConversationsResponse,
  type StaffAiJobResult,
  type StaffAiJobRow,
} from '../usage/staff-org-ai-conversations'

/**
 * "Aglyn AI requests" (AGL-3675, AGL-3660): everything people typed to
 * Aglyn AI and what it answered — the Assist chat's questions (in the console
 * and the Besigner) and answers, and each AI job's brief, the fields filled
 * in beside it (a guided start's form, a Create-with-AI dialog's options)
 * and its result — newest first. On the staff org page for one organization,
 * and on the staff account page for one account across every organization
 * it asked in.
 *
 * Nothing is read until staff ask: the route writes an audited access row
 * for every page it returns, so a card that loaded with the page would log
 * reads nobody chose to make.
 */

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : 'Unknown time')

const who = (person: StaffAiConversationPerson) =>
  person.email ?? person.name ?? (person.uid ? `uid ${person.uid}` : 'Unknown member')

const money = (value: number | null) => (value === null ? null : `$${value.toFixed(value < 1 ? 4 : 2)}`)

/** A block of what someone typed or what came back, kept as written. */
const Words = ({ label, children }: { label: string; children: string }) => (
  <Box>
    <Typography variant="overline" color="text.secondary">
      {label}
    </Typography>
    <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
      {children || '—'}
    </Typography>
  </Box>
)

const Meta = ({ children }: { children: ReactNode }) => (
  <Stack direction="row" useFlexGap sx={{ flexWrap: 'wrap', gap: 1, alignItems: 'center' }}>
    {children}
  </Stack>
)

const AssistRow = ({ row, showOrg }: { row: StaffAiAssistRow; showOrg?: boolean }) => (
  <Stack spacing={1}>
    <Meta>
      {showOrg ? <OrgChip orgId={row.orgId} /> : null}
      <Typography variant="body2" sx={{ fontWeight: 600 }}>
        {who(row.by)}
      </Typography>
      <Typography variant="body2" color="text.secondary">
        {when(row.at)}
      </Typography>
      {row.route ? <Chip size="small" variant="outlined" label={row.route} /> : null}
      {row.model ? <Chip size="small" variant="outlined" label={row.model} /> : null}
      {money(row.estCostUsd) ? <Chip size="small" variant="outlined" label={money(row.estCostUsd)} /> : null}
      {row.feedback ? (
        <Chip size="small" color={row.feedback === 'up' ? 'success' : 'warning'} label={`Rated ${row.feedback}`} />
      ) : null}
    </Meta>
    <Words label="Question">{row.question}</Words>
    <Words label="Answer">{row.answer}</Words>
  </Stack>
)

const Result = ({ result }: { result: StaffAiJobResult }) => {
  switch (result.kind) {
    case 'insight':
      return (
        <Words label="Answer">
          {[...result.insights, ...(result.gap ? [`Not answered: ${result.gap}`] : [])].join('\n\n')}
        </Words>
      )
    case 'crm-record':
      return (
        <Words label="Summary">
          {[result.summary, result.standing, result.nextStep ? `Next step: ${result.nextStep}` : null]
            .filter(Boolean)
            .join('\n\n')}
        </Words>
      )
    case 'crm-email':
      return <Words label="Email draft">{`Subject: ${result.subject}\n\n${result.body}`}</Words>
    case 'crm-mapping':
      return <Words label="Column matches">{result.matches.join('\n')}</Words>
  }
}

/** Where a row was asked, on the account card: the org's staff page. */
const OrgChip = ({ orgId }: { orgId: string | null }) =>
  orgId ? (
    <AppLink
      href={buildRoute(Route.ADMIN_ORG_DETAIL, { orgId })}
      variant="body2"
      underline="hover"
    >
      {`Organization ${orgId.slice(0, 8)}…`}
    </AppLink>
  ) : null

const JobRow = ({ row, showOrg }: { row: StaffAiJobRow; showOrg?: boolean }) => (
  <Stack spacing={1}>
    <Meta>
      {showOrg ? <OrgChip orgId={row.orgId} /> : null}
      <Typography variant="body2" sx={{ fontWeight: 600 }}>
        {who(row.by)}
      </Typography>
      <Typography variant="body2" color="text.secondary">
        {when(row.at)}
      </Typography>
      <Chip size="small" variant="outlined" label={row.kind} />
      <Chip
        size="small"
        color={row.status === 'done' ? 'success' : row.status === 'failed' ? 'error' : 'default'}
        label={row.status}
      />
      <Chip size="small" variant="outlined" label={`${row.credits.toLocaleString()} credits`} />
    </Meta>
    <Words label="Brief">{row.brief}</Words>
    {row.inputs?.length ? (
      <Words label="Filled in">
        {row.inputs.map((input) => `${input.label}: ${input.value}`).join('\n')}
      </Words>
    ) : null}
    {row.result ? <Result result={row.result} /> : null}
    {row.outputs.length ? (
      <Words label="Made">
        {row.outputs
          .map((output) => [output.label, output.note].filter(Boolean).join(' — '))
          .join('\n')}
      </Words>
    ) : null}
    {row.error ? <Alert severity="error">{row.error}</Alert> : null}
  </Stack>
)

/** The anchor an activity row's "Open the AI job" link lands on. */
export const STAFF_AI_REQUESTS_ANCHOR = 'aglyn-ai-requests'

export interface StaffAiRequestsProps {
  /** The staff org page: this organization's requests. */
  orgId?: string
  /** The staff account page: this account's requests, in every org. */
  uid?: string
}

const StaffOrgAiConversations = ({ orgId, uid }: StaffAiRequestsProps) => {
  const subject = uid ? { uid } : orgId ? { orgId } : null
  const account = Boolean(uid)
  // `?aiJob=` — an activity or audit row's link to the job behind it opens
  // the card on that one job; asking for it IS the staff member's ask.
  // Read from the location in an effect rather than `useSearchParams`, which
  // would ask every page this zone sits on for a Suspense boundary.
  const [focusJob, setFocusJob] = useState<string | null>(null)
  useEffect(() => {
    setFocusJob(new URLSearchParams(window.location.search).get('aiJob'))
  }, [])
  const [focused, setFocused] = useState<string | null>(null)
  const focusOpened = useRef(false)
  const { data: user } = useUser()
  const userRef = useRef(user)
  userRef.current = user
  const [kind, setKind] = useState<StaffAiConversationKind | null>(null)
  const [rows, setRows] = useState<Array<StaffAiAssistRow | StaffAiJobRow>>([])
  // The cursor that opens each page: `cursors[page]` is the `after` its
  // request carries, so Previous re-reads a page rather than keeping every
  // page read so far in memory.
  const [cursors, setCursors] = useState<Array<string | null>>([null])
  const [page, setPage] = useState(0)
  const [next, setNext] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(
    async (
      target: StaffAiConversationKind,
      targetPage: number,
      after: string | null,
      jobId: string | null = null,
    ) => {
      const current = userRef.current
      if (!current || !subject) return
      setLoading(true)
      setError(null)
      try {
        const params = new URLSearchParams({ ...subject, kind: target })
        if (after) params.set('after', after)
        if (jobId) params.set('jobId', jobId)
        const response = await authorizedFetch(current, `/api/ai/admin/conversations?${params}`)
        const payload = (await response.json().catch(() => null)) as
          | (StaffAiConversationsResponse & { error?: string })
          | null
        if (!response.ok || !payload) {
          setError(payload?.error ?? 'The conversations could not be read.')
          return
        }
        setRows(payload.rows)
        setPage(targetPage)
        setNext(payload.next)
        setCursors((existing) => {
          const kept = existing.slice(0, targetPage + 1)
          return payload.next ? [...kept, payload.next] : kept
        })
      } catch {
        setError('The conversations could not be read.')
      } finally {
        setLoading(false)
      }
    },
    // `subject` is rebuilt from these two every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [orgId, uid],
  )

  const show = useCallback(
    (target: StaffAiConversationKind) => {
      setFocused(null)
      setKind(target)
      setRows([])
      setNext(null)
      setPage(0)
      setCursors([null])
      void load(target, 0, null)
    },
    [load],
  )

  const signedIn = Boolean(user)
  useEffect(() => {
    // Once per visit: Show all jobs clears the focus and must not bring it back.
    if (account || !focusJob || !signedIn || focusOpened.current) return
    focusOpened.current = true
    setFocused(focusJob)
    setKind('jobs')
    setRows([])
    setNext(null)
    setPage(0)
    setCursors([null])
    void load('jobs', 0, null, focusJob)
    // The card mounts after the page's own hash scroll has come and gone.
    document.getElementById(STAFF_AI_REQUESTS_ANCHOR)?.scrollIntoView({ block: 'start' })
  }, [account, focusJob, signedIn, load])

  return (
    <Box id={STAFF_AI_REQUESTS_ANCHOR} sx={{ scrollMarginTop: 80 }}>
      <CardDisplay
        header={`${PLATFORM_BRAND_NAME} AI requests`}
        help={pluginDocsHelp('aiMonitoring', {
          anchor: '#ai-conversations',
          excerpt:
            `What ${account ? 'this account' : 'this organization'} typed to ${PLATFORM_BRAND_NAME} AI and what it answered: Assist chat questions and answers, and each AI job’s brief, the fields filled in beside it, and its result. Each page staff read is recorded in the audit log, without the text.`,
        })}
        HeaderProps={{
          action:
            kind === null ? (
              <Button size="small" onClick={() => show('assist')}>
                {'Show requests'}
              </Button>
            ) : (
              <ToggleButtonGroup
                size="small"
                exclusive
                value={kind}
                onChange={(_, value: StaffAiConversationKind | null) => value && show(value)}
                aria-label="Which conversations"
              >
                <ToggleButton value="assist">{'Assist chat'}</ToggleButton>
                <ToggleButton value="jobs">{'AI jobs'}</ToggleButton>
              </ToggleButtonGroup>
            ),
        }}
        contentGutterX
        contentGutterY
      >
        {kind === null ? (
          <Typography variant="body2" color="text.secondary">
            {account
              ? `What this account typed to ${PLATFORM_BRAND_NAME} AI in every organization, and what it answered. Opening it is recorded in the audit log, and in this account's data access by staff.`
              : `What people in this organization typed to ${PLATFORM_BRAND_NAME} AI, and what it answered. Opening it is recorded in the audit log.`}
          </Typography>
        ) : (
          <Stack spacing={2} divider={<Divider flexItem />}>
            {focused ? (
              <Alert
                severity="info"
                action={
                  <Button size="small" onClick={() => show('jobs')}>
                    {'Show all jobs'}
                  </Button>
                }
              >
                {'Showing the one AI job the link pointed at.'}
              </Alert>
            ) : null}
            {error ? <Alert severity="warning">{error}</Alert> : null}
            {!loading && !error && !rows.length ? (
              <Typography variant="body2" color="text.secondary">
                {kind === 'assist'
                  ? 'No Assist chat in the last 180 days.'
                  : 'No AI jobs yet.'}
              </Typography>
            ) : null}
            {rows.map((row) =>
              kind === 'assist' ? (
                <AssistRow key={`${row.orgId}:${row.id}`} row={row as StaffAiAssistRow} showOrg={account} />
              ) : (
                <JobRow key={`${row.orgId}:${row.id}`} row={row as StaffAiJobRow} showOrg={account} />
              ),
            )}
            {loading ? (
              <Typography variant="body2" color="text.secondary">
                {'Loading…'}
              </Typography>
            ) : null}
            {rows.length || page > 0 ? (
              <ListPagination
                page={page}
                pageSize={STAFF_AI_CONVERSATIONS_PAGE}
                rowCount={rows.length}
                hasMore={Boolean(next)}
                disabled={loading}
                onPageChange={(target) => void load(kind, target, cursors[target] ?? null)}
              />
            ) : null}
          </Stack>
        )}
      </CardDisplay>
    </Box>
  )
}

StaffOrgAiConversations.displayName = 'StaffOrgAiConversations'

export default StaffOrgAiConversations
