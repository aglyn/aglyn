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

import { CardDisplay, useConfirmationContext } from '@aglyn/shared-ui-jsx'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import {
  Button,
  Chip,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import {
  collection,
  count,
  getAggregateFromServer,
  limit,
  orderBy,
  query,
  sum,
  where,
} from 'firebase/firestore'
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  useFirestore,
  usePagedCollection,
  useUser,
} from '@aglyn/tenant-feature-instance'
import { pluginDocsHelp } from '@aglyn/aglyn'
import { EntitlementGatedCard } from './entitlement-gate.component'

export interface GiftCardsCardProps {
  hostId: string
}

const usd = (cents: number | undefined) => `$${((cents ?? 0) / 100).toFixed(2)}`

/** Cards shown before "Load more". */
const CARDS_PAGE_SIZE = 25

const giftCardsHelp = pluginDocsHelp('commerce', {
  anchor: '#gift-cards',
  title: 'Gift cards',
  excerpt:
    'Every gift card your store has issued, what is left on it, and what ' +
    'that adds up to in outstanding store credit.',
})

/**
 * Gift cards & store credit (AGL-2226).
 *
 * `hosts/{hostId}/giftCards` has existed since AGL-322 with no console at
 * either end: `billing-webhook.ts` mints a card when one is bought,
 * `cart-checkout.ts` decrements it at redemption, and nothing in the product
 * ever showed the merchant a code, a balance, or the total they owe.
 *
 * The total is the point. Outstanding gift-card balance is a real liability
 * on the merchant's books, and it was invisible — which is also why AGL-1767
 * (a redemption resurrecting a deleted card at a NEGATIVE balance,
 * understating that liability) could not have been noticed from the console.
 * The sum below deliberately floors each card at zero so a stray negative row
 * cannot flatter the number the way that bug did.
 *
 * Reads are client-side because the Firestore host catch-all already grants
 * them and the merchant wants the list live. The two operations that MOVE
 * MONEY — issue and void — go through `commerce/gift-cards`, because that same
 * catch-all would otherwise let any site admin write their own `balanceCents`
 * and redeem it at checkout.
 */
export function GiftCardsCard(props: GiftCardsCardProps) {
  const { hostId } = props
  const firestore = useFirestore()
  const { data: user } = useUser()
  const { enqueueSnackbar } = useSnackbar()
  const { confirm } = useConfirmationContext()
  /*
   * Ordered by the server, and a growing window rather than a fixed 300.
   *
   * `limit(300)` with no `orderBy` returns DOCUMENT-ID order, and a gift card
   * is keyed by its CODE, so the window was three hundred cards chosen by
   * code — sorted by date afterwards to look newest-first. Past three hundred
   * cards, one issued this morning was not in it.
   */
  const {
    rows: allCards,
    hasMore,
    loadMore,
  } = usePagedCollection<any>(
    (pageLimit) =>
      query(
        collection(firestore, 'hosts', hostId, 'giftCards'),
        orderBy('createdAtMs', 'desc'),
        limit(pageLimit),
      ),
    [firestore, hostId],
    { idField: '$id', pageSize: CARDS_PAGE_SIZE },
  )
  const [search, setSearch] = useState('')
  const [amount, setAmount] = useState('')
  const [recipient, setRecipient] = useState('')
  const [busy, setBusy] = useState(false)

  const cards = useMemo(() => {
    const term = search.trim().toUpperCase()
    if (!term) return allCards
    return allCards.filter(
      (card: any) =>
        card.$id.includes(term) ||
        String(card.recipientEmail ?? '').toUpperCase().includes(term),
    )
  }, [allCards, search])

  /*==========================================
   * OUTSTANDING LIABILITY IS A SERVER AGGREGATE, not a page total.
   *
   * These two numbers are what the merchant owes their customers, and they
   * were `reduce`d over whatever the window happened to hold — 300 cards
   * chosen by code. A shop with 400 gift cards under-reported its own
   * liability and had no way to know: the chip does not say "of the cards on
   * screen", and there is no reading of "$X outstanding" under which a
   * sample is the answer.
   *
   * `where('balanceCents','>',0)` IS the per-card floor the reduce applied
   * by hand. A negative balance is a data fault (AGL-1767), not credit the
   * merchant gets back; excluding it contributes zero, exactly as flooring
   * it did. Zero-balance cards contribute nothing either way and are what
   * `liveCount` was already counting.
   *
   * An aggregation is billed per 1,000 documents scanned rather than per
   * document, so this is cheaper than the read it replaces as well as
   * correct.
   *=========================================*/
  const [totalsEpoch, setTotalsEpoch] = useState(0)
  const [totals, setTotals] = useState<{
    outstandingCents: number
    liveCount: number
    issuedCount: number
  } | null>(null)
  useEffect(() => {
    let active = true
    const cardsRef = collection(firestore, 'hosts', hostId, 'giftCards')
    void Promise.all([
      getAggregateFromServer(query(cardsRef, where('balanceCents', '>', 0)), {
        outstandingCents: sum('balanceCents'),
        liveCount: count(),
      }),
      // "Issued" is every card ever, so this one carries no predicate.
      getAggregateFromServer(cardsRef, { issuedCount: count() }),
    ])
      .then(([balances, issued]) => {
        if (!active) return
        setTotals({
          outstandingCents: Number(balances.data().outstandingCents ?? 0),
          liveCount: Number(balances.data().liveCount ?? 0),
          issuedCount: Number(issued.data().issuedCount ?? 0),
        })
      })
      .catch(() => {
        // Held at null rather than zeroed. "$0.00 outstanding" is a
        // confident wrong number in the flattering direction; an absent one
        // renders as unknown and cannot be mistaken for a settled book.
        if (active) setTotals(null)
      })
    return () => {
      active = false
    }
  }, [firestore, hostId, totalsEpoch])

  const post = useCallback(
    async (payload: Record<string, unknown>, success: (body: any) => string) => {
      setBusy(true)
      try {
        const idToken = await (user as any)?.getIdToken?.()
        const response = await fetch('/api/commerce/gift-cards', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
          },
          body: JSON.stringify({ hostId, ...payload }),
        })
        const body = await response.json().catch(() => ({}))
        if (!response.ok) {
          return void enqueueSnackbar(body?.error ?? 'Gift card action failed', {
            variant: 'error',
            allowDuplicate: true,
          })
        }
        enqueueSnackbar(success(body), { variant: 'success', persist: false })
        // Issuing, voiding or adjusting moves the liability. The list is a
        // live listener and updates itself; the aggregate is a one-shot read
        // and would otherwise keep reporting the balance from before.
        setTotalsEpoch((epoch) => epoch + 1)
      } finally {
        setBusy(false)
      }
    },
    [user, hostId, enqueueSnackbar],
  )

  const handleIssue = useCallback(async () => {
    const dollars = Number(amount)
    if (!Number.isFinite(dollars) || dollars <= 0) {
      return void enqueueSnackbar('Enter an amount above zero', {
        variant: 'error',
        allowDuplicate: true,
      })
    }
    await post(
      {
        action: 'issue',
        amountCents: Math.round(dollars * 100),
        recipientEmail: recipient.trim(),
      },
      (body) =>
        body.emailed
          ? `Issued ${body.code} — emailed to ${recipient.trim()}`
          : `Issued ${body.code}`,
    )
    setAmount('')
    setRecipient('')
  }, [amount, recipient, post, enqueueSnackbar])

  const handleVoid = useCallback(
    async (card: any) => {
      // This provider REJECTS on dismissal rather than resolving false, so
      // the `.then/.catch` pair is the read — awaiting the promise bare would
      // throw out of the handler on a cancel.
      const confirmed = await confirm({
        title: `Void ${card.$id}?`,
        description:
          `This zeroes the ${usd(card.balanceCents)} left on the card. The ` +
          'holder will no longer be able to redeem it, and it cannot be undone.',
        confirmationText: 'Void gift card',
        confirmationButtonProps: { color: 'error' },
      })
        .then(() => true)
        .catch(() => false)
      if (!confirmed) return
      await post({ action: 'void', code: card.$id }, () => `${card.$id} voided`)
    },
    [confirm, post],
  )

  return (
    <EntitlementGatedCard
      help={giftCardsHelp}
      hostId={hostId}
      feature="giftCards"
      header={'Gift cards'}
      upsell={
        'Gift cards let shoppers buy store credit for someone else, and let ' +
        'you issue credit by hand for a goodwill gesture or a service ' +
        'recovery. Balances apply automatically at checkout.'
      }
    >
      <CardDisplay
        header={'Gift cards'}
        help={giftCardsHelp}
        contentGutterX
        contentGutterY
      >
        <Stack spacing={2}>
          <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
            <Chip
              size="small"
              color={totals?.outstandingCents ? 'warning' : 'default'}
              label={
                totals
                  ? `${usd(totals.outstandingCents)} outstanding`
                  : 'Outstanding unavailable'
              }
            />
            {totals ? (
              <Chip
                size="small"
                label={`${totals.liveCount} with a balance`}
              />
            ) : null}
            {totals ? (
              <Chip size="small" label={`${totals.issuedCount} issued`} />
            ) : null}
          </Stack>
          <Typography variant="caption" color="text.secondary">
            {'Outstanding balance is store credit your customers have already ' +
              'paid for and not yet spent — it is a liability, not revenue.'}
          </Typography>

          <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
            <TextField
              label="Issue amount (USD)"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              size="small"
              type="number"
              sx={{ maxWidth: 180 }}
            />
            <TextField
              label="Email it to (optional)"
              value={recipient}
              onChange={(event) => setRecipient(event.target.value)}
              size="small"
              sx={{ minWidth: 240 }}
            />
            <Button
              variant="contained"
              size="small"
              disabled={busy || !amount}
              onClick={handleIssue}
            >
              {'Issue card'}
            </Button>
          </Stack>

          <TextField
            label="Find in the cards below"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            size="small"
            sx={{ maxWidth: 320 }}
          />

          {cards.length ? (
            <Stack spacing={1}>
              {cards.map((card: any) => (
                <Stack
                  key={card.$id}
                  direction="row"
                  spacing={1}
                  useFlexGap
                  sx={{ flexWrap: 'wrap', alignItems: 'center' }}
                >
                  <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
                    {card.$id}
                  </Typography>
                  <Chip
                    size="small"
                    color={
                      Number(card.balanceCents ?? 0) > 0 ? 'success' : 'default'
                    }
                    label={`${usd(card.balanceCents)} of ${usd(card.initialCents)}`}
                  />
                  {card.recipientEmail ? (
                    <Typography variant="body2" color="text.secondary">
                      {card.recipientEmail}
                    </Typography>
                  ) : null}
                  {card.orderId ? null : (
                    <Chip size="small" variant="outlined" label={'Issued by hand'} />
                  )}
                  {card.voidedAtMs ? (
                    <Chip size="small" variant="outlined" label={'Voided'} />
                  ) : Number(card.balanceCents ?? 0) > 0 ? (
                    <Button
                      size="small"
                      color="error"
                      disabled={busy}
                      onClick={() => handleVoid(card)}
                    >
                      {'Void'}
                    </Button>
                  ) : null}
                </Stack>
              ))}
            </Stack>
          ) : (
            <Typography variant="body2" color="text.secondary">
              {search
                ? 'No gift card loaded so far matches that code or email — ' +
                  'load more to search further back.'
                : 'No gift cards yet. Sell a gift-card product, or issue one above.'}
            </Typography>
          )}
          {hasMore ? (
            <Button
              size="small"
              sx={{ alignSelf: 'flex-start' }}
              onClick={loadMore}
            >
              {'Load more'}
            </Button>
          ) : null}
        </Stack>
      </CardDisplay>
    </EntitlementGatedCard>
  )
}
GiftCardsCard.displayName = 'GiftCardsCard'

export default GiftCardsCard
