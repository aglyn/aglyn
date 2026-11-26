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

import { authorizedFetch } from '@aglyn/shared-util-http/authorized-token'
import { useEffect, useMemo, useState } from 'react'
import { useUser } from '@aglyn/tenant-feature-instance'
import * as CommerceModel from '../../model'

/** What a console surface prices other currencies from (AGL-4248). */
export interface ConsoleCurrencySetup {
  /** The store currency, upper case. */
  base: string
  /** The currencies the store sells in besides its own, as saved. */
  others: CommerceModel.StoreCurrency[]
  /** Every rate the platform holds, or undefined before (or without) an answer. */
  rates: CommerceModel.FxRates | undefined
  /** The settings as stored, for a card that edits them. */
  settings: CommerceModel.StoreCurrencySettings | undefined
}

const NONE: CommerceModel.StoreCurrency[] = []

/**
 * The store's currency setup and the day's rates, from
 * `GET commerce/currency?setup=1`. One request per mount, and none while
 * `enabled` is false (a closed dialog costs nothing). A failed request is a
 * store that sells in its own currency only: every per-currency field stays
 * hidden rather than guessing.
 */
export function useCurrencySetup(hostId: string, enabled = true): ConsoleCurrencySetup {
  const { data: user } = useUser()
  const [answer, setAnswer] = useState<CommerceModel.CurrencySetupAnswer | null>(null)
  useEffect(() => {
    if (!enabled || !hostId) return undefined
    let live = true
    Promise.resolve()
      .then(() =>
        authorizedFetch(
          user,
          `/api/commerce/currency?hostId=${encodeURIComponent(hostId)}&setup=1`,
        ),
      )
      .then((response) => (response?.ok ? response.json() : null))
      .then((payload: CommerceModel.CurrencySetupAnswer | null) => {
        if (live && payload?.base) setAnswer(payload)
      })
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [hostId, user, enabled])
  return useMemo(() => {
    const base = answer?.base ?? 'USD'
    const settings = answer?.settings ?? undefined
    const others = answer ? CommerceModel.otherStoreCurrencies(settings, base) : NONE
    return { base, others, rates: answer?.allRates ?? undefined, settings }
  }, [answer])
}
