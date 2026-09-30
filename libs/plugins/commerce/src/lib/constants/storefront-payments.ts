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
 * What a SHOPPER is told when the storefront's checkout answers that this
 * deployment takes no payments (AGL-2019).
 *
 * The status is the platform's (`isPaymentsNotConfigured`, core's
 * `payments-configured.ts`); the sentence is the storefront's, because only
 * the storefront knows its visitor was trying to buy something. It is a fact
 * about the store: no cause, no variable names, no mention of the platform —
 * naming an environment variable to a stranger leaks the operator's
 * deployment shape to the public internet, and there is nothing they could do
 * with it anyway.
 *
 * Present tense and permanent-sounding on purpose: "right now" or
 * "temporarily" would imply a transient outage and invite a retry that cannot
 * succeed.
 */
export function storefrontPaymentsNotConfiguredText() {
  return 'This store is not set up to take payments.'
}
