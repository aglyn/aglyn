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

import { mdiEyeOutline } from '@aglyn/shared-data-mdi'
import { CardDisplay } from '@aglyn/shared-ui-jsx'
import { ListRowActions } from '@aglyn/shared-ui-jsx/components/list-table.component'
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  Tab,
  Tabs,
  Typography,
} from '@mui/material'
import type { GridColDef } from '@mui/x-data-grid'
import { useCallback, useMemo, useState } from 'react'
import { docsHelp } from '../constants/docs-links'
import { buildRoute, Route } from '../constants/route-links'
import { staffSitePreviewHref } from '../utils/staff-site-links'
import {
  AutomationDialog,
  chipsColumn,
  nameColumn,
  nameOf,
  StaffDocTable,
  type StaffDocRow,
  updatedColumn,
  whenOf,
} from './staff-doc-table.component'

type MarketingTab = 'sends' | 'campaigns' | 'automations'

const TAB_LABELS: Record<MarketingTab, string> = {
  sends: 'Email sends',
  campaigns: 'Email campaigns',
  automations: 'Automations',
}

/** When a send went, or is due: the sent stamp, else the schedule, else its creation. */
const sendWhen = (row: StaffDocRow): string =>
  row['sentAt']
    ? whenOf(row['sentAt'])
    : row['sendAtMs']
      ? `due ${whenOf(row['sendAtMs'])}`
      : whenOf(row['createdAtMs'])

/**
 * A stored message body, drawn in a frame that runs nothing and reaches
 * nothing: `sandbox` with no permissions, so a customer's HTML is only ever
 * pixels on the staff page.
 */
function MessageDialog(props: { row: StaffDocRow | null; onClose: () => void }) {
  const { row, onClose } = props
  return (
    <Dialog open={Boolean(row)} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>{row ? String(row['subject'] || row.$id) : ''}</DialogTitle>
      <DialogContent>
        {row?.['preheader'] ? (
          <Typography variant="caption" color="text.secondary">
            {String(row['preheader'])}
          </Typography>
        ) : null}
        <Box
          component="iframe"
          title="Message"
          sandbox=""
          srcDoc={String(row?.['body'] ?? '')}
          sx={{ mt: 1, width: '100%', height: 560, border: 1, borderColor: 'divider', bgcolor: '#fff' }}
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{'Close'}</Button>
      </DialogActions>
    </Dialog>
  )
}

/**
 * The organization's email and automation work, for staff (AGL-3380): every
 * campaign send with its audience, state and numbers, the campaign
 * containers, and the organization-level automations. A send opens its
 * design in the staff preview, or its stored message in a sandboxed frame.
 */
export function StaffOrgMarketingCard(props: {
  orgId: string
  siteNames?: Readonly<Record<string, string>>
}) {
  const { orgId, siteNames } = props
  const [tab, setTab] = useState<MarketingTab>('sends')
  const [message, setMessage] = useState<StaffDocRow | null>(null)
  const [automation, setAutomation] = useState<StaffDocRow | null>(null)

  const siteOf = useCallback(
    (hostId: unknown) =>
      typeof hostId === 'string' && hostId ? (siteNames?.[hostId] ?? hostId) : null,
    [siteNames],
  )

  const sendColumns: GridColDef[] = useMemo(
    () => [
      {
        ...nameColumn('Subject'),
        valueGetter: (_value, row: StaffDocRow) => String(row['subject'] || row.$id),
        renderCell: ({ row }: { row: StaffDocRow }) => (
          <Stack sx={{ justifyContent: 'center', height: '100%', lineHeight: 1.25 }}>
            <Typography variant="body2" noWrap sx={{ lineHeight: 1.25 }}>
              {String(row['subject'] || '(no subject)')}
            </Typography>
            <Typography variant="caption" color="text.secondary" noWrap sx={{ lineHeight: 1.25 }}>
              {siteOf(row['hostId']) ?? 'no site'}
            </Typography>
          </Stack>
        ),
      },
      chipsColumn('Status', (row) => {
        const stats = row['stats'] ?? {}
        return [
          {
            label: String(row['status'] ?? 'draft'),
            color:
              row['status'] === 'sent'
                ? ('success' as const)
                : row['status'] === 'failed'
                  ? ('error' as const)
                  : undefined,
          },
          ...(row['staffReview']?.state === 'held'
            ? [{ label: 'held for review', color: 'warning' as const }]
            : []),
          ...(typeof stats.sent === 'number' ? [{ label: `${stats.sent} sent` }] : []),
          ...(typeof stats.uniqueOpens === 'number' ? [{ label: `${stats.uniqueOpens} opened` }] : []),
          ...(typeof stats.uniqueClicks === 'number' ? [{ label: `${stats.uniqueClicks} clicked` }] : []),
          ...(stats.bounced ? [{ label: `${stats.bounced} bounced`, color: 'error' as const }] : []),
        ]
      }),
      {
        field: 'audience',
        headerName: 'Audience',
        flex: 0.7,
        minWidth: 110,
        valueGetter: (_value, row: StaffDocRow) => String(row['audience'] ?? '—'),
      },
      {
        field: 'when',
        headerName: 'When',
        flex: 0.9,
        minWidth: 160,
        valueGetter: (_value, row: StaffDocRow) => sendWhen(row),
      },
    ],
    [siteOf],
  )
  const sendActions = useCallback(
    (row: StaffDocRow) => {
      const design =
        typeof row['templateScreenId'] === 'string' &&
        row['templateScreenId'] &&
        typeof row['hostId'] === 'string' &&
        row['hostId']
          ? staffSitePreviewHref(row['hostId'], 'screen', row['templateScreenId'])
          : undefined
      return (
        <ListRowActions
          label={String(row['subject'] || row.$id)}
          quick={{
            icon: mdiEyeOutline.path,
            label: 'View message',
            onClick: () => setMessage(row),
            unavailableReason: row['body'] ? undefined : 'No message body was stored',
          }}
          items={[
            {
              key: 'design',
              label: 'Open design preview',
              href: design,
              external: true,
              disabled: !design,
              disabledReason: design ? undefined : 'This send was not composed from a design',
            },
            {
              key: 'site',
              label: 'Open site',
              href: row['hostId']
                ? buildRoute(Route.ADMIN_SITE_DETAIL, { hostId: String(row['hostId']) })
                : undefined,
              disabled: !row['hostId'],
            },
          ]}
        />
      )
    },
    [],
  )

  const campaignColumns: GridColDef[] = useMemo(
    () => [
      nameColumn('Campaign'),
      chipsColumn('Runs on', (row) => {
        const scope: string[] = Array.isArray(row['visibleTo']) ? row['visibleTo'] : []
        return [
          ...scope.map((token) =>
            token === 'org'
              ? { label: 'every site' }
              : { label: siteOf(token.replace(/^host:/, '')) ?? token },
          ),
          ...(row['deletedAt'] ? [{ label: 'deleted', color: 'error' as const }] : []),
        ]
      }),
      {
        field: 'window',
        headerName: 'Window',
        flex: 1,
        minWidth: 180,
        valueGetter: (_value, row: StaffDocRow) =>
          row['startAtMs'] || row['endAtMs']
            ? `${whenOf(row['startAtMs'])} – ${row['endAtMs'] ? whenOf(row['endAtMs']) : 'open'}`
            : '—',
      },
    ],
    [siteOf],
  )

  const automationColumns: GridColDef[] = useMemo(
    () => [
      nameColumn('Automation'),
      chipsColumn('Status', (row) => [
        { label: row['trigger']?.event ?? 'manual' },
        row['enabled'] === false
          ? { label: 'off', color: 'warning' as const }
          : { label: 'on', color: 'success' as const },
        ...(Array.isArray(row['pausedHostIds']) && row['pausedHostIds'].length
          ? [{ label: `paused on ${row['pausedHostIds'].length} site(s)`, color: 'warning' as const }]
          : []),
        ...(row['deletedAt'] ? [{ label: 'deleted', color: 'error' as const }] : []),
      ]),
      updatedColumn,
    ],
    [],
  )
  const automationActions = useCallback(
    (row: StaffDocRow) => (
      <ListRowActions
        label={nameOf(row)}
        quick={{ icon: mdiEyeOutline.path, label: 'View steps', onClick: () => setAutomation(row) }}
        items={[]}
      />
    ),
    [],
  )

  return (
    <>
      <CardDisplay
        header={'Email & automations'}
        help={docsHelp('staffConsole', {
          anchor: '#org-email-and-automations',
          excerpt:
            "The organization's campaign sends, campaigns and automations. A send opens its design preview or its stored message; an automation opens its steps.",
        })}
        contentGutterX
        contentGutterY
      >
        <Stack spacing={2}>
          <Tabs
            value={tab}
            onChange={(_event, next: MarketingTab) => setTab(next)}
            variant="scrollable"
            scrollButtons="auto"
          >
            {(Object.keys(TAB_LABELS) as MarketingTab[]).map((key) => (
              <Tab key={key} value={key} label={TAB_LABELS[key]} />
            ))}
          </Tabs>
          {tab === 'sends' ? (
            <StaffDocTable
              key="sends"
              path={orgId ? ['orgs', orgId, 'campaigns'] : null}
              columns={sendColumns}
              actions={sendActions}
              onOpen={(row) => (row['body'] ? setMessage(row) : undefined)}
              noRowsLabel="This organization has sent no campaigns"
            />
          ) : null}
          {tab === 'campaigns' ? (
            <StaffDocTable
              key="campaigns"
              path={orgId ? ['orgs', orgId, 'emailCampaigns'] : null}
              columns={campaignColumns}
              noRowsLabel="This organization has no email campaigns"
            />
          ) : null}
          {tab === 'automations' ? (
            <StaffDocTable
              key="automations"
              path={orgId ? ['orgs', orgId, 'automations'] : null}
              columns={automationColumns}
              actions={automationActions}
              onOpen={setAutomation}
              noRowsLabel="This organization has no automations"
            />
          ) : null}
        </Stack>
      </CardDisplay>
      <MessageDialog row={message} onClose={() => setMessage(null)} />
      <AutomationDialog row={automation} onClose={() => setAutomation(null)} />
    </>
  )
}

export default StaffOrgMarketingCard
