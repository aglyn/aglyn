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
  createResourceUid,
  normalizeDynamicListRule,
  pluginDocsHelp,
  type DynamicListSource,
} from '@aglyn/aglyn'
import { CardDisplay, useConfirmationContext } from '@aglyn/shared-ui-jsx'
import { ListPagination } from '@aglyn/shared-ui-jsx/components/list-pagination.component'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { Timestamp } from '@aglyn/shared-util-timestamp'
import {
  Button,
  Chip,
  MenuItem,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
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
import { Fragment, useEffect, useState } from 'react'
import {
  useFirestore,
  useOrgDataScope,
  usePagedCollection,
  useUser,
} from '@aglyn/tenant-feature-instance'
import ListMembersPanel from './list-members-panel'

export interface OrgListsCardProps {
  hostId: string
}

/**
 * Email lists (AGL-254): static audiences at `orgs/{orgId}/lists`, shared
 * across the org's sites. Members arrive via the enrollList automation
 * step, popup email capture, or manual adds here; campaigns target a
 * list from the audience picker.
 */
export function OrgListsCard(props: OrgListsCardProps) {
  const { hostId } = props
  const firestore = useFirestore()
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
  /*
   * Bumped by an add or a removal, and by nothing else.
   *
   * The counts below are server aggregates, one per visible list, taken once
   * per page of lists. That is the right cost for reading — but a figure taken
   * before an add would sit directly above the members table that shows the
   * person who was just added, disagreeing with it. Re-taking them on a
   * MUTATION keeps the column honest without turning a read into a poll.
   */
  const [membershipVersion, setMembershipVersion] = useState(0)
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
  }, [
    firestore,
    scope,
    membershipVersion,
    JSON.stringify(lists.map((l: any) => l.$id)),
  ])

  /*
   * The one list whose membership is open, if any.
   *
   * One at a time, and closed by default. Each open panel is a Firestore
   * listener over that list's `members`; rendering one per row would open an
   * agency's fifty on arrival, to show a table nobody asked for. The reader
   * asks, and the panel unmounts — listener with it — when they close it.
   */
  const [openListId, setOpenListId] = useState('')

  const [name, setName] = useState('')
  /*
   * A dynamic list is authored HERE, with pickers.
   *
   * The rule shape is small enough that a merchant could in principle type it
   * as JSON, and that is exactly the signal that a picker is missing: needing
   * to hand-write a stored structure is a console feature that did not ship,
   * not a power-user affordance. Every control below writes one field of the
   * rule `normalizeDynamicListRule` reads back.
   */
  const [kind, setKind] = useState<'manual' | 'dynamic'>('manual')
  const [sources, setSources] = useState<DynamicListSource[]>(['contacts'])
  const [tags, setTags] = useState('')
  const [formNames, setFormNames] = useState('')
  const [createdAfter, setCreatedAfter] = useState('')

  /** Comma-separated free text → the trimmed, non-empty values. */
  const splitList = (value: string) =>
    value
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean)

  const handleCreate = async () => {
    // Without an org there is nowhere org-shared to put the list, and the
    // host path that used to absorb it is gone (AGL-1050). The button is
    // disabled here; this is the same answer for a stale closure.
    if (!name.trim() || !scope) return
    const id = createResourceUid()
    /*
     * Normalized before it is stored, by the same function the materializer
     * reads it back through. A rule that is coerced on the way out but not on
     * the way in is a rule the console can display differently from the way
     * it evaluates.
     */
    const rule = normalizeDynamicListRule({
      sources,
      ...(splitList(tags).length ? { tags: splitList(tags) } : {}),
      ...(splitList(formNames).length
        ? { formNames: splitList(formNames) }
        : {}),
      ...(createdAfter ? { createdAfterMs: Date.parse(createdAfter) } : {}),
    })
    try {
      await setDoc(doc(firestore, scope[0], scope[1], 'lists', id), {
        name: name.trim(),
        kind,
        ...(kind === 'dynamic'
          ? {
              rule,
              /*
               * WHICH SITE'S people the rule draws from.
               *
               * Lists are org-shared but leads, members and form submissions
               * are host-owned, and org contacts are read narrowed to one
               * host. A dynamic list with no host has no silos at all, so the
               * sweep skips it — which is why this is stamped at creation
               * rather than resolved later from whoever happens to sweep.
               */
              hostId,
            }
          : {}),
        createdAt: Timestamp.now(),
      })
      setName('')
      enqueueSnackbar(`List "${name.trim()}" created`, {
        variant: 'success',
        persist: false,
      })
    } catch (error) {
      console.error(error)
      enqueueSnackbar('An error has occurred', { variant: 'error' })
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

  return (
    <CardDisplay
      header="Email lists"
      help={pluginDocsHelp('emailCampaigns', { anchor: '#email-lists' })}
      contentGutterX
      contentGutterY
      contentBordered="all"
    >
      <Stack spacing={1.5}>
        <Typography variant="body2" color="text.secondary">
          {'Audiences shared across your organization. A manual list holds ' +
            'the people you enroll into it. A dynamic list holds everyone ' +
            'matching a rule, re-checked about every fifteen minutes. Target ' +
            'either from the campaign composer.'}
        </Typography>
        <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
          <TextField
            size="small"
            label="New list name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            sx={{ flexGrow: 1, minWidth: 220, maxWidth: 320 }}
          />
          <TextField
            select
            size="small"
            label="Membership"
            value={kind}
            onChange={(event) =>
              setKind(event.target.value as 'manual' | 'dynamic')
            }
            sx={{ minWidth: 160 }}
          >
            <MenuItem value="manual">{'Manual'}</MenuItem>
            <MenuItem value="dynamic">{'From a rule'}</MenuItem>
          </TextField>
          <Button
            size="small"
            variant="contained"
            color="primary"
            disabled={
              !name.trim() ||
              !scope ||
              // A dynamic list with no source matches nobody, and an empty
              // list is indistinguishable from a rule that has not run yet.
              (kind === 'dynamic' && sources.length === 0)
            }
            onClick={() => void handleCreate()}
          >
            {'Create'}
          </Button>
        </Stack>
        {kind !== 'dynamic' ? null : (
          <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
            <TextField
              select
              size="small"
              label="People from"
              value={sources}
              onChange={(event) =>
                setSources(
                  (typeof event.target.value === 'string'
                    ? [event.target.value]
                    : event.target.value) as DynamicListSource[],
                )
              }
              slotProps={{ select: { multiple: true } }}
              sx={{ minWidth: 220 }}
            >
              <MenuItem value="contacts">{'Contacts'}</MenuItem>
              <MenuItem value="leads">{'Leads'}</MenuItem>
              <MenuItem value="siteMembers">{'Site members'}</MenuItem>
              <MenuItem value="formSubmissions">{'Form submissions'}</MenuItem>
            </TextField>
            <TextField
              size="small"
              label="Tagged"
              placeholder="vip, wholesale"
              helperText="Contacts only"
              value={tags}
              onChange={(event) => setTags(event.target.value)}
              sx={{ minWidth: 180 }}
            />
            <TextField
              size="small"
              label="Submitted form"
              placeholder="Contact us"
              helperText="Form submissions only"
              value={formNames}
              onChange={(event) => setFormNames(event.target.value)}
              sx={{ minWidth: 180 }}
            />
            <TextField
              type="date"
              size="small"
              label="Created after"
              value={createdAfter}
              onChange={(event) => setCreatedAfter(event.target.value)}
              slotProps={{ inputLabel: { shrink: true } }}
              sx={{ minWidth: 170 }}
            />
          </Stack>
        )}
        {kind !== 'dynamic' ? null : (
          <Typography variant="caption" color="text.secondary">
            {'Matching people are enrolled automatically and leave when they ' +
              'stop matching. Anyone you add by hand stays. Being matched by ' +
              'a rule is not consent to be emailed — a campaign still only ' +
              'reaches people whose consent is on record.'}
          </Typography>
        )}
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
                <Fragment key={list.$id}>
                <TableRow>
                  <TableCell>{list.name}</TableCell>
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
                  <TableCell align="right">
                    <Button
                      size="small"
                      onClick={() =>
                        setOpenListId((current) =>
                          current === list.$id ? '' : list.$id,
                        )
                      }
                    >
                      {openListId === list.$id ? 'Close' : 'Members'}
                    </Button>
                    <Button
                      size="small"
                      color="error"
                      onClick={() => void handleDelete(list)}
                    >
                      {'Delete'}
                    </Button>
                  </TableCell>
                </TableRow>
                {openListId !== list.$id || !scope ? null : (
                  <TableRow>
                    {/*
                      One cell across the table, so the panel is not squeezed
                      into the actions column. `colSpan` is the header count.
                     */}
                    <TableCell colSpan={4} sx={{ py: 0 }}>
                      <ListMembersPanel
                        hostId={hostId}
                        scope={scope as readonly [string, string]}
                        listId={list.$id}
                        listName={String(list.name ?? '')}
                        onMembershipChanged={() =>
                          setMembershipVersion((version) => version + 1)
                        }
                      />
                    </TableCell>
                  </TableRow>
                )}
                </Fragment>
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
