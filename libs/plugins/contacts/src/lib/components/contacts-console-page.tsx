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
  checkContactQuota,
  contactMatchesSegment,
  CONTACT_SOURCE_LABELS,
  type ContactSegment,
  type ContactSource,
  type HostContact,
  newResourceScopeFields,
  ORG_SCOPE_TOKEN,
  pluginDocsHelp,
} from '@aglyn/aglyn'
import { type ConsolePluginPageProps } from '@aglyn/aglyn'
import {
  gridFilterRequest,
  hiddenFilterColumns,
  hiddenFilterVisibility,
  listFilterColumn,
  type ListFilterRequest,
} from '@aglyn/shared-ui-jsx/const/list-filter'
import { ListTable } from '@aglyn/shared-ui-jsx/components/list-table.component'
import type { GridColDef } from '@mui/x-data-grid'
import {
  CONTACT_LIST_FILTER_FIELDS,
  CONTACT_LIST_FILTER_HEADERS,
} from '../constants/contact-filters'
import { CardDisplay, useConfirmationContext } from '@aglyn/shared-ui-jsx'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import {
  listFilterConstraints,
  useFirestore,
  useFirestoreCollection,
  useFirestoreDoc,
  useOrgDataScope,
  writeGuardedBySeed,
} from '@aglyn/tenant-feature-instance'
import {
  Alert,
  Button,
  Chip,
  MenuItem,
  Drawer,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getCountFromServer,
  limit,
  orderBy,
  query,
  updateDoc,
} from 'firebase/firestore'
import { useCallback, useEffect, useMemo, useState } from 'react'

/**
 * The shared labels, under the name this file has always called them.
 *
 * The map lives beside the `ContactSource` union so the dynamic-list rule
 * editor and this filter cannot disagree about what `order` is called.
 */
const SOURCE_LABELS = CONTACT_SOURCE_LABELS

type ContactDoc = HostContact & {
  $id: string
  createdAt?: any
  updatedAt?: any
}

/**
 * Why a refund found no contact to record itself against (AGL-2329).
 *
 * The three reasons `recordContactRefund` distinguishes, in the operator's
 * language rather than the writer's enum. They are not interchangeable: two
 * of them are things the merchant can act on and one is a deletion nothing
 * should undo, and collapsing them into "unmatched" would turn an actionable
 * fact into a statistic.
 */
const UNMATCHED_REFUND_REASON: Record<string, string> = {
  'no-email': 'the order carried no email address',
  'no-contact': 'no contact record matched the buyer',
  'contact-deleted': 'the contact was deleted between the sale and the refund',
}

const csvEscape = (value: unknown) => {
  const text = String(value ?? '')
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

/**
 * Contacts CRM (AGL-198): the unified people list fed by AGL-197's
 * ingestion — search, source badges, a profile drawer with the
 * interaction timeline plus tags/notes editing, and CSV export. Available
 * on every plan; the contactsPerHost quota is the upgrade lever.
 */
/**
 * Contacts CRM (AGL-109 → AGL-395): the unified contacts list, segments,
 * and profile drawer, owned by the contacts plugin and rendered by the
 * shell's generic plugin route. The shell applies the `release_contacts`
 * gate (via the nav tab) and passes the resolved `org` doc for the
 * `contactsPerHost` quota check.
 */
/**
 * The filterable fields that get a column. The rest of
 * `CONTACT_LIST_FILTER_FIELDS` still reaches the filter panel, hidden.
 */
const CONTACT_FILTER_COLUMNS = ['name', 'sources', 'tags', 'updatedAt']

export function ContactsConsolePage(props: ConsolePluginPageProps) {
  const { hostId, org, releaseFlag } = props
  // Whether the audience overage on this page is actually INVOICED
  // (AGL-1662), and whether that question has been answered yet.
  //
  // AGL-1604 stopped the usage cron putting `contactsOverageUsd` into
  // `billedCents` while `release_contacts` is off for the org; `db5ecdf2b`
  // taught the console billing page's caption the same thing. This page's own
  // alert still quoted the dollar figure with no flag check — and this is the
  // surface a staff member reaches with the flag OFF, because the shell's
  // `FeatureGate` admits them on `visible` (`released || isStaff`). Support
  // then reads that number back to a customer whose invoice will not carry it.
  //
  // The shell resolves this from `released`, never `visible`: staff opening a
  // page does not put a line on the customer's bill.
  //
  // Both default to the WITHHELD answer when the prop is absent, which only
  // happens in a direct mount — the shell always supplies it for a surface
  // with a nav-tab flag. A caller that has not resolved the verdict has not
  // earned the right to quote a charge.
  const contactsBilled = releaseFlag?.released ?? false
  const releaseFlagsReady = releaseFlag?.ready ?? false
  // Org-shared data root (AGL-237). Null until the org lookup settles
  // (AGL-1061), and for a host with no owning org — the pre-migration host
  // path this used to fall back to is gone (AGL-1050), so the CRM lists
  // nothing rather than listing somewhere else.
  const { scope: dataScope } = useOrgDataScope({ hostId })
  const firestore = useFirestore()
  const { enqueueSnackbar } = useSnackbar()
  const { confirm } = useConfirmationContext()

  /*
   * The column filter, declared BEFORE the listener that reads it — the query
   * is rebuilt from it, so it cannot be state introduced further down.
   */
  const [filter, setFilter] = useState<ListFilterRequest | null>(null)
  const {
    data: contactDocs,
    status: contactsStatus,
    /**
     * The rows the profile drawer is seeded from are unconfirmed by the
     * server (AGL-1358). This payload is narrower than most sites in this
     * issue — `email`, `sources` and `interactions` are not in it — but the
     * two fields that are, `tags` and `notes`, are BOTH written on every
     * save and both come off the seed. Edit the notes against a cached read
     * and the tags go back with them, and tags are what
     * `contactMatchesSegment` runs on: a saved segment is a campaign
     * audience, so a rollback here silently changes who gets emailed.
     */
    fromCache: contactsFromCache,
  } = useFirestoreCollection<any>(
    () => {
      if (!dataScope) return null
      /*
       * ORDERED, and filtered by the QUERY (AGL-2501, AGL-2292).
       *
       * Two bugs shared this one line. `limit(1000)` with no `orderBy` returns
       * documents in ID order — contacts are created with `.add()` and
       * `createResourceUid()`, so that is a pseudo-random SAMPLE of a thousand,
       * and the client `.sort()` below made it look reliably newest-first. An
       * org with forty thousand contacts saw a thousand arbitrary ones,
       * convincingly sorted.
       *
       * The search then ran over that sample, so a name on the wrong side of
       * the cap answered "no contacts match" — the answer a search must never
       * give wrongly, on the list a merchant uses to find one person.
       *
       * The cap STAYS: nobody needs forty thousand rows streamed into a table,
       * and the head-count has been a server aggregate since AGL-1706. What
       * changes is that the thousand are now the newest thousand, and that a
       * filter reaches the whole collection before the cap applies.
       */
      const constraints = listFilterConstraints(
        CONTACT_LIST_FILTER_FIELDS,
        filter,
      )
      return query(
        collection(firestore, dataScope[0], dataScope[1], 'contacts'),
        ...(constraints ?? [orderBy('updatedAt', 'desc')]),
        limit(1000),
      )
    },
    [firestore, dataScope, filter],
    { idField: '$id' },
  )
  const contacts: ContactDoc[] = useMemo(
    () => [...(contactDocs ?? [])],
    [contactDocs],
  )
  /**
   * The HEAD-COUNT, read as a server-side aggregate (AGL-1706).
   *
   * The listener above is `limit(1000)` and always will be — nobody needs
   * 40,000 rows streamed into a table. What it must not do is answer "how
   * many contacts does this org have", and it did: `contacts.length`
   * saturated at 1,000, which is *exactly* the smallest paid included band
   * (`starter`). So `overageContacts = max(0, used − included)` was 0 on
   * every stock plan and the alert below could not render at all.
   *
   * Worse than the dead alert, the same capped number fed the readout in the
   * toolbar. An org with 40,000 contacts on Pro read "1,000 contacts ·
   * 10,000 included" — a page whose job is telling a customer where they sit
   * in their band, telling them they have room they do not have. The console
   * billing page read the truth from `getCountFromServer` on this very
   * collection, so the two surfaces disagreed about the same org's audience.
   *
   * THE LIST AND THE COUNT ARE DIFFERENT QUESTIONS and now have different
   * answers: one aggregate read per mount, the same call
   * `billing-usage.component.tsx` already makes against the same path.
   *
   * The counting RULE is untouched — `checkContactQuota` is an entitlement
   * input and the usage cron is what bills from it. Only this page's input
   * stopped being a saturated one.
   */
  const [serverContactCount, setServerContactCount] = useState<number | null>(
    null,
  )
  useEffect(() => {
    if (!dataScope) return
    let active = true
    void getCountFromServer(
      collection(firestore, dataScope[0], dataScope[1], 'contacts'),
    )
      .then((snapshot) => {
        if (active) setServerContactCount(snapshot.data().count)
      })
      .catch(() => {
        // Falls back to the listener length below — a LOWER bound, and the
        // behaviour this page had before. Deliberately not 0: `checkContactQuota`
        // answers a question from whatever it is handed, and a defaulted 0
        // would clear the free plan's hard-band alert on an org that is over it.
      })
    return () => {
      active = false
    }
  }, [firestore, dataScope])
  // Pending or denied, the listener length stands in. It can only UNDERSTATE
  // (it is the same collection, capped), never overstate, so no alert this
  // number gates can fire on a count larger than the truth.
  const contactCount = serverContactCount ?? contacts.length
  // Audience bands (AGL-890): paid plans meter past the included count
  // instead of blocking; only free hard-bands (quota.allowed = false).
  const quota = checkContactQuota(org, contactCount)
  // Signups whose CRM record was dropped at the free band (AGL-891) —
  // written by upsert-contact, host-scoped.
  const { data: droppedCounter } = useFirestoreDoc<any>(
    () => doc(firestore, 'hosts', hostId, 'counters', 'contactsDropped'),
    [firestore, hostId],
  )
  const droppedTotal = Number(droppedCounter?.['total'] ?? 0)

  /*==========================================
   * REFUNDS THAT REACHED NO CONTACT (AGL-2329).
   *
   * `recordContactRefund` refuses to create a contact for a refund — a
   * contact holding a refund and no purchase is a phantom record with
   * negative lifetime value — and increments
   * `hosts/{hostId}/counters/contactRefundsUnmatched` instead. Its own
   * comment says the shape mirrors `contactsDropped` "so an operator…", and
   * there the sentence stops: `contactsDropped` had this reader and the
   * refund counter had none, so a refund that reached no contact record
   * incremented a number nobody could see.
   *
   * It sits beside the dropped-signup alert because they are the same kind
   * of fact — something that happened to this host's CRM and left no row —
   * and an operator reconciling their contact list needs both or neither.
   *=========================================*/
  const { data: unmatchedRefundCounter } = useFirestoreDoc<any>(
    () => doc(firestore, 'hosts', hostId, 'counters', 'contactRefundsUnmatched'),
    [firestore, hostId],
  )
  const unmatchedRefundTotal = Number(unmatchedRefundCounter?.['total'] ?? 0)
  const unmatchedRefundReason = String(
    unmatchedRefundCounter?.['lastReason'] ?? '',
  )

  // Saved segments (AGL-199): reusable audience filters.
  const { data: segmentDocs } = useFirestoreCollection<any>(
    () =>
      dataScope
        ? query(
            collection(
              firestore,
              dataScope[0],
              dataScope[1],
              'contactSegments',
            ),
            limit(50),
          )
        : null,
    [firestore, dataScope],
    { idField: '$id' },
  )
  const segments = [...(segmentDocs ?? [])].sort((a, b) =>
    String(a.name ?? '').localeCompare(String(b.name ?? '')),
  )

  const [sourceFilter, setSourceFilter] = useState<'' | ContactSource>('')
  const [tagFilter, setTagFilter] = useState('')
  const filterSegment: Pick<ContactSegment, 'tags' | 'sources'> = useMemo(
    () => ({
      tags: tagFilter
        .split(',')
        .map((tag) => tag.trim())
        .filter(Boolean),
      sources: sourceFilter ? [sourceFilter] : [],
    }),
    [tagFilter, sourceFilter],
  )
  const filterActive = Boolean(
    filterSegment.tags?.length || filterSegment.sources?.length,
  )
  /*
   * The SEGMENT controls still narrow in the browser, and say so below.
   *
   * They are a different feature from the search: a segment is saved and
   * becomes a campaign audience, and `contactMatchesSegment` is the one
   * predicate that both the console and the sender read. Pushing it into the
   * query would need a second copy of it in Firestore terms — and two copies
   * of "who is in this audience" is how a campaign goes to the wrong people.
   *
   * So it refines the ordered window rather than the collection, which the
   * caption states rather than leaving to be discovered. The free-text search
   * that used to sit beside it is the grid's now, and reaches everything.
   */
  const visible = useMemo(
    () =>
      contacts.filter((contact) =>
        contactMatchesSegment(contact, filterSegment),
      ),
    [contacts, filterSegment],
  )

  /* One row grammar, the console's (AGL-2501) — the same table everywhere. */
  const contactColumns: GridColDef[] = useMemo(
    () => [
      {
        field: 'name',
        headerName: 'Contact',
        flex: 1.6,
        minWidth: 240,
        ...listFilterColumn(CONTACT_LIST_FILTER_FIELDS, 'name'),
        valueGetter: (_value, row: any) => String(row.name || row.email || ''),
        renderCell: ({ row }: any) => (
          <Stack sx={{ justifyContent: 'center', height: '100%', lineHeight: 1.25 }}>
            <Typography variant="body2" sx={{ lineHeight: 1.25 }}>
              {row.name || row.email}
            </Typography>
            {row.name ? (
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{ lineHeight: 1.25 }}
                noWrap
              >
                {row.email}
              </Typography>
            ) : null}
          </Stack>
        ),
      },
      {
        field: 'sources',
        headerName: 'Sources',
        flex: 1,
        minWidth: 160,
        // A map of provenance flags, not a scalar — `sources.form == true` is
        // queryable one key at a time, which is a menu of its own rather than
        // a filter on this column.
        filterable: false,
        sortable: false,
        valueGetter: (_value, row: any) =>
          Object.keys(row.sources ?? {}).join(', '),
        renderCell: ({ row }: any) => (
          <Stack
            direction="row"
            spacing={0.5}
            sx={{ alignItems: 'center', height: '100%' }}
          >
            {Object.keys(row.sources ?? {}).map((source) => (
              <Chip
                key={source}
                label={SOURCE_LABELS[source as ContactSource] ?? source}
                size="small"
              />
            ))}
          </Stack>
        ),
      },
      {
        field: 'tags',
        headerName: 'Tags',
        flex: 1,
        minWidth: 150,
        ...listFilterColumn(CONTACT_LIST_FILTER_FIELDS, 'tags'),
        sortable: false,
        valueGetter: (_value, row: any) => (row.tags ?? []).join(', '),
        renderCell: ({ row }: any) => (row.tags ?? []).slice(0, 3).join(', '),
      },
      {
        field: 'updatedAt',
        headerName: 'Last activity',
        flex: 0.8,
        minWidth: 150,
        // `type: 'date'` is what gives the panel a date PICKER rather than a
        // free-text box for a value the query reads as a day.
        type: 'date',
        ...listFilterColumn(CONTACT_LIST_FILTER_FIELDS, 'updatedAt'),
        valueGetter: (_value, row: any) =>
          row.updatedAt?.seconds ? new Date(row.updatedAt.seconds * 1000) : null,
        renderCell: ({ row }: any) => (
          <Typography variant="caption" color="text.secondary">
            {row.interactions?.[0]
              ? new Date(row.interactions[0].atMs).toLocaleDateString()
              : '—'}
          </Typography>
        ),
      },
      ...hiddenFilterColumns(
        CONTACT_LIST_FILTER_FIELDS,
        CONTACT_FILTER_COLUMNS,
        CONTACT_LIST_FILTER_HEADERS,
      ),
    ],
    [],
  )

  const [segmentName, setSegmentName] = useState('')
  const handleSaveSegment = useCallback(async () => {
    const name = segmentName.trim().slice(0, 60)
    // No org, no place to put it (AGL-1050). The button is disabled in
    // this state; the guard is here so the callback cannot outlive it.
    if (!name || !filterActive || !dataScope) return
    try {
      await addDoc(
        collection(firestore, dataScope[0], dataScope[1], 'contactSegments'),
        {
          name,
          tags: filterSegment.tags ?? [],
          sources: filterSegment.sources ?? [],
          // `contactSegments` is in SCOPED_COLLECTIONS and was the one
          // member of it with no `array-contains-any` reader and no rules
          // `hasAny` — the rules gate it on `isOrgWideMember()` and
          // `campaign-send` checks it with `visibleToHost`, which passes on
          // a missing field. So nothing broke, which is precisely why this
          // went unnoticed (AGL-1478): a collection listed as scoped that
          // nothing enforces is a trap set for whoever wires up the first
          // scoped read, and they would inherit every segment ever saved
          // already broken. Stamped at creation instead, like its siblings.
          //
          // Org-wide, unconditionally: `useOrgDataScope` resolves to
          // `['orgs', orgId]` or to null, AGL-1061 having removed the
          // `hosts/{hostId}` branch after counting zero documents there.
          // A segment is a saved filter over org contacts, so it is exactly
          // as visible as they are.
          ...newResourceScopeFields([ORG_SCOPE_TOKEN]),
          createdAt: new Date(),
        },
      )
      setSegmentName('')
      enqueueSnackbar(
        `Segment "${name}" saved — usable as a campaign audience`,
        { variant: 'success', persist: false },
      )
    } catch (error) {
      console.error(error)
      enqueueSnackbar('An error has occurred', {
        variant: 'error',
        allowDuplicate: true,
      })
    }
  }, [
    segmentName,
    filterActive,
    filterSegment,
    firestore,
    dataScope,
    enqueueSnackbar,
  ])

  // Profile drawer with editable tags/notes.
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const selected = contacts.find((contact) => contact.$id === selectedId)
  const [tagsDraft, setTagsDraft] = useState('')
  const [notesDraft, setNotesDraft] = useState('')
  const openContact = useCallback((contact: ContactDoc) => {
    setSelectedId(contact.$id)
    setTagsDraft((contact.tags ?? []).join(', '))
    setNotesDraft(contact.notes ?? '')
  }, [])
  // Right-to-erasure (AGL-209): hard-deletes the contact doc. Source
  // records (inbox, orders, bookings, members) live in their own managers.
  const handleDeleteContact = useCallback(async () => {
    if (!selectedId || !dataScope) return
    const contact = contacts.find((item) => item.$id === selectedId)
    const confirmed = await confirm({
      title: 'Delete this contact?',
      description:
        `"${contact?.email ?? selectedId}" is permanently removed from ` +
        'Contacts. Their form submissions, orders, bookings, and ' +
        'membership records are separate — delete those from their own ' +
        'pages if the request covers them.',
      confirmationText: 'Delete contact',
      confirmationButtonProps: { color: 'error' },
    })
      .then(() => true)
      .catch(() => false)
    if (!confirmed) return
    try {
      await deleteDoc(
        doc(firestore, dataScope[0], dataScope[1], 'contacts', selectedId),
      )
      setSelectedId(null)
      enqueueSnackbar('Contact deleted', {
        variant: 'success',
        persist: false,
      })
    } catch (error) {
      console.error(error)
      enqueueSnackbar('An error has occurred', {
        variant: 'error',
        allowDuplicate: true,
      })
    }
  }, [selectedId, contacts, confirm, firestore, dataScope, enqueueSnackbar])

  const handleProfileSave = useCallback(async () => {
    if (!selectedId || !dataScope) return
    const tags = [
      ...new Set(
        tagsDraft
          .split(',')
          .map((tag) => tag.trim().toLowerCase())
          .filter(Boolean)
          .slice(0, 20),
      ),
    ]
    try {
      /**
       * Refuse a save whose seed the server never confirmed (AGL-1358).
       *
       * There is no create path to reach here — a new contact is written by
       * the capture endpoints, and the only create on this page,
       * `handleSaveSegment`, is a separate function building an `addDoc` out
       * of the filter UI rather than a listener row.
       *
       * The guard WRAPS the write — an early return is a shape you can keep
       * while losing the protection.
       */
      const verdict = await writeGuardedBySeed(
        {
          subject: 'contact',
          unreadable: contactsStatus === 'error',
          fromCache: contactsFromCache,
        },
        async () => {
          await updateDoc(
            doc(firestore, dataScope[0], dataScope[1], 'contacts', selectedId),
            {
              tags,
              notes: notesDraft.slice(0, 2000),
            },
          )
        },
      )
      // The drawer is never closed by this handler, so a refusal leaves the
      // typed tags and notes exactly where they are — but it still has to
      // say so, or it reads as a save that worked.
      if (!verdict.ok) {
        return void enqueueSnackbar(verdict.message, {
          variant: 'warning',
          persist: false,
        })
      }
      enqueueSnackbar('Contact saved', { variant: 'success', persist: false })
    } catch (error) {
      console.error(error)
      enqueueSnackbar('An error has occurred', {
        variant: 'error',
        allowDuplicate: true,
      })
    }
  }, [
    selectedId,
    tagsDraft,
    notesDraft,
    firestore,
    dataScope,
    enqueueSnackbar,
    contactsStatus,
    contactsFromCache,
  ])

  const handleExport = useCallback(() => {
    const rows = [
      ['email', 'name', 'sources', 'tags', 'lastInteraction', 'notes'],
      ...visible.map((contact) => [
        contact.email,
        contact.name ?? '',
        Object.keys(contact.sources ?? {}).join('|'),
        (contact.tags ?? []).join('|'),
        contact.interactions?.[0]
          ? new Date(contact.interactions[0].atMs).toISOString()
          : '',
        contact.notes ?? '',
      ]),
    ]
    const csv = rows.map((row) => row.map(csvEscape).join(',')).join('\n')
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = 'contacts.csv'
    anchor.click()
    URL.revokeObjectURL(url)
  }, [visible])

  return (
    <>
      <CardDisplay
        header={'Contacts'}
        help={pluginDocsHelp('contacts', { anchor: '#the-contacts-page' })}
        contentGutterX
        contentGutterY
      >
        <Stack spacing={2}>
          <Stack
            direction="row"
            spacing={1}
            sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 1 }}
          >
            <Typography variant="body2" color="text.secondary" sx={{ flex: 1 }}>
              {/* The org's audience, not the page's row count (AGL-1706) —
                  these two stopped being the same number the moment the
                  listener grew a `limit(1000)`. */}
              {`${contactCount.toLocaleString()} contacts · ${
                Number.isFinite(quota.included)
                  ? `${quota.included.toLocaleString()} included`
                  : '∞'
              }`}
            </Typography>
            <Button
              size="small"
              onClick={handleExport}
              disabled={!visible.length}
            >
              {'Export CSV'}
            </Button>
          </Stack>
          <Stack
            direction="row"
            spacing={1}
            sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 1 }}
          >
            <TextField
              select
              size="small"
              label="Source"
              value={sourceFilter}
              onChange={(event) => setSourceFilter(event.target.value as any)}
              sx={{ minWidth: 140 }}
            >
              <MenuItem value="">{'Any source'}</MenuItem>
              {Object.entries(SOURCE_LABELS).map(([value, label]) => (
                <MenuItem key={value} value={value}>
                  {label}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              size="small"
              label="Tags"
              placeholder="vip, beta"
              value={tagFilter}
              onChange={(event) => setTagFilter(event.target.value)}
              sx={{ minWidth: 160 }}
            />
            {filterActive ? (
              <>
                <TextField
                  size="small"
                  label="Segment name"
                  value={segmentName}
                  onChange={(event) => setSegmentName(event.target.value)}
                  sx={{ minWidth: 160 }}
                />
                <Button
                  size="small"
                  disabled={!segmentName.trim() || !dataScope}
                  onClick={handleSaveSegment}
                >
                  {'Save segment'}
                </Button>
              </>
            ) : null}
            {segments.map((segment: any) => (
              <Chip
                key={segment.$id}
                label={segment.name}
                size="small"
                onClick={() => {
                  setTagFilter((segment.tags ?? []).join(', '))
                  setSourceFilter(segment.sources?.[0] ?? '')
                }}
                // A segment can only have come FROM an org scope, so this
                // is unreachable in practice — but the scope is nullable
                // now (AGL-1050) and an unguarded deref would be a crash
                // rather than a no-op if that ever stopped being true.
                onDelete={
                  dataScope
                    ? () =>
                        deleteDoc(
                          doc(
                            firestore,
                            dataScope[0],
                            dataScope[1],
                            'contactSegments',
                            segment.$id,
                          ),
                        )
                    : undefined
                }
              />
            ))}
          </Stack>
          {!quota.allowed ? (
            <Alert severity="warning">
              {'Contact limit reached — new visitors are no longer ' +
                'captured' +
                (droppedTotal > 0
                  ? ` (${droppedTotal.toLocaleString()} missed so far)`
                  : '') +
                '. Upgrade in Billing to keep collecting.'}
            </Alert>
          ) : quota.overageContacts > 0 &&
            quota.overageRateUsd != null &&
            // No claim about money until the verdict that decides it has
            // settled (AGL-1662). `release_contacts` is default-off before
            // Remote Config activation, so an ungated alert would assert the
            // withheld wording for one paint on an org that IS billed.
            releaseFlagsReady ? (
            <Alert severity="info">
              {contactsBilled
                ? // Same sentence as the billing page's caption, and the same
                  // basis (AGL-2399): the count here is LIVE, the invoice
                  // charges the last reading before the month closes, so the
                  // dollar figure is a projection until the month ends. Staff
                  // and customer must not read different sentences about the
                  // same org's money — that applies to WHEN it is measured as
                  // much as to how much.
                  `${quota.overageContacts.toLocaleString()} contacts over ` +
                  `your plan's included ${quota.included.toLocaleString()} — ` +
                  `metered at $${quota.overageRateUsd}/1,000 per month ` +
                  `(≈$${quota.overageMonthlyUsd.toFixed(2)} if your list ends ` +
                  'the month at this size). ' +
                  'Upgrade in Billing for a larger included audience.'
                : // The wording `db5ecdf2b` put on the billing page, which is
                  // itself the wording `1a2aed5cb` published to
                  // `billing-and-plans/overview.md` (AGL-1601/1603). Staff and
                  // customer must not read different sentences about the same
                  // org's money.
                  //
                  // THE COUNT STAYS, THE TOTAL GOES: the head-count is real —
                  // ingestion captured those records — and is not a claim
                  // about money. The upgrade nudge goes with the total, since
                  // it prompts a purchase premised on a charge that is not
                  // happening.
                  `${quota.overageContacts.toLocaleString()} contacts over ` +
                  `your plan's included ${quota.included.toLocaleString()} — ` +
                  'not billed while the Contacts page is unavailable. ' +
                  `The $${quota.overageRateUsd}/1,000 rate applies once ` +
                  'Contacts opens.'}
            </Alert>
          ) : droppedTotal > 0 ? (
            <Alert severity="info">
              {`${droppedTotal.toLocaleString()} earlier visitor${
                droppedTotal === 1 ? ' was' : 's were'
              } not captured while your contact band was full.`}
            </Alert>
          ) : null}
          {/*
            Unlike the band alert above, this one is NOT exclusive with the
            others: a host can be over its band AND have refunds that landed
            nowhere, and the two have different remedies. Chaining it into the
            same ternary would hide whichever fact came second.
          */}
          {unmatchedRefundTotal > 0 ? (
            <Alert severity="warning">
              {`${unmatchedRefundTotal.toLocaleString()} refund${
                unmatchedRefundTotal === 1 ? '' : 's'
              } could not be recorded against a contact${
                UNMATCHED_REFUND_REASON[unmatchedRefundReason]
                  ? ` — most recently because ${UNMATCHED_REFUND_REASON[unmatchedRefundReason]}`
                  : ''
              }. The money moved; the customer's timeline does not show it.`}
            </Alert>
          ) : null}
          {contacts.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              {'No contacts yet — form submissions, member sign-ups, ' +
                'orders, and bookings all become contacts automatically.'}
            </Typography>
          ) : (
            <>
              {/* The segment controls refine the loaded window; the search
                  and the column filters reach the whole collection. Said out
                  loud, because a control that narrows less than it looks like
                  it does is the thing this page has been fixing. */}
              {filterActive ? (
                <Typography variant="caption" color="text.secondary">
                  {'Source and tag narrow the loaded window. Search and the ' +
                    'column filters reach every contact.'}
                </Typography>
              ) : null}
              <ListTable
                rows={visible}
                columns={contactColumns}
                onOpen={(id) => {
                  const found = visible.find((row) => row.$id === id)
                  if (found) openContact(found)
                }}
                /*
                 * The grid must NOT also filter. The query answers it, so a
                 * client pass could only drop rows the query already matched.
                 */
                filterMode="server"
                onFilterModelChange={(model) =>
                  setFilter(gridFilterRequest(model))
                }
                initialState={{
                  columns: {
                    columnVisibilityModel: hiddenFilterVisibility(
                      CONTACT_LIST_FILTER_FIELDS,
                      CONTACT_FILTER_COLUMNS,
                    ),
                  },
                }}
              />
            </>
          )}
        </Stack>
      </CardDisplay>
      <Drawer
        anchor="right"
        open={Boolean(selected)}
        onClose={() => setSelectedId(null)}
      >
        {selected ? (
          <Stack spacing={2} sx={{ width: 360, p: 3 }}>
            <Typography variant="h6" noWrap>
              {selected.name || selected.email}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {selected.email}
            </Typography>
            <Stack direction="row" spacing={0.5}>
              {Object.keys(selected.sources ?? {}).map((source) => (
                <Chip
                  key={source}
                  label={SOURCE_LABELS[source as ContactSource] ?? source}
                  size="small"
                />
              ))}
            </Stack>
            <TextField
              size="small"
              label="Tags"
              helperText="Comma-separated"
              value={tagsDraft}
              onChange={(event) => setTagsDraft(event.target.value)}
            />
            <TextField
              size="small"
              label="Notes"
              value={notesDraft}
              onChange={(event) => setNotesDraft(event.target.value)}
              multiline
              minRows={3}
            />
            <Stack direction="row" spacing={1}>
              <Button
                variant="contained"
                color="primary"
                onClick={handleProfileSave}
              >
                {'Save'}
              </Button>
              <Button color="error" onClick={handleDeleteContact}>
                {'Delete contact'}
              </Button>
            </Stack>
            <Typography variant="subtitle2">{'Activity'}</Typography>
            <Stack spacing={1}>
              {(selected.interactions ?? []).map((interaction, index) => (
                <Stack key={index}>
                  <Typography variant="body2">
                    {interaction.summary ??
                      SOURCE_LABELS[interaction.type] ??
                      interaction.type}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {new Date(interaction.atMs).toLocaleString()}
                  </Typography>
                </Stack>
              ))}
              {!(selected.interactions ?? []).length ? (
                <Typography variant="body2" color="text.secondary">
                  {'No recorded activity.'}
                </Typography>
              ) : null}
            </Stack>
          </Stack>
        ) : null}
      </Drawer>
    </>
  )
}
ContactsConsolePage.displayName = 'ContactsConsolePage'

export default ContactsConsolePage
