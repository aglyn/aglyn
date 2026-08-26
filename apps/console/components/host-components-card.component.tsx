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

import {
  AppLink,
  CardDisplay,
  MdiIcon,
  useConfirmationContext,
} from '@aglyn/shared-ui-jsx'
import {
} from '@aglyn/shared-ui-jsx/components/data-table.component'
import { type GridColDef } from '@mui/x-data-grid'
import {
  mdiBookmarkOutline,
  mdiEyeOutline,
  mdiPencilOutline,
  mdiStorefrontOutline,
  mdiTrashCanOutline,
  mdiVectorSquare,
} from '@aglyn/shared-data-mdi'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { Timestamp } from '@aglyn/shared-util-timestamp'
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material'
import DocumentPresenceChips from './document-presence-chips.component'
import usePresenceSummary from '../hooks/use-presence-summary'
import * as Aglyn from '@aglyn/aglyn'
import {
  isBelowMarketplacePriceFloor,
  marketplacePriceCostNote,
  marketplacePriceFloorHint,
} from '@aglyn/aglyn'
import {
  collection,
  doc,
  limit,
  query,
  setDoc,
  updateDoc,
} from 'firebase/firestore'
import { ICON_VARIANT_SHOW_DETAIL } from '@aglyn/shared-data-enums'
import { useRouter } from 'next/navigation'
import ArtifactTable, {
  ArtifactRowActions,
  artifactActionsColumn,
} from './artifacts/artifact-table.component'
import ArtifactDeleteConfirmDescription, {
  fetchArtifactUsage,
} from './artifacts/artifact-delete-confirm.component'
import { buildRoute, Route } from '../constants/route-links'
import { useOrgSlug } from '../hooks/use-org-scope'
import { useHostSubdomain } from './host-id-provider'
import { useCallback, useEffect, useState } from 'react'
import {
  useFirestore,
  useHostVersionApi,
  useUser,
  writeGuardedBySeed,
} from '@aglyn/tenant-feature-instance'
import ComponentIconField from './component-icon-field.component'
import { docsHelp } from '../constants/docs-links'
import { TABLE_ROW_HEIGHT } from '../constants/shared'
import useCurrentOrg from '../hooks/use-current-org'
import useFirestoreCollection from '../hooks/use-firestore-collection'
import SaveAsTemplateDialog, {
  type SaveAsTemplateSource,
} from './templates/save-as-template-dialog.component'

/** The count and cap a components readout renders (AGL-693). */
export interface ComponentQuotaReadout {
  ready: boolean
  used: number
  limit: number
}

export interface HostComponentsCardProps {
  hostId: string
  /**
   * Publishes the component count and cap so the PAGE can render the readout
   * beside its create button — the same wire the templates card uses, and for
   * the same reason: the card owns the listener the count comes from, so a
   * page that counted separately would be a second source for one fact.
   */
  onQuota?: (readout: ComponentQuotaReadout) => void
  /**
   * The empty state's way OUT (AGL-1152).
   *
   * The card owns the list and therefore the empty state, but the PAGE owns
   * the create drawer and the template gallery — so the buttons have to come
   * down rather than be rebuilt here, or the empty state would open a second
   * drawer that knows nothing about the page's quota check.
   *
   * Optional: a caller with no create affordance gets the illustration and the
   * sentence, which is what this list showed before.
   */
  onCreate?: () => void
  onBrowseTemplates?: () => void
}

/**
 * Reusable-component management (user request 2026-07-07): rename/describe
 * and delete host component definitions. Deletion is a soft delete
 * (`deletedAt`), so already-published tenant pages keep grafting until
 * their next revalidate and nothing hard-breaks; the element drawer and
 * tenant compose both filter deleted definitions. Content editing lands
 * with the marketplace component editor.
 */
export function HostComponentsCard(props: HostComponentsCardProps) {
  const { hostId, onQuota, onCreate, onBrowseTemplates } = props
  const firestore = useFirestore()
  const createHostVersion = useHostVersionApi()
  const { enqueueSnackbar } = useSnackbar()
  const { confirm } = useConfirmationContext()
  const { org, ready: orgReady } = useCurrentOrg()
  const {
    data: componentDocs,
    status: componentsStatus,
    /**
     * The rows the rename dialog is seeded from are unconfirmed by the server
     * (AGL-1358). The payload here is narrow — `nodes`, `versionId` and
     * `deletedAt` are not in it, and a plain `updateDoc` leaves them alone —
     * but `description` and `icon` are written on every save whether or not
     * the author opened them, and both are echoes of the seed. Against a
     * cached read, retyping the name restores that snapshot's description
     * and icon, which is the identity this component wears in every besigner
     * drawer and in its marketplace listing.
     */
    fromCache: componentsFromCache,
  } = useFirestoreCollection<any>(
    () =>
      query(collection(firestore, 'hosts', hostId, 'components'), limit(100)),
    [firestore, hostId],
    { idField: '$id' },
  )
  const components = [...(componentDocs ?? [])]
    .filter((definition: any) => !definition.deletedAt)
    .sort((a: any, b: any) =>
      String(a.displayName ?? '').localeCompare(String(b.displayName ?? '')),
    )

  /**
   * The readout the page header renders (AGL-693).
   *
   * `reusableComponents` is a BOOLEAN entitlement, which looks like a reason
   * to print no denominator at all. It is not: the denominator is exactly what
   * the boolean says. A plan that grants it caps nothing (`∞`, which is what
   * layouts and screens already print on that plan), and a plan that does not
   * grant it allows none.
   *
   * So `0/0 components on your plan` on Free is not a missing number, it is
   * the number — and it is the one an operator on Starter needs to see BEFORE
   * clicking a create button the resources route will refuse (AGL-473).
   * `QuotaReadoutComponent` holds the `ready` rule that keeps a paying org
   * from being shown a free tier's cap while the org doc is still loading.
   */
  const componentsEntitled =
    orgReady && Aglyn.checkEntitlement(org as never, 'reusableComponents')
  useEffect(() => {
    onQuota?.({
      ready: orgReady,
      used: components.length,
      limit: componentsEntitled ? Aglyn.UNLIMITED : 0,
    })
  }, [onQuota, orgReady, components.length, componentsEntitled])

  const [editor, setEditor] = useState<{
    id: string
    name: string
    description: string
    icon?: Aglyn.ReusableComponentIcon
  } | null>(null)

  // Marketplace publish (AGL-44): posts to the server-side publish API —
  // sanitization/allowlisting happen there; clients cannot create listings.
  const { data: user } = useUser()
  const router = useRouter()
  const orgSlug = useOrgSlug()
  const host = useHostSubdomain()
  const [publisher, setPublisher] = useState<{
    id: string
    name: string
    description: string
    category: string
    price: string
    busy?: boolean
  } | null>(null)
  // Save as template (AGL-668) — same dialog as screens and layouts.
  const [saveTemplateFor, setSaveTemplateFor] =
    useState<SaveAsTemplateSource | null>(null)

  const handlePublishConfirm = useCallback(async () => {
    if (!publisher || !publisher.name.trim() || publisher.busy) return
    setPublisher((prev) => (prev ? { ...prev, busy: true } : prev))
    try {
      const idToken = await (user as any)?.getIdToken?.()
      const response = await fetch('/api/marketplace/publish', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
        },
        body: JSON.stringify({
          hostId,
          componentId: publisher.id,
          displayName: publisher.name.trim(),
          description: publisher.description.trim(),
          category: publisher.category.trim(),
          priceUsd: Number(publisher.price) || 0,
        }),
      })
      const payload = await response.json()
      if (!response.ok) {
        return void enqueueSnackbar(payload?.error ?? 'Publish failed', {
          variant: response.status === 412 ? 'warning' : 'error',
          allowDuplicate: true,
        })
      }
      setPublisher(null)
      enqueueSnackbar(`Published v${payload.version} to the marketplace`, {
        variant: 'success',
        persist: false,
      })
    } catch (error) {
      console.error(error)
      enqueueSnackbar('An error has occurred', {
        variant: 'error',
        allowDuplicate: true,
      })
    } finally {
      setPublisher((prev) => (prev ? { ...prev, busy: false } : prev))
    }
  }, [publisher, user, hostId, enqueueSnackbar])

  const handleSave = useCallback(async () => {
    if (!editor || !editor.name.trim()) return
    /**
     * Refuse a rename whose seed the server never confirmed (AGL-1358).
     *
     * The dialog only ever opens on a stored row, so there is no create path
     * here to exempt — `handleOpenInBesigner`'s new version document is a
     * different handler writing a fresh uid, and it is deliberately left
     * alone.
     *
     * The guard WRAPS the write — an early return is a shape you can keep
     * while losing the protection.
     */
    const verdict = await writeGuardedBySeed(
      {
        subject: 'component',
        unreadable: componentsStatus === 'error',
        fromCache: componentsFromCache,
      },
      async () => {
        await updateDoc(
          doc(firestore, 'hosts', hostId, 'components', editor.id),
          {
            displayName: editor.name.trim(),
            description: editor.description.trim(),
            // Only when the dialog was opened on a component that has one or
            // the picker set one — an untouched dialog must not write
            // `icon: {}` over a component whose icon was chosen on the
            // detail page.
            ...(editor.icon && { icon: editor.icon }),
            updatedAt: Timestamp.now(),
          },
        )
      },
    )
    // This handler had no report of its own — it has no try/catch either, so
    // a failed write left the dialog open and said nothing. A refusal that
    // did the same would be indistinguishable from a click that missed.
    if (!verdict.ok) {
      return void enqueueSnackbar(verdict.message, {
        variant: 'warning',
        persist: false,
      })
    }
    setEditor(null)
    enqueueSnackbar('Component updated', { variant: 'success', persist: false })
  }, [
    editor,
    firestore,
    hostId,
    enqueueSnackbar,
    componentsStatus,
    componentsFromCache,
  ])

  /**
   * Open a component in its own besigner (AGL-680).
   *
   * Components that predate the standalone editor have no `versionId` —
   * they were only ever edited from inside a screen. Opening one creates
   * version 1 from whatever is published on the doc, so nothing needs
   * migrating up front and a component nobody opens stays untouched.
   */
  const [opening, setOpening] = useState<string | null>(null)
  const handleOpenInBesigner = useCallback(
    async (definition: any) => {
      if (opening) return
      setOpening(definition.$id)
      try {
        let versionId = definition.versionId as string | undefined
        if (!versionId) {
          versionId = Aglyn.createResourceUid()
          // Minting the first version rides /api/hosts/versions (AGL-1369):
          // rules deny the client create, and the route allows a resource's
          // FIRST version on every plan — which this always is, since the
          // component reached here with no `versionId` at all.
          await createHostVersion({
            hostId,
            kind: 'component',
            parentId: definition.$id,
            id: versionId,
            data: {
              componentId: definition.$id,
              hostId,
              displayName: 'Initial version',
              rootId: definition.rootId ?? null,
              nodes: definition.nodes ?? {},
            },
          })
          await updateDoc(
            doc(firestore, 'hosts', hostId, 'components', definition.$id),
            { versionId, updatedAt: Timestamp.now() },
          )
        }
        router.push(
          buildRoute(Route.COMPONENT_BESIGNER, {
            orgSlug,
            host,
            componentId: definition.$id,
            versionId,
          }),
        )
      } catch (error) {
        enqueueSnackbar(
          error instanceof Error ? error.message : 'Could not open the component',
          { variant: 'error', allowDuplicate: true },
        )
      } finally {
        setOpening(null)
      }
    },
    [
      opening,
      firestore,
      hostId,
      orgSlug,
      host,
      router,
      enqueueSnackbar,
      createHostVersion,
    ],
  )

  const handleDelete = useCallback(
    (definition: any) => async () => {
      /*
        The scan STARTS here and the dialog opens in the same tick (AGL-703).
        Awaiting it first would hold a destructive dialog closed for the length
        of a multi-collection read, which reads as a dead button — the failure
        AGL-1461 fixed on the media side.
      */
      const scan = (async () =>
        fetchArtifactUsage({
          hostId,
          kind: 'component',
          id: definition.$id,
          idToken: await (user as any)?.getIdToken?.(),
        }))()
      const confirmed = await confirm({
        title: 'Delete this component?',
        description: (
          <ArtifactDeleteConfirmDescription
            kind="component"
            name={definition.displayName ?? definition.$id}
            scan={scan}
          />
        ),
        confirmationText: 'Delete',
        confirmationButtonProps: { color: 'error' },
      })
        .then(() => true)
        .catch(() => false)
      if (!confirmed) return
      await updateDoc(
        doc(firestore, 'hosts', hostId, 'components', definition.$id),
        { deletedAt: Timestamp.now() },
      )
      enqueueSnackbar('Component deleted', {
        variant: 'success',
        persist: false,
      })
    },
    [confirm, firestore, hostId, enqueueSnackbar, user],
  )

  // Same column/action shape the layouts and screens lists use (AGL-693),
  // so the four artifact listings read as one product rather than three.
  /**
   * Who is already in each component, beside its name (AGL-2486).
   *
   * ONE request for the whole list. The RTDB rules admit a client to exactly
   * one room at a time, so a chip per row would mean a subscription per row —
   * and the presence tree is sparse enough (2 occupied rooms against a largest
   * host of 69 documents) that ~97% of them would report an empty room.
   *
   * Rolled up across VERSIONS, because a row names a document and not a
   * version. The chip's own copy carries that caveat so the count cannot be
   * read as "already in the one you are about to open".
   */
  const { peopleIn } = usePresenceSummary(hostId)

  const columns: GridColDef[] = [
    {
      field: 'displayName',
      headerName: 'Display name',
      minWidth: 220,
      type: 'string',
      renderCell: ({ id, value }: any) => (
        <Stack direction="row" sx={{ alignItems: 'center', gap: 0.5 }}>
          <AppLink
            href={buildRoute(Route.COMPONENT_DETAILS, {
              orgSlug,
              host,
              componentId: id as string,
            })}
          >
            {value || (id as string)}
          </AppLink>
          <DocumentPresenceChips people={peopleIn('component', id as string)} />
        </Stack>
      ),
    },
    { field: '$id', headerName: 'ID', type: 'string', minWidth: 150 },
    {
      field: 'description',
      headerName: 'Description',
      flex: 1,
      minWidth: 240,
      type: 'string',
      // Blank reads as a rendering gap; '--' reads as "nothing here",
      // which is what the screens list has always shown.
      valueFormatter: (value: any) => value || '--',
    },
    {
      field: 'updatedAt',
      headerName: 'Updated',
      flex: 1,
      minWidth: 170,
      type: 'date',
      // MUI X v9 passes the value positionally. The old v6 object form
      // (`({ value })`) silently destructures undefined off a Date and every
      // row renders '--', which is what these columns were doing.
      valueGetter: (value: any) => value?.toDate?.() ?? null,
      valueFormatter: (value: any) => value?.toLocaleString?.() || '--',
    },
    {
      field: 'createdAt',
      headerName: 'Created',
      flex: 1,
      minWidth: 170,
      type: 'date',
      // MUI X v9 passes the value positionally. The old v6 object form
      // (`({ value })`) silently destructures undefined off a Date and every
      // row renders '--', which is what these columns were doing.
      valueGetter: (value: any) => value?.toDate?.() ?? null,
      valueFormatter: (value: any) => value?.toLocaleString?.() || '--',
    },
    /*
      ONE quick action, then the overflow (AGL-693). This list had five inline
      icons — besigner, rename, and three behind MUI's own `showInMenu` — which
      is the arrangement the other three lists each varied in their own way.
      Everything except Preview now lives in the menu.
    */
    artifactActionsColumn((row: any) => {
      const definition = { ...row, $id: row.$id as string }
      const versionId = definition.versionId as string | undefined
      return (
        <ArtifactRowActions
          label={definition.displayName ?? definition.$id}
          quick={{
            icon: mdiEyeOutline.path,
            label: 'Preview',
            // A component with no version has never been opened in the
            // besigner, so there is no snapshot to render. Disabled and
            // saying so, rather than a link to an empty preview.
            ...(versionId
              ? {
                  to: buildRoute(Route.COMPONENT_PREVIEW, {
                    orgSlug,
                    host,
                    componentId: definition.$id,
                    versionId,
                  }),
                }
              : {
                  unavailableReason:
                    'Nothing to preview yet — open it in the besigner once.',
                }),
          }}
          items={[
            {
              key: 'details',
              label: 'View details',
              icon: <MdiIcon path={ICON_VARIANT_SHOW_DETAIL.path} size={0.8} />,
              href: buildRoute(Route.COMPONENT_DETAILS, {
                orgSlug,
                host,
                componentId: definition.$id,
              }),
            },
            {
              key: 'besigner',
              label: 'Edit in besigner',
              icon: <MdiIcon path={mdiVectorSquare.path} size={0.8} />,
              disabled: opening === definition.$id,
              /*
                A LINK only once the component has a version. A component that
                predates the standalone editor has none, and opening it mints
                the first one before it can navigate — that is a write, so it
                stays a handler. Everything else on this list is an address,
                and an address should behave like one.
              */
              ...(versionId
                ? {
                    href: buildRoute(Route.COMPONENT_BESIGNER, {
                      orgSlug,
                      host,
                      componentId: definition.$id,
                      versionId,
                    }),
                  }
                : { onClick: () => void handleOpenInBesigner(definition) }),
            },
            {
              key: 'rename',
              label: 'Rename',
              icon: <MdiIcon path={mdiPencilOutline.path} size={0.8} />,
              onClick: () =>
                setEditor({
                  id: definition.$id,
                  name: definition.displayName ?? '',
                  description: definition.description ?? '',
                  icon: definition.icon,
                }),
            },
            {
              key: 'save-template',
              label: 'Save as template',
              icon: <MdiIcon path={mdiBookmarkOutline.path} size={0.8} />,
              onClick: () =>
                setSaveTemplateFor({
                  kind: 'component',
                  displayName: definition.displayName ?? '',
                  // Unlike screens and layouts, a component definition holds
                  // its own nodes — there is no version doc to fetch.
                  loadNodes: async () =>
                    definition.nodes
                      ? { nodes: definition.nodes, rootId: definition.rootId }
                      : null,
                }),
            },
            {
              key: 'publish',
              label: 'Publish to marketplace',
              icon: <MdiIcon path={mdiStorefrontOutline.path} size={0.8} />,
              onClick: () =>
                setPublisher({
                  id: definition.$id,
                  name: definition.displayName ?? '',
                  description: definition.description ?? '',
                  category: '',
                  price: '',
                }),
            },
            {
              key: 'delete',
              label: 'Delete',
              destructive: true,
              icon: <MdiIcon path={mdiTrashCanOutline.path} size={0.8} />,
              onClick: handleDelete(definition),
            },
          ]}
        />
      )
    }),
  ]

  // No card header: the page header already says "Reusable Components",
  // and screens/layouts do not repeat it either (AGL-693).
  return (
    <CardDisplay>
      <ArtifactTable
        rowHeight={TABLE_ROW_HEIGHT}
        columns={columns}
        noRowsLabel="No reusable components yet"
        noRowsDescription="A reusable component is a block you build once and drop onto any screen — a hero, a pricing table, a footer. Create one, or save one from the besigner."
        noRowsAction={
          onCreate || onBrowseTemplates ? (
            <Stack direction="row" spacing={1}>
              {onCreate ? (
                <Button variant="contained" onClick={onCreate}>
                  {'Create your first component'}
                </Button>
              ) : null}
              {onBrowseTemplates ? (
                <Button variant="outlined" onClick={onBrowseTemplates}>
                  {'Browse templates'}
                </Button>
              ) : null}
            </Stack>
          ) : null
        }
        rows={components}
        // The whole row opens the detail page (AGL-693); the action cluster
        // stops propagation so a menu click never navigates underneath it.
        onOpen={(id) =>
          router.push(
            buildRoute(Route.COMPONENT_DETAILS, {
              orgSlug,
              host,
              componentId: id,
            }),
          )
        }
        // Screens, layouts and templates all hand the table their load state;
        // this one did not, so the four lists that render the SAME table
        // disagreed about whether a fetch is worth mentioning — components
        // showed an empty table until the rows arrived, which reads as "you
        // have none" rather than "these are on their way" (AGL-693).
        loading={componentsStatus === 'loading'}
      />
      <Dialog
        open={Boolean(editor)}
        onClose={() => setEditor(null)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>{'Edit component'}</DialogTitle>
        <DialogContent
          sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}
        >
          <TextField
            label="Name"
            value={editor?.name ?? ''}
            onChange={(event) =>
              setEditor((prev) =>
                prev ? { ...prev, name: event.target.value } : prev,
              )
            }
            size="small"
            autoFocus
            sx={{ mt: 1 }}
          />
          <TextField
            label="Description"
            value={editor?.description ?? ''}
            onChange={(event) =>
              setEditor((prev) =>
                prev ? { ...prev, description: event.target.value } : prev,
              )
            }
            size="small"
            multiline
            minRows={2}
          />
          <ComponentIconField
            value={editor?.icon}
            onChange={(icon) =>
              setEditor((prev) => (prev ? { ...prev, icon } : prev))
            }
            helperText="Marks every instance of this component in the besigner"
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEditor(null)}>{'Cancel'}</Button>
          <Button
            variant="contained"
            color="primary"
            disabled={!editor?.name.trim()}
            onClick={handleSave}
          >
            {'Save'}
          </Button>
        </DialogActions>
      </Dialog>
      <Dialog
        open={Boolean(publisher)}
        onClose={() => (publisher?.busy ? null : setPublisher(null))}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>{'Publish to marketplace'}</DialogTitle>
        <DialogContent
          sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}
        >
          <Typography variant="body2" color="text.secondary">
            {'Publishes a snapshot as a public listing under your ' +
              'marketplace profile. Re-publishing releases a new version; ' +
              'sites that installed it choose when to update.'}
          </Typography>
          <TextField
            label="Listing name"
            value={publisher?.name ?? ''}
            onChange={(event) =>
              setPublisher((prev) =>
                prev ? { ...prev, name: event.target.value } : prev,
              )
            }
            size="small"
            autoFocus
          />
          <TextField
            label="Description"
            value={publisher?.description ?? ''}
            onChange={(event) =>
              setPublisher((prev) =>
                prev ? { ...prev, description: event.target.value } : prev,
              )
            }
            size="small"
            multiline
            minRows={2}
          />
          <TextField
            label="Category"
            placeholder="e.g. Hero, Footer, Pricing"
            value={publisher?.category ?? ''}
            onChange={(event) =>
              setPublisher((prev) =>
                prev ? { ...prev, category: event.target.value } : prev,
              )
            }
            size="small"
          />
          <TextField
            label="Price (USD)"
            placeholder="0 = free"
            // The minimum paid price (AGL-2343): marketplace checkout is a
            // destination charge, so Stripe's fee is debited from the PLATFORM
            // and at $1 it exceeds the whole platform cut. The publish route
            // refuses anything under the floor — this field says so first.
            error={isBelowMarketplacePriceFloor(publisher?.price)}
            helperText={
              marketplacePriceCostNote(publisher?.price) ??
              marketplacePriceFloorHint(
                'Paid listings need payouts set up on your marketplace profile.',
              )
            }
            value={publisher?.price ?? ''}
            onChange={(event) =>
              setPublisher((prev) =>
                prev
                  ? {
                      ...prev,
                      price: event.target.value.replace(/[^0-9]/g, ''),
                    }
                  : prev,
              )
            }
            size="small"
          />
        </DialogContent>
        <DialogActions>
          <Button
            disabled={publisher?.busy}
            onClick={() => setPublisher(null)}
          >
            {'Cancel'}
          </Button>
          <Button
            variant="contained"
            color="primary"
            disabled={
              !publisher?.name.trim() ||
              publisher?.busy ||
              isBelowMarketplacePriceFloor(publisher?.price)
            }
            onClick={handlePublishConfirm}
          >
            {publisher?.busy ? 'Publishing…' : 'Publish'}
          </Button>
        </DialogActions>
      </Dialog>
      <SaveAsTemplateDialog
        hostId={hostId}
        source={saveTemplateFor}
        onClose={() => setSaveTemplateFor(null)}
      />
    </CardDisplay>
  )
}
HostComponentsCard.displayName = 'HostComponentsCard'

export default HostComponentsCard
