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

import { buildRoute, pluginDocsHelp, Route } from '@aglyn/aglyn'
import {
  mdiDeleteOutline,
  mdiContentCopy,
  mdiEyeOutline,
  mdiPencilOutline,
} from '@aglyn/shared-data-mdi'
import {
  AppLink,
  CardDisplay,
  MdiIcon,
  useConfirmationContext,
} from '@aglyn/shared-ui-jsx'
import ListFilterChips from '@aglyn/shared-ui-jsx/components/list-filter-chips.component'
import {
  ListRowActions,
  ListTable,
  listActionsColumn,
} from '@aglyn/shared-ui-jsx/components/list-table.component'
import type { RowActionsMenuItem } from '@aglyn/shared-ui-jsx/components/row-actions-menu.component'
import { inMemoryListField } from '@aglyn/shared-ui-jsx/const/list-grid-filter'
import { TABLE_ROW_HEIGHT } from '@aglyn/shared-ui-jsx/const/table-pagination'
import { useListRowsFilter } from '@aglyn/shared-ui-jsx/hooks/use-list-rows-filter'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import {
  ceilingedWindow,
  collectionCeiling,
} from '@aglyn/tenant-feature-instance/hooks/host-collection-queries'
import {
  DUPLICATE_MENU_LABEL,
  useConsoleHostRoute,
  useDuplicateResource,
  useFirestore,
  useFirestoreCollection,
  useHostResourceApi,
  useHostVersionApi,
} from '@aglyn/tenant-feature-instance'
import {
  Alert,
  Button,
  Chip,
  Stack,
  Typography,
} from '@mui/material'
import type { GridColDef } from '@mui/x-data-grid'
import { collection, doc, Timestamp, updateDoc } from 'firebase/firestore'
import { useRouter } from 'next/navigation'
import { useMemo } from 'react'
import { templateProvenance } from '../model/template-provenance'
import { createEmailScreen } from '../utils/create-email-screen'

/** How many of the site's screens one read of this list covers. */
const TEMPLATE_CEILING = 200

/*
 * What the templates grid's Filters panel offers (AGL-3317). The card holds
 * the templates its capped window read, so it answers the panel over all of
 * them; the notice under the table says when the cap truncated the window.
 * Origin reads `originKey`, the provenance the column draws.
 */
const TEMPLATE_FILTER_FIELDS = [
  inMemoryListField('displayName', 'text', 'templateName'),
  inMemoryListField('origin', 'select', 'originKey'),
]
const TEMPLATE_FILTER_HEADERS: Readonly<Record<string, string>> = {
  displayName: 'Template',
  origin: 'Origin',
}
const TEMPLATE_FILTER_OPTIONS = {
  origin: [
    { value: 'local', label: 'Yours' },
    { value: 'installed', label: 'Installed' },
  ],
}
const TEMPLATE_SEARCH_FIELDS = ['templateName'] as const

// The besigner route is `/[orgSlug]/hosts/[host]/screens/[screenId]/
// versions/[versionId]/besigner`. This built `/{hostDocId}/screens/…`, the
// pre-AGL-621/622 shape — so every "Edit"/"Design" jump out of the Emails
// page landed on a 404, including the one right after creating a new email
// (AGL-685). Takes the resolved org slug + subdomain, not a host doc id.
const besignerHref = (
  orgSlug: string,
  host: string,
  screenId: string,
  versionId: string,
) =>
  buildRoute(Route.SCREEN_BESIGNER, { orgSlug, host, screenId, versionId })

/**
 * THE TEMPLATES: reusable besigner documents an email is built from.
 *
 * A template is a screen document with `kind: 'email'`, kept out of the main
 * Screens list and opened in the besigner with only email-safe components on
 * offer. It is not itself a message — a message is what a campaign sends, and
 * one template can be behind many of them, which is why the row leads to the
 * template's own page rather than straight into the editor.
 *
 * A template is not necessarily this org's. One installed from a marketplace
 * listing appears here beside the locally authored ones, carries its
 * publisher's provenance on the same document, and opens the same detail
 * page; the chip beside its name is what distinguishes them.
 *
 * ## A table, on the surface's own row grammar
 *
 * The row opens the template, its name is ALSO a real link so it can be
 * middle-clicked and copied, and editing and deleting live behind the shared
 * overflow menu rather than as text buttons in the row — the same grammar the
 * audiences table reads by. Delete in particular: it sat inline, one mis-click
 * from the name beside it.
 *
 * ## Why the read is a CEILING with a probe
 *
 * `screens` holds every kind of screen the site has and the email ones are
 * picked out here, so the cap cannot be a page: a page of the collection is
 * not a page of this list. `collectionCeiling` orders on the document name,
 * which is the one ordering that cannot drop a screen — `orderBy('displayName')`
 * matches only documents that HAVE the field, so a screen created without a
 * name would vanish rather than sort oddly. It reads one past the ceiling so
 * the card can SAY when the site holds more than it drew, and the footer under
 * the table pages the window the card already has.
 */
export function EmailScreensCard(props: {
  hostId: string
  /** The emails hub URL, which every template route hangs beneath. */
  basePath: string
}) {
  const { hostId, basePath } = props
  const { orgSlug, subdomain } = useConsoleHostRoute(hostId)
  const firestore = useFirestore()
  const createHostResource = useHostResourceApi()
  const createHostVersion = useHostVersionApi()
  const router = useRouter()
  const { enqueueSnackbar } = useSnackbar()
  // Duplicate (AGL-2936): the copy is a design of its own, sent by nothing
  // until a campaign picks it.
  const duplicate = useDuplicateResource({
    hostId,
    onDuplicated: (_kind, copy) =>
      enqueueSnackbar(`Duplicated as “${copy.name}”`, { variant: 'success' }),
  })
  const { confirm } = useConfirmationContext()

  const { data: screenDocs } = useFirestoreCollection<any>(
    () =>
      collectionCeiling(
        collection(firestore, 'hosts', hostId, 'screens'),
        TEMPLATE_CEILING,
      ),
    [firestore, hostId],
    { idField: '$id' },
  )
  const { rows: readScreens, truncated } = ceilingedWindow<any>(
    screenDocs,
    TEMPLATE_CEILING,
  )
  const emailScreens = useMemo(
    () =>
      [...readScreens]
        .filter((screen: any) => !screen.deletedAt && screen.kind === 'email')
        .sort((a: any, b: any) =>
          String(a.displayName ?? '').localeCompare(
            String(b.displayName ?? ''),
          ),
        )
        .map((screen: any) => ({
          ...screen,
          templateName: String(screen.displayName ?? 'Untitled template'),
          originKey:
            templateProvenance(screen).origin === 'installed' ? 'installed' : 'local',
        })),
    [readScreens],
  )
  const templateFilter = useListRowsFilter<any>({
    rows: emailScreens,
    fields: TEMPLATE_FILTER_FIELDS,
    options: TEMPLATE_FILTER_OPTIONS,
    headers: TEMPLATE_FILTER_HEADERS,
    search: TEMPLATE_SEARCH_FIELDS,
  })

  const handleCreate = async () => {
    try {
      const { screenId, versionId } = await createEmailScreen(
        hostId,
        createHostResource,
        createHostVersion,
      )
      if (orgSlug && subdomain) {
        void router.push(besignerHref(orgSlug, subdomain, screenId, versionId))
      }
    } catch (error: any) {
      console.error(error)
      enqueueSnackbar(error?.message ?? 'Creating the template failed', {
        variant: 'error',
      })
    }
  }

  const handleDelete = async (screen: any) => {
    const confirmed = await confirm({
      title: 'Delete this template?',
      description:
        `"${screen.displayName ?? 'Untitled template'}" will be removed. ` +
        'Emails already sent from it keep their reports.',
      confirmationText: 'Delete',
      confirmationButtonProps: { color: 'error' },
    })
      .then(() => true)
      .catch(() => false)
    if (!confirmed) return
    await updateDoc(doc(firestore, 'hosts', hostId, 'screens', screen.$id), {
      deletedAt: Timestamp.now(),
    })
  }

  const templateHref = (screen: any) => `${basePath}/templates/${screen.$id}`

  const templateName = (screen: any) =>
    String(screen.displayName ?? 'Untitled template')

  const rowActions = (screen: any): RowActionsMenuItem[] => [
    {
      key: 'details',
      label: 'Open details',
      icon: <MdiIcon path={mdiEyeOutline.path} size={0.8} />,
      href: templateHref(screen),
    },
    {
      key: 'besigner',
      label: 'Edit in besigner',
      icon: <MdiIcon path={mdiPencilOutline.path} size={0.8} />,
      /*
        The editor's URL needs the resolved org slug and subdomain. Until the
        host route settles both are empty and a link built from them lands on
        `/null/hosts/null`, so the item is shown DISABLED with the reason
        rather than pointing at a 404.
       */
      href:
        orgSlug && subdomain
          ? besignerHref(orgSlug, subdomain, screen.$id, screen.versionId)
          : undefined,
      disabled: !orgSlug || !subdomain,
      disabledReason: 'This site’s console URL has not resolved yet',
    },
    {
      key: 'duplicate',
      label: DUPLICATE_MENU_LABEL,
      icon: <MdiIcon path={mdiContentCopy.path} size={0.8} />,
      onClick: () =>
        duplicate.request('emailDesign', {
          id: screen.$id,
          name: templateName(screen),
        }),
    },
    {
      key: 'delete',
      label: 'Delete',
      icon: <MdiIcon path={mdiDeleteOutline.path} size={0.8} />,
      destructive: true,
      onClick: () => void handleDelete(screen),
    },
  ]

  /*
   * The templates are a window this card already holds, so the grid pages
   * it. The name is a link AND the row opens the template.
   */
  const columns: GridColDef[] = [
    {
      field: 'displayName',
      headerName: 'Template',
      flex: 1,
      minWidth: 220,
      valueGetter: (_value, row) => templateName(row),
      renderCell: ({ row, value }) => (
        <AppLink
          href={templateHref(row)}
          // The row's own handler would fire too and push the same route
          // twice — one history entry per back press.
          onClick={(event: { stopPropagation: () => void }) =>
            event.stopPropagation()
          }
        >
          {value}
        </AppLink>
      ),
    },
    {
      /*
        WHOSE template this is, where the reader is choosing between them. An
        installed one is versioned by its publisher and can be withdrawn, which
        is not a property a name can carry.
       */
      field: 'origin',
      headerName: 'Origin',
      width: 140,
      valueGetter: (_value, row) => row.originKey,
      renderCell: ({ value }) =>
        value === 'installed' ? (
          <Chip size="small" label="Installed" />
        ) : (
          <Typography variant="body2" color="text.secondary">
            {'Yours'}
          </Typography>
        ),
    },
    listActionsColumn(
      (row) => (
        <ListRowActions label={templateName(row)} items={rowActions(row)} />
      ),
      { width: 72 },
    ),
  ]

  return (
    <CardDisplay
      header={'Templates'}
      help={pluginDocsHelp('designedEmails', { anchor: '#find-a-template' })}
      contentGutterX
      contentGutterY
      HeaderProps={{
        action: (
          <Button
            size="small"
            variant="contained"
            onClick={() => void handleCreate()}
          >
            {'New template'}
          </Button>
        ),
      }}
    >
      {duplicate.dialog}
      <Stack spacing={1.5}>
        {emailScreens.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            {'Design a reusable email here, then send it from a campaign. A ' +
              'new template opens in the besigner with email-safe components ' +
              'only.'}
          </Typography>
        ) : (
          <>
            <ListFilterChips {...templateFilter.chipsProps} />
            <ListTable
              aria-label="Email templates"
              rows={templateFilter.rows}
              columns={templateFilter.filterColumns(columns)}
              rowHeight={TABLE_ROW_HEIGHT}
              onOpen={(_id, row) => router.push(templateHref(row))}
              // The panel and the search are the grid's; the card answers
              // them over every template its window read.
              {...templateFilter.gridProps}
              noRowsLabel="No templates match these filters"
            />
          </>
        )}
        {truncated ? (
          <Alert severity="info">
            {`This site holds more than ${TEMPLATE_CEILING} screens, and the ` +
              'templates listed are drawn from the first of them. Any beyond ' +
              'that are not in this list.'}
          </Alert>
        ) : null}
      </Stack>
    </CardDisplay>
  )
}
EmailScreensCard.displayName = 'EmailScreensCard'

export default EmailScreensCard
