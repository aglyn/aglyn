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

import { Typography, type TypographyProps } from '@mui/material'
import { forwardRef } from 'react'

/**
 * A standing "N/M &lt;noun&gt; on your plan" readout for an enforced quota
 * (AGL-2113).
 *
 * WHY THIS EXISTS. A per-site quota is a plan differentiator the customer is
 * paying for, and most of the console only ever mentioned one at the moment
 * it refused a click — `Product limit reached (100) — upgrade in Billing`.
 * That is the number arriving as a rejection: the operator learns their cap
 * by hitting it, cannot see how close they are before that, and cannot tell
 * whether an upgrade would help without first being blocked. Two cards
 * (`locations-card`, `registers-card`) already rendered a standing readout;
 * five siblings enforcing the same class of quota did not, and this component
 * is what makes that a property of the shared UI rather than of whoever wrote
 * the card.
 *
 * DELIBERATELY PRESENTATIONAL. It takes numbers, not an org doc, and it does
 * NOT call `checkQuota` — this lib may not depend on `@aglyn/aglyn`, and more
 * importantly the caller already holds the quota result it uses to gate its
 * own controls. Recomputing here would let the readout and the gate disagree,
 * which is the AGL-1716 defect (a card whose head-count came from a
 * `limit()`-ed listener while the gate counted properly) in a new place.
 *
 * `ready` IS LOAD-BEARING and is not a nicety. `checkQuota(undefined, …)`
 * resolves the FREE tier rather than "unknown", so a readout rendered before
 * the org doc lands tells a paying customer they are on `0/0`. While `ready`
 * is false this shows the count it does know and says the plan is still being
 * read, which is the honest answer.
 *
 * NOT IN THE BARREL (AGL-1290). Console-only; import by subpath:
 * `@aglyn/shared-ui-jsx/components/quota-readout.component`.
 */
export interface QuotaReadoutProps
  extends Omit<TypographyProps<'div'>, 'children'> {
  /**
   * Whether the plan behind `limit` has actually resolved. False renders the
   * count without a denominator — never a denominator invented from an
   * unresolved org.
   */
  ready: boolean
  /** How many of the thing exist right now. */
  used: number
  /**
   * The plan's cap. `Number.POSITIVE_INFINITY` (which is what `UNLIMITED`
   * is) renders as `∞`. Ignored entirely while `ready` is false.
   */
  limit: number
  /** Singular noun, lowercase — e.g. `product`, `redirect`, `record`. */
  noun: string
  /** Plural, when it is not `noun + 's'` — e.g. `entries` for `entry`. */
  nounPlural?: string
  /**
   * For a quota that RESETS, the period it counts over — e.g. `this month`.
   *
   * Omitted, the readout says "on your plan", which is true of a standing
   * count (products, redirects) and a lie about a monthly one: `340/500
   * campaign emails on your plan` reads as a lifetime allowance, so a
   * customer at 340 believes they have 160 left forever rather than until
   * the 1st. Supplied, it replaces that tail — `340/500 campaign emails
   * this month`.
   *
   * A string rather than a boolean because the reset window is the caller's
   * fact, not this component's: every monthly counter in the product is
   * keyed `YYYY-MM`, but nothing here reads the counter and a component that
   * hardcoded "month" would be asserting a period it cannot see.
   */
  period?: string
}

/** `∞` for an unlimited cap, the number otherwise. */
function formatLimit(limit: number): string {
  return Number.isFinite(limit) ? String(limit) : '∞'
}

export const QuotaReadoutComponent = forwardRef<
  HTMLDivElement,
  QuotaReadoutProps
>((props, ref) => {
  const { ready, used, limit, noun, nounPlural, period, ...rest } = props
  const plural = nounPlural ?? `${noun}s`
  const word = used === 1 ? noun : plural
  // A resetting quota says WHEN it resets; a standing one says the count is
  // the plan's. Both tails are about the denominator, so neither renders
  // while `ready` is false and there is no denominator to qualify.
  const tail = period ?? 'on your plan'
  return (
    <Typography
      variant="caption"
      color="text.secondary"
      component="div"
      ref={ref}
      {...rest}
    >
      {ready
        ? `${used}/${formatLimit(limit)} ${plural} ${tail}`
        : `${used} ${word} · checking your plan…`}
    </Typography>
  )
})
QuotaReadoutComponent.displayName = 'QuotaReadoutComponent'

export default QuotaReadoutComponent
