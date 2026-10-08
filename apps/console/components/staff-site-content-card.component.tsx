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
import { CardDisplay } from '@aglyn/shared-ui-jsx'
import { ListRowActions } from '@aglyn/shared-ui-jsx/components/list-table.component'
import type { RowActionsMenuItem } from '@aglyn/shared-ui-jsx/components/row-actions-menu.component'
import { Stack, Tab, Tabs } from '@mui/material'
import { useCallback, useMemo, useState } from 'react'
import { docsHelp } from '../constants/docs-links'
import type { PreviewKind } from '../constants/preview-state'
import { buildScreenLiveUrl } from '../constants/tenant-links'
import { staffSitePreviewHref } from '../utils/staff-site-links'
import {
  STAFF_SITE_CONTENT_LISTS,
  type StaffSiteContentTab,
} from '../utils/staff-site-content-list-query'
import {
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
 * it.
 */

/** The tabs, in the order a reader looks for things. */
type ContentTab = StaffSiteContentTab

const TAB_LABELS: Record<ContentTab, string> = {
  screens: 'Pages',
  emails: 'Email designs',
  layouts: 'Layouts',
  components: 'Components',
  templates: 'Templates',
  forms: 'Forms',
}

/**
 * Why a document cannot be previewed, or undefined when it can. Every kind
 * but a template renders a VERSION, and a document that never saved one has
 * nothing to render.
 */
const previewRefusal = (kind: PreviewKind, row: StaffDocRow): string | undefined =>
  kind === 'template' || row['versionId'] ? undefined : 'It has never been saved'

/** The tabs' fixed Status chips (the Pages tab's read the routing map). */
const emailChips = (row: StaffDocRow) =>
  row['deletedAt'] ? [{ label: 'trashed', color: 'error' as const }] : [{ label: 'email' }]

const layoutChips = (row: StaffDocRow) => [
  { label: row['layoutId'] ? 'nested' : 'root' },
  ...(row['deletedAt'] ? [{ label: 'trashed', color: 'error' as const }] : []),
]

const formChips = (row: StaffDocRow) => {
  const submissions = row['stats']?.submissions
  return [
    ...(typeof submissions === 'number'
      ? [{ label: `${submissions} submission${submissions === 1 ? '' : 's'}` }]
      : [{ label: 'no submissions' }]),
    ...(row['retired'] ? [{ label: 'retired', color: 'warning' as const }] : []),
    ...(row['archivedAt'] ? [{ label: 'archived', color: 'warning' as const }] : []),
  ]
}

/** How each page-sorted header reads in its notice. */
const PAGE_SORT_HEADERS: Record<ContentTab, Record<string, string>> = {
  screens: { displayName: 'Page', status: 'Status' },
  emails: { displayName: 'Email design', status: 'Status' },
  layouts: { status: 'Status' },
  components: {},
  templates: { displayName: 'Template' },
  forms: { status: 'Status' },
}

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
 * layouts, components, templates and forms, each previewable. What a plugin
 * holds for the site — its automations, its sends — is the plugin's to show,
 * on the page's `staffSite` zone.
 */
export function StaffSiteContentCard(props: StaffSiteContentCardProps) {
  const { hostId, host } = props
  const [tab, setTab] = useState<ContentTab>('screens')
  const routing = useMemo(
    () => (host?.['screens'] ?? {}) as Record<string, string>,
    [host],
  )

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

  /*
   * The Status chips are DERIVED — the routing map, the submission count —
   * so they sort the page (AGL-3680), by the words the chips say. So does
   * the name where the tab's query cannot order by it
   * (`staff-site-content-list-query.ts` says why).
   */
  const pageSorts = useMemo(() => {
    const chipText = (chips: (row: StaffDocRow) => Array<{ label: string }>) => (row: StaffDocRow) =>
      chips(row)
        .map((chip) => chip.label)
        .join(', ')
    return {
      screens: { displayName: nameOf, status: chipText(screenChips) },
      emails: { displayName: nameOf, status: chipText(emailChips) },
      layouts: { status: chipText(layoutChips) },
      components: {},
      templates: { displayName: nameOf },
      forms: { status: chipText(formChips) },
    }
  }, [screenChips])
  const columns = useMemo(
    () => ({
      screens: [nameColumn('Page'), chipsColumn('Status', screenChips), updatedColumn],
      emails: [nameColumn('Email design'), chipsColumn('Status', emailChips), updatedColumn],
      layouts: [nameColumn('Layout'), chipsColumn('Status', layoutChips), updatedColumn],
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
      forms: [nameColumn('Form'), chipsColumn('Status', formChips), updatedColumn],
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

  const siteTable = (key: ContentTab, kind: PreviewKind) => (
    <StaffDocTable
      key={key}
      path={['hosts', hostId, STAFF_SITE_CONTENT_LISTS[key].collection]}
      declaration={STAFF_SITE_CONTENT_LISTS[key].declaration}
      base={STAFF_SITE_CONTENT_LISTS[key].base}
      pageSorts={pageSorts[key]}
      headers={PAGE_SORT_HEADERS[key]}
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
            // MUI hides scroll buttons on touch screens by default, which
            // leaves a phone no sign that four of the six tabs are offscreen.
            allowScrollButtonsMobile
          >

            {(Object.keys(TAB_LABELS) as ContentTab[]).map((key) => (
              <Tab key={key} value={key} label={TAB_LABELS[key]} />
            ))}
          </Tabs>
          {tab === 'screens' ? siteTable('screens', 'screen') : null}
          {tab === 'emails' ? siteTable('emails', 'screen') : null}
          {tab === 'layouts' ? siteTable('layouts', 'layout') : null}
          {tab === 'components' ? siteTable('components', 'component') : null}
          {tab === 'templates' ? siteTable('templates', 'template') : null}
          {tab === 'forms' ? siteTable('forms', 'form') : null}
        </Stack>
      </CardDisplay>
    </>
  )
}

export default StaffSiteContentCard
