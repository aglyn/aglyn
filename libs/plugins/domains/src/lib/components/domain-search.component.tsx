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

import { BlockedControl } from '@aglyn/shared-ui-jsx/components/blocked-control.component'
import {
  Alert,
  Button,
  CircularProgress,
  InputAdornment,
  List,
  ListItem,
  ListItemText,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { useEffect, useRef, useState } from 'react'
import { DOMAINS_API_ROUTES } from '../constants/bundle-common'
import {
  DomainsRequestError,
  formatMoney,
  useDomainsFetch,
  type DomainOfferView,
  type DomainsScope,
} from './domains-api'

/*
 * THE NAME SEARCH (AGL-3962), as the site's Get a domain card and the
 * workspace's Buy a domain dialog both draw it (AGL-4040): type, see each
 * name with this year's price and every year's after, pick one.
 */

/** Results shown before "Show more". */
const FIRST_RESULTS = 6

/** "$15.99 a year", or the first year and the renewal when they differ. */
export function priceLine(offer: DomainOfferView): string {
  if (offer.firstYearCents === offer.renewalCents) {
    return `${formatMoney(offer.firstYearCents)} a year`
  }
  return `${formatMoney(offer.firstYearCents)} the first year, then ${formatMoney(offer.renewalCents)} a year`
}

export interface DomainSearchProps {
  scope: DomainsScope
  /** Buying is not possible now; the Buy buttons say why on hover. */
  blocked: boolean
  blockedReason: string
  /** A name to open the box with, searched once. */
  prefill?: string
  onBuy: (offer: DomainOfferView) => void
  /** Bumped by the caller to clear the box after a purchase. */
  resetKey?: number
}

export function DomainSearch(props: DomainSearchProps) {
  const { scope, blocked, blockedReason, prefill, onBuy, resetKey } = props
  const request = useDomainsFetch()
  const [query, setQuery] = useState('')
  const [offers, setOffers] = useState<DomainOfferView[] | null>(null)
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)
  const [showAll, setShowAll] = useState(false)
  const latestQuery = useRef('')
  const prefilled = useRef(false)
  const scopeKey = JSON.stringify(scope)

  // Setting the query is the search, once; nothing else re-runs it.
  useEffect(() => {
    if (prefilled.current || !prefill) return
    prefilled.current = true
    setQuery(prefill)
  }, [prefill])

  useEffect(() => {
    if (resetKey) setQuery('')
  }, [resetKey])

  // Search as they type, the last query winning.
  useEffect(() => {
    const value = query.trim()
    latestQuery.current = value
    setShowAll(false)
    if (value.length < 2) {
      setOffers(null)
      setSearchError(null)
      return
    }
    const timer = setTimeout(async () => {
      setSearching(true)
      setSearchError(null)
      try {
        const answer = await request<{ offers: DomainOfferView[] }>(DOMAINS_API_ROUTES.search, {
          query: { ...(JSON.parse(scopeKey) as Record<string, string>), q: value },
        })
        if (latestQuery.current === value) setOffers(answer.offers)
      } catch (caught) {
        if (latestQuery.current === value) {
          setOffers(null)
          setSearchError(
            caught instanceof DomainsRequestError ? caught.message : 'Search isn’t answering right now.',
          )
        }
      } finally {
        if (latestQuery.current === value) setSearching(false)
      }
    }, 450)
    return () => clearTimeout(timer)
  }, [query, scopeKey, request])

  const visible = offers ? (showAll ? offers : offers.slice(0, FIRST_RESULTS)) : []

  return (
    <Stack spacing={2}>
      <TextField
        label="Search for a domain"
        placeholder="Your business name, or yourbusiness.com"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        slotProps={{
          input: {
            endAdornment: searching ? (
              <InputAdornment position="end">
                <CircularProgress size={18} />
              </InputAdornment>
            ) : undefined,
          },
        }}
      />
      {searchError ? <Alert severity="warning">{searchError}</Alert> : null}
      {offers && offers.length === 0 && !searching ? (
        <Typography variant="body2" color="text.secondary">
          {'No names to offer for that. Try a shorter version of the name.'}
        </Typography>
      ) : null}
      {visible.length ? (
        <List disablePadding>
          {visible.map((offer) => (
            <ListItem
              key={offer.domain}
              divider
              disableGutters
              secondaryAction={
                offer.available ? (
                  <BlockedControl blocked={blocked} reason={blockedReason}>
                    <Button variant="outlined" size="small" onClick={() => onBuy(offer)}>
                      {'Buy'}
                    </Button>
                  </BlockedControl>
                ) : (
                  <Typography variant="body2" color="text.disabled">
                    {'Taken'}
                  </Typography>
                )
              }
            >
              <ListItemText
                primary={offer.domain}
                slotProps={{
                  primary: { sx: { fontWeight: 'fontWeightBold', color: offer.available ? undefined : 'text.disabled' } },
                }}
                secondary={offer.available ? priceLine(offer) : 'Someone already owns this name'}
              />
            </ListItem>
          ))}
        </List>
      ) : null}
      {offers && offers.length > FIRST_RESULTS && !showAll ? (
        <Button size="small" onClick={() => setShowAll(true)} sx={{ alignSelf: 'flex-start' }}>
          {`Show ${offers.length - FIRST_RESULTS} more`}
        </Button>
      ) : null}
    </Stack>
  )
}
