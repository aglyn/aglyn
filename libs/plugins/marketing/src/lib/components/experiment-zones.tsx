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

import {
  type ConsoleWidgetSlotRenderer,
  useConsoleWidgetSlot,
} from '@aglyn/aglyn/app-utils/console-widget-slot-context'
import { definePluginZone } from '@aglyn/aglyn/plugin-manager/plugin-zones'
import type { ExperimentTarget, ExperimentVariant } from '../model/experiments'

/**
 * The two zones the A/B testing card hosts (AGL-2914).
 *
 * A/B testing is this plugin's: the experiment document, its variants, the
 * traffic split, the counters and the comparison. What it never had was
 * anyone to help WRITE the variants or READ the result in words, and the
 * plugin that could do both may not be imported here any more than this one
 * may be imported there.
 *
 * So the card hosts two positions and says what each hands a widget. A
 * widget is drawn by the console shell's own renderer, through the context it
 * hands down, so every gate a console page's slot applies — the plugins this
 * workspace has, the entitlement the widget declares, the permission its
 * reader must hold — applies here unchanged. Outside the shell the context is
 * `null` and a zone draws nothing, which is also what a workspace with no
 * widget for the zone gets: the card renders exactly as it did before these
 * positions existed.
 *
 * ## A widget proposes; this card writes
 *
 * {@link EXPERIMENT_VARIANTS_ZONE} hands a widget the experiment being
 * edited and a `proposeVariants` callback. The callback fills the editor's
 * OWN fields, unsaved, and the dialog's Save is the only write — the same
 * guarded write a typed variant takes. Nothing a widget returns reaches
 * Firestore, starts a test or moves a visitor.
 *
 * {@link EXPERIMENT_RESULT_ZONE} hands a widget the test whose results are
 * open, by the name the results figures label it with, so a widget that
 * explains a result is looking at the same test the reader is. It takes no
 * callback: there is nothing to apply to an explanation.
 */

/** One variant as the editor holds it, for a widget writing alternatives to it. */
export interface MarketingExperimentVariantDraft {
  id: string
  name: string
  /** A screen or section variant's copy is its screen version, so it carries none here. */
  subject: string
  body: string
}

/** What {@link EXPERIMENT_VARIANTS_ZONE} hands each widget. */
export interface MarketingExperimentVariantsZoneProps {
  hostId: string
  /** The experiment's id once it has been saved; empty while it is new. */
  experimentId: string
  /** The experiment's name as the editor holds it. */
  name: string
  target: ExperimentTarget
  /** The conversion event the test counts, as the goal names it. */
  goal: string
  variants: MarketingExperimentVariantDraft[]
  /**
   * Fills the editor's variant fields with what a widget proposes, unsaved.
   * `key` identifies the proposal so a widget can tell which of its own the
   * editor is showing. Variants past the ones the editor holds are ignored:
   * the editor's list is the test's shape and a widget does not change it.
   */
  proposeVariants: (
    variants: readonly MarketingExperimentVariantDraft[],
    key: string,
  ) => void
}

/** What {@link EXPERIMENT_RESULT_ZONE} hands each widget. */
export interface MarketingExperimentResultZoneProps {
  hostId: string
  experimentId: string
  /** The test's name as the results figures label it, which is how a reader names one. */
  test: string
}

export const EXPERIMENT_VARIANTS_ZONE =
  definePluginZone<MarketingExperimentVariantsZoneProps>('experimentVariants')

export const EXPERIMENT_RESULT_ZONE =
  definePluginZone<MarketingExperimentResultZoneProps>('experimentResult')

/**
 * Draws a hosted zone through the shell's renderer, or nothing at all when
 * there is no shell. One component for both zones: they differ only in the
 * id they name and the props they carry, and a zone that drew a heading or a
 * wrapper of its own would change the card for every workspace that has no
 * widget for it.
 */
function HostedZone(props: {
  slot: string
  zone: Record<string, unknown>
  Slot: ConsoleWidgetSlotRenderer
}) {
  const { slot, zone, Slot } = props
  return <Slot slot={slot} {...zone} />
}

export function ExperimentVariantsZone(props: MarketingExperimentVariantsZoneProps) {
  const Slot = useConsoleWidgetSlot()
  return Slot ? (
    <HostedZone slot={EXPERIMENT_VARIANTS_ZONE.id} zone={{ ...props }} Slot={Slot} />
  ) : null
}
ExperimentVariantsZone.displayName = 'ExperimentVariantsZone'

export function ExperimentResultZone(props: MarketingExperimentResultZoneProps) {
  const Slot = useConsoleWidgetSlot()
  return Slot ? (
    <HostedZone slot={EXPERIMENT_RESULT_ZONE.id} zone={{ ...props }} Slot={Slot} />
  ) : null
}
ExperimentResultZone.displayName = 'ExperimentResultZone'

/** The editor's variants as the zone hands them over. */
export function marketingExperimentVariantDrafts(
  variants: readonly ExperimentVariant[] | undefined,
): MarketingExperimentVariantDraft[] {
  return (variants ?? []).map((variant) => ({
    id: variant.id,
    name: variant.name ?? '',
    subject: variant.subject ?? '',
    body: variant.body ?? '',
  }))
}
