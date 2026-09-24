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

import { pluginDocsHelp } from '@aglyn/aglyn'
import { CardDisplay, useConfirmationContext } from '@aglyn/shared-ui-jsx'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { Alert, Box, Button, Chip, Divider, Stack, Typography } from '@mui/material'
import { useCallback, useEffect, useState } from 'react'
import type {
  OutreachLinkDomain,
  OutreachLinkDomainRequest,
  OutreachLinkDomainStatus,
  OutreachLinkDomainsResponse,
} from '../model/outreach-api'
import { OutreachLoading, OutreachLoadProblem } from './outreach-ui'
import { OutreachRouteError, useOutreachApi } from './use-outreach-api'

export interface OutreachLinkDomainsCardProps {
  /** The organization the hub is mounted under; `null` until the shell knows it. */
  orgId: string | null
}

/** Where a link domain stands, as the card's chip says it. */
export const OUTREACH_LINK_DOMAIN_STATUS_LABELS: Record<OutreachLinkDomainStatus, string> = {
  'not-set-up': 'Not set up',
  requested: 'Not added yet',
  'records-issued': 'Waiting for DNS',
  verified: 'Verified',
  failed: 'Not answering',
}

const STATUS_COLORS: Record<OutreachLinkDomainStatus, 'default' | 'success' | 'warning' | 'error'> = {
  'not-set-up': 'default',
  requested: 'warning',
  'records-issued': 'warning',
  verified: 'success',
  failed: 'error',
}

/** Accessible names of the card's controls, spelled once for the specs. */
export const LINK_DOMAIN_LABELS = {
  setUp: (host: string) => `Set up ${host}`,
  check: (host: string) => `Check ${host}`,
  remove: (host: string) => `Remove ${host}`,
} as const

type Load =
  | { status: 'loading' }
  | { status: 'ready'; data: OutreachLinkDomainsResponse }
  | { status: 'error' | 'refused' }

/**
 * Sequences → Mailboxes → Link domains (AGL-3306): the host tracked links in
 * a mailbox's email point at.
 *
 * With **Count link clicks** on, every link in a sequence email is a short
 * link. It reads `https://links.<the mailbox's domain>/…` once that host is
 * set up here and verified — the same `links.` name, CNAME and check a
 * sending domain's campaign click tracking uses — and the app's own address
 * until then. A link on your own domain looks like the rest of your email.
 */
export function OutreachLinkDomainsCard(props: OutreachLinkDomainsCardProps) {
  const { orgId } = props
  const api = useOutreachApi(orgId)
  const { enqueueSnackbar } = useSnackbar()
  const { confirm } = useConfirmationContext()
  const [load, setLoad] = useState<Load>({ status: 'loading' })
  const [busy, setBusy] = useState<string | null>(null)

  useEffect(() => {
    if (!orgId) return undefined
    let current = true
    setLoad({ status: 'loading' })
    api
      .readLinkDomains()
      .then((data) => current && setLoad({ status: 'ready', data }))
      .catch(
        (error: Error) =>
          current &&
          setLoad({ status: error instanceof OutreachRouteError && error.refused ? 'refused' : 'error' }),
      )
    return () => {
      current = false
    }
  }, [api, orgId])

  const change = useCallback(
    async (action: OutreachLinkDomainRequest['action'], row: OutreachLinkDomain) => {
      if (action === 'remove') {
        const confirmed = await confirm({
          title: `Remove ${row.host}?`,
          description:
            `Links already sent on ${row.host} stop working, and new sequence emails use this ` +
            'app’s address instead. Remove it only once no one will click those links again.',
          confirmationText: 'Remove',
          confirmationButtonProps: { color: 'error' },
        })
          .then(() => true)
          .catch(() => false)
        if (!confirmed) return
      }
      setBusy(row.domain)
      try {
        const answer = await api.changeLinkDomain(action, row.domain)
        setLoad({ status: 'ready', data: answer })
        const now = answer.domains.find((entry) => entry.domain === row.domain)
        enqueueSnackbar(
          action === 'remove'
            ? `${row.host} is no longer a link domain.`
            : now?.status === 'verified'
              ? `${row.host} is verified. Tracked links now use it.`
              : action === 'set-up'
                ? `${row.host} is set up. Publish the DNS record, then check it.`
                : (now?.detail ?? `${row.host} is not verified yet.`),
          { variant: now?.status === 'verified' || action === 'remove' ? 'success' : 'info' },
        )
      } catch (error) {
        enqueueSnackbar((error as Error).message, { variant: 'error', allowDuplicate: true })
      } finally {
        setBusy(null)
      }
    },
    [api, confirm, enqueueSnackbar],
  )

  return (
    <CardDisplay
      header="Link domains"
      help={pluginDocsHelp('sequences', { anchor: '#link-domains' })}
      contentGutterX
      contentGutterY
    >
      <Stack spacing={2}>
        <Typography variant="body2" color="text.secondary">
          {'With Count link clicks on, the links in a sequence email are short links. Set up your ' +
            'mailbox domain’s links host and they read links.<your domain> instead of this app’s ' +
            'address — your own domain, like the rest of the email.'}
        </Typography>
        {load.status === 'loading' ? <OutreachLoading label="Loading link domains…" /> : null}
        {load.status === 'error' || load.status === 'refused' ? (
          <OutreachLoadProblem status={load.status} what="the link domains" />
        ) : null}
        {load.status === 'ready' && !load.data.domains.length ? (
          <Typography variant="body2" color="text.secondary">
            Connect a mailbox on your own domain to set up its link domain.
          </Typography>
        ) : null}
        {load.status === 'ready'
          ? load.data.domains.map((row, index) => (
              <Stack key={row.domain} spacing={1.5}>
                {index > 0 ? <Divider /> : null}
                <LinkDomainRow
                  row={row}
                  canManage={load.data.canManage}
                  busy={busy !== null}
                  onAction={(action) => void change(action, row)}
                />
              </Stack>
            ))
          : null}
      </Stack>
    </CardDisplay>
  )
}
OutreachLinkDomainsCard.displayName = 'OutreachLinkDomainsCard'

function LinkDomainRow(props: {
  row: OutreachLinkDomain
  canManage: boolean
  busy: boolean
  onAction: (action: OutreachLinkDomainRequest['action']) => void
}) {
  const { row, canManage, busy, onAction } = props
  const setUp = row.status !== 'not-set-up'
  return (
    <Stack spacing={1}>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
        <Typography variant="body2" sx={{ fontWeight: 500, wordBreak: 'break-all' }}>
          {row.host}
        </Typography>
        <Chip
          size="small"
          variant="outlined"
          color={STATUS_COLORS[row.status]}
          label={OUTREACH_LINK_DOMAIN_STATUS_LABELS[row.status]}
        />
      </Stack>
      {row.linkPrefix ? (
        <Typography variant="caption" color="text.secondary" sx={{ wordBreak: 'break-all' }}>
          {`Links in email from ${row.domain} read ${row.linkPrefix}…`}
        </Typography>
      ) : null}
      {row.detail && row.status !== 'verified' ? <Alert severity="info">{row.detail}</Alert> : null}
      {setUp && row.status !== 'verified' && row.records.length ? (
        <Stack spacing={1} component="dl" sx={{ m: 0 }}>
          {row.records.map((record) => (
            <Box
              key={`${record.type}:${record.name}:${record.value}`}
              sx={{ border: 1, borderColor: 'divider', borderRadius: 1, p: 1.5 }}
            >
              <Typography variant="caption" component="dt" color="text.secondary">
                {`${record.type} · ${record.name}${record.required ? '' : ' · if needed'}`}
              </Typography>
              <Typography
                variant="body2"
                component="dd"
                sx={{ m: 0, fontFamily: 'monospace', wordBreak: 'break-all' }}
              >
                {record.value}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {record.note}
              </Typography>
            </Box>
          ))}
        </Stack>
      ) : null}
      {setUp && row.status !== 'verified' && !row.records.length ? (
        <Typography variant="body2" color="text.secondary">
          {`Point ${row.host} at this app — a CNAME to its address, or your proxy’s — then check it.`}
        </Typography>
      ) : null}
      <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap' }}>
        {!setUp && canManage ? (
          <Button
            variant="outlined"
            size="small"
            disabled={busy}
            aria-label={LINK_DOMAIN_LABELS.setUp(row.host)}
            onClick={() => onAction('set-up')}
          >
            Set up
          </Button>
        ) : null}
        {setUp ? (
          <Button
            variant="outlined"
            size="small"
            disabled={busy}
            aria-label={LINK_DOMAIN_LABELS.check(row.host)}
            onClick={() => onAction('check')}
          >
            Check
          </Button>
        ) : null}
        {setUp && canManage ? (
          <Button
            color="error"
            size="small"
            disabled={busy}
            aria-label={LINK_DOMAIN_LABELS.remove(row.host)}
            onClick={() => onAction('remove')}
          >
            Remove
          </Button>
        ) : null}
      </Stack>
    </Stack>
  )
}

export default OutreachLinkDomainsCard
