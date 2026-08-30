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

import { createResourceUid, pluginDocsHelp } from '@aglyn/aglyn'
import {
  mdiDeleteOutline,
  mdiEyeOutline,
  mdiPencilOutline,
} from '@aglyn/shared-data-mdi'
import { AppLink, CardDisplay, MdiIcon, useConfirmationContext } from '@aglyn/shared-ui-jsx'
import { ListPagination } from '@aglyn/shared-ui-jsx/components/list-pagination.component'
import RowActionsMenu, {
  type RowActionsMenuItem,
} from '@aglyn/shared-ui-jsx/components/row-actions-menu.component'
import { CreateArtifactDrawer } from '@aglyn/shared-ui-jsx-forms'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { Timestamp } from '@aglyn/shared-util-timestamp'
import {
  Alert,
  Button,
  Chip,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material'
import {
  collection,
  doc,
  getCountFromServer,
  limit,
  orderBy,
  query,
  setDoc,
} from 'firebase/firestore'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import {
  useFirestore,
  useOrgDataScope,
  usePagedCollection,
  useUser,
} from '@aglyn/tenant-feature-instance'

export interface OrgListsCardProps {
  hostId: string
  /** The emails hub URL, which every list route hangs beneath. */
  basePath: string
}

/**
 * Email lists (AGL-254): static audiences at `orgs/{orgId}/lists`, shared
 * across the org's sites. Members arrive via the enrollList automation
 * step, popup email capture, or manual adds; campaigns target a list from
 * the audience picker.
 *
 * ## A list is a resource, so it has pages
 *
 * The row opens `…/audiences/{listId}`, and everything a list can be asked or
 * told lives there or on its edit page. The membership used to expand INSIDE
 * this table, which made three things impossible at once: a merchant could not
 * link anybody to one audience, the browser's back button did not walk out of
 * a list, and the rename lived under a table it was not about.
 *
 * Row click and the row's own link are two affordances rather than one. A
 * click handler cannot be middle-clicked, copied, or opened from the browser's
 * context menu, and a link alone loses the whole-row target.
 */
export function OrgListsCard(props: OrgListsCardProps) {
  const { hostId, basePath } = props
  const firestore = useFirestore()
  const router = useRouter()
  const { enqueueSnackbar } = useSnackbar()
  const { confirm } = useConfirmationContext()
  const { data: user } = useUser()
  // The org lookup is async (AGL-1061): `scope` is null until it settles,
  // and stays null for a host with no owning org. Lists have always been
  // org-shared (AGL-254) — there is no host path to fall back to any more
  // (AGL-1050), so creating one is held rather than misdirected.
  const { scope } = useOrgDataScope({ hostId })

  /*
   * Ordered by the server and paged, rather than capped and re-sorted here
   * (AGL-2501, AGL-2292).
   *
   * `limit(50)` carried no `orderBy`, so Firestore answered it in
   * DOCUMENT-ID order over ids from `createResourceUid()` — an arbitrary
   * fifty of the org's lists, which the `localeCompare` below then arranged
   * alphabetically. An agency past fifty lists saw a believable A-to-Z page
   * that was missing most of the alphabet, and the campaign composer's
   * audience picker reads the same collection.
   *
   * `name` is safe to order on here, which is a claim about the writers and
   * not a preference: this card is the only thing that CREATES a list
   * (`handleCreate` refuses an empty name), the automation step and the
   * newsletter enrollment both resolve an existing list and deliberately
   * never create one, and `lists` is absent from `IMPORTABLE_FIELDS`, so no
   * restore path can produce a nameless document for `orderBy` to drop.
   */
  const {
    rows: lists,
    hasMore,
    page,
    setPage,
    pageSize,
    setPageSize,
  } = usePagedCollection<any>(
    (pageLimit) =>
      scope
        ? query(
            collection(firestore, scope[0], scope[1], 'lists'),
            orderBy('name'),
            limit(pageLimit),
          )
        : null,
    [firestore, scope],
    { idField: '$id' },
  )
  const [counts, setCounts] = useState<Record<string, number>>({})
  useEffect(() => {
    // `lists` can only be non-empty when `scope` resolved, but the
    // effect must say so for itself — it reads `scope` outside the query.
    if (!scope) return undefined
    let active = true
    void Promise.all(
      lists.map(async (list: any) => {
        try {
          const snapshot = await getCountFromServer(
            collection(
              firestore,
              scope[0],
              scope[1],
              'lists',
              list.$id,
              'members',
            ),
          )
          return [list.$id, snapshot.data().count] as const
        } catch {
          return [list.$id, 0] as const
        }
      }),
    ).then((entries) => {
      if (active) setCounts(Object.fromEntries(entries))
    })
    return () => {
      active = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firestore, scope, JSON.stringify(lists.map((l: any) => l.$id))])

  /*
   * Creating is a DRAWER, and the drawer is the shared one.
   *
   * The card used to carry a name box, a membership select and a Create
   * button stacked above the table. A create form wedged over a list has
   * nowhere to grow, which is how the rule behind a dynamic list came to be
   * authored through four controls out of nine — the form could not hold the
   * rest. Naming happens here; everything the audience IS happens on its edit
   * page, which has the room.
   */
  const [createOpen, setCreateOpen] = useState(false)
  const [createError, setCreateError] = useState<unknown>(null)
  const [creating, setCreating] = useState(false)

  const handleCreate = async (values: Record<string, any>) => {
    const name = String(values?.['displayName'] ?? '').trim()
    // Without an org there is nowhere org-shared to put the list, and the
    // host path that used to absorb it is gone (AGL-1050). The button is
    // disabled in this state; this is the same answer for a stale closure.
    if (!name || !scope || creating) return
    setCreating(true)
    setCreateError(null)
    const id = createResourceUid()
    try {
      await setDoc(doc(firestore, scope[0], scope[1], 'lists', id), {
        name,
        /*
         * Manual until somebody says otherwise.
         *
         * A list arrives holding the people you put on it, and becomes
         * rule-driven on its edit page where the rule can actually be
         * written. Offering the choice in the naming drawer would ask for a
         * decision before the thing it decides — a rule — can be seen.
         */
        kind: 'manual',
        createdAt: Timestamp.now(),
      })
      setCreateOpen(false)
      enqueueSnackbar(`List "${name}" created`, {
        variant: 'success',
        persist: false,
      })
      router.push(`${basePath}/audiences/${id}`)
    } catch (error) {
      console.error(error)
      setCreateError(error)
      enqueueSnackbar('An error has occurred', { variant: 'error' })
    } finally {
      setCreating(false)
    }
  }

  const handleDelete = async (list: any) => {
    if (!scope) return
    const accepted = await confirm({
      title: 'Delete list?',
      description: `"${list.name}" and its enrollments stop being targetable; automations enrolling into it start reporting errors.`,
      confirmationText: 'Delete',
      confirmationButtonProps: { color: 'error' },
    })
      // `confirm` resolves with no value and REJECTS on cancel, so gating on
      // the resolved value alone made this always return (AGL-950).
      .then(() => true)
      .catch(() => false)
    if (!accepted) return
    // The list owns a `members` subcollection of enrolled contacts, and
    // Firestore doesn't cascade — deleting the doc from here left that PII
    // behind, unreachable but still readable to every org member. Only the
    // Admin SDK can recursiveDelete, so this goes through the erase route
    // (AGL-946).
    try {
      const idToken = await (user as any)?.getIdToken?.()
      const response = await fetch('/api/resources/erase', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
        },
        body: JSON.stringify({
          scope: scope[0],
          scopeId: scope[1],
          kind: 'lists',
          id: list.$id,
        }),
      })
      const result = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(result?.error ?? 'List delete failed')
    } catch (error: any) {
      return void enqueueSnackbar(error?.message ?? 'List delete failed', {
        variant: 'error',
      })
    }
    enqueueSnackbar('List deleted', { variant: 'success', persist: false })
  }

  const listHref = (list: any) => `${basePath}/audiences/${list.$id}`

  const rowActions = (list: any): RowActionsMenuItem[] => [
    {
      key: 'details',
      label: 'Open details',
      icon: <MdiIcon path={mdiEyeOutline.path} size={0.8} />,
      href: listHref(list),
    },
    {
      key: 'edit',
      label: 'Edit list',
      icon: <MdiIcon path={mdiPencilOutline.path} size={0.8} />,
      href: `${listHref(list)}/edit`,
    },
    {
      key: 'delete',
      label: 'Delete',
      icon: <MdiIcon path={mdiDeleteOutline.path} size={0.8} />,
      destructive: true,
      onClick: () => void handleDelete(list),
    },
  ]

  return (
    <CardDisplay
      header="Email lists"
      help={pluginDocsHelp('emailCampaigns', { anchor: '#email-lists' })}
      contentGutterX
      contentGutterY
      contentBordered="all"
      HeaderProps={{
        action: (
          <Button
            size="small"
            variant="contained"
            disabled={!scope || creating}
            onClick={() => setCreateOpen(true)}
          >
            {creating ? 'Creating…' : 'Create audience'}
          </Button>
        ),
      }}
    >
      <Stack spacing={1.5}>
        <Typography variant="body2" color="text.secondary">
          {'Audiences shared across your organization. A manual list holds ' +
            'the people you enroll into it. A dynamic list holds everyone ' +
            'matching a rule, re-checked about every fifteen minutes. Target ' +
            'either from the campaign composer.'}
        </Typography>
        {/*
          A list document stores a name and nothing else descriptive, so the
          shared Description box is refused: a field the writer discards on
          write is worse than a field that was never offered.
         */}
        <CreateArtifactDrawer
          open={createOpen}
          onClose={() => setCreateOpen(false)}
          title="Create new audience"
          submitLabel="Create audience"
          onSubmit={handleCreate}
          errorSlot={
            createError ? (
              <Alert severity="error" sx={{ mt: 2, mb: 1 }}>
                {'This audience could not be created.'}
              </Alert>
            ) : null
          }
          includeDescription={false}
        />
        {lists.length === 0 ? null : (
          <>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>{'List'}</TableCell>
                  <TableCell>{'Membership'}</TableCell>
                  <TableCell>{'Subscribers'}</TableCell>
                  <TableCell align="right" />
                </TableRow>
              </TableHead>
              <TableBody>
                {lists.map((list) => (
                  <TableRow
                    key={list.$id}
                    hover
                    onClick={() => router.push(listHref(list))}
                    sx={{ cursor: 'pointer' }}
                  >
                    <TableCell>
                      {/*
                        The row's own handler would fire too and push the same
                        route twice — one history entry per back press.
                       */}
                      <AppLink
                        href={listHref(list)}
                        onClick={(event: { stopPropagation: () => void }) =>
                          event.stopPropagation()
                        }
                      >
                        {list.name}
                      </AppLink>
                    </TableCell>
                    <TableCell>
                      {list.kind === 'dynamic' ? (
                        <Chip
                          size="small"
                          color="primary"
                          variant="outlined"
                          /*
                            Freshness, not just kind. A dynamic list that has
                            stopped being swept looks exactly like one whose
                            population has not changed, so the last evaluation
                            time is the only thing that tells them apart — and
                            it is the first thing to look at when a merchant
                            reports that somebody is missing from an audience.
                           */
                          label={
                            list.lastEvaluatedAt?.toDate
                              ? `Rule · ${list.lastEvaluatedAt
                                  .toDate()
                                  .toLocaleString()}`
                              : 'Rule · not yet evaluated'
                          }
                        />
                      ) : (
                        <Chip size="small" variant="outlined" label="Manual" />
                      )}
                    </TableCell>
                    <TableCell>{counts[list.$id] ?? '…'}</TableCell>
                    <TableCell
                      align="right"
                      sx={{ width: 56 }}
                      onClick={(event) => event.stopPropagation()}
                    >
                      <RowActionsMenu
                        label={String(list.name ?? list.$id)}
                        items={rowActions(list)}
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <ListPagination
              page={page}
              pageSize={pageSize}
              rowCount={lists.length}
              hasMore={hasMore}
              onPageChange={setPage}
              onPageSizeChange={setPageSize}
            />
          </>
        )}
      </Stack>
    </CardDisplay>
  )
}
OrgListsCard.displayName = 'OrgListsCard'

export default OrgListsCard
