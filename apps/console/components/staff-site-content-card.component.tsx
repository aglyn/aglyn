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

import { screenRoutePathToUrl } from '@aglyn/aglyn/app-utils/screen-route'
import { mdiEyeOutline } from '@aglyn/shared-data-mdi'
import { AppLink, CardDisplay } from '@aglyn/shared-ui-jsx'
import { ListRowActions } from '@aglyn/shared-ui-jsx/components/list-table.component'
import type { RowActionsMenuItem } from '@aglyn/shared-ui-jsx/components/row-actions-menu.component'
import { Stack, Tab, Tabs, Typography } from '@mui/material'
import { type QueryConstraint, where } from 'firebase/firestore'
import { useCallback, useMemo, useState } from 'react'
import { docsHelp } from '../constants/docs-links'
import type { PreviewKind } from '../constants/preview-state'
import { buildRoute, Route } from '../constants/route-links'
import { buildScreenLiveUrl } from '../constants/tenant-links'
import { staffSitePreviewHref } from '../utils/staff-site-links'
import {
  AutomationDialog,
  chipsColumn,
  nameColumn,
  nameOf,
  StaffDocTable,
  type StaffDocRow,
  updatedColumn,
} from './staff-doc-table.component'

/*
 * EVERYTHING A SITE HOLDS, FOR STAFF WHO ARE NOT ITS MEMBERS (AGL-3379).
 *
 * One tab per kind of document, each a paged table from
 * `staff-doc-table.component`. The five besigner kinds open in the staff
 * preview route in a new tab, rendering the draft as the besigner last saved
 * it. Automations have no renderer; theirs is a read-only view of the
 * trigger and the steps.
 */

/** The tabs, in the order a reader looks for things. */
type ContentTab =
  | 'screens'
  | 'emails'
  | 'layouts'
  | 'components'
  | 'templates'
  | 'forms'
  | 'automations'

const TAB_LABELS: Record<ContentTab, string> = {
  screens: 'Pages',
  emails: 'Email designs',
  layouts: 'Layouts',
  components: 'Components',
  templates: 'Templates',
  forms: 'Forms',
  automations: 'Automations',
}

/**
 * Why a document cannot be previewed, or undefined when it can. Every kind
 * but a template renders a VERSION, and a document that never saved one has
 * nothing to render.
 */
const previewRefusal = (kind: PreviewKind, row: StaffDocRow): string | undefined =>
  kind === 'template' || row['versionId'] ? undefined : 'It has never been saved'

const openInNewTab = (href: string) => {
  window.open(href, '_blank', 'noopener,noreferrer')
}

export interface StaffSiteContentCardProps {
  hostId: string
  /** The site document: its routing map says which pages are live. */
  host: Record<string, any> | null | undefined
  orgId: string
}

/**
 * The staff site page's Content card (AGL-3379): pages, email designs,
 * layouts, components, templates, forms and automations, each previewable.
 */
export function StaffSiteContentCard(props: StaffSiteContentCardProps) {
  const { hostId, host, orgId } = props
  const [tab, setTab] = useState<ContentTab>('screens')
  const [automation, setAutomation] = useState<StaffDocRow | null>(null)
  const routing = (host?.['screens'] ?? {}) as Record<string, string>

  const previewActions = useCallback(
    (kind: PreviewKind, extra?: (row: StaffDocRow) => RowActionsMenuItem[]) =>
      (row: StaffDocRow) => {
        const refusal = previewRefusal(kind, row)
        return (
          <ListRowActions
            label={nameOf(row)}
            quick={{
              icon: mdiEyeOutline.path,
              label: 'Open preview',
              href: refusal ? undefined : staffSitePreviewHref(hostId, kind, row.$id),
              unavailableReason: refusal,
            }}
            items={extra ? extra(row) : []}
          />
        )
      },
    [hostId],
  )
  const openPreview = useCallback(
    (kind: PreviewKind) => (row: StaffDocRow) => {
      if (!previewRefusal(kind, row)) openInNewTab(staffSitePreviewHref(hostId, kind, row.$id))
    },
    [hostId],
  )

  const screenChips = useCallback(
    (row: StaffDocRow) => {
      const path = routing[row.$id]
      return [
        ...(row['kind'] === 'email' ? [{ label: 'email design' }] : []),
        path != null
          ? { label: `live ${screenRoutePathToUrl(String(path))}`, color: 'success' as const }
          : { label: 'draft' },
        ...(row['deletedAt'] ? [{ label: 'trashed', color: 'error' as const }] : []),
      ]
    },
    [routing],
  )
  const liveItem = useCallback(
    (row: StaffDocRow): RowActionsMenuItem[] => {
      const liveUrl = buildScreenLiveUrl(host as never, row.$id)
      return [
        {
          key: 'live',
          label: 'Visit live page',
          href: liveUrl,
          external: true,
          disabled: !liveUrl,
          disabledReason: liveUrl ? undefined : 'This page is not published',
        },
      ]
    },
    [host],
  )

  const emailOnly = useMemo(() => [where('kind', '==', 'email')], [])
  const orgAutomationScope = useMemo(
    () => [where('visibleTo', 'array-contains-any', ['org', `host:${hostId}`])],
    [hostId],
  )
  const automationActions = useCallback(
    (row: StaffDocRow) => (
      <ListRowActions
        label={nameOf(row)}
        quick={{
          icon: mdiEyeOutline.path,
          label: 'View steps',
          onClick: () => setAutomation(row),
        }}
        items={[]}
      />
    ),
    [],
  )
  const automationColumns = useMemo(
    () => [
      nameColumn('Automation'),
      chipsColumn('Status', (row) => [
        { label: row['trigger']?.event ?? 'manual' },
        row['enabled'] === false
          ? { label: 'off', color: 'warning' as const }
          : { label: 'on', color: 'success' as const },
        ...(Array.isArray(row['pausedHostIds']) && row['pausedHostIds'].includes(hostId)
          ? [{ label: 'paused here', color: 'warning' as const }]
          : []),
        ...(row['deletedAt'] ? [{ label: 'deleted', color: 'error' as const }] : []),
      ]),
      updatedColumn,
    ],
    [hostId],
  )

  const columns = useMemo(
    () => ({
      screens: [nameColumn('Page'), chipsColumn('Status', screenChips), updatedColumn],
      emails: [
        nameColumn('Email design'),
        chipsColumn('Status', (row) =>
          row['deletedAt'] ? [{ label: 'trashed', color: 'error' as const }] : [{ label: 'email' }],
        ),
        updatedColumn,
      ],
      layouts: [
        nameColumn('Layout'),
        chipsColumn('Status', (row) => [
          { label: row['layoutId'] ? 'nested' : 'root' },
          ...(row['deletedAt'] ? [{ label: 'trashed', color: 'error' as const }] : []),
        ]),
        updatedColumn,
      ],
      components: [
        nameColumn('Component'),
        chipsColumn('Kind', (row) => [
          { label: row['kind'] === 'email' ? 'email' : 'site' },
          ...(row['deletedAt'] ? [{ label: 'trashed', color: 'error' as const }] : []),
        ]),
        updatedColumn,
      ],
      templates: [
        nameColumn('Template'),
        chipsColumn('Kind', (row) => [
          { label: String(row['kind'] ?? 'page') },
          ...(row['category'] ? [{ label: String(row['category']) }] : []),
          ...(row['deletedAt'] ? [{ label: 'trashed', color: 'error' as const }] : []),
        ]),
        updatedColumn,
      ],
      forms: [
        nameColumn('Form'),
        chipsColumn('Status', (row) => {
          const submissions = row['stats']?.submissions
          return [
            ...(typeof submissions === 'number'
              ? [{ label: `${submissions} submission${submissions === 1 ? '' : 's'}` }]
              : [{ label: 'no submissions' }]),
            ...(row['retired'] ? [{ label: 'retired', color: 'warning' as const }] : []),
            ...(row['archivedAt'] ? [{ label: 'archived', color: 'warning' as const }] : []),
          ]
        }),
        updatedColumn,
      ],
    }),
    [screenChips],
  )

  const actions = useMemo(
    () => ({
      screens: previewActions('screen', liveItem),
      emails: previewActions('screen'),
      layouts: previewActions('layout'),
      components: previewActions('component'),
      templates: previewActions('template'),
      forms: previewActions('form'),
    }),
    [previewActions, liveItem],
  )

  const siteTable = (
    key: Exclude<ContentTab, 'automations'>,
    collectionId: string,
    kind: PreviewKind,
    constraints?: readonly QueryConstraint[],
  ) => (
    <StaffDocTable
      key={key}
      path={['hosts', hostId, collectionId]}
      constraints={constraints}
      columns={columns[key]}
      actions={actions[key]}
      onOpen={openPreview(kind)}
      noRowsLabel={`No ${TAB_LABELS[key].toLowerCase()} on this site`}
    />
  )

  return (
    <>
      <CardDisplay
        header={'Content'}
        help={docsHelp('staffConsole', {
          anchor: '#site-content',
          excerpt:
            "Every page, email design, layout, component, template, form and automation on the site. A row opens its draft preview in a new tab — no membership or impersonation needed.",
        })}
        contentGutterX
        contentGutterY
      >
        <Stack spacing={2}>
          <Tabs
            value={tab}
            onChange={(_event, next: ContentTab) => setTab(next)}
            variant="scrollable"
            scrollButtons="auto"
          >
            {(Object.keys(TAB_LABELS) as ContentTab[]).map((key) => (
              <Tab key={key} value={key} label={TAB_LABELS[key]} />
            ))}
          </Tabs>
          {tab === 'screens' ? siteTable('screens', 'screens', 'screen') : null}
          {tab === 'emails' ? siteTable('emails', 'screens', 'screen', emailOnly) : null}
          {tab === 'layouts' ? siteTable('layouts', 'layouts', 'layout') : null}
          {tab === 'components' ? siteTable('components', 'components', 'component') : null}
          {tab === 'templates' ? siteTable('templates', 'templates', 'template') : null}
          {tab === 'forms' ? siteTable('forms', 'forms', 'form') : null}
          {tab === 'automations' ? (
            <Stack spacing={3}>
              <Stack spacing={1}>
                <Typography variant="subtitle2">{'Site automations'}</Typography>
                <StaffDocTable
                  path={['hosts', hostId, 'actions']}
                  columns={automationColumns}
                  actions={automationActions}
                  onOpen={setAutomation}
                  noRowsLabel="No automations on this site"
                />
              </Stack>
              <Stack spacing={1}>
                <Typography variant="subtitle2">{'Organization automations that run here'}</Typography>
                <StaffDocTable
                  path={orgId ? ['orgs', orgId, 'automations'] : null}
                  constraints={orgAutomationScope}
                  columns={automationColumns}
                  actions={automationActions}
                  onOpen={setAutomation}
                  noRowsLabel="No organization automation runs on this site"
                />
              </Stack>
              <Stack spacing={1}>
                <Typography variant="subtitle2">{'Workflows'}</Typography>
                <StaffDocTable
                  path={['hosts', hostId, 'workflows']}
                  columns={automationColumns}
                  actions={automationActions}
                  onOpen={setAutomation}
                  noRowsLabel="No workflows on this site"
                />
              </Stack>
              {orgId ? (
                <Typography variant="caption" color="text.secondary">
                  {'Email campaigns and sends belong to the organization — see its '}
                  <AppLink href={buildRoute(Route.ADMIN_ORG_DETAIL, { orgId })}>
                    {'staff page'}
                  </AppLink>
                  {'.'}
                </Typography>
              ) : null}
            </Stack>
          ) : null}
        </Stack>
      </CardDisplay>
      <AutomationDialog row={automation} onClose={() => setAutomation(null)} />
    </>
  )
}

export default StaffSiteContentCard
