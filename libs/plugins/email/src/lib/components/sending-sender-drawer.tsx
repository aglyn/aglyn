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

import { hostRoleFor, HOST_ACCESS_ROLES } from '@aglyn/aglyn'
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
import { collection, limit, query, where } from 'firebase/firestore'
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  useSendingApi,
  type SendingIdentityView,
} from './use-sending-identity-api'

/**
 * How many people each of the roster reads may return.
 *
 * A ceiling rather than a page, because this control is a shortcut and not a
 * roster: somebody choosing a sender knows who they are looking for, and a
 * site large enough to overflow this has an admin who can type the three
 * fields directly. Bounded because the read happens on a merchant's settings
 * screen, and an unbounded one would grow with the site for no benefit.
 *
 * 250 is the largest per-site collaborator allowance any finite plan grants
 * (`membersPerHost`), so on every plan below Enterprise the whole entitled
 * set fits and nothing is cut. Where it does bite it cuts in document-id
 * order, which is a stable slice and not a ranked one — the queries below are
 * already narrowed to people who can reach this site, so what is dropped is a
 * tail of an entitled roster rather than an arbitrary sample of a workspace.
 */
const SENDER_PICKER_CEILING = 250

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
 * ## Who is on the list
 *
 * Everybody who can reach this site, from wherever their access comes from:
 * the organization's team, whose members reach a site through an org role or
 * an `allHosts` flag or a per-site grant, and the site's own collaborators,
 * who are on it and nowhere else. Both, because either alone is a picker that
 * is missing people — and a workspace that manages its team entirely at the
 * org level has an empty site roster, so reading only that one offered no
 * teammates at all.
 *
 * Nobody else. An org member scoped to other sites is not a candidate sender
 * for this one: the address would work, and the person would be signing mail
 * for a site they cannot open. `hostRoleFor` draws that line, and it is the
 * same one the rules and every server gate draw.
 *
 * The roster is read only while this drawer is open. It is four collection
 * reads on a settings surface, and ones that happen because somebody asked for
 * them are a different thing from ones that happen because a card mounted.
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

  /*
   * The org this site belongs to, as the identity route resolved it.
   *
   * Taken from the view rather than read again here, so the drawer and the
   * card it opens from agree about which workspace they are looking at, and
   * so the org reads below cannot start before the route has answered.
   */
  const orgId = String(view?.orgId ?? '')
  const reading = open && Boolean(hostId)

  /*
   * THE SITE'S OWN COLLABORATOR ROSTER — `hosts/{hostId}/members`.
   *
   * Not the whole answer, and reading it alone was the defect: this
   * subcollection holds only people added TO ONE SITE by
   * `POST /api/hosts/members`. A workspace whose team reaches every site
   * through their org membership has no rows here at all, so a picker built
   * on it offered whichever one address happened to have been added this way
   * and no teammates whatsoever.
   *
   * It stays because it is the only source for one population: somebody
   * invited to the site by an address with no Aglyn account behind it yet has
   * a roster row and, until they accept, no org member document. They are a
   * real person with a real mailbox who has been granted access, which is all
   * a reply address needs.
   *
   * Ordered by nothing, and capped: see {@link SENDER_PICKER_CEILING}. This
   * subcollection has exactly one writer and it writes `email` on every
   * document, so an `orderBy('email')` would be safe here — it buys nothing,
   * because the merged set below is arranged for display after the fact and a
   * server order over one of four reads cannot survive the merge.
   */
  const { data: siteMemberDocs } = useFirestoreCollection<any>(
    () =>
      reading
        ? query(
            collection(firestore, 'hosts', hostId, 'members'),
            limit(SENDER_PICKER_CEILING),
          )
        : null,
    [firestore, hostId, reading],
    { idField: '$id' },
  )

  /*
   * THE ORG'S TEAM — `orgs/{orgId}/members`, in the three shapes that reach
   * one host.
   *
   * `hostRoleFor` is the predicate the rules, the ~20 server gates and
   * `useHostRole` all resolve a member's access to a site with, and it is a
   * disjunction of exactly three cases: an owner or admin spans every site; an
   * editor or viewer with `allHosts` spans every site at their org role; and
   * anybody may carry an explicit per-site grant in `hostAccess`. Firestore
   * cannot express that as one query, so it is asked as three and merged.
   *
   * ## Three narrow reads rather than one broad one
   *
   * The alternative — read the roster and filter in the browser — reads every
   * member of the workspace to find the few who work on this site, and the cap
   * would then apply BEFORE the filter: in an org of 400 where five people
   * have this site, the picker could contain none of them. Splitting the
   * predicate across the wire means the cap only ever cuts a tail of people
   * who all belong in the list.
   *
   * ## The `orderBy` trap, and why there is no `orderBy` here
   *
   * `orderBy` matches only documents that HAVE the field, so ordering on one
   * some writer omits hides rows instead of arranging them. `email` is NOT
   * safe to order on in this collection: `AglynOrgMember` declares it
   * optional, and two production paths create a member document without it —
   * `PATCH /api/hosts/members` re-grants host access with no identity fields,
   * and `POST /api/orgs/members` omits it entirely when the auth record
   * carries no email. Ordering on it would drop exactly the teammates this
   * change exists to surface, silently.
   *
   * Each `where` below is safe in a way an `orderBy` is not, and for the same
   * reason it looks unsafe: a document missing `role`, missing `allHosts` or
   * missing `hostAccess` is dropped by the filter — and `hostRoleFor` resolves
   * every one of those to "no access" anyway. The predicate and the index
   * agree about what absence means, so the query cannot hide anybody the
   * filter would have kept.
   */
  const orgMembers = (constrain: (base: any) => any) => () =>
    reading && orgId
      ? constrain(collection(firestore, 'orgs', orgId, 'members'))
      : null

  const { data: orgAdminDocs } = useFirestoreCollection<any>(
    orgMembers((base) =>
      query(
        base,
        where('role', 'in', ['owner', 'admin']),
        limit(SENDER_PICKER_CEILING),
      ),
    ),
    [firestore, orgId, reading],
    { idField: '$id' },
  )
  const { data: orgWideDocs } = useFirestoreCollection<any>(
    orgMembers((base) =>
      query(base, where('allHosts', '==', true), limit(SENDER_PICKER_CEILING)),
    ),
    [firestore, orgId, reading],
    { idField: '$id' },
  )
  /*
   * `HOST_ACCESS_ROLES` rather than a written-out array, for the reason it
   * exists: a role added to `HostAccessRole` and missing from an `in` list is
   * a person who holds access and cannot be seen to, with no error to explain
   * it. The constant is built from a `Record` so a new role fails to compile
   * there instead of quietly shortening this query.
   */
  const { data: orgScopedDocs } = useFirestoreCollection<any>(
    orgMembers((base) =>
      query(
        base,
        where(`hostAccess.${hostId}`, 'in', HOST_ACCESS_ROLES),
        limit(SENDER_PICKER_CEILING),
      ),
    ),
    [firestore, orgId, hostId, reading],
    { idField: '$id' },
  )

  const candidates = useMemo<SenderCandidate[]>(() => {
    /*
     * ONE ROW PER PERSON, keyed by uid.
     *
     * The same teammate legitimately appears in several of these reads — an
     * org admin who is also an explicit collaborator is in two, and an org
     * member who accepted a site invite has a roster row as well — so the
     * merge is by identity rather than by document. The org member document
     * and the site roster row are keyed by the same uid, which is what makes
     * that possible: `POST /api/hosts/members` names the roster document after
     * the auth uid whenever an account exists, and falls back to a generated
     * id only for an address that has none. Such a row has no org document to
     * collide with, so the fallback cannot merge two people into one.
     *
     * Fields are taken from the first read that has them rather than from a
     * chosen winner. Neither source is complete on its own: the site roster
     * always carries an `email` and never a `displayName`, and an org member
     * document usually carries both but is allowed to omit either.
     */
    const byPerson = new Map<string, SenderCandidate>()
    const fold = (id: string, entry: any) => {
      if (!id) return
      const current = byPerson.get(id) ?? { id, email: '', displayName: '' }
      byPerson.set(id, {
        id,
        email: current.email || String(entry?.email ?? '').trim(),
        displayName:
          current.displayName || String(entry?.displayName ?? '').trim(),
      })
    }

    /*
     * THE PREDICATE IS APPLIED AGAIN HERE, over the documents themselves.
     *
     * The three queries are the predicate projected onto an index, and an
     * index answers a coarser question than the function does — `allHosts`
     * reaches every site only for a member who HAS an org role, and a document
     * carrying the flag with no role is a member of nothing. `hostRoleFor` is
     * the one definition of "can this person reach this site", so it decides,
     * and the queries are only what keeps the reads narrow.
     */
    for (const entry of [
      ...(orgAdminDocs ?? []),
      ...(orgWideDocs ?? []),
      ...(orgScopedDocs ?? []),
    ]) {
      if (!hostRoleFor(entry, hostId as never)) continue
      fold(String(entry?.$id ?? ''), entry)
    }

    /*
     * The site's roster rows carry no role of their own to resolve — being in
     * this subcollection IS access to this site, which is what the Users card
     * on the site's own settings page renders it as. `uid` before `$id` so an
     * accepted collaborator merges onto their org member document rather than
     * arriving as a second row for the same person.
     */
    for (const entry of siteMemberDocs ?? []) {
      fold(String(entry?.uid || entry?.$id || ''), entry)
    }

    return (
      [...byPerson.values()]
        /*
         * An address is not optional. It is what the mailbox is derived from
         * and what replies are pointed at, so a person recorded without one
         * has nothing this picker could fill in.
         */
        .filter((entry) => entry.email)
        /*
         * Sorted here rather than by the server, because this is a COMPLETE
         * set and not a page: four reads have been merged, so no server order
         * survives, and arranging a page in the browser is what makes an
         * arbitrary slice read as a ranked one. By the name a person is
         * looking for, falling back to the address for somebody who has none.
         */
        .sort((left, right) =>
          (left.displayName || left.email).localeCompare(
            right.displayName || right.email,
            undefined,
            { sensitivity: 'base' },
          ),
        )
    )
  }, [orgAdminDocs, orgWideDocs, orgScopedDocs, siteMemberDocs, hostId])

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
                helperText="Fills the three fields below from someone who works on this site"
              >
                {/*
                  THE NAME LEADS, and the address sits under it.

                  A sender picker is answering "which of us is this from",
                  which is a question about a person; a list of bare addresses
                  makes the reader parse a local part to recognise a colleague.
                  The address stays on the row because it is what the mailbox
                  is derived from and where replies will land, so it is part of
                  the choice rather than a detail behind it — and it is the
                  whole row for somebody whose name nothing has recorded, which
                  is an ordinary state for an invited teammate who has not
                  signed in yet.
                */}
                {candidates.map((candidate) => (
                  <MenuItem key={candidate.id} value={candidate.id}>
                    <Stack spacing={0}>
                      {candidate.displayName ? (
                        <Typography variant="body2">
                          {candidate.displayName}
                        </Typography>
                      ) : null}
                      <Typography
                        variant={candidate.displayName ? 'caption' : 'body2'}
                        color={
                          candidate.displayName ? 'text.secondary' : undefined
                        }
                      >
                        {candidate.email}
                      </Typography>
                    </Stack>
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
