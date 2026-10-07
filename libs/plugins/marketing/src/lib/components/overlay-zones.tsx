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

import { useConsoleWidgetSlot } from '@aglyn/aglyn/app-utils/console-widget-slot-context'
import { definePluginZone } from '@aglyn/aglyn/plugin-manager/plugin-zones'
import type {
  OverlayCopyField,
  OverlayCopyProposal,
  OverlayPopupTrigger,
} from '../model/overlay-drafts'
import type { HostOverlay } from '../model/overlays'

/**
 * The two zones the overlays list hosts (AGL-3603).
 *
 * The overlays — announcement bars and popups — are this plugin's: the
 * documents, their schedule, their targeting and the order a visitor meets
 * them in. A plugin that can WRITE copy for one may not be imported here, so
 * the list hosts two positions and says what each hands a widget, drawn by the
 * console shell's own renderer with every gate a console page's slot applies.
 *
 * ## A widget proposes; this plugin writes
 *
 * {@link HOST_OVERLAYS_ZONE}, beside New bar and New popup, hands a widget
 * `createOverlayDraft`. The list cuts what it is handed to the overlay's own
 * limits, writes it SWITCHED OFF through the same site-wide write a typed
 * overlay takes, and opens it in the editor. A visitor sees nothing until a
 * person turns it on.
 *
 * {@link OVERLAY_EDITOR_ZONE}, among the editor's fields, hands a widget the
 * copy as the editor holds it and `proposeValues`, which fills the editor's
 * own fields unsaved. The editor's Save is the only write.
 */

/** The limits and the trigger catalog a widget writes inside, as the list hands them over. */
export interface MarketingOverlayRules {
  limits: Readonly<Record<OverlayCopyField, number>>
  triggers: readonly OverlayPopupTrigger[]
}

/** What `createOverlayDraft` answers: the overlay it wrote, or why it wrote none. */
export type MarketingOverlayDraftResult =
  | { ok: true; id: string }
  | { ok: false; error: string }

/** What {@link HOST_OVERLAYS_ZONE} hands each widget. */
export interface MarketingHostOverlaysZoneProps extends MarketingOverlayRules {
  hostId: string
  /**
   * Writes a new overlay of `kind` from `proposal`, switched off, and opens it
   * in the editor. Refused when the proposal has nothing the overlay needs —
   * a bar's text, a popup's body — or when the write fails.
   */
  createOverlayDraft: (
    kind: HostOverlay['kind'],
    proposal: OverlayCopyProposal,
  ) => Promise<MarketingOverlayDraftResult>
}

/** One overlay's copy as the editor holds it, as typed. */
export interface MarketingOverlayEditorCopy {
  name: string
  /** A bar's text. */
  text: string
  headline: string
  body: string
  ctaLabel: string
  ctaHref: string
  trigger: string
  triggerValue: number | null
}

/** What {@link OVERLAY_EDITOR_ZONE} hands each widget. */
export interface MarketingOverlayEditorZoneProps extends MarketingOverlayRules {
  hostId: string
  /** The overlay's id once it has been saved; empty while it is new. */
  overlayId: string
  kind: HostOverlay['kind']
  copy: MarketingOverlayEditorCopy
  /**
   * Fills the editor's fields with what a widget proposes, unsaved, cut to the
   * limits; a trigger outside the catalog is ignored. `key` identifies the
   * proposal so a widget can tell which of its own the editor is showing.
   */
  proposeValues: (proposal: OverlayCopyProposal, key: string) => void
}

export const HOST_OVERLAYS_ZONE =
  definePluginZone<MarketingHostOverlaysZoneProps>('hostOverlays')

export const OVERLAY_EDITOR_ZONE =
  definePluginZone<MarketingOverlayEditorZoneProps>('overlayEditor')

/** The list's zone, drawn through the shell's renderer, or nothing outside the shell. */
export function HostOverlaysZone(props: MarketingHostOverlaysZoneProps) {
  const Slot = useConsoleWidgetSlot()
  return Slot ? <Slot slot={HOST_OVERLAYS_ZONE.id} {...props} /> : null
}
HostOverlaysZone.displayName = 'HostOverlaysZone'

/** The editor's zone, drawn through the shell's renderer, or nothing outside the shell. */
export function OverlayEditorZone(props: MarketingOverlayEditorZoneProps) {
  const Slot = useConsoleWidgetSlot()
  return Slot ? <Slot slot={OVERLAY_EDITOR_ZONE.id} {...props} /> : null
}
OverlayEditorZone.displayName = 'OverlayEditorZone'
