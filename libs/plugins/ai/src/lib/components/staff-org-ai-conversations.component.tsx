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
import { useCallback, useRef, useState, type ReactNode } from 'react'
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
 * What an organization asked Aglyn AI and what it answered (AGL-3675): the
 * Assist chat's questions and answers, and each AI job's brief and result,
 * newest first, on the staff org page.
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

const AssistRow = ({ row }: { row: StaffAiAssistRow }) => (
  <Stack spacing={1}>
    <Meta>
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

const JobRow = ({ row }: { row: StaffAiJobRow }) => (
  <Stack spacing={1}>
    <Meta>
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

const StaffOrgAiConversations = ({ orgId }: { orgId: string }) => {
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
    async (target: StaffAiConversationKind, targetPage: number, after: string | null) => {
      const current = userRef.current
      if (!current || !orgId) return
      setLoading(true)
      setError(null)
      try {
        const params = new URLSearchParams({ orgId, kind: target })
        if (after) params.set('after', after)
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
    [orgId],
  )

  const show = useCallback(
    (target: StaffAiConversationKind) => {
      setKind(target)
      setRows([])
      setNext(null)
      setPage(0)
      setCursors([null])
      void load(target, 0, null)
    },
    [load],
  )

  return (
    <CardDisplay
      header="AI conversations"
      help={pluginDocsHelp('aiMonitoring', {
        anchor: '#ai-conversations',
        excerpt:
          `What this organization asked ${PLATFORM_BRAND_NAME} AI and what it answered: Assist chat questions and answers, and each AI job’s brief and result. Each page staff read is recorded in the audit log, without the text.`,
      })}
      HeaderProps={{
        action:
          kind === null ? (
            <Button size="small" onClick={() => show('assist')}>
              {'Show conversations'}
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
          {`What people in this organization typed to ${PLATFORM_BRAND_NAME} AI, and what it answered. Opening it is recorded in the audit log.`}
        </Typography>
      ) : (
        <Stack spacing={2} divider={<Divider flexItem />}>
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
              <AssistRow key={row.id} row={row as StaffAiAssistRow} />
            ) : (
              <JobRow key={row.id} row={row as StaffAiJobRow} />
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
  )
}

StaffOrgAiConversations.displayName = 'StaffOrgAiConversations'

export default StaffOrgAiConversations
