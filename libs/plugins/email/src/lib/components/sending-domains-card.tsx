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
import { CardDisplay, Container, MdiIcon, SrOnly } from '@aglyn/shared-ui-jsx'
import { NavigationDrawerComponent } from '@aglyn/shared-ui-jsx/components/navigation-drawer.component'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import {
  Alert,
  Button,
  Chip,
  Divider,
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
import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { describeSendingDomain } from '../model/sending-domain-status'
import SendingSenderDrawer from './sending-sender-drawer'
import {
  useSendingApi,
  type SendingIdentityView,
} from './use-sending-identity-api'

export interface SendingDomainsCardProps {
  hostId: string
  /** `/…/emails`, which every card in this section is handed. */
  basePath: string
}

/**
 * WHERE A WORKSPACE PROVES IT OWNS THE DOMAIN ITS MAIL LEAVES ON.
 *
 * ## The two halves on one screen, and why they are not one control
 *
 * A domain is proved by the ORG — publishing a DKIM record is a statement
 * about a zone, and an agency running four sites on `client.com` should make
 * it once. Which of the proved domains THIS SITE sends as is a separate,
 * per-site choice, because the `From:` a recipient sees belongs to the site.
 *
 * So the top of this card says what this site sends as right now, and the
 * table below is the org's set of domains. Collapsing them would make one of
 * the two questions unanswerable: with one control per site, four sites would
 * publish the same record four times; with one control per org, an agency
 * could not give two clients two different `From:` lines.
 *
 * ## Every state gets its own sentence
 *
 * Five situations, and `describeSendingDomain` holds four of them — the fifth,
 * a check nobody answered, is deliberately not a state at all. It rides the
 * surface as a transient notice beside whatever the record still says, which
 * is the whole reason the model file exists.
 */
export function SendingDomainsCard(props: SendingDomainsCardProps) {
  const { hostId, basePath } = props
  const call = useSendingApi()
  const router = useRouter()
  const { enqueueSnackbar } = useSnackbar()
  /*
   * The snackbar held in a REF, for the reason `use-campaign-send-api` holds
   * the user in one: `load` is a dependency of the effect that runs it, so
   * anything whose identity changes per render re-runs the fetch — and a
   * hook returning a fresh object each render turns that into a loop that
   * never settles. Reading it through a ref makes the effect depend on the
   * things that actually identify the request.
   */
  const notifyRef = useRef(enqueueSnackbar)
  notifyRef.current = enqueueSnackbar

  const [view, setView] = useState<SendingIdentityView | null>(null)
  const [loading, setLoading] = useState(true)
  const [adding, setAdding] = useState(false)
  /**
   * The open sender editor, and which row it is on.
   *
   * One state rather than an `open` flag beside an id, so the drawer cannot be
   * open with no answer to "which sender" — the id and the openness are the
   * same fact. `senderId: null` is the add case.
   */
  const [senderEditor, setSenderEditor] = useState<{
    senderId: string | null
  } | null>(null)
  /** The row a list action is in flight for, so only its buttons go quiet. */
  const [senderBusy, setSenderBusy] = useState('')
  const [addingBusy, setAddingBusy] = useState(false)
  const [newDomain, setNewDomain] = useState('')
  const [addError, setAddError] = useState('')
  const [claimingDedicated, setClaimingDedicated] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const { response, payload } = await call({
      path: 'sending-identity',
      method: 'GET',
      query: { hostId },
    })
    setLoading(false)
    if (!response.ok) {
      /*
       * The refusal itself, not a generic failure. A reader without the org
       * admin role, or on a plan that does not carry white-label, needs to
       * know which of those it is — "something went wrong" would send them
       * to support for an answer the response already gave.
       */
      setView(null)
      return void notifyRef.current(payload?.error ?? 'Could not read the sending identity', {
        variant: 'warning',
      })
    }
    setView(payload as SendingIdentityView)
  }, [call, hostId])

  useEffect(() => {
    void load()
  }, [load])

  /**
   * The list's own two actions — move the default, and remove a sender.
   *
   * Both are a POST and a re-read rather than a local edit of `view`. The
   * server decides which row is the default and what the projection onto the
   * host document becomes, so re-reading is what keeps this list and the
   * address a send would actually resolve to one answer.
   */
  const handleSenderAction = useCallback(
    async (action: 'makeDefaultSender' | 'deleteSender', senderId: string) => {
      setSenderBusy(senderId)
      const { response, payload } = await call({
        path: 'sending-identity',
        method: 'POST',
        body: { hostId, action, senderId },
      })
      setSenderBusy('')
      if (!response.ok) {
        return void notifyRef.current(
          payload?.error ?? 'Could not update that sender',
          { variant: 'warning' },
        )
      }
      void load()
    },
    [call, hostId, load],
  )

  const handleAdd = useCallback(async () => {
      const domain = newDomain.trim()
      if (!domain || addingBusy) return
      setAddError('')
      setAddingBusy(true)
      const { response, payload } = await call({
        path: 'sending-domains',
        method: 'POST',
        body: { orgId: view?.orgId, domain, action: 'request' },
      })
      setAddingBusy(false)
      if (!response.ok) {
        setAddError(payload?.error ?? 'Could not add that domain')
        return
      }
      setAdding(false)
      setNewDomain('')
      /*
       * Straight to the domain's own page, because the thing the person came
       * for is now there: the records to publish. A list row saying
       * "Publish the records" with the records one click further away would
       * make the next step something they have to go looking for.
       */
      router.push(
        `${basePath}/sending/${encodeURIComponent(payload?.domain ?? domain)}`,
      )
  }, [call, view?.orgId, basePath, router, newDomain, addingBusy])

  /**
   * ASK FOR THE PLATFORM SUBDOMAIN.
   *
   * The second of the two ways out of the marketing refusal, and the one for a
   * merchant who cannot publish DNS — an agency's client on a domain somebody
   * else administers, or a site whose registrar access is a support ticket
   * away. It is offered rather than issued because it spends a provider domain
   * slot and three records in Aglyn's own zone, where a domain the merchant
   * owns spends neither.
   *
   * Reloads rather than patching the view from the response. The claim moves
   * three things at once — the site's selection, the org's domain list and the
   * identity the send path resolves — and a surface that updated one of them
   * from a response body would be the second opinion this card exists not to
   * be.
   */
  const handleClaimDedicated = useCallback(async () => {
    if (claimingDedicated) return
    setClaimingDedicated(true)
    const { response, payload } = await call({
      path: 'sending-identity',
      method: 'POST',
      body: { hostId, action: 'request-dedicated' },
    })
    setClaimingDedicated(false)
    if (!response.ok) {
      return void notifyRef.current(
        payload?.error ?? 'Could not set up a sending domain for this site',
        { variant: 'warning' },
      )
    }
    notifyRef.current(
      `${payload?.selected} is being set up. Account email keeps sending ` +
        'meanwhile, and campaigns can go out once it verifies.',
      { variant: 'success' },
    )
    await load()
  }, [call, hostId, claimingDedicated, load])

  const domains = view?.domains ?? []
  const senders = view?.senders ?? []
  /*
   * Whether this site has a domain of its own to name a mailbox on — the same
   * question the route asks before it accepts one. A site on the shared pool
   * has exactly one sender and its mailbox is fixed, so offering to add a
   * second would offer a choice the write refuses.
   */
  const canAddSender = Boolean(view?.selected)

  return (
    <CardDisplay
      header="Sending domains"
      help={pluginDocsHelp('emailCampaigns', {
        anchor: '#sending-domains',
      })}
      contentGutterX
      contentGutterY
      contentBordered="all"
      HeaderProps={{
        action: view?.canManage ? (
          <Stack direction="row" spacing={1}>
            {/*
              THE ACTION SITS IN THE HEADER, not above the list it adds to.

              This page is built of vertical-tab sections, so a create control
              stacked over the table would put an editor between a reader and
              the rows they came to read — the same reason every create in the
              console opens a drawer.

              Senders are offered on every plan, unlike the domain beside
              them: the name in front of the address and where replies land
              are honored on the pooled Aglyn address exactly as they are on a
              site's own domain, and gating them behind the paid tier would
              withhold the free half of a capability over the paid half. A
              SECOND sender is a different matter and is disabled on the pool,
              because the mailbox that would distinguish it is fixed there.
             */}
            <Button
              size="small"
              variant="outlined"
              disabled={!view || !canAddSender}
              onClick={() => setSenderEditor({ senderId: null })}
            >
              {'Add sender'}
            </Button>
            <Button
              size="small"
              variant="contained"
              disabled={!view?.entitled || !view?.orgId}
              onClick={() => setAdding(true)}
            >
              {'Add domain'}
            </Button>
          </Stack>
        ) : null,
      }}
    >
      <Stack spacing={1.5}>
        {/*
          THE LADDER, IN THE ORDER A READER NEEDS IT.

          What already works, then what does not, then the two ways out. One
          claim per block: the same material as one paragraph is the same
          material nobody finishes, and the sentence a merchant came for —
          "do my receipts send?" — was the one buried in the middle of it.
         */}
        <Typography variant="body2" color="text.secondary">
          {'Receipts, password resets, booking confirmations and other ' +
            'account email send on every plan, including Free. Nothing here ' +
            'has to be finished first.'}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {'Campaigns and other marketing email are different: they need a ' +
            'sending domain of this site’s own. The shared address carries ' +
            'every other site’s receipts, so one campaign’s complaint rate ' +
            'there would be charged against all of them.'}
        </Typography>

        {/*
          WHAT THIS SITE SENDS AS, RIGHT NOW.

          Read from the same resolver the send path calls, so this is the
          answer a campaign would get and not a second opinion assembled from
          the table below. A surface that re-derived it would eventually show
          a healthy address for a send that refuses.
         */}
        {view ? (
          <Alert severity={view.refusal ? 'warning' : 'info'}>
            <Typography variant="body2" sx={{ fontWeight: 'bold' }}>
              {view.refusal ? 'This site cannot send' : 'This site sends as'}
            </Typography>
            <Typography variant="body2">
              {view.refusal?.message ?? view.identity}
            </Typography>
            {view.identitySource === 'shared' && !view.refusal ? (
              <Typography variant="body2" sx={{ mt: 0.5 }}>
                {'Recipients see an Aglyn address, and replies still reach ' +
                  'you. The sending reputation on it is shared with the other ' +
                  'sites using it rather than being yours.'}
              </Typography>
            ) : null}
            {/*
              THE SENDER, beside the address rather than only inside the
              drawer that sets it.

              A person reading this card is asking what their recipients see,
              and the address alone does not answer it: an inbox shows the
              name first. Reply-to is named only when one is set, because a
              message without one takes replies at the sending address and
              saying "none" would read as replies going nowhere.
             */}
            {view.fromName || view.replyTo ? (
              <Typography variant="body2" sx={{ mt: 0.5 }}>
                {view.fromName
                  ? `Recipients see it from ${view.fromName}.`
                  : 'Recipients see the address with no name in front of it.'}
                {view.replyTo ? ` Replies go to ${view.replyTo}.` : ''}
              </Typography>
            ) : null}
            {/*
              A stored mailbox that is not the one in use, said out loud. The
              alternative is a settings drawer showing `sales` beside mail
              that is leaving as `notifications@`.
             */}
            {view.localPart && !view.localPartInUse && !view.refusal ? (
              <Typography variant="body2" sx={{ mt: 0.5 }}>
                {`This site is set to send as ${view.localPart}@, which ` +
                  'takes effect once it has a domain of its own. The shared ' +
                  'address has one fixed mailbox for every site on it.'}
              </Typography>
            ) : null}
          </Alert>
        ) : null}

        {/*
          THE SENDERS THIS SITE HOLDS.

          A list rather than one editable address, because a site legitimately
          sends as several people — and because a mailbox has to be one
          somebody serves. A composer that could type an address per campaign
          would mint mailboxes that exist in one message's headers and nowhere
          else; a composer that picks from this list can only reach an address
          that was configured here and validated once.

          The DEFAULT is what an email that names no sender goes out as, and
          it is also the row projected onto the host document — which is why
          nothing needed backfilling: a site that never opens this list has
          exactly one sender, the one it has always had.
         */}
        {view ? (
          <>
            <Divider />
            <Typography variant="body2" sx={{ fontWeight: 'bold' }}>
              {'Senders'}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {'The addresses this site may send as. Every email you compose ' +
                'picks one of them; the default is what an email that names ' +
                'no other goes out as.'}
            </Typography>
            {!canAddSender ? (
              <Typography variant="body2" color="text.secondary">
                {'This site sends on a shared Aglyn address, whose mailbox is ' +
                  'fixed and shared with the other sites on it, so it has one ' +
                  'sender. A domain of this site’s own is what makes a second ' +
                  'address possible.'}
              </Typography>
            ) : null}
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>{'Sends as'}</TableCell>
                  <TableCell>{'Name'}</TableCell>
                  <TableCell>{'Replies to'}</TableCell>
                  <TableCell align="right">{'Default'}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {senders.map((sender) => (
                  <TableRow
                    key={sender.id}
                    hover={view.canManage}
                    sx={{ cursor: view.canManage ? 'pointer' : 'default' }}
                    onClick={
                      view.canManage
                        ? () => setSenderEditor({ senderId: sender.id })
                        : undefined
                    }
                  >
                    <TableCell sx={{ fontFamily: 'monospace' }}>
                      {/*
                        The whole address as the SERVER assembled it, and the
                        mailbox alone when there is none to assemble it onto.
                        A site whose domain is not settled has a real stored
                        mailbox that is not yet in effect, and the alert above
                        says so — printing a domain here that no send would
                        use would be this surface inventing the answer.
                       */}
                      {sender.from ?? `${sender.localPart}@`}
                    </TableCell>
                    <TableCell>{sender.fromName ?? '—'}</TableCell>
                    <TableCell>{sender.replyTo ?? '—'}</TableCell>
                    <TableCell align="right">
                      {sender.isDefault ? (
                        <Chip size="small" label="Default" color="primary" />
                      ) : view.canManage ? (
                        <Stack
                          direction="row"
                          spacing={1}
                          sx={{ justifyContent: 'flex-end' }}
                        >
                          {/*
                            `stopPropagation` because the row itself opens the
                            editor. Without it, making a sender the default
                            would also open a drawer over the list that just
                            changed underneath it.
                           */}
                          <Button
                            size="small"
                            disabled={senderBusy === sender.id}
                            onClick={(event) => {
                              event.stopPropagation()
                              void handleSenderAction(
                                'makeDefaultSender',
                                sender.id,
                              )
                            }}
                          >
                            {'Make default'}
                          </Button>
                          <Button
                            size="small"
                            color="error"
                            disabled={senderBusy === sender.id}
                            onClick={(event) => {
                              event.stopPropagation()
                              void handleSenderAction(
                                'deleteSender',
                                sender.id,
                              )
                            }}
                          >
                            {'Remove'}
                          </Button>
                        </Stack>
                      ) : (
                        <Typography variant="body2" color="text.secondary">
                          {'—'}
                        </Typography>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </>
        ) : null}

        {/*
          THE TWO WAYS TO GET A DOMAIN, WITH WHAT EACH COSTS THE MERCHANT.

          Both are shown whatever this site already has, because they are not
          steps in a sequence — they are a choice, and a site already on the
          one we provision is exactly the reader who has not been told the
          other exists. They name the same tier today and are still two
          sentences: what separates them is the DNS work and the name in the
          `From:` line, which is what a merchant is actually choosing between.

          The plan names come from the server, which derives them from the
          entitlement tables. A tier written in here is pricing copy that keeps
          rendering after the gate beneath it moves.

          The one we provision carries an ACTION, and it is the only place in
          the product that claims one. It used to arrive by itself — at site
          creation, on the upgrade webhook, from a sweep — which made the
          platform's domain count grow with paying customers rather than with
          anybody's decision, against a provider allowance that grows only by
          purchase. Offering it here is what makes the count something people
          choose rather than something that happens.
         */}
        {view ? (
          <>
            <Divider />
            <Typography variant="body2" sx={{ fontWeight: 'bold' }}>
              {'Two ways to get one'}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {view.platformDomain
                ? `A domain we set up. This site has one — ${view.platformDomain} — ` +
                  'with no records for you to publish, and the sending ' +
                  'reputation on it is this site’s alone. Recipients see an ' +
                  'address on our domain rather than on yours.'
                : 'A domain we set up' +
                  (view.dedicatedDomainPlan
                    ? `, which comes with ${view.dedicatedDomainPlan}`
                    : '') +
                  '. There is nothing for you to publish, and the sending ' +
                  'reputation on it is this site’s alone. Recipients see an ' +
                  'address on our domain rather than on yours.'}
            </Typography>
            {/*
              The action, beside the sentence that describes it rather than in
              an alert of its own — a second box repeating the same trade would
              be the surface arguing with itself about which option it prefers.

              Only for a reader who can act on it, and only when the plan
              carries one and this site has none. Somebody without
              `org.settings` gets the role notice further down instead.
             */}
            {view.dedicated?.available && view.canManage ? (
              <Button
                size="small"
                variant="outlined"
                sx={{ alignSelf: 'flex-start' }}
                disabled={claimingDedicated}
                onClick={() => void handleClaimDedicated()}
              >
                {claimingDedicated
                  ? 'Setting up…'
                  : view.dedicated.proposed
                    ? `Set up ${view.dedicated.proposed}`
                    : 'Set up a domain for this site'}
              </Button>
            ) : null}
            <Typography variant="body2" color="text.secondary">
              {(view.customDomainPlan
                ? 'A domain you already own. Sending as your own domain ' +
                  `starts on the ${view.customDomainPlan} plan.`
                : 'A domain you already own.') +
                ' Your own name in the From: line and a sending reputation ' +
                'that is entirely yours. The trade is the DNS work: you ' +
                'publish three records in your zone, and we never write to it.'}
            </Typography>
            {/*
              A PLAN GATE ON THE DOMAIN IS NOT A GATE ON THE MAIL.

              Said only to the reader it applies to, and said here rather than
              as an alert: the address this site sends account email from is
              already named above, and repeating "you cannot" in a colored box
              would read as an outage on a site that is sending perfectly well.
             */}
            {!view.entitled ? (
              <Typography variant="body2" color="text.secondary">
                {'Account email from this site sends without it either way — ' +
                  'the address is shown above.'}
              </Typography>
            ) : null}
            <Divider />
          </>
        ) : null}

        {/*
          The role gate holds whatever the plan says, so it is stated whatever
          the plan says. Nesting it under `entitled` left the reader who is
          BOTH un-entitled and unable to manage with no explanation of either.
         */}
        {view && !view.canManage ? (
          <Alert severity="info">
            {'Adding a domain and choosing what this site sends as needs the ' +
              'organization admin role. You can see the current state here.'}
          </Alert>
        ) : null}

        {loading ? (
          <Typography variant="body2" color="text.secondary">
            {'Loading…'}
          </Typography>
        ) : domains.length ? (
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>{'Domain'}</TableCell>
                <TableCell>{'State'}</TableCell>
                <TableCell>{'Used by this site'}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {domains.map((record) => {
                const state = describeSendingDomain({
                  status: record.status,
                  // The list read does not carry the provider detail — the
                  // domain's own page does — so `requested` reads here as the
                  // waiting state it usually is, and the page is where the
                  // difference between "no credential" and "the provider
                  // refused" is spelled out.
                  pendingProvider: record.status === 'requested',
                })
                return (
                  <TableRow
                    key={record.domain}
                    hover
                    sx={{ cursor: 'pointer' }}
                    onClick={() =>
                      router.push(
                        `${basePath}/sending/${encodeURIComponent(record.domain)}`,
                      )
                    }
                  >
                    <TableCell sx={{ fontFamily: 'monospace' }}>
                      {record.domain}
                    </TableCell>
                    <TableCell>
                      <Chip
                        size="small"
                        label={state.label}
                        color={state.color}
                        variant={state.sending ? 'filled' : 'outlined'}
                      />
                    </TableCell>
                    <TableCell>
                      {view?.selected === record.domain ? (
                        <Chip size="small" label="Sending as this" color="primary" />
                      ) : (
                        <Typography variant="body2" color="text.secondary">
                          {'—'}
                        </Typography>
                      )}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        ) : (
          <Typography variant="body2" color="text.secondary">
            {'No domain has been added yet.'}
          </Typography>
        )}
      </Stack>

      {/*
        Editing the sender is a drawer too, for the standing reason a create
        is: the alternative is a form stacked above the table of domains,
        which puts an open editor between a reader and the thing they came to
        read.
       */}
      <SendingSenderDrawer
        open={Boolean(senderEditor)}
        hostId={hostId}
        view={view}
        senderId={senderEditor?.senderId ?? null}
        onClose={() => setSenderEditor(null)}
        onSaved={() => void load()}
      />

      {/*
        Creating is a drawer, the same as every other create in the console.

        Composed from `NavigationDrawerComponent` — the primitive
        `CreateArtifactDrawer` is itself built on — rather than from that
        wrapper, for the reason `suppressions-card.tsx` states beside the same
        choice: the shared schema opens with a required `displayName` labeled
        "Friendly name for internal reference", and a sending domain has no
        such thing. Its identity IS the domain, which is also its document id.
        Offering a name box that the writer ignores would teach the person it
        was used.
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
              <SrOnly>close drawer</SrOnly>
            </IconButton>
            <Typography variant="h6" component="div">
              {'Add a sending domain'}
            </Typography>
          </>
        }
      >
        <Container gutterY>
          <Stack spacing={2}>
            <Typography variant="body2" color="text.secondary">
              {'The domain your mail should come from — the part after the @. ' +
                'Use a domain you control the DNS for; you will be given ' +
                'records to publish on it. Mailbox providers do not delegate ' +
                'sending for their own names, so a Gmail or Outlook address ' +
                'cannot be verified here.'}
            </Typography>
            <TextField
              label="Domain"
              value={newDomain}
              onChange={(event) => setNewDomain(event.target.value)}
              size="small"
              autoFocus
              placeholder="acme.com"
              helperText="For example acme.com — not an address"
            />
            {addError ? <Alert severity="error">{addError}</Alert> : null}
            <Button
              variant="contained"
              disabled={!newDomain.trim() || addingBusy}
              onClick={() => void handleAdd()}
            >
              {addingBusy ? 'Adding…' : 'Add domain'}
            </Button>
          </Stack>
        </Container>
      </NavigationDrawerComponent>
    </CardDisplay>
  )
}
SendingDomainsCard.displayName = 'SendingDomainsCard'

export default SendingDomainsCard
