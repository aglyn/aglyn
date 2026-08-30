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

/**
 * THE ATTRIBUTION WINDOW, in the one place both halves of the join can reach.
 *
 * The writer lives in `tenant-data-admin` (it holds the Firestore paths) and
 * the reader lives in the email plugin (it holds the report math), and a
 * foundation library may not import a feature plugin. A window defined twice
 * is a window that drifts, and the two copies would drift in the worst
 * possible way: the number credited and the number printed beside it would
 * describe different rules.
 *
 * The reasoning behind the model itself is recorded once, with the report, in
 * `campaign-revenue.ts`.
 */

/** Days between a click and an order, inside which the click gets the credit. */
export const EMAIL_ATTRIBUTION_WINDOW_DAYS = 7

/** The same window in milliseconds. */
export const EMAIL_ATTRIBUTION_WINDOW_MS =
  EMAIL_ATTRIBUTION_WINDOW_DAYS * 24 * 60 * 60 * 1000

/**
 * The model orders are credited under, stamped onto every record written.
 *
 * A string on the record rather than an implied convention, so a second model
 * can be added without making the records already written unreadable. It is
 * not an enum anything switches on.
 */
export const EMAIL_ATTRIBUTION_MODEL = 'last-click'

/**
 * Whether a click may be credited with an order placed at `orderedAtMs`.
 *
 * Both bounds matter and they fail differently. A click AFTER the order is
 * not a touch that led to it — it is the receipt, or a campaign that happened
 * to land between the sale and the webhook — and crediting it would let a
 * LATER campaign steal an earlier one's order. A click older than the window
 * is a touch nobody can argue caused the purchase.
 *
 * Inclusive at both ends: an order placed in the same millisecond as the
 * click is a plausible checkout from the landing page, and one placed exactly
 * seven days later is inside a window described as seven days.
 */
export function emailTouchIsInWindow(
  clickedAtMs: number,
  orderedAtMs: number,
  windowMs: number = EMAIL_ATTRIBUTION_WINDOW_MS,
): boolean {
  if (!Number.isFinite(clickedAtMs) || !Number.isFinite(orderedAtMs)) {
    return false
  }
  if (clickedAtMs <= 0 || orderedAtMs <= 0) return false
  const age = orderedAtMs - clickedAtMs
  return age >= 0 && age <= windowMs
}
