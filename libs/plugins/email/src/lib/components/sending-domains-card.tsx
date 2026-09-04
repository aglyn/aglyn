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
  mdiDeleteOutline,
  mdiDnsOutline,
  mdiEmailCheckOutline,
  mdiRefresh,
} from '@aglyn/shared-data-mdi'
import {
  CardDisplay,
  Container,
  HelpTip,
  MdiIcon,
  SrOnly,
  useConfirmationContext,
} from '@aglyn/shared-ui-jsx'
import { NavigationDrawerComponent } from '@aglyn/shared-ui-jsx/components/navigation-drawer.component'
import RowActionsMenu, {
  type RowActionsMenuItem,
} from '@aglyn/shared-ui-jsx/components/row-actions-menu.component'
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
import {
  describeSendingDomain,
  describeSendingDomainRemoval,
  INCONCLUSIVE_CHECK,
} from '../model/sending-domain-status'
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
  const { confirm } = useConfirmationContext()
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
  /** The same, for the domains table below it. */
  const [domainBusy, setDomainBusy] = useState('')
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
   * A DOMAIN'S OWN PAGE, BUILT IN ONE PLACE.
   *
   * Three things navigate here — the row, the row's menu, and the redirect
   * after adding a domain — and the `sending/` segment is the whole address:
   * `${basePath}/{domain}` resolves to no section and renders an empty page,
   * which is the worst possible landing for all three, because every one of
   * them happens at the moment somebody needs the DNS records. Derived once
   * so a second copy cannot be written without it.
   */
  const domainPath = useCallback(
    (domain: string) => `${basePath}/sending/${encodeURIComponent(domain)}`,
    [basePath],
  )

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

  /*
   * THE ROW'S OWN ACTIONS.
   *
   * Each one posts to the route that owns the decision rather than to a route
   * that happens to be nearby: checking DNS and releasing a claim are facts
   * about the ORG's domain, and which of them this SITE sends as is a per-site
   * selection. That split is the reason there are two routes, and a menu that
   * collapsed it would be the surface deciding an agency's client sends as
   * another client's name.
   *
   * All three re-read afterwards instead of patching `view`. The server
   * decides what the identity resolves to, and a list that edited itself from
   * a response body would be the second opinion this card exists not to be.
   */
  const handleVerifyDomain = useCallback(
    async (domain: string) => {
      if (!view?.orgId || domainBusy) return
      setDomainBusy(domain)
      const { response, payload } = await call({
        path: 'sending-domains',
        method: 'POST',
        body: { orgId: view.orgId, domain, action: 'verify' },
      })
      setDomainBusy('')
      /*
       * THE THIRD OUTCOME, held here exactly as the domain's own page holds
       * it. A `503` means the lookup got no answer, so nothing about the
       * record changed; reporting it as a failed check is how a customer
       * whose DNS is perfect ends up editing a zone that has nothing wrong
       * with it.
       */
      if (response.status === 503) {
        return void notifyRef.current(INCONCLUSIVE_CHECK.text, {
          variant: 'info',
        })
      }
      if (!response.ok) {
        return void notifyRef.current(
          payload?.error ?? 'The check could not run',
          { variant: 'warning' },
        )
      }
      await load()
      notifyRef.current(
        payload?.verified
          ? `Verified — ${domain} can send`
          : `Checked. Some of ${domain}’s records are still missing.`,
        { variant: payload?.verified ? 'success' : 'info' },
      )
    },
    [call, view?.orgId, domainBusy, load],
  )

  const handleUseDomain = useCallback(
    async (domain: string) => {
      if (domainBusy) return
      setDomainBusy(domain)
      const { response, payload } = await call({
        path: 'sending-identity',
        method: 'POST',
        body: { hostId, domain },
      })
      setDomainBusy('')
      if (!response.ok) {
        return void notifyRef.current(
          payload?.error ?? 'Could not change the identity',
          { variant: 'warning' },
        )
      }
      await load()
      // The address the ROUTE settled on, not the one this click asked for —
      // only the response knows what the `From:` line now says.
      notifyRef.current(
        payload?.from
          ? `This site now sends as ${payload.from}`
          : 'This site’s sending address was changed',
        { variant: 'success' },
      )
    },
    [call, hostId, domainBusy, load],
  )

  const handleReleaseDomain = useCallback(
    async (domain: string) => {
      if (!view?.orgId || domainBusy) return
      const ok = await confirm({
        // The same three sentences the domain's own page asks with. Two
        // confirmations describing one action differently is how a merchant
        // learns to dismiss the harsher of them.
        ...describeSendingDomainRemoval({
          domain,
          selected: view.selected,
          platformDomain: view.platformDomain,
        }),
        confirmationButtonProps: { color: 'error' },
      })
        // `confirm` resolves with no value and REJECTS on cancel, so the
        // resolved value alone can never gate this.
        .then(() => true)
        .catch(() => false)
      if (!ok) return
      setDomainBusy(domain)
      const { response, payload } = await call({
        path: 'sending-domains',
        method: 'DELETE',
        query: { orgId: view.orgId, domain },
      })
      setDomainBusy('')
      if (!response.ok) {
        return void notifyRef.current(
          payload?.error ?? 'Could not remove the domain',
          { variant: 'warning' },
        )
      }
      await load()
    },
    [
      call,
      confirm,
      domainBusy,
      view?.orgId,
      view?.selected,
      view?.platformDomain,
      load,
    ],
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
      router.push(domainPath(payload?.domain ?? domain))
  }, [call, view?.orgId, domainPath, router, newDomain, addingBusy])

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
        payload?.error ?? 'Could not ask for a sending domain for this site',
        { variant: 'warning' },
      )
    }
    /*
     * "Asked for", not "is being set up". The claim is the only thing this
     * press completed; creating the domain happens on our side afterwards and
     * can be held at the provider's domain allowance, so a message promising
     * setup would be promising the half that is not ours to promise. The
     * domain's row is where the answer arrives, which is why this points at
     * it rather than restating it.
     */
    notifyRef.current(
      `${payload?.selected} has been asked for. Its row below says where the ` +
        'setup has got to. Account email keeps sending meanwhile, and ' +
        'campaigns can go out once the domain verifies.',
      { variant: 'success' },
    )
    await load()
  }, [call, hostId, claimingDedicated, load])

  /**
   * WHAT MAY BE DONE TO ONE DOMAIN, AND WHY NOT WHEN NOT.
   *
   * Every item here is an operation the routes behind this card can actually
   * perform, and one whose gate this card can see. Nothing is offered on a
   * guess: a menu entry that 403s teaches a reader the console does not know
   * its own rules, and it costs them a round trip to find out.
   *
   * DISABLED WITH A REASON rather than hidden, for the reason
   * `RowActionsMenuItem.disabledReason` exists: an absent control and an
   * inapplicable one look identical, so a viewer who cannot remove a domain
   * would otherwise be left wondering whether the console can remove domains
   * at all.
   *
   * The gates are not one gate, because the routes are not one route:
   *
   *   - Open is navigation and needs nothing.
   *   - Check DNS and Remove go to the DOMAINS route, which is owner/admin on
   *     the org AND carries the own-domain entitlement across the whole
   *     handler — so both conditions are read here.
   *   - Sending as a domain goes to the IDENTITY route, whose write gate is
   *     `org.settings` alone. It also refuses an unverified domain, which is
   *     a state this list can already see, so it is named rather than
   *     discovered.
   */
  const domainActions = useCallback(
    (record: SendingIdentityView['domains'][number]): RowActionsMenuItem[] => {
      const working = Boolean(domainBusy)
      const manage = view?.canManage === true
      const entitled = view?.entitled === true
      const selected = view?.selected === record.domain
      const orgAdminReason =
        'Managing sending domains needs the organization admin role.'
      const domainRouteReason = !manage
        ? orgAdminReason
        : !entitled
          ? 'Managing sending domains needs a plan that carries sending as ' +
            'your own domain.'
          : ''

      return [
        {
          key: 'open',
          label: 'Open domain',
          icon: <MdiIcon path={mdiDnsOutline.path} size={0.8} />,
          // An `href`, so the domain's page is middle-clickable and copyable
          // like any other link rather than only reachable by this handler.
          href: domainPath(record.domain),
        },
        {
          key: 'verify',
          label: 'Check DNS',
          icon: <MdiIcon path={mdiRefresh.path} size={0.8} />,
          disabled:
            working || record.status === 'requested' || Boolean(domainRouteReason),
          disabledReason:
            record.status === 'requested'
              ? 'No records have been issued for this domain yet, so there ' +
                'is nothing to look for. Open it to see what it is waiting on.'
              : domainRouteReason || undefined,
          onClick: () => void handleVerifyDomain(record.domain),
        },
        {
          key: 'use',
          label: 'Send this site’s email as this domain',
          icon: <MdiIcon path={mdiEmailCheckOutline.path} size={0.8} />,
          disabled:
            working || selected || record.status !== 'verified' || !manage,
          disabledReason: selected
            ? 'This site already sends as this domain.'
            : record.status !== 'verified'
              ? 'Only a verified domain can be sent as. Publish its records ' +
                'and check DNS first.'
              : !manage
                ? 'Choosing what this site sends as needs the organization ' +
                  'admin role.'
                : undefined,
          onClick: () => void handleUseDomain(record.domain),
        },
        {
          key: 'release',
          label: 'Remove domain',
          icon: <MdiIcon path={mdiDeleteOutline.path} size={0.8} />,
          destructive: true,
          disabled: working || Boolean(domainRouteReason),
          disabledReason: domainRouteReason || undefined,
          onClick: () => void handleReleaseDomain(record.domain),
        },
      ]
    },
    [
      domainBusy,
      domainPath,
      view?.canManage,
      view?.entitled,
      view?.selected,
      handleVerifyDomain,
      handleUseDomain,
      handleReleaseDomain,
    ],
  )

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
          {'Campaigns send on the shared address too. Its delivery ' +
            'reputation is pooled with the other sites on it, so campaigns ' +
            'there are held to tighter complaint and bounce limits — a ' +
            'domain of this site’s own lifts that, and is the name your ' +
            'recipients will recognize.'}
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
            {/*
              The card's own help affordance points at the domain half, which
              is what the header is about. A site's senders are a different
              question with a section of their own, so the block that asks it
              carries its own tip rather than sending a reader to the top of a
              page about domains.
             */}
            <Stack
              direction="row"
              spacing={0.5}
              sx={{ alignItems: 'center' }}
            >
              <Typography variant="body2" sx={{ fontWeight: 'bold' }}>
                {'Senders'}
              </Typography>
              <HelpTip
                {...pluginDocsHelp('emailCampaigns', {
                  anchor: '#senders',
                  title: 'Senders',
                  excerpt:
                    'The addresses this site may send as — a mailbox, a name ' +
                    'and a reply address each. A campaign picks one; the ' +
                    'default is what an email that names no other goes out as.',
                })}
              />
            </Stack>
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
          THE THREE PLACES A SITE'S MAIL CAN LEAVE FROM, AND WHICH OF THEM IS
          A PROMISE.

          It read as "two ways to get one", which was two errors in four words.
          The shared address is not a way to get a domain and is not an absence
          of one either — it is where every site starts, it needs nothing, and
          it is the only one of the three that is always available. Leaving it
          out of the list made the two that are conditional read as the whole
          of the model, so a site that had neither looked broken.

          The order is what is guaranteed, then what a merchant can take, then
          what they can ask for. That ranking is the honest one and it is not
          the order of preference somebody would guess: the domain a CUSTOMER
          owns is the better `From:` line AND the one nothing on our side can
          hold up, because it costs our zone nothing.

          A domain we set up is last because it is the one this card must not
          oversell. The plan admits the REQUEST; the provider's account-wide
          domain allowance decides whether it is filled, and a claim made with
          no room waits. It used to arrive by itself — at site creation, on the
          upgrade webhook, from a sweep — so a merchant who upgraded may be
          looking for something that is now a button, which is the other half
          of what these sentences have to say.

          Plan names come from the server, which derives them from the
          entitlement tables. A tier written in here is pricing copy that keeps
          rendering after the gate beneath it moves.
         */}
        {view ? (
          <>
            <Divider />
            {/*
              Pointed at the section that says a domain we set up is asked for
              rather than included, which is the thing a merchant most needs
              before they choose between the two conditional options and the
              thing that reads worst when it is discovered afterwards.
             */}
            <Stack
              direction="row"
              spacing={0.5}
              sx={{ alignItems: 'center' }}
            >
              <Typography variant="body2" sx={{ fontWeight: 'bold' }}>
                {'Where this site’s mail can leave from'}
              </Typography>
              <HelpTip
                {...pluginDocsHelp('emailCampaigns', {
                  anchor: '#a-domain-we-set-up-is-a-request',
                  title: 'A domain we set up is asked for',
                  excerpt:
                    'The shared address is always there. A domain you own you ' +
                    'add yourself. A domain we set up is a request against a ' +
                    'limited allowance, so it can wait — receipts and account ' +
                    'email keep sending whichever you are on.',
                })}
              />
            </Stack>
            <Typography variant="body2" color="text.secondary">
              <Typography
                component="span"
                variant="body2"
                sx={{ fontWeight: 'bold' }}
              >
                {'The shared Aglyn address. '}
              </Typography>
              {'Every plan, nothing to set up, and the one thing here you are ' +
                'never waiting for. It carries receipts and account email ' +
                'only, and its sending reputation is shared with the other ' +
                'sites on it rather than being this site’s.'}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              <Typography
                component="span"
                variant="body2"
                sx={{ fontWeight: 'bold' }}
              >
                {'A domain you already own. '}
              </Typography>
              {(view.customDomainPlan
                ? `Sending as your own domain starts on the ${view.customDomainPlan} plan. `
                : '') +
                'Your own name in the From: line and a sending reputation ' +
                'that is entirely yours. The trade is the DNS work: you ' +
                'publish three records in your zone, and we never write to ' +
                'it. Nothing on our side can hold this one up.'}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              <Typography
                component="span"
                variant="body2"
                sx={{ fontWeight: 'bold' }}
              >
                {'A domain we set up. '}
              </Typography>
              {view.platformDomain
                ? `This site has one — ${view.platformDomain} — with no ` +
                  'records for you to publish, and the sending reputation on ' +
                  'it is this site’s alone. Recipients see an address on our ' +
                  'domain rather than on yours.'
                : 'Nothing for you to publish, and a sending reputation this ' +
                  'site holds alone; recipients see an address on our domain ' +
                  'rather than on yours. ' +
                  /*
                   * THE PART A MERCHANT WOULD OTHERWISE FEEL CHEATED BY, said
                   * before they press rather than in the refusal afterwards.
                   *
                   * Each of these domains is a slot in the mail provider's
                   * account-wide allowance plus three records in our own zone.
                   * A card that named a tier and stopped would be promising an
                   * inclusion the platform does not sell — and the sentence
                   * that has to travel with the correction is the one about
                   * what does not stop meanwhile, because "we might not have
                   * room" reads as an outage without it.
                   */
                  (view.dedicatedDomainPlan
                    ? `It needs ${view.dedicatedDomainPlan}, and the plan ` +
                      'admits the request rather than handing you the domain: '
                    : 'It is a request rather than something a plan hands ' +
                      'you: ') +
                  'we hold a limited number of sending domains with our mail ' +
                  'provider, so one asked for when there is no room waits ' +
                  'until there is. Nothing stops while it waits — this site ' +
                  'keeps sending receipts and account email on the address ' +
                  'above, and only campaigns wait with the domain.'}
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
                {/*
                  THE LABEL NAMES WHAT THE PRESS DOES, which is ask.

                  "Set up" promises the outcome, and the outcome is not this
                  button's to promise: creating the domain happens afterwards
                  and can be held at the provider's domain allowance. A label
                  that overstated it would make the waiting state read as a
                  failure of something that had already happened.
                 */}
                {claimingDedicated
                  ? 'Asking…'
                  : view.dedicated.proposed
                    ? `Ask for ${view.dedicated.proposed}`
                    : 'Ask for a domain for this site'}
              </Button>
            ) : null}
            {/*
              A PLAN GATE ON THE DOMAIN IS NOT A GATE ON THE MAIL.

              Said only to the reader it applies to, and said here rather than
              as an alert: the address this site sends account email from is
              already named above, and repeating "you cannot" in a colored box
              would read as an outage on a site that is sending perfectly well.
             */}
            {!view.entitled ? (
              <Typography variant="body2" color="text.secondary">
                {'Account email from this site sends without either of those ' +
                  '— the address is shown above.'}
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
                {/*
                  Named for a screen reader and blank on screen. A visible
                  header over an overflow column labels the menus rather than
                  the data, and every other actions column in this console is
                  headed the same way.
                 */}
                <TableCell align="right">
                  <SrOnly>{'Actions'}</SrOnly>
                </TableCell>
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
                  // The REASON is the exception to that, because one of its
                  // values is not a fault. A claim held at the provider's
                  // domain allowance would otherwise read here as "waiting on
                  // a signing key", whose whole instruction is to press a
                  // button that cannot move it.
                  issueError: record.lastIssueError ?? null,
                })
                return (
                  <TableRow
                    key={record.domain}
                    hover
                    sx={{ cursor: 'pointer' }}
                    onClick={() => router.push(domainPath(record.domain))}
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
                    {/*
                      The overflow, which the menu itself keeps from taking
                      the row's own navigation with it: `RowActionsMenu` stops
                      propagation on open, so pressing the button does not
                      also push the domain's page out from under the menu it
                      just opened.
                     */}
                    <TableCell align="right" padding="none">
                      <RowActionsMenu
                        label={record.domain}
                        items={domainActions(record)}
                      />
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
