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

import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import { segmentTitle } from '../../page-title'
import DeploymentCapabilitiesProvider from '../../../components/deployment-capabilities-provider.component'
import OrgGuard from '../../../components/org-guard.component'
import { platformPaymentsConfigured } from '../../../utils/server/payments-platform'

// Fallback title for the org area (AGL-1059) — the slug is the only org
// identity available without a read, and every real page below overrides it
// with its own segment.
export async function generateMetadata({
  params,
}: {
  params: Promise<{ orgSlug: string }>
}): Promise<Metadata> {
  const { orgSlug } = await params
  return { title: segmentTitle(orgSlug) }
}

/**
 * Org-scoped shell (AGL-621): everything under `/[orgSlug]` is gated on the
 * signed-in user belonging to that org. The authenticated + main chrome is
 * provided by the parent `(app)` layout; this adds the membership guard and
 * the deployment's own capabilities.
 *
 * ## Why the capabilities are read HERE (AGL-3080)
 *
 * This is the outermost SERVER component under an organization, and what it
 * reads is a server-only secret: `STRIPE_SECRET_KEY` carries no
 * `NEXT_PUBLIC_` prefix, so anything below this line is a client component
 * that would read `undefined` and report a working Stripe platform as absent
 * on every deployment, ours included.
 *
 * `platformPaymentsConfigured()` rather than a bare truthiness test: it
 * matches the key's PREFIX, so a `.env` still holding the template's
 * placeholder reads as unconfigured instead of as configured-and-broken.
 *
 * It sits here rather than on the surfaces that use it because a surface may
 * be a plugin's, and a plugin has no way to read an environment at all —
 * which is the whole reason a fresh self-host install drew the entire
 * Marketplace, Buy button included, backed by a Stripe platform its operator
 * does not have.
 */
export default function OrgSlugLayout({ children }: { children: ReactNode }) {
  return (
    <DeploymentCapabilitiesProvider payments={platformPaymentsConfigured()}>
      <OrgGuard>{children}</OrgGuard>
    </DeploymentCapabilitiesProvider>
  )
}
