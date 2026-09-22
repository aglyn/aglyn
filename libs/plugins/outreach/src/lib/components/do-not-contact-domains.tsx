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
import { mdiTrashCanOutline } from '@aglyn/shared-data-mdi'
import { CardDisplay, MdiIcon } from '@aglyn/shared-ui-jsx'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import {
  Button,
  Chip,
  IconButton,
  List,
  ListItem,
  ListItemText,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { useState } from 'react'
import { normalizeOutreachDomain } from '../engine/do-not-contact-domain'
import type {
  OutreachDoNotContactDomainEntry,
  OutreachDoNotContactReason,
} from '../model/outreach.types'
import { OutreachLoading, OutreachLoadProblem } from './outreach-ui'
import { useOutreachApi } from './use-outreach-api'
import { useOutreachDoNotContactDomains } from './use-outreach-data'

export interface OutreachDoNotContactDomainsCardProps {
  /** The organization the hub is mounted under; `null` until the shell knows it. */
  orgId: string | null
}

/** Why a domain is on the list, as the card says it. */
export const OUTREACH_DO_NOT_CONTACT_REASON_LABELS: Record<OutreachDoNotContactReason, string> = {
  manual: 'Added by a member',
  opt_out_reply: 'A reply asked not to be emailed',
  unsubscribe: 'Unsubscribed',
  hard_bounce: 'Mail bounced',
  gateway_block: 'Its mail gateway blocked the sender',
}

/** Accessible names of the card's controls, spelled once for the specs. */
export const DO_NOT_CONTACT_DOMAIN_LABELS = {
  field: 'Domain',
  add: 'Add domain',
  remove: (domain: string) => `Remove ${domain}`,
} as const

/** What the field says under a value that is not a domain. */
export const DO_NOT_CONTACT_DOMAIN_HINT = 'A domain, such as example.com. Every address at it is refused.'

function addedOn(entry: OutreachDoNotContactDomainEntry): string {
  if (!entry.addedAtMs) return ''
  return new Intl.DateTimeFormat('en-US', { dateStyle: 'medium' }).format(entry.addedAtMs)
}

/**
 * Sequences → Compliance → Do not contact domains (AGL-3244): the domains no
 * sequence emails anyone at, whoever enrolls them.
 *
 * A member adds one by hand — a company that asked, or one whose gateway is
 * known to block cold mail — and the sending runtime adds one when a hard
 * bounce reads as the domain's gateway refusing the sender. Either way it
 * is listed here with why, and a member takes it off by name.
 */
export function OutreachDoNotContactDomainsCard(props: OutreachDoNotContactDomainsCardProps) {
  const { orgId } = props
  const api = useOutreachApi(orgId)
  const listed = useOutreachDoNotContactDomains(orgId)
  const { enqueueSnackbar } = useSnackbar()
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const normalized = normalizeOutreachDomain(draft)
  const invalid = draft.trim() !== '' && normalized === null

  const change = async (action: 'add' | 'remove', domain: string) => {
    setBusy(domain)
    try {
      const answer = await api.changeDoNotContactDomain(action, domain)
      if (action === 'add') setDraft('')
      enqueueSnackbar(
        answer.changed
          ? action === 'add'
            ? `${answer.domain} is on the do-not-contact list.`
            : `${answer.domain} is off the do-not-contact list.`
          : action === 'add'
            ? `${answer.domain} was already on the list.`
            : `${answer.domain} was not on the list.`,
        { variant: answer.changed ? 'success' : 'info' },
      )
    } catch (error) {
      enqueueSnackbar((error as Error).message, { variant: 'error', allowDuplicate: true })
    } finally {
      setBusy(null)
    }
  }

  return (
    <CardDisplay
      header="Do not contact domains"
      help={pluginDocsHelp('sequences', { anchor: '#do-not-contact-domains' })}
      contentGutterX
      contentGutterY
    >
      <Stack spacing={2}>
        <Typography variant="body2" color="text.secondary">
          {'No sequence emails anyone at these domains, whoever enrolls them. Add a company that asked not ' +
            'to hear from you, or one whose mail gateway blocks you. When an email bounces because the ' +
            'recipient’s gateway refused it — rather than because the address is unknown — the domain is ' +
            'added here automatically, so the next person at that company is not tried.'}
        </Typography>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ alignItems: { sm: 'flex-start' } }}>
          <TextField
            label={DO_NOT_CONTACT_DOMAIN_LABELS.field}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && normalized && !busy) {
                event.preventDefault()
                void change('add', normalized)
              }
            }}
            error={invalid}
            helperText={invalid ? 'That is not a domain.' : DO_NOT_CONTACT_DOMAIN_HINT}
            size="small"
            sx={{ flexGrow: 1 }}
          />
          <Button
            variant="outlined"
            disabled={!normalized || busy !== null}
            onClick={() => normalized && void change('add', normalized)}
          >
            {DO_NOT_CONTACT_DOMAIN_LABELS.add}
          </Button>
        </Stack>
        {listed.status === 'loading' ? (
          <OutreachLoading label="Loading domains…" />
        ) : listed.status === 'error' || listed.status === 'refused' ? (
          <OutreachLoadProblem status={listed.status} what="the do-not-contact domains" />
        ) : listed.data.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            No domains yet.
          </Typography>
        ) : (
          <List dense disablePadding aria-label="Do not contact domains">
            {listed.data.map((entry) => (
              <ListItem
                key={entry.domain}
                disableGutters
                secondaryAction={
                  <IconButton
                    edge="end"
                    size="small"
                    aria-label={DO_NOT_CONTACT_DOMAIN_LABELS.remove(entry.domain)}
                    disabled={busy !== null}
                    onClick={() => void change('remove', entry.domain)}
                  >
                    <MdiIcon path={mdiTrashCanOutline.path} fontSize="small" />
                  </IconButton>
                }
              >
                <ListItemText
                  primary={
                    <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
                      <Typography variant="body2" component="span" sx={{ fontWeight: 500 }}>
                        {entry.domain}
                      </Typography>
                      <Chip
                        size="small"
                        variant="outlined"
                        color={entry.reason === 'gateway_block' ? 'warning' : 'default'}
                        label={OUTREACH_DO_NOT_CONTACT_REASON_LABELS[entry.reason] ?? entry.reason}
                      />
                    </Stack>
                  }
                  secondary={[addedOn(entry) && `Added ${addedOn(entry)}`, entry.detail].filter(Boolean).join(' · ')}
                  slotProps={{ secondary: { sx: { wordBreak: 'break-word' } } }}
                />
              </ListItem>
            ))}
          </List>
        )}
      </Stack>
    </CardDisplay>
  )
}
OutreachDoNotContactDomainsCard.displayName = 'OutreachDoNotContactDomainsCard'

export default OutreachDoNotContactDomainsCard
