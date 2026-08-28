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

import type { NextPageWithLayout } from '@aglyn/shared-ui-next'
import { useRouter, useSearchParams } from 'next/navigation'
import { useEffect } from 'react'
import {
  DEFAULT_MARKETPLACE_SECTION_ID,
  MARKETPLACE_RETURN_SECTIONS,
  marketplaceSections,
} from '../../../../constants/marketplace-sections'
import { useOrgSlug } from '../../../../hooks/use-org-scope'

/**
 * `/marketplace` is the section index and renders nothing of its own
 * (AGL-693).
 *
 * No `?tab=` compatibility map, for the reason the settings sections have
 * none: the sections were panels behind a query parameter and are routes now,
 * nothing shipped holds a `?tab=` link into this hub, and a map kept "just in
 * case" is a second set of names for the same eight pages to maintain against
 * them.
 *
 * `?connect=` and `?purchase=` are the opposite case and ARE honored. Stripe
 * bakes them into onboarding links and checkout sessions, so they are held
 * externally by a third party rather than by us — see
 * `MARKETPLACE_RETURN_SECTIONS`. The whole query is carried across either way,
 * so a marker nothing routes on still survives the hop.
 *
 * `replace`, not `push`: a redirect the reader did not ask for must not become
 * a history entry their back button bounces off.
 */
const OrgMarketplace: NextPageWithLayout<Record<string, never>> = () => {
  const router = useRouter()
  const orgSlug = useOrgSlug()
  const searchParams = useSearchParams()
  const search = searchParams?.toString() ?? ''

  useEffect(() => {
    if (!orgSlug) return
    const sections = marketplaceSections(orgSlug)
    const returning = Object.keys(MARKETPLACE_RETURN_SECTIONS).find((key) =>
      searchParams?.has(key),
    )
    const targetId = returning
      ? MARKETPLACE_RETURN_SECTIONS[returning]
      : DEFAULT_MARKETPLACE_SECTION_ID
    const target =
      sections.find((section) => section.id === targetId) ?? sections[0]
    router.replace(search ? `${target.href}?${search}` : target.href)
    // `search` rather than the `searchParams` object: Next hands back a new
    // instance on every render, which would re-fire this redirect forever.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router, orgSlug, search])

  return null
}
OrgMarketplace.displayName = 'Page:OrgMarketplace'

export default OrgMarketplace
