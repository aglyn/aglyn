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
  type ContactSegment,
  type ContactSource,
  contactMatchesSegment,
  type HostContact,
} from '@aglyn/aglyn'
import { type ConsolePluginPageProps } from '@aglyn/aglyn'
import { CardDisplay, useConfirmationContext } from '@aglyn/shared-ui-jsx'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import {
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material'
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  limit,
  query,
  updateDoc,
} from 'firebase/firestore'
import { useCallback, useMemo, useState } from 'react'

const SOURCE_LABELS: Record<ContactSource, string> = {
  form: 'Form',
  member: 'Member',
  order: 'Customer',
  booking: 'Booking',
  newsletter: 'Newsletter',
}

type ContactDoc = HostContact & {
  $id: string
  createdAt?: any
  updatedAt?: any
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
export function ContactsConsolePage(props: ConsolePluginPageProps) {
  const { hostId, org } = props
  // Org-shared data root (AGL-237). Null until the org lookup settles
  // (AGL-1061), and for a host with no owning org — the pre-migration host
  // path this used to fall back to is gone (AGL-1050), so the CRM lists
  // nothing rather than listing somewhere else.
  const { scope: dataScope } = useOrgDataScope({ hostId })
  const firestore = useFirestore()
  const { enqueueSnackbar } = useSnackbar()
  const { confirm } = useConfirmationContext()

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
    () =>
      dataScope
        ? query(
            collection(firestore, dataScope[0], dataScope[1], 'contacts'),
            limit(1000),
          )
        : null,
    [firestore, dataScope],
    { idField: '$id' },
  )
  const contacts: ContactDoc[] = useMemo(
    () =>
      [...(contactDocs ?? [])].sort(
        (a, b) => (b.updatedAt?.seconds ?? 0) - (a.updatedAt?.seconds ?? 0),
      ),
    [contactDocs],
  )
  // Audience bands (AGL-890): paid plans meter past the included count
  // instead of blocking; only free hard-bands (quota.allowed = false).
  const quota = checkContactQuota(org, contacts.length)
  // Signups whose CRM record was dropped at the free band (AGL-891) —
  // written by upsert-contact, host-scoped.
  const { data: droppedCounter } = useFirestoreDoc<any>(
    () => doc(firestore, 'hosts', hostId, 'counters', 'contactsDropped'),
    [firestore, hostId],
  )
  const droppedTotal = Number(droppedCounter?.['total'] ?? 0)

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

  const [search, setSearch] = useState('')
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
  const visible = useMemo(() => {
    const term = search.trim().toLowerCase()
    return contacts.filter((contact) => {
      if (!contactMatchesSegment(contact, filterSegment)) return false
      if (!term) return true
      return [contact.email, contact.name, ...(contact.tags ?? [])]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(term)
    })
  }, [contacts, search, filterSegment])

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
      <CardDisplay header={'Contacts'} contentGutterX contentGutterY>
        <Stack spacing={2}>
          <Stack
            direction="row"
            spacing={1}
            sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 1 }}
          >
            <TextField
              size="small"
              label="Search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              sx={{ minWidth: 220 }}
            />
            <Typography variant="body2" color="text.secondary" sx={{ flex: 1 }}>
              {`${contacts.length.toLocaleString()} contacts · ${
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
          ) : quota.overageContacts > 0 && quota.overageRateUsd != null ? (
            <Alert severity="info">
              {`${quota.overageContacts.toLocaleString()} contacts over ` +
                `your plan's included ${quota.included.toLocaleString()} — ` +
                `metered at $${quota.overageRateUsd}/1,000 per month ` +
                `(≈$${quota.overageMonthlyUsd.toFixed(2)} this month). ` +
                'Upgrade in Billing for a larger included audience.'}
            </Alert>
          ) : droppedTotal > 0 ? (
            <Alert severity="info">
              {`${droppedTotal.toLocaleString()} earlier visitor${
                droppedTotal === 1 ? ' was' : 's were'
              } not captured while your contact band was full.`}
            </Alert>
          ) : null}
          {contacts.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              {'No contacts yet — form submissions, member sign-ups, ' +
                'orders, and bookings all become contacts automatically.'}
            </Typography>
          ) : (
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>{'Contact'}</TableCell>
                  <TableCell>{'Sources'}</TableCell>
                  <TableCell>{'Tags'}</TableCell>
                  <TableCell align="right">{'Last activity'}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {visible.map((contact) => (
                  <TableRow
                    key={contact.$id}
                    hover
                    sx={{ cursor: 'pointer' }}
                    onClick={() => openContact(contact)}
                  >
                    <TableCell>
                      <Typography variant="body2">
                        {contact.name || contact.email}
                      </Typography>
                      {contact.name ? (
                        <Typography variant="caption" color="text.secondary">
                          {contact.email}
                        </Typography>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      <Stack direction="row" spacing={0.5}>
                        {Object.keys(contact.sources ?? {}).map((source) => (
                          <Chip
                            key={source}
                            label={
                              SOURCE_LABELS[source as ContactSource] ?? source
                            }
                            size="small"
                          />
                        ))}
                      </Stack>
                    </TableCell>
                    <TableCell>
                      {(contact.tags ?? []).slice(0, 3).join(', ')}
                    </TableCell>
                    <TableCell align="right">
                      <Typography variant="caption" color="text.secondary">
                        {contact.interactions?.[0]
                          ? new Date(
                              contact.interactions[0].atMs,
                            ).toLocaleDateString()
                          : '—'}
                      </Typography>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
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
