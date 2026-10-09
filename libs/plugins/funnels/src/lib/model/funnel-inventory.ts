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

import type { SiteJourneyStepType } from '@aglyn/aglyn/app-utils/site-journey-steps'
import { funnelStepTitle } from './funnel-definition'
import type { FunnelStep } from './funnels.types'

/**
 * What a site has that a funnel step can name: its routed pages and the
 * records the step pickers list. The editor's pickers draw from it, and the
 * save route and the AI proposal check every step against it, so a funnel
 * cannot name a page the site does not serve or a form it does not have.
 */
export interface FunnelInventoryItem {
  id: string
  name: string
}

export interface FunnelInventory {
  /** Every path the site routes, sorted. */
  pages: string[]
  forms: FunnelInventoryItem[]
  services: FunnelInventoryItem[]
  products: FunnelInventoryItem[]
  overlays: FunnelInventoryItem[]
}

export const EMPTY_FUNNEL_INVENTORY: FunnelInventory = {
  pages: [],
  forms: [],
  services: [],
  products: [],
  overlays: [],
}

/** The inventory list a step type picks from, or null for types with none. */
export function inventoryListFor(
  inventory: FunnelInventory,
  type: SiteJourneyStepType,
): FunnelInventoryItem[] | null {
  switch (type) {
    case 'form':
      return inventory.forms
    case 'booking':
      return inventory.services
    case 'cart':
      return inventory.products
    case 'overlay':
      return inventory.overlays
    default:
      return null
  }
}

/**
 * Why a step names something the site does not have, or null. A custom event
 * and an order name nothing to check, and "any" of a kind is always fine.
 */
export function stepInventoryProblem(
  step: FunnelStep,
  inventory: FunnelInventory,
): string | null {
  if (step.type === 'page') {
    if (step.match === 'prefix') {
      const covered =
        step.key === '/' ||
        inventory.pages.some((path) => path === step.key || path.startsWith(`${step.key}/`))
      return covered ? null : `No page on this site is at or under ${step.key}.`
    }
    return inventory.pages.includes(step.key) ? null : `This site has no page at ${step.key}.`
  }
  const list = inventoryListFor(inventory, step.type)
  if (!list || !step.key) return null
  return list.some((item) => item.id === step.key)
    ? null
    : `${funnelStepTitle({ ...step, label: undefined })} is not on this site.`
}

/** A step's label from the inventory, when the step has none of its own. */
export function labelStepFromInventory(step: FunnelStep, inventory: FunnelInventory): FunnelStep {
  if (step.label) return step
  const item = inventoryListFor(inventory, step.type)?.find((one) => one.id === step.key)
  return item ? { ...step, label: item.name } : step
}
