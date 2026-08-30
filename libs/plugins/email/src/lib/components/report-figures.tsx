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

/**
 * THE THREE WAYS AN EMAIL NUMBER IS ALLOWED TO REACH A SCREEN.
 *
 * Every email reporting surface renders the same three things — a titled
 * block, a count, and a rate — under the rules stated in full on
 * `measured-figures.component`: a `null` count draws a dash and never a zero,
 * a rate prints its denominator beside its percentage, and a rate that cannot
 * be divided draws a dash and no number.
 *
 * The renderers themselves live in `@aglyn/shared-ui-jsx` because email is
 * not the only surface that quotes a rate — a form's lead rate faces the same
 * ambiguity between "of everyone who submitted" and "of everyone who gave an
 * address" — and a second copy is a second chance to render a percentage
 * without its denominator. This module stays the name every email card
 * imports, so the four of them are unaffected by where the implementation
 * sits.
 *
 * `CampaignRate` is structurally a `MeasuredRate` and is passed to `RateRow`
 * unchanged; the campaign model keeps its own name for the type because the
 * denominators it can produce are an email fact, not a shared one.
 */

export {
  Figure,
  percent,
  RateRow,
  Section,
  type MeasuredRate,
} from '@aglyn/shared-ui-jsx/components/measured-figures.component'
