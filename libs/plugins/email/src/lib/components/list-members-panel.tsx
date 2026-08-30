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

/**
 * Who is on one list, and the three things you can do about it.
 *
 * The audience card could create a list and delete a list. It could not show
 * you a single name on one. This panel is the rest of it: read the membership,
 * add somebody, take somebody off. The list's own settings — its name, and the
 * rule behind a dynamic one — belong to the edit route, because they are
 * facts about the LIST rather than about who is on it.
 *
 * ## It mounts only on a list's own page
 *
 * The audience detail route renders this for the ONE list being read. A
 * membership listener per row would open one per list on the audiences table,
 * on a surface where most visits are to read the list of lists — the
 * read-on-mount shape `emails-console-read-cost.spec.tsx` meters. Nothing here
 * reads anything until a list is opened, and the add form reads nothing until
 * an address is typed.
 *
 * ## The consent facts come from the server, always
 *
 * Every sentence about whether somebody may be added is `email/list-members-preview`
 * answering from that person's actual record and both suppression lists. This
 * component computes none of it. A screen that decided for itself would be a
 * second copy of the rule on the one surface whose job is to tell the operator
 * the truth about what is about to happen — including, and especially, that
 * the product knows nothing about this person's permission.
 *
 * ## Removing is not suppressing, and the screen says so
 *
 * Taking somebody off a list is the operator changing their mind about an
 * audience. It is not the person asking to stop being mailed, it does not stop
 * another list reaching them, and it writes nothing to the suppression list.
 * Those are different acts with different records, and a console that let them
 * blur is a console where "remove" is quietly relied on as an unsubscribe.
 */

import type { DynamicListRule } from '@aglyn/aglyn'
import { mdiAccountRemoveOutline } from '@aglyn/shared-data-mdi'
import { MdiIcon, useConfirmationContext } from '@aglyn/shared-ui-jsx'
import { ListPagination } from '@aglyn/shared-ui-jsx/components/list-pagination.component'
import RowActionsMenu from '@aglyn/shared-ui-jsx/components/row-actions-menu.component'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  FormControlLabel,
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
  deleteDoc,
  doc,
  documentId,
  limit,
  orderBy,
  query,
} from 'firebase/firestore'
import { useCallback, useEffect, useState } from 'react'
import {
  useFirestore,
  usePagedCollection,
  useUser,
} from '@aglyn/tenant-feature-instance'

export interface ListMembersPanelProps {
  hostId: string
  /** `['orgs', orgId]` — the resolved org scope the card already holds. */
  scope: readonly [string, string]
  listId: string
  listName: string
  /**
   * Called after a membership is added or removed.
   *
   * The audience page's subscriber total is a server aggregate, taken once.
   * Left alone it would go on reporting the figure from before the add — a
   * stale total directly above a live table that disagrees with it, which
   * reads as the add having failed. The page re-takes the aggregate on this
   * signal and at no other time, so nothing is re-counted while somebody is
   * only reading.
   */
  onMembershipChanged?: () => void
  /**
   * The list's saved filters, when it has any and its membership is FIXED.
   *
   * Present, the panel offers to find the people they select and add them —
   * the same act as typing addresses, with the search doing the typing. Absent
   * (a live list, or one with no filters saved), the add form is the address
   * box alone: a live list's membership is the sweep's to decide, and offering
   * to add its own matches by hand would produce hand-added copies of rows the
   * sweep already owns.
   */
  findRule?: DynamicListRule | null
  /** The same filters in sentences, so the button says what it will find. */
  ruleSummary?: readonly string[]
}

/** One member row, as stored. */
interface MemberRow {
  $id: string
  email?: string
  name?: string
  source?: string
  via?: 'manual' | 'rule'
  addedAt?: { toDate?: () => Date }
  marketingConsent?: boolean
  marketingConsentBasis?: 'contact-opt-in' | 'operator-attested'
  marketingConsentAtMs?: number
}

/** What `email/list-members-preview` answers for one address. */
interface AddressVerdict {
  input: string
  email: string | null
  refusal: string | null
  requiresAttestation: boolean
  summary: string
}

interface Preview {
  verdicts: AddressVerdict[]
  optedIn: number
  needAttestation: number
  refused: number
}

/** What a filter search found, as `email/list-rule-preview` reports it. */
interface FoundPeople extends Preview {
  /** People the filters matched — NOT the length of `emails`. */
  matched: number
  /** `emails` is one batch of a larger match. */
  truncated: boolean
  /** False when the scan hit its budget, so `matched` is itself a floor. */
  complete: boolean
  emails: string[]
}

/** What one address's outcome was, after the add. */
interface AddResult {
  input: string
  email: string | null
  enrolled: boolean
  error?: string
}

/**
 * How the basis reads on screen.
 *
 * An attestation and an opt-in are NOT the same fact and a table that
 * rendered both as a tick would be the conflation `list-members.ts` stores
 * the basis to prevent: one is a person's own decision, the other is a claim
 * an account made on their behalf. A row with neither says so plainly rather
 * than reading as a refusal — absence is not refusal.
 */
function consentLabel(member: MemberRow): { label: string; asserted: boolean } {
  if (member.marketingConsent !== true) {
    return { label: 'No basis on record', asserted: false }
  }
  const when = member.marketingConsentAtMs
    ? ` · ${new Date(member.marketingConsentAtMs).toLocaleDateString()}`
    : ''
  return member.marketingConsentBasis === 'operator-attested'
    ? { label: `Attested by your team${when}`, asserted: true }
    : { label: `Opted in${when}`, asserted: false }
}

/** Free text — a paste, a typed address, commas or newlines — to addresses. */
export function splitAddresses(value: string): string[] {
  return value
    .split(/[\s,;]+/)
    .map((entry) => entry.trim())
    // A pasted mail-client line is `Name <a@b.co>`; keep the address part.
    .map((entry) => entry.replace(/^.*<|>.*$/g, ''))
    .filter(Boolean)
}

export function ListMembersPanel(props: ListMembersPanelProps) {
  const {
    hostId,
    scope,
    listId,
    listName,
    onMembershipChanged,
    findRule,
    ruleSummary,
  } = props
  const firestore = useFirestore()
  const { data: user } = useUser()
  const { enqueueSnackbar } = useSnackbar()
  const { confirm } = useConfirmationContext()

  /*
   * Ordered by DOCUMENT ID and paged, not capped and re-sorted here.
   *
   * `__name__` rather than `addedAt`, which is the column a reader would
   * assume: `orderBy` FILTERS as well as sorts, so a document missing the
   * field is not in the result at all — and `addedAt` is stamped only when a
   * membership is CREATED, so every row written under the two legacy ids
   * `list-members.ts` still adopts predates it. Ordering on it would drop the
   * oldest members from their own list, silently, which is the failure that
   * turned an audience into a random sample (AGL-2501). The id is the one key
   * every row has.
   */
  const {
    rows: members,
    hasMore,
    page,
    setPage,
    pageSize,
    setPageSize,
  } = usePagedCollection<MemberRow>(
    (pageLimit) =>
      query(
        collection(firestore, scope[0], scope[1], 'lists', listId, 'members'),
        orderBy(documentId()),
        limit(pageLimit),
      ),
    [firestore, scope[0], scope[1], listId],
    { idField: '$id' },
  )

  const [addInput, setAddInput] = useState('')
  const [addName, setAddName] = useState('')
  const [preview, setPreview] = useState<Preview | null>(null)
  const [attested, setAttested] = useState(false)
  const [results, setResults] = useState<AddResult[] | null>(null)
  const [busy, setBusy] = useState(false)
  /*
   * The addresses a SEARCH found, when the operator ran one.
   *
   * A second way to fill the same candidate set, not a second way to add. Once
   * this holds addresses, everything below it — the consent readout, the
   * attestation, the Add button — is the code the typed path already used, so
   * there is exactly one place in this component where somebody is put on a
   * list and exactly one gate in front of it.
   */
  const [found, setFound] = useState<FoundPeople | null>(null)

  const addresses = found ? found.emails : splitAddresses(addInput)

  /*
   * Any edit to the box invalidates the answer.
   *
   * A preview belongs to the exact addresses it was run for. Leaving a stale
   * one on screen would show a count, and an attestation checkbox, for a set
   * the operator has since changed — so the number they stand behind would
   * not be the number that acts. Typing also abandons a search: the two are
   * alternative ways of naming a candidate set, and holding both at once
   * would leave the Add button acting on whichever the code happened to
   * prefer.
   */
  useEffect(() => {
    setPreview(null)
    setAttested(false)
    setResults(null)
    setFound(null)
  }, [addInput])

  const post = useCallback(
    async (route: string, body: Record<string, unknown>) => {
      const idToken = await (user as { getIdToken?: () => Promise<string> })
        ?.getIdToken?.()
      const response = await fetch(`/api/email/${route}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
        },
        body: JSON.stringify({ hostId, listId, ...body }),
      })
      const payload = await response.json().catch(() => ({}))
      return { ok: response.ok, payload }
    },
    [user, hostId, listId],
  )

  const handlePreview = useCallback(async () => {
    if (busy || !addresses.length) return
    setBusy(true)
    try {
      const { ok, payload } = await post('list-members-preview', {
        emails: addresses,
      })
      if (!ok) {
        return void enqueueSnackbar(
          payload?.error ?? 'The addresses could not be checked.',
          { variant: 'warning', allowDuplicate: true },
        )
      }
      setPreview(payload as Preview)
    } catch {
      enqueueSnackbar('The addresses could not be checked.', {
        variant: 'warning',
        allowDuplicate: true,
      })
    } finally {
      setBusy(false)
    }
  }, [busy, addresses, post, enqueueSnackbar])

  const handleFind = useCallback(async () => {
    if (busy || !findRule) return
    setBusy(true)
    try {
      const { ok, payload } = await post('list-rule-preview', {
        rule: findRule,
      })
      if (!ok) {
        return void enqueueSnackbar(
          payload?.error ?? 'The audience could not be worked out.',
          { variant: 'warning', allowDuplicate: true },
        )
      }
      /*
       * The verdicts come back from the SAME resolution the typed path runs,
       * so what lands in `preview` here is the same object the consent
       * readout below already knows how to draw. A search that returned its
       * own shaped summary would be a second consent readout, and the second
       * one is the one nobody reviews.
       */
      setFound(payload as FoundPeople)
      setPreview(payload as Preview)
      setAttested(false)
      setResults(null)
      if (!Number(payload?.matched ?? 0)) {
        enqueueSnackbar('These filters match nobody', {
          variant: 'info',
          persist: false,
        })
      }
    } catch {
      enqueueSnackbar('The audience could not be worked out.', {
        variant: 'warning',
        allowDuplicate: true,
      })
    } finally {
      setBusy(false)
    }
  }, [busy, findRule, post, enqueueSnackbar])

  const handleAdd = useCallback(async () => {
    if (busy || !preview) return
    setBusy(true)
    try {
      const { ok, payload } = await post('list-members-add', {
        emails: addresses,
        ...(addresses.length === 1 && addName.trim()
          ? { name: addName.trim() }
          : {}),
        // The operator's assertion, not a basis they named: the server
        // derives a pass-through from each person's own record, and this flag
        // can only ever add the attributable kind.
        attestConsent: attested,
      })
      if (!ok) {
        return void enqueueSnackbar(
          payload?.error ?? 'Nobody was added to the list',
          { variant: 'warning', allowDuplicate: true },
        )
      }
      const added = Number(payload?.added ?? 0)
      setResults((payload?.results ?? []) as AddResult[])
      setPreview(null)
      if (added) {
        setAddInput('')
        setAddName('')
        setFound(null)
        onMembershipChanged?.()
      }
      enqueueSnackbar(
        added === 1 ? 'One person added' : `${added} people added`,
        { variant: added ? 'success' : 'warning', persist: false },
      )
    } catch {
      enqueueSnackbar('Nobody was added to the list', {
        variant: 'warning',
        allowDuplicate: true,
      })
    } finally {
      setBusy(false)
    }
  }, [
    busy,
    preview,
    addresses,
    addName,
    attested,
    post,
    enqueueSnackbar,
    onMembershipChanged,
  ])

  const handleRemove = useCallback(
    async (member: MemberRow) => {
      const accepted = await confirm({
        title: 'Remove from this list?',
        description:
          `${member.email ?? 'This person'} stops being part of "${listName}" ` +
          'and campaigns to this list stop reaching them. This is NOT an ' +
          'unsubscribe: it does not add them to your suppression list, and ' +
          'any other list they are on still reaches them. If they asked to ' +
          'stop hearing from you, suppress the address instead.',
        confirmationText: 'Remove',
        confirmationButtonProps: { color: 'error' },
      })
        // `confirm` resolves with no value and REJECTS on cancel, so gating on
        // the resolved value alone would make this always proceed (AGL-950).
        .then(() => true)
        .catch(() => false)
      if (!accepted) return
      try {
        await deleteDoc(
          doc(
            firestore,
            scope[0],
            scope[1],
            'lists',
            listId,
            'members',
            member.$id,
          ),
        )
        onMembershipChanged?.()
        enqueueSnackbar('Removed from the list', {
          variant: 'success',
          persist: false,
        })
      } catch (error) {
        console.error(error)
        enqueueSnackbar('They were not removed', { variant: 'error' })
      }
    },
    [
      confirm,
      listName,
      firestore,
      scope,
      listId,
      enqueueSnackbar,
      onMembershipChanged,
    ],
  )

  const enrollable = preview
    ? preview.optedIn + preview.needAttestation
    : 0

  return (
    <Stack spacing={2} sx={{ py: 2 }}>
      {/*
        FINDING people, for a list whose membership is fixed.
        The filters are the same ones a live list is swept by; here they run
        once, on request, and what they find is offered for adding rather than
        enrolled. The count and the consent readout arrive together, because
        the second is the thing that decides how much of the first can act.
       */}
      {findRule ? (
        <Stack
          spacing={1}
          sx={{ border: 1, borderColor: 'divider', borderRadius: 1, p: 1.5 }}
        >
          <Typography variant="overline" color="text.secondary">
            {'Find people'}
          </Typography>
          {(ruleSummary ?? []).map((clause) => (
            <Typography key={clause} variant="body2">
              {clause}
            </Typography>
          ))}
          <Box>
            <Button
              size="small"
              variant="outlined"
              disabled={busy}
              onClick={() => void handleFind()}
            >
              {busy ? 'Searching…' : 'Find matching people'}
            </Button>
          </Box>
          {found ? (
            <Alert severity={found.matched ? 'info' : 'warning'}>
              {(found.matched === 1
                ? '1 person matches'
                : `${found.matched.toLocaleString()} people match`) +
                (found.truncated
                  ? ` — this batch covers the first ${found.emails.length}. ` +
                    'Add them, then search again for the rest.'
                  : '') +
                (found.complete
                  ? ''
                  : ' The search stopped at its read budget, so this is at ' +
                    'least that many rather than exactly.')}
            </Alert>
          ) : null}
          <Typography variant="caption" color="text.secondary">
            {'Whoever you add stays on this list. It does not keep growing — ' +
              'change the membership to live on the edit page if you want ' +
              'new matches enrolled automatically.'}
          </Typography>
        </Stack>
      ) : null}

      <Typography variant="body2" color="text.secondary">
        {'Add someone by typing their address, or paste a column of them. ' +
          'Every address is checked against their consent record and both ' +
          'suppression lists before anyone is added.'}
      </Typography>

      <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
        <TextField
          size="small"
          label="Email addresses"
          placeholder="someone@example.com"
          multiline
          minRows={1}
          maxRows={6}
          value={addInput}
          onChange={(event) => setAddInput(event.target.value)}
          helperText={
            addresses.length > 1
              ? `${addresses.length} addresses`
              : 'One address, or paste many'
          }
          sx={{ flexGrow: 1, minWidth: 260 }}
        />
        {addresses.length > 1 ? null : (
          <TextField
            size="small"
            label="Name"
            value={addName}
            onChange={(event) => setAddName(event.target.value)}
            sx={{ minWidth: 180 }}
          />
        )}
        <Box>
          <Button
            size="small"
            variant="outlined"
            disabled={busy || !addresses.length || Boolean(preview)}
            onClick={() => void handlePreview()}
          >
            {busy ? 'Checking…' : 'Check'}
          </Button>
        </Box>
      </Stack>

      {/*
        The count, in front of the operator, BEFORE the attestation control
        exists. One assertion covers the batch, so the number it covers has to
        be on screen when it is given — an attestation offered above an
        unexamined paste is a signature on a blank page.
       */}
      {preview ? (
        <Stack spacing={1}>
          <Alert severity={enrollable ? 'info' : 'warning'}>
            {[
              preview.optedIn
                ? `${preview.optedIn} already opted in`
                : '',
              preview.needAttestation
                ? `${preview.needAttestation} with no opt-in on record`
                : '',
              preview.refused
                ? `${preview.refused} cannot be added at all`
                : '',
            ]
              .filter(Boolean)
              .join(' · ')}
          </Alert>
          {/*
            The HARD refusals only. An address that merely needs the
            attestation is not a refusal — listing it here would put the very
            people the checkbox below is about under a heading that says they
            cannot be added.
           */}
          {preview.verdicts
            .filter((verdict) => verdict.refusal)
            .map((verdict) => (
              <Typography
                key={verdict.input}
                variant="caption"
                color="text.secondary"
              >
                {`${verdict.input} — ${verdict.summary}`}
              </Typography>
            ))}
          {preview.needAttestation ? (
            <FormControlLabel
              control={
                <Checkbox
                  checked={attested}
                  onChange={(event) => setAttested(event.target.checked)}
                />
              }
              label={
                <Typography variant="body2">
                  {`I have permission to send marketing email to the ` +
                    `${preview.needAttestation} ` +
                    `${preview.needAttestation === 1 ? 'person' : 'people'} ` +
                    'above with no opt-in on record. This is recorded against ' +
                    'my account, with the date.'}
                </Typography>
              }
            />
          ) : null}
          <Box>
            <Button
              size="small"
              variant="contained"
              disabled={
                busy ||
                !enrollable ||
                (preview.needAttestation > 0 && !attested)
              }
              onClick={() => void handleAdd()}
            >
              {busy ? 'Adding…' : `Add ${enrollable}`}
            </Button>
          </Box>
        </Stack>
      ) : null}

      {/*
        What actually happened, per address. A batch where one address was
        suppressed and forty were fine is not a failure, and a bare count would
        leave the operator to work out which of their lines is missing.
       */}
      {results?.length ? (
        <Stack spacing={0.5}>
          {results
            .filter((result) => !result.enrolled)
            .map((result) => (
              <Typography
                key={result.input}
                variant="caption"
                color="text.secondary"
              >
                {`${result.input} — not added. ${result.error ?? ''}`}
              </Typography>
            ))}
        </Stack>
      ) : null}

      {members.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          {'Nobody is on this list yet.'}
        </Typography>
      ) : (
        <>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>{'Address'}</TableCell>
                <TableCell>{'Name'}</TableCell>
                <TableCell>{'Joined'}</TableCell>
                <TableCell>{'How'}</TableCell>
                <TableCell>{'Consent'}</TableCell>
                <TableCell align="right" />
              </TableRow>
            </TableHead>
            <TableBody>
              {members.map((member) => {
                const consent = consentLabel(member)
                return (
                  <TableRow key={member.$id}>
                    <TableCell>{member.email ?? '—'}</TableCell>
                    <TableCell>{member.name ?? '—'}</TableCell>
                    <TableCell>
                      {member.addedAt?.toDate
                        ? member.addedAt.toDate().toLocaleDateString()
                        : '—'}
                    </TableCell>
                    <TableCell>
                      {/*
                        `via` says whether a rule put them here or a person
                        did, which is what decides whether they LEAVE on their
                        own: the materializer reconciles its own rows away and
                        never touches a manual one. `source` is the finer
                        provenance underneath it.
                       */}
                      <Chip
                        size="small"
                        variant="outlined"
                        label={member.via === 'rule' ? 'Rule' : 'Added'}
                      />
                      {member.source ? (
                        <Typography
                          variant="caption"
                          color="text.secondary"
                          sx={{ ml: 1 }}
                        >
                          {member.source}
                        </Typography>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      <Chip
                        size="small"
                        variant="outlined"
                        color={consent.asserted ? 'warning' : 'default'}
                        label={consent.label}
                      />
                    </TableCell>
                    {/*
                      A SUBSCRIBER HAS NO PAGE of their own here, so the row
                      opens nothing — but taking somebody off an audience is
                      the one act performed on one, and it belongs in the
                      trailing cluster with every other table's actions rather
                      than as a red text button sitting in the row.
                     */}
                    <TableCell align="right" sx={{ width: 56 }}>
                      <RowActionsMenu
                        label={String(member.email ?? member.$id)}
                        items={[
                          {
                            key: 'remove',
                            label: 'Remove from this list',
                            icon: (
                              <MdiIcon
                                path={mdiAccountRemoveOutline.path}
                                size={0.8}
                              />
                            ),
                            destructive: true,
                            onClick: () => void handleRemove(member),
                          },
                        ]}
                      />
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
          <ListPagination
            page={page}
            pageSize={pageSize}
            rowCount={members.length}
            hasMore={hasMore}
            onPageChange={setPage}
            onPageSizeChange={setPageSize}
          />
        </>
      )}

      <Typography variant="caption" color="text.secondary">
        {'Removing someone from a list is not an unsubscribe. It does not add ' +
          'them to your suppression list, and it does not stop any other list ' +
          'reaching them. If somebody asked you to stop, suppress the address.'}
      </Typography>
    </Stack>
  )
}
ListMembersPanel.displayName = 'ListMembersPanel'

export default ListMembersPanel
