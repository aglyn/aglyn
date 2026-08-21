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
 * Does THIS deployment have a Stripe platform at all? (AGL-2019)
 *
 * SERVER ONLY. `STRIPE_SECRET_KEY` carries no `NEXT_PUBLIC_` prefix, so Next
 * never inlines it into a browser bundle — a client component calling this
 * would read `undefined` and conclude "not configured" on every deployment,
 * including ours. Import it from server components and route handlers only.
 *
 * ⚠️ THIS IS A DELIBERATE TWIN OF `platformStripeMode()` in
 * `libs/tenant/data/admin/src/lib/server/stripe-account-mode.ts` (AGL-2471),
 * and the duplication is not an oversight. `apps/console` cannot statically
 * import `@aglyn/tenant-data-admin`: a dynamic `import()` in
 * `app/api/auth/sso-lookup/route.emulator.spec.ts` marks that library
 * lazy-loaded in the nx graph, so `@nx/enforce-module-boundaries` rejects
 * every static import of it with "Static imports of lazy-loaded libraries are
 * forbidden". Two console files already carry that error; this one does not
 * add a third.
 *
 * The PREFIX TEST is the part worth copying, and it is why this is not the
 * bare `Boolean(process.env.STRIPE_SECRET_KEY)` used by
 * `app/api/health/billing/route.ts`. A `.env` left holding a placeholder —
 * `your-key-here`, or the template's own empty-but-present line — is truthy,
 * and would report a working Stripe platform to an operator who has none.
 * Matching `sk_`/`rk_` + `live`/`test` means a half-filled file reads as
 * unconfigured, which is the true answer.
 */
export function platformPaymentsConfigured(
  key: string | undefined = process.env['STRIPE_SECRET_KEY'],
): boolean {
  return /^[sr]k_(live|test)_/.test(String(key ?? '').trim())
}
