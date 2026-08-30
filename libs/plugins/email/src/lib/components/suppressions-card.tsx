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

import { pluginDocsHelp } from '@aglyn/aglyn'
import { ICON_VARIANT_CLOSE } from '@aglyn/shared-data-enums'
import {
  CardDisplay,
  Container,
  MdiIcon,
  SrOnly,
  useConfirmationContext,
} from '@aglyn/shared-ui-jsx'
import { ListPagination } from '@aglyn/shared-ui-jsx/components/list-pagination.component'
/*
 * The shared drawer, reached by its own path.
 *
 * `@aglyn/shared-ui-jsx`'s barrel deliberately does not re-export this one, so
 * a deep import is the supported way in rather than an escape hatch. The
 * console's `CreateArtifactDrawer` — what Screens, Components, Layouts and
 * Templates create through — is this same component with a form inside it,
 * and it lives in `apps/console`, which a plugin library may not import. So
 * the chrome is composed from the same primitive rather than duplicated from
 * the wrapper.
 */
import { NavigationDrawerComponent } from '@aglyn/shared-ui-jsx/components/navigation-drawer.component'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import {
  Alert,
  Chip,
  IconButton,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material'
import Button from '@mui/material/Button'
import {
  collection,
  count,
  deleteDoc,
  doc,
  getAggregateFromServer,
  limit,
  orderBy,
  query,
  where,
} from 'firebase/firestore'
import { useCallback, useEffect, useState } from 'react'
import {
  useFirestore,
  usePagedCollection,
  useUser,
} from '@aglyn/tenant-feature-instance'

export interface SuppressionsCardProps {
  hostId: string
}

/** A stored entry. `reason` is absent on anything written before AGL-2408. */
interface SuppressionRow {
  $id: string
  email?: string
  reason?: string
  suppressedAt?: { seconds?: number } | null
  createdAt?: { seconds?: number } | null
}

/**
 * What a reason means to a merchant, and how much it should worry them.
 *
 * An ABSENT reason reads as "Unsubscribed", and that is a compatibility rule
 * rather than a guess: until AGL-2408 the unsubscribe handler wrote
 * `{ email, createdAt }` and nothing else, while the Resend webhook has
 * stamped `'bounce'`/`'complaint'` since AGL-1918 — so an entry with no reason
 * can only have come from somebody clicking the link. New unsubscribes write
 * the reason explicitly, so this fallback covers history and nothing else.
 */
const REASONS: Record<string, { label: string; color: 'default' | 'warning' | 'error' }> = {
  unsubscribe: { label: 'Unsubscribed', color: 'default' },
  bounce: { label: 'Bounced', color: 'warning' },
  complaint: { label: 'Marked as spam', color: 'error' },
  /*
   * Recorded by a person, through the Add control.
   *
   * Its OWN value rather than a reuse of `unsubscribe`: an opt-out arriving
   * by reply, phone or in person is not somebody clicking a link, and the
   * difference is exactly what a merchant asked to prove the request was
   * honored has to be able to show.
   */
  manual: { label: 'Added by hand', color: 'default' },
}

const describeReason = (reason: unknown) =>
  REASONS[String(reason ?? 'unsubscribe')] ?? {
    label: String(reason),
    color: 'default' as const,
  }

/**
 * `YYYY-MM-DD` from a Firestore timestamp shape, or an em dash.
 *
 * `createdAt` first, and that ordering is the column's meaning rather than a
 * preference. Both writers restamp `suppressedAt` on every touch and write
 * `createdAt` only when the document is new, precisely so that a bounce
 * arriving after an unsubscribe does not move the date the person actually
 * unsubscribed. Reading `suppressedAt` first put the restamp on screen under a
 * heading that says "Since", and it is also the field the list is ordered by,
 * so a re-touched row would have sorted by one date and displayed another.
 */
function onDate(row: SuppressionRow): string {
  const seconds = row.createdAt?.seconds ?? row.suppressedAt?.seconds
  if (!seconds) return '—'
  return new Date(seconds * 1000).toISOString().slice(0, 10)
}

/**
 * Suppressions (AGL-2410): who is not being emailed, and why.
 *
 * ## What was missing
 *
 * `hosts/{hostId}/suppressions` was written by two paths — the unsubscribe
 * handler and, since AGL-1918, the Resend webhook on a permanent bounce or a
 * complaint — and read by exactly one: `campaign-send.ts`, to filter an
 * audience. Nothing in the console displayed it. So a merchant could not
 * answer any of:
 *
 *  - *"My campaign says 500 recipients and 480 sent — who were the other
 *    20?"* The send returns `{recipients, sent}` and the difference was
 *    unexplained.
 *  - *"Is my list going stale?"* A bounce rate is the single most useful
 *    number about a list and there was nowhere to see it.
 *  - *"This address was suppressed by mistake."* There was no way to remove
 *    an entry — and a link prescanner unsubscribing someone (AGL-2408 §2) was
 *    therefore unrecoverable from inside the product.
 *
 * ## Why a surface and not another counter
 *
 * AGL-1918 deliberately did NOT write a `stats.bounces` counter alongside its
 * fix, because a number with no screen to show it is the written-but-never-
 * read shape this issue is about, one level up. So the fix is the READER, and
 * the breakdown here is derived from the rows on screen rather than from a
 * second stored figure that could disagree with them.
 *
 * ## Removing an entry
 *
 * A plain client `deleteDoc`, and that is a decision. The list belongs to the
 * merchant, host admins already read it through the same rules, and removing
 * a row does nothing except make an address targetable again — there is no
 * counter to launder and no money attached, which is the AGL-1367 test for
 * whether a write has to move server-side.
 *
 * The confirmation is not decoration either: for a `bounce` the address very
 * likely does not exist, and mailing it again is what a provider scores the
 * sending domain on. So the dialog says which reason is being overridden
 * rather than asking a generic "are you sure".
 */
export function SuppressionsCard(props: SuppressionsCardProps) {
  const { hostId } = props
  const firestore = useFirestore()
  const { data: user } = useUser()
  const { enqueueSnackbar } = useSnackbar()
  const { confirm } = useConfirmationContext()
  const [adding, setAdding] = useState(false)

  const [addInput, setAddInput] = useState('')
  const [addNote, setAddNote] = useState('')
  const [busy, setBusy] = useState(false)

  /*
   * The window IS the query, ordered by the server (AGL-2501, AGL-2292).
   *
   * This was `limit(500)` with no `orderBy`, sorted by date in the browser.
   * Firestore answers an unordered limit in DOCUMENT-ID order, and an entry
   * here is keyed by `sha256(email)` — so the window was five hundred
   * addresses chosen by the hash of the address, and the client sort dressed
   * that sample up as the newest five hundred. A list past the ceiling
   * therefore hid whoever bounced this morning behind whoever happened to
   * hash low, with no gap on screen to notice and no control asking for more.
   *
   * `createdAt` is the safe field to order on, and that is checked rather
   * than assumed: both writers — the unsubscribe handler and the Resend
   * bounce/complaint webhook — stamp it when the document is created, the
   * pre-AGL-2408 handler wrote `{ email, createdAt }`, and `suppressions` is
   * not in `IMPORTABLE_FIELDS`, so no restore path can produce a row without
   * one. `suppressedAt` would NOT be safe: it is absent on every entry
   * written before AGL-1918, and `orderBy` drops documents that lack the
   * field rather than mis-sorting them.
   */
  const {
    rows: entries,
    hasMore,
    page,
    setPage,
    pageSize,
    setPageSize,
  } = usePagedCollection<SuppressionRow>(
    (pageLimit) =>
      query(
        collection(firestore, 'hosts', hostId, 'suppressions'),
        orderBy('createdAt', 'desc'),
        limit(pageLimit),
      ),
    [firestore, hostId],
    { idField: '$id' },
  )

  /*==========================================
   * THE BREAKDOWN IS A SERVER AGGREGATE, not a tally of the page.
   *
   * These chips answer "is my list going stale?", and they were a `reduce`
   * over whatever the listener had fetched — so on a site past the old
   * ceiling "Bounced: 140" meant 140 of an arbitrary five hundred, and under
   * a ten-row page it would have meant 140 of ten. A bounce rate computed
   * from a sample is not a bounce rate, and nothing on screen said it was one.
   *
   * Three reads, not one per reason. `where('reason','==','unsubscribe')`
   * cannot be asked, because an entry written before AGL-2408 carries no
   * `reason` at all and an equality filter excludes it — the same
   * field-presence trap as the ordering above. Unsubscribes are therefore the
   * REMAINDER: total minus the two reasons that are always written
   * explicitly, which is exactly the compatibility rule `describeReason`
   * applies row by row.
   *=========================================*/
  const [totalsEpoch, setTotalsEpoch] = useState(0)
  const [totals, setTotals] = useState<Record<string, number> | null>(null)
  useEffect(() => {
    let active = true
    const suppressionsRef = collection(firestore, 'hosts', hostId, 'suppressions')
    void Promise.all([
      getAggregateFromServer(suppressionsRef, { total: count() }),
      getAggregateFromServer(
        query(suppressionsRef, where('reason', '==', 'bounce')),
        { total: count() },
      ),
      getAggregateFromServer(
        query(suppressionsRef, where('reason', '==', 'complaint')),
        { total: count() },
      ),
      // A FOURTH read, and it is not optional. Unsubscribes are the
      // REMAINDER, so every reason that is counted explicitly has to be
      // subtracted — a hand-added entry left out of this list would be
      // reported as somebody who clicked unsubscribe.
      getAggregateFromServer(
        query(suppressionsRef, where('reason', '==', 'manual')),
        { total: count() },
      ),
    ])
      .then(([all, bounced, complained, added]) => {
        if (!active) return
        const total = Number(all.data().total ?? 0)
        const bounce = Number(bounced.data().total ?? 0)
        const complaint = Number(complained.data().total ?? 0)
        const manual = Number(added.data().total ?? 0)
        setTotals({
          unsubscribe: Math.max(0, total - bounce - complaint - manual),
          bounce,
          complaint,
          manual,
        })
      })
      .catch(() => {
        // Held at null rather than zeroed. "Bounced: 0" is a confident wrong
        // number in the reassuring direction, and this card exists to warn.
        if (active) setTotals(null)
      })
    return () => {
      active = false
    }
    // The list is a live listener and refreshes itself; an aggregate is a
    // one-shot read and would otherwise keep reporting the breakdown from
    // before the address was put back.
  }, [firestore, hostId, totalsEpoch])

  /*
   * The ADD, through a route rather than a client write.
   *
   * The Remove button below writes straight from the browser, and this does
   * not, which looks inconsistent until the document id is considered: an
   * entry is keyed by `sha256` of the normalized address, and a browser
   * computing that itself would be a second derivation of the key every
   * reader shares. Getting it wrong is silent and one-directional — the
   * merchant is told the person is suppressed and the mail keeps going. A
   * removal has no such hazard: it names a row that is already on screen.
   */
  const handleAdd = useCallback(async () => {
    const typed = addInput.trim()
    if (!typed || busy) return
    setBusy(true)
    try {
      const idToken = await (user as { getIdToken?: () => Promise<string> })
        ?.getIdToken?.()
      const response = await fetch('/api/email/suppression-add', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
        },
        body: JSON.stringify({ hostId, emails: typed, note: addNote.trim() }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        return void enqueueSnackbar(
          payload?.error ?? 'The address could not be suppressed.',
          { variant: 'error' },
        )
      }
      const results = (payload?.results ?? []) as Array<{
        input: string
        added: boolean
        refusal?: string
      }>
      const added = Number(payload?.added ?? 0)
      const rejected = results.filter(
        (result) => result.refusal === 'not-an-address',
      )
      // The refusals are NAMED, because "3 of 5 added" leaves an operator to
      // work out which two, and the two that failed are the ones somebody
      // asked to stop being emailed.
      if (rejected.length) {
        enqueueSnackbar(
          `Not an email address: ${rejected
            .map((result) => result.input)
            .join(', ')}`,
          { variant: 'warning' },
        )
      }
      if (added) {
        enqueueSnackbar(
          added === 1
            ? 'Added to the suppression list'
            : `${added} addresses added to the suppression list`,
          { variant: 'success', persist: false },
        )
      } else if (!rejected.length) {
        enqueueSnackbar('Already on the suppression list', { variant: 'info' })
      }
      if (added) {
        setAddInput('')
        setAddNote('')
        setAdding(false)
        setTotalsEpoch((epoch) => epoch + 1)
      }
    } catch (error) {
      console.error(error)
      enqueueSnackbar('An error has occurred', { variant: 'error' })
    } finally {
      setBusy(false)
    }
  }, [addInput, addNote, busy, user, hostId, enqueueSnackbar])

  /**
   * Whether one address is ALSO on the platform-wide list.
   *
   * The two lists are consulted together at send time and were visible
   * separately, so a merchant who removed their own entry could still find
   * the address was never mailed, with nothing anywhere saying why. The
   * platform entry is invisible to them and cannot be lifted by them, which
   * is precisely why it has to be said before the click rather than
   * discovered from a recipient count that stays short.
   */
  const isBlockedPlatformWide = useCallback(
    async (email: string): Promise<boolean> => {
      try {
        const idToken = await (user as { getIdToken?: () => Promise<string> })
          ?.getIdToken?.()
        const response = await fetch('/api/email/suppression-status', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
          },
          body: JSON.stringify({ hostId, emails: email }),
        })
        if (!response.ok) return false
        const payload = await response.json().catch(() => ({}))
        return ((payload?.platform ?? []) as string[]).length > 0
      } catch (error) {
        console.error(error)
        return false
      }
    },
    [user, hostId],
  )

  const handleRemove = async (row: SuppressionRow) => {
    const reason = describeReason(row.reason).label.toLowerCase()
    // The platform entry is invisible to a merchant and cannot be lifted by
    // one, so removing the site's row here changes nothing about whether the
    // address is mailed. Saying so BEFORE the click is the whole point: the
    // alternative is a merchant who removes the row, sends again, and sees a
    // recipient count that is still short with nothing explaining it.
    /*
     * ASKED, NOT MOUNTED.
     *
     * One keyed read for the one address the merchant is acting on, at the
     * moment they act. Fetching this for every visible row on mount would be
     * a request per page render for an answer that is only ever needed on a
     * click, and this card is one tab of a page a merchant opens to read.
     *
     * A failed check answers "not blocked", which is the ordinary case: the
     * dialog then reads exactly as it did before, and the removal still
     * works. Refusing to open the dialog because a supplementary lookup
     * failed would make an outage on an explanation into an outage on the
     * control it explains.
     */
    const alsoPlatform = row.email
      ? await isBlockedPlatformWide(row.email)
      : false
    const accepted = await confirm({
      title: alsoPlatform
        ? 'This address will still be skipped'
        : 'Put this address back on your list?',
      description: alsoPlatform
        ? `${row.email ?? 'This address'} bounced permanently or reported ` +
          'spam somewhere else in Aglyn, so it is on the platform-wide list ' +
          'as well as yours. Removing your entry will not start mail ' +
          'reaching it — contact support to have the platform entry lifted.'
        : `${row.email ?? 'This address'} is suppressed because it ` +
          `${reason === 'bounced' ? 'bounced permanently' : reason === 'marked as spam' ? 'was marked as spam' : reason === 'added by hand' ? 'was added by hand' : 'unsubscribed'}. ` +
          'Removing the entry means your next campaign will email it again.',
      confirmationText: 'Remove',
      confirmationButtonProps: { color: 'error' },
    })
      // `confirm` resolves with NO VALUE and REJECTS on cancel, so gating on
      // the resolved value alone makes this always return (AGL-950).
      .then(() => true)
      .catch(() => false)
    if (!accepted) return
    try {
      await deleteDoc(
        doc(firestore, 'hosts', hostId, 'suppressions', row.$id),
      )
      enqueueSnackbar('Removed from the suppression list', {
        variant: 'success',
        persist: false,
      })
      setTotalsEpoch((epoch) => epoch + 1)
    } catch (error) {
      console.error(error)
      enqueueSnackbar('An error has occurred', { variant: 'error' })
    }
  }

  return (
    <CardDisplay
      header="Suppressions"
      help={pluginDocsHelp('emailCampaigns', { anchor: '#compliance' })}
      contentGutterX
      contentGutterY
      contentBordered="all"
      HeaderProps={{
        action: (
          <Button
            size="small"
            variant="outlined"
            onClick={() => setAdding(true)}
          >
            {'Add'}
          </Button>
        ),
      }}
    >
      <Stack spacing={1.5}>
        <Typography variant="body2" color="text.secondary">
          {'Addresses this site’s marketing email skips. Someone lands here ' +
            'by clicking unsubscribe, by bouncing permanently, by marking a ' +
            'message as spam, or because you added them — this is where the ' +
            'gap between a campaign’s recipient count and what it actually ' +
            'sent comes from.'}
        </Typography>
        {entries.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            {'Nobody is suppressed. Every address in your audiences is ' +
              'currently mailable.'}
          </Typography>
        ) : (
          <>
            <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap' }}>
              {totals === null ? (
                <Typography variant="caption" color="text.secondary">
                  {'Could not read the breakdown. This is not the same as ' +
                    'nobody having bounced.'}
                </Typography>
              ) : (
                Object.entries(totals)
                  // A reason nobody has hit is not news, and three chips
                  // reading zero make the two that matter harder to find.
                  .filter(([, total]) => total > 0)
                  .map(([reason, total]) => {
                    const described = describeReason(reason)
                    return (
                      <Chip
                        key={reason}
                        size="small"
                        color={described.color}
                        variant="outlined"
                        label={`${described.label}: ${total}`}
                      />
                    )
                  })
              )}
            </Stack>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>{'Address'}</TableCell>
                  <TableCell>{'Reason'}</TableCell>
                  <TableCell>{'Since'}</TableCell>
                  <TableCell align="right" />
                </TableRow>
              </TableHead>
              <TableBody>
                {entries.map((row) => {
                  const described = describeReason(row.reason)
                  return (
                    <TableRow key={row.$id}>
                      <TableCell>
                        {/*
                          Entries are keyed by `sha256(email)` because
                          addresses are PII, and the address itself is stored
                          in the document. An older row written before the
                          address was stored has only its hash — which tells a
                          merchant nothing, so it says so rather than
                          displaying 64 hex characters.
                        */}
                        {row.email || (
                          <Typography variant="body2" color="text.secondary">
                            {'(address not recorded)'}
                          </Typography>
                        )}
                      </TableCell>
                      <TableCell>
                        <Chip
                          size="small"
                          color={described.color}
                          variant="outlined"
                          label={described.label}
                        />
                      </TableCell>
                      <TableCell>{onDate(row)}</TableCell>
                      <TableCell align="right">
                        <Button
                          size="small"
                          color="error"
                          onClick={() => void handleRemove(row)}
                        >
                          {'Remove'}
                        </Button>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
            <ListPagination
              page={page}
              pageSize={pageSize}
              rowCount={entries.length}
              hasMore={hasMore}
              // The collection's real size, so the footer's count line says
              // "1–10 of 812" rather than "of more than 10" — the aggregate
              // above already knows it, and it is the same number the chips
              // are a breakdown of.
              count={totals ? Object.values(totals).reduce((a, b) => a + b, 0) : undefined}
              onPageChange={setPage}
              onPageSizeChange={setPageSize}
            />
          </>
        )}
      </Stack>
      {/*
        A DRAWER, not a form stacked above the table.
        Creating is a drawer and picking is a dialog, which is how Screens,
        Components, Layouts and Templates all take a name before they create
        one; the chrome here is the same `NavigationDrawerComponent` those go
        through, composed directly because the console's wrapper around it
        lives in an application a plugin library may not import.
      */}
      <NavigationDrawerComponent
        open={adding}
        anchor="right"
        variant="temporary"
        onClose={() => setAdding(false)}
        AppBarProps={{ color: 'surface' }}
        appBarLeft={
          <>
            <IconButton
              color="inherit"
              edge="start"
              onClick={() => setAdding(false)}
              sx={{ mr: 2 }}
            >
              <MdiIcon path={ICON_VARIANT_CLOSE.path} />
              <SrOnly>{'close drawer'}</SrOnly>
            </IconButton>
            <Typography variant="h6" component="div">
              {'Stop emailing an address'}
            </Typography>
          </>
        }
        appBarRight={
          <Button
            variant="outlined"
            color="inherit"
            onClick={() => setAdding(false)}
          >
            {'Cancel'}
          </Button>
        }
      >
        <Container gutterY>
          <Stack spacing={2}>
            <Typography variant="body2" color="text.secondary">
              {'Use this when somebody asks you to stop emailing them by ' +
                'reply, by phone, or in person. They stay on your audiences ' +
                'and keep every record you hold about them — this only stops ' +
                'this site’s marketing email reaching them.'}
            </Typography>
            <TextField
              label="Email addresses"
              value={addInput}
              onChange={(event) => setAddInput(event.target.value)}
              multiline
              minRows={3}
              fullWidth
              autoFocus
              helperText={
                'One per line, or separated by commas. Up to 50 at a time.'
              }
            />
            <TextField
              label="Note (optional)"
              value={addNote}
              onChange={(event) => setAddNote(event.target.value)}
              fullWidth
              helperText={
                'How the request reached you. Kept with the entry as the ' +
                'record that it was honored.'
              }
              slotProps={{ htmlInput: { maxLength: 200 } }}
            />
            <Alert severity="info">
              {'Order confirmations, booking reminders and password resets ' +
                'are unaffected. Somebody who asked to stop hearing from ' +
                'your marketing still gets their receipt.'}
            </Alert>
            <Stack direction="row" spacing={1} sx={{ justifyContent: 'flex-end' }}>
              <Button
                variant="contained"
                disabled={busy || !addInput.trim()}
                onClick={() => void handleAdd()}
              >
                {'Add to suppression list'}
              </Button>
            </Stack>
          </Stack>
        </Container>
      </NavigationDrawerComponent>
    </CardDisplay>
  )
}
SuppressionsCard.displayName = 'SuppressionsCard'

export default SuppressionsCard
