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

/*
 * A visit's step vocabulary (AGL-3605), as a leaf: what a journey step may
 * be and carry. `site-journey.ts` re-exports it beside the recorder; the
 * funnels' model reads it from here, so the model stays free of the
 * beacon (and the DOM it reaches) and can be read by the native apps.
 */

/**
 * What a step can be — only what the platform already sees happen.
 *
 * - `page`: a page was viewed; key = the path.
 * - `form`: a form was submitted successfully; key = the form id.
 * - `booking`: a booking was made (a free one confirmed, or a paid one's
 *   payment settled); key = the service id.
 * - `cart`: a product was added to the cart; key = the product id.
 * - `order`: a storefront order was placed and paid; no key.
 * - `overlay`: an announcement bar or popup was clicked; key = the overlay id.
 * - `event`: a custom event an interaction fired; key = the event name.
 * - `email`: a person the visit identified opened or clicked an email the
 *   site sent them; key = `opened` or `clicked`. Recorded by the SERVER from
 *   the delivery log, never by a page: a browser that sends one is refused.
 */
export const SITE_JOURNEY_STEP_TYPES = [
  'page',
  'form',
  'booking',
  'cart',
  'order',
  'overlay',
  'event',
  'email',
] as const

export type SiteJourneyStepType = (typeof SITE_JOURNEY_STEP_TYPES)[number]

export function isSiteJourneyStepType(value: unknown): value is SiteJourneyStepType {
  return (
    typeof value === 'string' &&
    (SITE_JOURNEY_STEP_TYPES as readonly string[]).includes(value)
  )
}

/** The keys an `email` step carries. */
export const SITE_JOURNEY_EMAIL_KEYS = ['opened', 'clicked'] as const

/** The longest key a step carries; longer keys are cut. */
export const SITE_JOURNEY_KEY_MAX = 200
