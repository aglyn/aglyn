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
import PluginWidgetSlot from '../../../../components/plugin-widget-slot.component'
import { segmentTitle } from '../../../page-title'

// Title-only shell (AGL-1059): the page is a client component, and a client
// component cannot export `metadata` — so its title lives here, in the
// nearest server layout.  re-declares the brand template so
// it keeps applying to the titled routes nested below (AGL-1059).
export const metadata: Metadata = { title: segmentTitle('Marketplace') }

/**
 * …and, since AGL-2019, the marketplace's Stripe capability notice — which
 * is now the MARKETPLACE'S, drawn in a zone (AGL-3080).
 *
 * A capability notice, NOT a release flag. The two answer different questions
 * and both are needed: the flag asks "should this deployment show the
 * marketplace", which the sections layout's `<FeatureGate>` answers; the
 * notice answers "can this deployment take money", which no flag knows.
 *
 * WHAT MOVED AND WHY. The fact is a server-only secret — `STRIPE_SECRET_KEY`
 * carries no `NEXT_PUBLIC_` prefix — and it used to be read here because this
 * was the only server component in the marketplace subtree. It is read one
 * level up now, in the organization's own server layout, and handed to every
 * surface beneath it as a deployment capability; the SENTENCE stays with the
 * plugin, because it names what still works without a Stripe platform
 * (browsing, free installs) and that is the marketplace's knowledge, not the
 * shell's. The app supplies the fact and draws the zone.
 *
 * The zone still sits on the layout rather than on the pages, for the reason
 * the check did: it covers the listing, publish and publisher routes without
 * five copies. It renders nothing at all on a configured deployment.
 */
export default function MarketplaceTitleLayout({
  children,
}: {
  children: ReactNode
}) {
  return (
    <>
      <PluginWidgetSlot slot="marketplaceCapability" />
      {children}
    </>
  )
}
