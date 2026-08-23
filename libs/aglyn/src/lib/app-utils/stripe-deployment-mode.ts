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
 * Which Stripe world THIS deployment lives in (AGL-2040, shared in AGL-2486).
 *
 * Lifted out of `apps/console/utils/server/stripe-livemode.ts` verbatim so a
 * LIBRARY can ask the question too — `org-billing.ts` now keys the stored
 * Stripe customer id by mode, and a lib cannot import from an app. That file
 * re-exports this one, so the webhook's livemode gate and its spec are
 * untouched and there is still exactly ONE definition of "are we live".
 *
 * Duplicating the `sk_live_` inference instead would have put a second answer
 * to a money-path question in the tree, and the two would drift the first time
 * the override was extended.
 */

/** Explicit ops override, for the case where key-prefix inference is wrong. */
const LIVEMODE_OVERRIDE = 'STRIPE_LIVEMODE'

/**
 * Whether THIS deployment is the live one.
 *
 * Derived from `STRIPE_SECRET_KEY`'s prefix, with an explicit
 * `STRIPE_LIVEMODE=true|false` override that wins when set. Note the
 * asymmetry, which is deliberate: only `sk_live_` yields `true`. An unset or
 * unrecognised key is NOT a live deployment, because a deployment with no
 * Stripe secret key cannot be charging anyone.
 */
export function deploymentLivemode(
  env: Partial<Record<string, string>> = process.env,
): boolean {
  const override = env[LIVEMODE_OVERRIDE]
  if (override === 'true') return true
  if (override === 'false') return false
  return String(env['STRIPE_SECRET_KEY'] ?? '').startsWith('sk_live_')
}
