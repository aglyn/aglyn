'use client'

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

import type { ConsoleWidgetEntitlementProps } from '@aglyn/aglyn/plugin-manager/feature-plugins'
import { mdiCreation } from '@aglyn/shared-data-mdi'
import { MdiIcon } from '@aglyn/shared-ui-jsx'
import { Button } from '@mui/material'
import { useCallback, useSyncExternalStore } from 'react'
import type { ConsoleProductsCreateZoneProps } from './ai-product-zones'
import { AiUpsellButton } from './ai-upsell-dialog.component'

/**
 * "Create with AI" for products (AGL-3596), beside Add product and in the
 * empty catalog, through the commerce plugin's `productsCreate` zone.
 *
 * Products from a brief are already the products hub card's ("Propose
 * products", AGL-2916): the card starts the `products` job, and the proposal
 * is reviewed in its table and written through the hub's own writes, which
 * only the `productsHub` zone hands a widget. So this button is a door to
 * that brief, not a second flow: the card registers an opener for its site
 * as it mounts, and the button shows only while one is registered — never
 * where the card could not take the brief, or would not show the proposal.
 * Both are drawn from the shell's gates alone (AGL-3601), so nothing asks a
 * server until the brief is sent; on a plan without the AI add-on the button
 * opens the add-on's dialog instead.
 */

type Opener = () => void

/** The open hub cards' brief openers, by site. */
const openers = new Map<string, Set<Opener>>()
const subscribers = new Set<() => void>()

function notify() {
  for (const subscriber of subscribers) subscriber()
}

/** The products hub card offers its "Propose products" brief for a site; returns the release. */
export function registerAiProductsBriefOpener(hostId: string, open: Opener): () => void {
  const set = openers.get(hostId) ?? new Set<Opener>()
  set.add(open)
  openers.set(hostId, set)
  notify()
  return () => {
    set.delete(open)
    if (!set.size) openers.delete(hostId)
    notify()
  }
}

/** Opens the newest card's brief for the site; `false` when no card offers one. */
export function openAiProductsBrief(hostId: string): boolean {
  const set = openers.get(hostId)
  if (!set?.size) return false
  ;[...set][set.size - 1]()
  return true
}

function subscribe(onChange: () => void) {
  subscribers.add(onChange)
  return () => {
    subscribers.delete(onChange)
  }
}

/** Whether a hub card on this site takes the brief right now. */
export function useAiProductsBriefAvailable(hostId: string): boolean {
  const read = useCallback(() => Boolean(openers.get(hostId)?.size), [hostId])
  return useSyncExternalStore(subscribe, read, () => false)
}

export function AiCreateProductsButton({
  hostId,
  entitled,
  upgrade,
}: ConsoleProductsCreateZoneProps & ConsoleWidgetEntitlementProps) {
  const available = useAiProductsBriefAvailable(hostId)
  if (entitled === false) return upgrade ? <AiUpsellButton kind="product" upgrade={upgrade} /> : null
  if (!available) return null
  return (
    <Button
      size="small"
      variant="outlined"
      startIcon={<MdiIcon path={mdiCreation.path} />}
      onClick={() => openAiProductsBrief(hostId)}
    >
      {'Create with AI'}
    </Button>
  )
}

export default AiCreateProductsButton
