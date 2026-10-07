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

import type { HostOverlay } from './overlays'

/**
 * Copy proposed for an announcement bar or a popup by something other than a
 * person typing it — a widget in the overlay zones — and the rules it is held
 * to before it reaches an overlay.
 *
 * A proposal is never trusted to be the right length or to name a trigger the
 * site runtime knows: {@link overlayCopyFromProposal} cuts every field to
 * {@link OVERLAY_COPY_LIMITS} and keeps a trigger only when it is one of
 * {@link OVERLAY_POPUP_TRIGGERS}, with its value inside that trigger's range.
 * Links are never proposed: a call to action's destination is a page of the
 * person's own site, which they pick.
 */

/** The longest each overlay field a proposal fills may be, in characters. */
export const OVERLAY_COPY_LIMITS = {
  /** The internal name shown in the overlays list. */
  name: 80,
  /** An announcement bar's one line. */
  text: 160,
  /** A popup's headline. */
  headline: 90,
  /** A popup's body. */
  body: 400,
  /** A popup's button label; the single popup card cuts the label to the same. */
  ctaLabel: 60,
} as const

export type OverlayCopyField = keyof typeof OVERLAY_COPY_LIMITS

/** One way a popup opens, with the unit and the range of the value it reads. */
export interface OverlayPopupTrigger {
  id: NonNullable<NonNullable<HostOverlay['popup']>['trigger']>
  /** How the editor names it. */
  label: string
  /** What `triggerValue` counts, or `null` for a trigger that reads none. */
  unit: 'seconds' | 'percent' | null
  min: number
  max: number
}

/**
 * Every trigger the site runtime opens a popup on: after a delay, once the
 * visitor has scrolled a share of the page, or as they move to leave it.
 */
export const OVERLAY_POPUP_TRIGGERS: readonly OverlayPopupTrigger[] = [
  { id: 'delay', label: 'After a delay', unit: 'seconds', min: 0, max: 120 },
  { id: 'scroll', label: 'On scroll', unit: 'percent', min: 1, max: 100 },
  { id: 'exit', label: 'On exit intent', unit: null, min: 0, max: 0 },
]

/** What a widget proposes for one overlay. Every field is optional. */
export interface OverlayCopyProposal {
  name?: string
  /** An announcement bar's text. */
  text?: string
  headline?: string
  body?: string
  ctaLabel?: string
  trigger?: string
  triggerValue?: number
}

/** A proposal as it may be written: cut to the limits, with a known trigger or none. */
export type OverlayCopyValues = Omit<OverlayCopyProposal, 'trigger'> & {
  trigger?: OverlayPopupTrigger['id']
}

/** One line of copy, on one line, cut to its field's limit. */
function clean(value: unknown, field: OverlayCopyField, multiline = false): string | undefined {
  if (typeof value !== 'string') return undefined
  const folded = multiline
    ? value.replace(/\r\n?/g, '\n').replace(/[^\S\n]+/g, ' ').replace(/\n{3,}/g, '\n\n')
    : value.replace(/\s+/g, ' ')
  const trimmed = folded.trim().slice(0, OVERLAY_COPY_LIMITS[field]).trim()
  return trimmed || undefined
}

/**
 * A proposal held to the overlay's own rules, keeping only the fields the
 * overlay's kind has: a bar has text, a popup a headline, a body, a button
 * label and a trigger.
 */
export function overlayCopyFromProposal(
  kind: HostOverlay['kind'],
  proposal: OverlayCopyProposal,
): OverlayCopyValues {
  const values: OverlayCopyValues = {}
  const name = clean(proposal.name, 'name')
  if (name) values.name = name
  if (kind === 'bar') {
    const text = clean(proposal.text, 'text')
    if (text) values.text = text
    return values
  }
  const headline = clean(proposal.headline, 'headline')
  const body = clean(proposal.body, 'body', true)
  const ctaLabel = clean(proposal.ctaLabel, 'ctaLabel')
  if (headline) values.headline = headline
  if (body) values.body = body
  if (ctaLabel) values.ctaLabel = ctaLabel
  const trigger = OVERLAY_POPUP_TRIGGERS.find((entry) => entry.id === proposal.trigger)
  if (trigger) {
    values.trigger = trigger.id
    if (trigger.unit) {
      const raw = Number(proposal.triggerValue)
      if (Number.isFinite(raw)) {
        values.triggerValue = Math.min(trigger.max, Math.max(trigger.min, Math.round(raw)))
      }
    }
  }
  return values
}

/**
 * A new overlay from a proposal, written SWITCHED OFF: a visitor sees nothing
 * until a person reads it and turns it on. `null` when the proposal has
 * nothing the overlay needs to exist — a bar's text, a popup's body.
 */
export function overlayDraftFromProposal(
  kind: HostOverlay['kind'],
  proposal: OverlayCopyProposal,
): HostOverlay | null {
  const values = overlayCopyFromProposal(kind, proposal)
  if (kind === 'bar') {
    if (!values.text) return null
    return {
      kind: 'bar',
      enabled: false,
      ...(values.name ? { name: values.name } : {}),
      bar: { text: values.text, dismissible: true },
    }
  }
  if (!values.body) return null
  const trigger = values.trigger ?? 'delay'
  return {
    kind: 'popup',
    enabled: false,
    ...(values.name ? { name: values.name } : {}),
    popup: {
      ...(values.headline ? { headline: values.headline } : {}),
      body: values.body,
      ...(values.ctaLabel ? { ctaLabel: values.ctaLabel } : {}),
      trigger,
      ...(trigger === 'exit' ? {} : { triggerValue: values.triggerValue ?? 3 }),
      frequencyDays: 7,
    },
  }
}
