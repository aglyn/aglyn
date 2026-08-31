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

import { ICON_VARIANT_CLOSE } from '@aglyn/shared-data-enums'
import { Container, MdiIcon, SrOnly } from '@aglyn/shared-ui-jsx'
import { NavigationDrawerComponent } from '@aglyn/shared-ui-jsx/components/navigation-drawer.component'
import {
  normalizeLocalPart,
  validateSendingLocalPart,
} from '@aglyn/shared-util-email'
import {
  useFirestore,
  useFirestoreCollection,
} from '@aglyn/tenant-feature-instance'
import {
  Alert,
  Button,
  Divider,
  IconButton,
  InputAdornment,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { collection, limit, orderBy, query } from 'firebase/firestore'
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  useSendingApi,
  type SendingIdentityView,
} from './use-sending-identity-api'

/**
 * How many of a site's people the picker offers.
 *
 * A ceiling rather than a page, because this control is a shortcut and not a
 * roster: somebody choosing a sender knows who they are looking for, and a
 * site large enough to overflow this has an admin who can type the three
 * fields directly. Bounded because the read happens on a merchant's settings
 * screen, and an unbounded one would grow with the site for no benefit.
 */
const SENDER_PICKER_CEILING = 50

export interface SendingSenderDrawerProps {
  open: boolean
  hostId: string
  /** The identity as the route reports it. Null while the card is loading. */
  view: SendingIdentityView | null
  onClose: () => void
  /** Called after a successful save, so the card can re-read the identity. */
  onSaved: () => void
}

/** One row of the picker, reduced to what a sender needs from a person. */
interface SenderCandidate {
  id: string
  email: string
  displayName: string
}

/**
 * WHO THIS SITE'S EMAIL COMES FROM.
 *
 * Three fields, and they are not three of a kind. The MAILBOX is the part of
 * the address in front of the `@`; the domain behind it is whatever this
 * site's verified identity resolves to and is not editable here, because
 * DMARC on the sending apex is published `adkim=s` and the `From:` domain has
 * to be exactly the domain whose DKIM key signed the message. The NAME is
 * what a recipient reads in their inbox list. The REPLY ADDRESS is the only
 * one of the three that may name a mailbox on a domain nobody here has
 * verified — which is what makes "replies reach me personally" possible
 * without pretending the mail came from a personal account.
 *
 * ## Why this is a site setting and not a per-send field
 *
 * The composer already carries a from name and a reply-to per campaign, and
 * keeps them: those are per-message facts. The mailbox is not, because it is
 * an address that has to work — a bounce returns to it, and a mail client
 * that ignores `Reply-To:` answers to it. A mailbox that exists in one
 * campaign's headers and nowhere else is an address nobody serves.
 *
 * The gates differ for the same reason. Choosing what every recipient of this
 * site's mail sees is an organization-admin decision and lives here beside
 * the domain it depends on; the composer is admin-or-editor and may choose
 * only the name in front of the address.
 *
 * ## The picker
 *
 * "Send as a person" is mostly one action — take a teammate's name and their
 * mailbox and make the mail read as theirs — so the picker does all three
 * fields at once and then lets any of them be edited. The address it proposes
 * is derived from the part of their email in front of the `@`, which is the
 * name they already answer to, and their real address becomes the reply
 * target rather than the sender: a `From:` on their own mail provider's
 * domain could never align, and would be rejected rather than delivered.
 *
 * The roster is read only while this drawer is open. It is a collection read
 * on a settings surface, and one that happens because somebody asked for it
 * is a different thing from one that happens because a card mounted.
 */
export function SendingSenderDrawer(props: SendingSenderDrawerProps) {
  const { open, hostId, view, onClose, onSaved } = props
  const call = useSendingApi()
  const firestore = useFirestore()

  const [mailbox, setMailbox] = useState('')
  const [fromName, setFromName] = useState('')
  const [replyTo, setReplyTo] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  /*
   * The stored values are copied in when the drawer OPENS, not on every
   * render of the card.
   *
   * A settings form seeded from a prop that keeps arriving would discard what
   * somebody was halfway through typing the moment the card re-read the
   * identity behind them.
   */
  useEffect(() => {
    if (!open) return
    setMailbox(view?.localPart ?? '')
    setFromName(view?.fromName ?? '')
    setReplyTo(view?.replyTo ?? '')
    setError('')
  }, [open, view?.localPart, view?.fromName, view?.replyTo])

  const { data: memberDocs } = useFirestoreCollection<any>(
    () =>
      open && hostId
        ? query(
            collection(firestore, 'hosts', hostId, 'members'),
            /*
             * `email` is safe to order on here: this subcollection has exactly
             * one writer — `POST /api/hosts/members` — and it writes the field
             * on every document. An `orderBy` on a field some writer omits
             * hides rows rather than arranging them.
             */
            orderBy('email'),
            limit(SENDER_PICKER_CEILING),
          )
        : null,
    [firestore, hostId, open],
    { idField: '$id' },
  )

  const candidates = useMemo<SenderCandidate[]>(
    () =>
      (memberDocs ?? [])
        .map((entry: any) => ({
          id: String(entry?.$id ?? ''),
          email: String(entry?.email ?? '').trim(),
          displayName: String(entry?.displayName ?? '').trim(),
        }))
        .filter((entry: SenderCandidate) => entry.id && entry.email),
    [memberDocs],
  )

  /*
   * The domain half, shown as a fixed suffix rather than as a field.
   *
   * A person setting a sender is choosing an address, and an address with its
   * domain missing from the screen is one they have to assemble in their head
   * from the alert above. Read from the identity the server resolved, so it
   * is the domain a send would actually use.
   */
  const domain = String(view?.selected ?? '')
  const pooled = Boolean(view) && !view?.localPartInUse

  const handleSave = useCallback(async () => {
    if (busy) return
    /*
     * A POOLED SITE SENDS NO MAILBOX AT ALL, rather than sending one the
     * route will refuse.
     *
     * The field is disabled above and the alert says why, and this is the
     * half that matters: a merchant on the shared address editing their
     * sender name would otherwise have the whole save rejected over a field
     * they were never offered.
     */
    const checked = pooled ? null : validateSendingLocalPart(mailbox)
    if (checked?.error) return setError(checked.error)
    setError('')
    setBusy(true)
    const { response, payload } = await call({
      path: 'sending-identity',
      method: 'POST',
      /*
       * No `domain` key. Absent means "this is not a decision about the
       * domain" — an empty one would mean "move this site back to the address
       * Aglyn issues it", which would reset a site sending as its own
       * verified name every time somebody edited the sender.
       */
      body: {
        hostId,
        ...(checked?.localPart ? { localPart: checked.localPart } : {}),
        fromName: fromName.trim(),
        replyTo: replyTo.trim(),
      },
    })
    setBusy(false)
    if (!response.ok) {
      return setError(payload?.error ?? 'Could not save who this site sends as')
    }
    onSaved()
    onClose()
  }, [busy, call, hostId, mailbox, pooled, fromName, replyTo, onSaved, onClose])

  const applyCandidate = useCallback((candidate: SenderCandidate) => {
    const at = candidate.email.lastIndexOf('@')
    const proposed = normalizeLocalPart(
      at > 0 ? candidate.email.slice(0, at) : '',
    )
    if (proposed) setMailbox(proposed)
    if (candidate.displayName) setFromName(candidate.displayName)
    setReplyTo(candidate.email)
    setError('')
  }, [])

  return (
    <NavigationDrawerComponent
      open={open}
      anchor="right"
      variant="temporary"
      onClose={onClose}
      AppBarProps={{ color: 'surface' }}
      appBarLeft={
        <>
          <IconButton
            color="inherit"
            edge="start"
            onClick={onClose}
            sx={{ mr: 2 }}
          >
            <MdiIcon path={ICON_VARIANT_CLOSE.path} />
            <SrOnly>close drawer</SrOnly>
          </IconButton>
          <Typography variant="h6" component="div">
            {'Who this site sends as'}
          </Typography>
        </>
      }
    >
      <Container gutterY>
        <Stack spacing={2}>
          <Typography variant="body2" color="text.secondary">
            {'The address your email leaves on, and the name in front of it. ' +
              'The domain is your site’s verified sending domain and cannot ' +
              'be changed here — the part before the @ can. To have replies ' +
              'reach a personal or company mailbox, use the reply address: ' +
              'sending as an address on somebody else’s mail provider is ' +
              'refused by the receiving side, not delivered.'}
          </Typography>

          {candidates.length ? (
            <>
              <TextField
                select
                label="Send as a person"
                value=""
                size="small"
                onChange={(event) => {
                  const match = candidates.find(
                    (entry) => entry.id === event.target.value,
                  )
                  if (match) applyCandidate(match)
                }}
                helperText="Fills the three fields below from a site member"
              >
                {candidates.map((candidate) => (
                  <MenuItem key={candidate.id} value={candidate.id}>
                    {candidate.displayName
                      ? `${candidate.displayName} — ${candidate.email}`
                      : candidate.email}
                  </MenuItem>
                ))}
              </TextField>
              <Divider />
            </>
          ) : null}

          {pooled ? (
            <Alert severity="info">
              {'This site sends on a shared Aglyn address, whose mailbox is ' +
                'fixed and shared with the other sites on it. The name and ' +
                'reply address below apply to that mail; the mailbox takes ' +
                'effect once this site has a domain of its own.'}
            </Alert>
          ) : null}

          <TextField
            label="Mailbox"
            value={mailbox}
            onChange={(event) => setMailbox(event.target.value)}
            size="small"
            disabled={pooled}
            slotProps={{
              input: domain
                ? {
                    endAdornment: (
                      <InputAdornment position="end">
                        {`@${domain}`}
                      </InputAdornment>
                    ),
                  }
                : undefined,
            }}
            helperText={
              'The part before the @ — for example hello, sales or jamie'
            }
          />
          <TextField
            label="Sender name"
            value={fromName}
            onChange={(event) => setFromName(event.target.value)}
            size="small"
            helperText="Shown in front of the address. A person’s name, or your brand"
          />
          <TextField
            label="Reply address"
            value={replyTo}
            onChange={(event) => setReplyTo(event.target.value)}
            size="small"
            type="email"
            helperText="Where replies go. May be any mailbox, including a personal one"
          />

          {error ? <Alert severity="error">{error}</Alert> : null}

          <Button
            variant="contained"
            disabled={busy || !view}
            onClick={() => void handleSave()}
          >
            {busy ? 'Saving…' : 'Save sender'}
          </Button>
        </Stack>
      </Container>
    </NavigationDrawerComponent>
  )
}
SendingSenderDrawer.displayName = 'SendingSenderDrawer'

export default SendingSenderDrawer
