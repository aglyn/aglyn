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
import { collection, limit, query } from 'firebase/firestore'
import { useCallback, useMemo, useState } from 'react'
import {
  useFirestore,
  useFirestoreCollection,
  useUser,
} from '@aglyn/tenant-feature-instance'
import { pluginDocsHelp } from '@aglyn/aglyn'
import { EntitlementGatedCard } from './entitlement-gate.component'

export interface GiftCardsCardProps {
  hostId: string
}

const usd = (cents: number | undefined) => `$${((cents ?? 0) / 100).toFixed(2)}`

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
  const { data: cardDocs } = useFirestoreCollection<any>(
    () => query(collection(firestore, 'hosts', hostId, 'giftCards'), limit(300)),
    [firestore, hostId],
    { idField: '$id' },
  )
  const [search, setSearch] = useState('')
  const [amount, setAmount] = useState('')
  const [recipient, setRecipient] = useState('')
  const [busy, setBusy] = useState(false)

  const { cards, outstandingCents, liveCount } = useMemo(() => {
    const all = [...(cardDocs ?? [])].sort(
      (a: any, b: any) => (b.createdAtMs ?? 0) - (a.createdAtMs ?? 0),
    )
    const term = search.trim().toUpperCase()
    return {
      cards: term
        ? all.filter(
            (card: any) =>
              card.$id.includes(term) ||
              String(card.recipientEmail ?? '').toUpperCase().includes(term),
          )
        : all,
      // Floored at zero per card: a negative balance is a data fault
      // (AGL-1767), not credit the merchant gets back.
      outstandingCents: all.reduce(
        (sum: number, card: any) =>
          sum + Math.max(0, Number(card.balanceCents ?? 0)),
        0,
      ),
      liveCount: all.filter(
        (card: any) => Number(card.balanceCents ?? 0) > 0,
      ).length,
    }
  }, [cardDocs, search])

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
              color={outstandingCents ? 'warning' : 'default'}
              label={`${usd(outstandingCents)} outstanding`}
            />
            <Chip size="small" label={`${liveCount} with a balance`} />
            <Chip size="small" label={`${(cardDocs ?? []).length} issued`} />
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
            label="Find a code or recipient"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            size="small"
            sx={{ maxWidth: 320 }}
          />

          {cards.length ? (
            <Stack spacing={1}>
              {cards.slice(0, 50).map((card: any) => (
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
                ? 'No gift card matches that code or email.'
                : 'No gift cards yet. Sell a gift-card product, or issue one above.'}
            </Typography>
          )}
        </Stack>
      </CardDisplay>
    </EntitlementGatedCard>
  )
}
GiftCardsCard.displayName = 'GiftCardsCard'

export default GiftCardsCard
