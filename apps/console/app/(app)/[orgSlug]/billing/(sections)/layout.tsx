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

import { ICON_VARIANT_APP_SETTINGS } from '@aglyn/shared-data-enums'
import { Container } from '@aglyn/shared-ui-jsx'
import {
  HubSections,
  useActiveSection,
} from '@aglyn/shared-ui-next/components/hub-tabs'
import { Alert, Box, CircularProgress } from '@mui/material'
import type { ReactNode } from 'react'
import DashboardLayout from '../../../../../components/layouts/dashboard.layout'
import { buildRoute, Route } from '../../../../../constants/route-links'
import { CONTENT_MAX_WIDTH } from '../../../../../constants/shared'
import { useOrgSlug } from '../../../../../hooks/use-org-scope'
import useCurrentOrg from '../../../../../hooks/use-current-org'
import useOrgPermissions from '../../../../../hooks/use-org-permissions'

/**
 * Billing, section by section (AGL-2501).
 *
 * The page had grown to four unrelated jobs on one route — choosing a plan,
 * reading meters, settling invoices, and editing billing details — and mounted
 * all of them at once. Every card ran its reads on arrival, so opening Billing
 * to change a card also priced a plan, pulled twelve months of usage rollups
 * and listed invoices from Stripe.
 *
 * As routes, Next mounts one page and code-splits per route: an unopened
 * section costs neither a read nor a byte. Same reasoning, and the same
 * `HubSections` rail, as `settings/(sections)`.
 *
 * ## Why PLAN is the route group's index and not a redirect
 *
 * `(sections)` adds no path segment, so `(sections)/page.tsx` IS
 * `/[orgSlug]/billing`. Every link in the console goes through
 * `Route.MANAGE_BILLING`, and the hash links (`#addons`,
 * `#collaborator-seats`) and Stripe's own dunning mail point at that same
 * path. Landing Plan there means none of them moves, no redirect swallows a
 * hash on the way through, and there is no `?tab=` shim to carry forever.
 *
 * ## The permission hold lives here
 *
 * `billing.view` gates all four sections, and `useOrgPermissions` fails OPEN
 * while loading — `can()` answers as an owner until `loaded`. Holding in the
 * layout means one gate rather than four, and a section cannot ship having
 * forgotten it. The three outcomes are deliberate (AGL-243, AGL-2474): a
 * pending read gets the spinner, a failed read says what is unknown WITHOUT
 * accusing the reader, and only a loaded refusal refuses.
 */
export default function BillingSectionsLayout({
  children,
}: {
  children: ReactNode
}) {
  const orgSlug = useOrgSlug()
  const { ready: orgReady } = useCurrentOrg()
  const {
    can,
    loaded: permissionsLoaded,
    errored: permissionsErrored,
  } = useOrgPermissions()

  /*
   * One list, read twice — by the rail and by the breadcrumb. Hoisted so
   * `useActiveSection` resolves against the same array the rail highlights: a
   * section added here is named in the trail by construction.
   */
  const sections = [
    {
      href: buildRoute(Route.MANAGE_BILLING, { orgSlug }),
      label: 'Plan',
    },
    {
      href: buildRoute(Route.MANAGE_BILLING_USAGE, { orgSlug }),
      label: 'Usage',
    },
    {
      href: buildRoute(Route.MANAGE_BILLING_INVOICES, { orgSlug }),
      label: 'Invoices',
    },
    {
      href: buildRoute(Route.MANAGE_BILLING_SETTINGS, { orgSlug }),
      label: 'Settings',
    },
  ]
  const active = useActiveSection(sections)

  return (
    <DashboardLayout
      breadcrumbItems={[
        {
          children: 'Billing',
          href: buildRoute(Route.MANAGE_BILLING, { orgSlug }),
        },
        // The section the reader is actually on. Without it the trail names
        // every level except theirs.
        ...(active ? [{ children: active.label, href: active.href }] : []),
      ]}
      help="billing"
      header={{
        children: 'Billing',
        icon: { path: ICON_VARIANT_APP_SETTINGS.path },
      }}
    >
      <Container gutterY maxWidth={CONTENT_MAX_WIDTH}>
        {permissionsLoaded && !can('billing.view') ? (
          <Alert severity="warning">
            {'You do not have permission to view billing for this ' +
              'organization — ask an organization admin for access.'}
          </Alert>
        ) : permissionsErrored ? (
          // The member read FAILED. Until AGL-243 the catch published
          // `loaded: true` over an untouched `ALL_GRANTED`, so the page
          // painted the whole ledger to whoever was looking. This states what
          // is unknown without accusing the reader of lacking access, because
          // that is precisely what we failed to determine.
          <Alert severity="error">
            {"We couldn't confirm your access to billing for this " +
              'organization. Reload the page — if this keeps happening, ' +
              'contact support.'}
          </Alert>
        ) : !permissionsLoaded || !orgReady ? (
          // Of every surface in the console this is the one that must not
          // guess: the plan defaults to `free` while loading, so the window
          // renders a paying workspace its own billing page saying Free
          // (AGL-1422). Hold — there is nothing here that is not an answer
          // about the plan.
          <Box sx={{ p: 2 }}>
            <CircularProgress size={24} />
          </Box>
        ) : (
          <HubSections sections={sections}>{children}</HubSections>
        )}
      </Container>
    </DashboardLayout>
  )
}
