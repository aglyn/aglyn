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
  type ConsentGroup,
  type ContactMergePreviewRow,
  contactDisplayName,
  contactMergePreview,
  nameSearchKey,
  normalizeContactEmail,
} from '@aglyn/aglyn'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { useFirestore } from '@aglyn/tenant-feature-instance'
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  FormControlLabel,
  FormLabel,
  List,
  ListItemButton,
  ListItemText,
  Radio,
  RadioGroup,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material'
import {
  collection,
  endAt,
  getDocs,
  limit,
  orderBy,
  query,
  startAt,
  where,
} from 'firebase/firestore'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useCrmApi } from './use-crm-api'

/** One contact as the dialog holds it: its id and the document as read. */
export interface ContactPick {
  id: string
  doc: Record<string, unknown>
}

/** Which of the two records stays. */
export type ContactMergeKeep = 'current' | 'other'

/** How many rows a search answers — a picker, not a list. */
const SEARCH_LIMIT = 8
/** The high code point that closes a `nameLower` prefix range. */
const HIGH = ''

export interface ContactMergeDialogState {
  open: boolean
  /** The record to merge with, when the opener already knows it. */
  other: ContactPick | null
  keep: ContactMergeKeep
}

/**
 * The dialog's open state, held by the page so two openers — the record's
 * overflow menu and the likely-duplicates card — share one dialog.
 *
 * The menu opens it empty, to be searched, with the OTHER record surviving:
 * "merge this into…" is what a reader means when they are on the record
 * they want gone. The duplicates card opens it with the candidate already
 * picked and THIS record surviving: the reader is on the record they keep,
 * looking at the copies. Either way the dialog lets them switch.
 */
export function useContactMergeDialog() {
  const [state, setState] = useState<ContactMergeDialogState>({
    open: false,
    other: null,
    keep: 'other',
  })
  const open = useCallback(
    (options: { other?: ContactPick; keep?: ContactMergeKeep } = {}) =>
      setState({
        open: true,
        other: options.other ?? null,
        keep: options.keep ?? (options.other ? 'current' : 'other'),
      }),
    [],
  )
  const close = useCallback(
    () => setState((previous) => ({ ...previous, open: false })),
    [],
  )
  return { state, open, close }
}

export interface ContactMergeDialogProps extends ContactMergeDialogState {
  onClose: () => void
  hostId: string
  /** The record whose page this is. */
  current: ContactPick
  /** `['orgs', orgId]` — where the contacts live. */
  scope: readonly [string, string]
  consentGroup: ConsentGroup
  /** What this viewer may list — the search's `array-contains-any`. */
  visibleTo: readonly string[]
  /** The owner's name for a uid, for the preview. */
  memberName?: (uid: string) => string
  /** Told which record survived, once the server has merged. */
  onMerged?: (survivorId: string) => void
}

const label = (pick: ContactPick, groupId: string) =>
  contactDisplayName(pick.doc, groupId) || String(pick.doc['email'] ?? pick.id)

/**
 * MERGE TWO RECORDS FOR ONE PERSON (AGL-2625).
 *
 * Two steps in one dialog. First the OTHER record, found by address or by
 * name among the contacts this viewer may list — the same two searches the
 * company's contacts card runs, one read each, on ask. Then the two records
 * side by side, field by field, with the value the surviving record will
 * carry and where it came from — `contactMergePreview` is the same rule the
 * server writes with, so what the reader is shown is what lands.
 *
 * The reader picks which record survives. The survivor keeps its address;
 * the other record's address becomes an alternate on it, its deals, tasks,
 * activities and leads move, and the document is deleted. The act is one
 * server route, because it is one transaction over two documents and a
 * repoint of rows a browser may not be able to list.
 */
export function ContactMergeDialog(props: ContactMergeDialogProps) {
  const {
    open,
    onClose,
    hostId,
    current,
    scope,
    consentGroup,
    visibleTo,
    memberName,
    onMerged,
  } = props
  const firestore = useFirestore()
  const callCrm = useCrmApi(hostId)
  const { enqueueSnackbar } = useSnackbar()
  const groupId = consentGroup.groupId

  const [other, setOther] = useState<ContactPick | null>(props.other)
  const [keep, setKeep] = useState<ContactMergeKeep>(props.keep)
  const [term, setTerm] = useState('')
  const [searching, setSearching] = useState(false)
  const [results, setResults] = useState<ContactPick[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Reset on every open to what the opener handed over.
  useEffect(() => {
    if (!open) return
    setOther(props.other)
    setKeep(props.keep)
    setTerm('')
    setResults(null)
    setError(null)
    setBusy(false)
  }, [open, props.other, props.keep])

  const search = useCallback(async () => {
    const raw = term.trim()
    if (!raw || searching) return
    setSearching(true)
    setError(null)
    try {
      const contactsRef = collection(firestore, scope[0], scope[1], 'contacts')
      const scoped = where('visibleTo', 'array-contains-any', [...visibleTo])
      let found
      if (raw.includes('@')) {
        const email = normalizeContactEmail(raw)
        if (!email) {
          setResults([])
          return
        }
        found = await getDocs(
          query(contactsRef, scoped, where('email', '==', email), limit(SEARCH_LIMIT)),
        )
      } else {
        const key = nameSearchKey(raw)
        found = await getDocs(
          query(
            contactsRef,
            scoped,
            orderBy('nameLower'),
            startAt(key),
            endAt(`${key}${HIGH}`),
            limit(SEARCH_LIMIT),
          ),
        )
      }
      setResults(
        found.docs
          .filter((snapshot) => snapshot.id !== current.id)
          .map((snapshot) => ({ id: snapshot.id, doc: snapshot.data() })),
      )
    } catch (searchError) {
      console.error(searchError)
      setResults(null)
      setError('The search could not be run.')
    } finally {
      setSearching(false)
    }
  }, [term, searching, firestore, scope, visibleTo, current.id])

  const survivor = keep === 'current' ? current : other
  const merged = keep === 'current' ? other : current
  const rows: ContactMergePreviewRow[] = useMemo(
    () =>
      survivor && merged
        ? contactMergePreview(survivor.doc, merged.doc, groupId, { memberName })
        : [],
    [survivor, merged, groupId, memberName],
  )

  const submit = useCallback(async () => {
    if (!survivor || !merged || busy) return
    setBusy(true)
    setError(null)
    try {
      const { response, payload } = await callCrm('contacts-merge', {
        survivorId: survivor.id,
        mergedId: merged.id,
      })
      if (!response.ok) {
        setError(String(payload['error'] ?? 'The contacts could not be merged.'))
        return
      }
      enqueueSnackbar('Contacts merged', { variant: 'success', persist: false })
      onClose()
      onMerged?.(survivor.id)
    } catch (submitError) {
      console.error(submitError)
      setError('The contacts could not be merged.')
    } finally {
      setBusy(false)
    }
  }, [survivor, merged, busy, callCrm, enqueueSnackbar, onClose, onMerged])

  const currentLabel = label(current, groupId)
  const otherLabel = other ? label(other, groupId) : ''

  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} maxWidth="md" fullWidth>
      <DialogTitle>{'Merge contacts'}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          {!other ? (
            <>
              <Typography variant="body2" color="text.secondary">
                {`Find the other record for ${currentLabel} — by email address, or by name.`}
              </Typography>
              <Stack direction="row" spacing={1} sx={{ alignItems: 'flex-start' }}>
                <TextField
                  label="Email or name"
                  value={term}
                  onChange={(event) => setTerm(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault()
                      void search()
                    }
                  }}
                  size="small"
                  fullWidth
                  autoFocus
                />
                <Button
                  variant="outlined"
                  onClick={() => void search()}
                  disabled={!term.trim() || searching}
                >
                  {searching ? 'Searching…' : 'Search'}
                </Button>
              </Stack>
              {results ? (
                results.length ? (
                  <List dense disablePadding aria-label="Matching contacts">
                    {results.map((pick) => (
                      <ListItemButton key={pick.id} onClick={() => setOther(pick)}>
                        <ListItemText
                          primary={label(pick, groupId)}
                          secondary={String(pick.doc['email'] ?? '')}
                        />
                      </ListItemButton>
                    ))}
                  </List>
                ) : (
                  <Typography variant="body2" color="text.secondary">
                    {'No other contact matches among the ones you can see.'}
                  </Typography>
                )
              ) : null}
            </>
          ) : (
            <>
              <FormControl>
                <FormLabel id="contact-merge-keep">{'Keep'}</FormLabel>
                <RadioGroup
                  aria-labelledby="contact-merge-keep"
                  value={keep}
                  onChange={(event) => setKeep(event.target.value as ContactMergeKeep)}
                >
                  <FormControlLabel
                    value="current"
                    control={<Radio size="small" />}
                    label={`${currentLabel} (${String(current.doc['email'] ?? '')})`}
                  />
                  <FormControlLabel
                    value="other"
                    control={<Radio size="small" />}
                    label={`${otherLabel} (${String(other.doc['email'] ?? '')})`}
                  />
                </RadioGroup>
              </FormControl>
              <Typography variant="body2" color="text.secondary">
                {'The kept record keeps every value it has; empty fields fill from the ' +
                  'other record. Tags, filings and the timeline are combined, and the ' +
                  "other record's deals, tasks, activities and leads move across. Its " +
                  'address becomes an alternate on the kept record, so a later capture ' +
                  'on it lands here — and the other record is deleted.'}
              </Typography>
              <TableContainer sx={{ overflowX: 'auto' }}>
                <Table size="small" aria-label="What the merge keeps">
                  <TableHead>
                    <TableRow>
                      <TableCell>{'Field'}</TableCell>
                      <TableCell>{'Kept'}</TableCell>
                      <TableCell>{'Merged'}</TableCell>
                      <TableCell>{'After'}</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {rows.map((row) => (
                      <TableRow key={row.key}>
                        <TableCell component="th" scope="row">
                          {row.label}
                        </TableCell>
                        <TableCell sx={{ whiteSpace: 'pre-wrap' }}>{row.survivor}</TableCell>
                        <TableCell sx={{ whiteSpace: 'pre-wrap' }}>{row.merged}</TableCell>
                        <TableCell
                          sx={{
                            whiteSpace: 'pre-wrap',
                            fontWeight: row.from === 'merged' || row.from === 'both' ? 600 : undefined,
                          }}
                        >
                          {row.result}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
              {!props.other ? (
                <Button size="small" onClick={() => setOther(null)} sx={{ alignSelf: 'flex-start' }}>
                  {'Pick a different contact'}
                </Button>
              ) : null}
            </>
          )}
          {error ? <Alert severity="error">{error}</Alert> : null}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>
          {'Cancel'}
        </Button>
        <Button
          variant="contained"
          onClick={() => void submit()}
          disabled={!other || busy}
        >
          {busy ? 'Merging…' : 'Merge'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
ContactMergeDialog.displayName = 'ContactMergeDialog'

export default ContactMergeDialog
