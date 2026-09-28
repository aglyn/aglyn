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

import type { HeldPageTarget } from '@aglyn/shared-util-email/held-page'

/** One open page hold, as `/api/hosts/page-holds` hands it over (`PageHoldView`). */
export interface PageHold {
  noticeId: string
  kind: 'page-held' | 'page-flagged'
  status: 'held' | 'in-review' | 'released' | 'rejected' | 'closed' | null
  chip: { label: string; color: 'warning' | 'error' | 'info' }
  label: string
  details: string[]
  visitorSentence: string
  targets: HeldPageTarget[]
  reference: string | null
  occurredAtMs: number
  reviewable: boolean
  reviewRequestedAtMs: number | null
}

/** The holds shown on one console document: the page itself, or its layout or component. */
export function holdsForTarget(
  holds: readonly PageHold[] | null | undefined,
  target: HeldPageTarget,
): PageHold[] {
  return (holds ?? []).filter((hold) =>
    hold.targets.some((candidate) => candidate.type === target.type && candidate.id === target.id),
  )
}

function capitalized(text: string): string {
  return text ? `${text.charAt(0).toUpperCase()}${text.slice(1)}` : text
}

/**
 * What the banner says (AGL-3374): what happened to which page, the facts
 * beside it, and what visitors get meanwhile. On a layout or component the
 * hold is on a PAGE that renders it, so the page is named first.
 */
export function pageHoldBannerCopy(
  hold: PageHold,
  target: HeldPageTarget,
): { title: string; lines: string[] } {
  const onPage = target.type === 'screen'
  const what =
    hold.status === 'rejected'
      ? 'was not approved after review, and is not being served'
      : hold.kind === 'page-flagged'
        ? 'was flagged by our automated safety review and is being looked at by a person'
        : 'is held for review by our automated safety review'
  const title = onPage
    ? `${capitalized(hold.label)} ${what}.`
    : `${capitalized(hold.label)}, which uses this ${target.type}, ${what}.`
  const lines = [...hold.details, hold.visitorSentence]
  if (hold.reviewRequestedAtMs) {
    lines.push(`A review was requested on ${new Date(hold.reviewRequestedAtMs).toLocaleString()}.`)
  }
  if (hold.reference) lines.push(`Reference ${hold.reference}.`)
  return { title, lines }
}
