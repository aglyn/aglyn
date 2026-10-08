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

import Box from '@mui/material/Box'
import Checkbox from '@mui/material/Checkbox'
import FormControlLabel from '@mui/material/FormControlLabel'
import Link from '@mui/material/Link'
import Typography from '@mui/material/Typography'
import { useCallback, useEffect, useMemo, useState } from 'react'

/**
 * Optional lines another plugin offers at the cart (AGL-3635), as boxes the
 * shopper ticks — package protection is the first. The offers come from
 * `GET /api/commerce/cart-extras`, asked only while the cart is on screen
 * and again whenever its lines change; the checkout asks the provider again
 * for the price it charges, so what is shown here is never what is trusted.
 * A store with no offering plugin gets an empty answer and draws nothing.
 */

export interface CartExtraOffer {
  id: string
  label: string
  description?: string
  amountCents: number
  defaultSelected: boolean
  termsUrl?: string
}

export function useCartExtras(hostId: string | undefined, cartSignature: string) {
  const [offers, setOffers] = useState<CartExtraOffer[]>([])
  const [chosen, setChosen] = useState<Record<string, boolean>>({})
  const [round, setRound] = useState(0)
  useEffect(() => {
    if (!hostId || cartSignature === '[]') {
      setOffers([])
      return
    }
    let live = true
    fetch(`/api/commerce/cart-extras?hostId=${encodeURIComponent(hostId)}`)
      .then((response) => (response.ok ? response.json() : { extras: [] }))
      .then((payload: { extras?: CartExtraOffer[] }) => {
        if (!live) return
        const next = Array.isArray(payload?.extras) ? payload.extras : []
        setOffers(next)
        // A box the shopper already touched keeps their answer.
        setChosen((prior) =>
          Object.fromEntries(next.map((offer) => [offer.id, prior[offer.id] ?? offer.defaultSelected])),
        )
      })
      .catch(() => live && setOffers([]))
    return () => {
      live = false
    }
  }, [hostId, cartSignature, round])
  const chosenIds = useMemo(
    () => offers.filter((offer) => chosen[offer.id]).map((offer) => offer.id),
    [offers, chosen],
  )
  const toggle = useCallback((id: string, value: boolean) => {
    setChosen((prior) => ({ ...prior, [id]: value }))
  }, [])
  /** Asks again — after the checkout said an offer changed. */
  const reload = useCallback(() => setRound((value) => value + 1), [])
  return { offers, chosen, chosenIds, toggle, reload }
}

export function CartExtras(props: {
  offers: CartExtraOffer[]
  chosen: Record<string, boolean>
  onToggle: (id: string, value: boolean) => void
  formatCents: (cents: number) => string
}) {
  const { offers, chosen, onToggle, formatCents } = props
  if (!offers.length) return null
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
      {offers.map((offer) => (
        <Box key={offer.id}>
          <FormControlLabel
            control={
              <Checkbox
                size="small"
                checked={Boolean(chosen[offer.id])}
                onChange={(event) => onToggle(offer.id, event.target.checked)}
              />
            }
            label={
              <Typography variant="body2">
                {`${offer.label} (${formatCents(offer.amountCents)})`}
              </Typography>
            }
          />
          {offer.description || offer.termsUrl ? (
            <Typography variant="caption" color="text.secondary" component="p" sx={{ ml: 4 }}>
              {offer.description ?? ''}
              {offer.termsUrl ? (
                <>
                  {offer.description ? ' ' : ''}
                  <Link href={offer.termsUrl} target="_blank" rel="noopener noreferrer">
                    {'Details'}
                  </Link>
                </>
              ) : null}
            </Typography>
          ) : null}
        </Box>
      ))}
    </Box>
  )
}
