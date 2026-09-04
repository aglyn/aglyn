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

import {
  mergeOrgBillingOverOrg,
  ORG_BILLING_DOC_ID,
  ORG_BILLING_SUBCOLLECTION,
  type AglynOrgBilling,
} from '@aglyn/aglyn'
import { Box, CircularProgress } from '@mui/material'
import { CardDisplay, GridItems } from '@aglyn/shared-ui-jsx'
import type { NextPageWithLayout } from '@aglyn/shared-ui-next'
import { useMemo } from 'react'
import { useFirestore, useUser } from '@aglyn/tenant-feature-instance'
import BillingMeteredEstimateComponent from '../../../../../../components/billing/billing-metered-estimate.component'
import BillingStorageOverageCardComponent from '../../../../../../components/billing/billing-storage-overage-card.component'
import BillingUsageBudgetCardComponent from '../../../../../../components/billing/billing-usage-budget-card.component'
import BillingUsageHistoryComponent from '../../../../../../components/billing/billing-usage-history.component'
import BillingUsageComponent from '../../../../../../components/billing/billing-usage.component'
import CardColumns from '../../../../../../components/card-columns.component'
import { docsHelp } from '../../../../../../constants/docs-links'
import useConfirmedDoc from '../../../../../../hooks/use-confirmed-doc'
import useCurrentOrg from '../../../../../../hooks/use-current-org'
import { useOrgHosts } from '../../../../../../hooks/use-org-hosts'
import useOrgPermissions from '../../../../../../hooks/use-org-permissions'

/**
 * What this workspace is consuming, and the two controls over what that costs.
 *
 * Its own route because these are the heaviest reads on the whole surface —
 * live meters across every host, twelve months of monthly rollups, a metered
 * cost estimate — and none of them has anything to do with choosing a plan or
 * editing a card. On one page they ran on every visit to Billing, whatever the
 * visitor came for.
 *
 * The storage cap and the usage budget sit here rather than under Plan on
 * purpose: both are about consumption, and the cap in particular is meaningless
 * without the meter above it that shows why you would want one.
 */
const BillingUsageSection: NextPageWithLayout<Record<string, never>> = () => {
  const firestore = useFirestore()
  const { data: user } = useUser()
  const { org: orgDoc, orgId, ready: orgReady } = useCurrentOrg()
  const { can } = useOrgPermissions()
  // Org-scoped (AGL-236): the meters must count this workspace's hosts, not
  // every host the viewer can reach.
  const { hosts } = useOrgHosts(firestore, user?.uid, orgId)
  // `stripeCustomerId` and `subscription` live in a manager-gated
  // subcollection (AGL-1028); the estimate needs the subscription's interval
  // and price ids. Merged with `mergeOrgBillingOverOrg` rather than spread,
  // because `useConfirmedDoc` stamps the document id into its payload and a
  // plain spread makes the merged `$id` the literal `'stripe'` (AGL-1991).
  const { data: orgBilling } = useConfirmedDoc<Partial<AglynOrgBilling>>(
    firestore,
    orgId ? ['orgs', orgId, ORG_BILLING_SUBCOLLECTION, ORG_BILLING_DOC_ID] : null,
  )
  const org = useMemo(
    () => mergeOrgBillingOverOrg(orgDoc as Record<string, unknown>, orgBilling),
    [orgDoc, orgBilling],
  )

  /*
   * Hold until the org is known. The plan defaults to `free` while the read
   * is in flight, and every meter below divides by that plan's quotas — so
   * the loading window would draw a paying workspace its own usage against
   * Free allowances, which is AGL-1422 wearing a different hat.
   *
   * The section layout holds too, and duplicating a HOLD is safe in a way
   * duplicating a grant never is: the worst case is a spinner nobody needed.
   * This copy keeps the invariant where the value is actually read, so a
   * refactor of the layout cannot take it away without anyone noticing.
   */
  if (!orgReady) {
    return (
      <Box sx={{ p: 2 }}>
        <CircularProgress size={24} />
      </Box>
    )
  }

  return (
    <GridItems
      spacing={3}
      masonry
      items={[
        {
          size: { xs: 12, md: 8 },
          children: (
            <CardDisplay
              header={'Usage'}
              help={docsHelp('billing', {
                anchor: '#usage-meters',
                excerpt:
                  'Live meters for sites, storage, bandwidth, and ' +
                  "campaign email sends against your plan's quotas. " +
                  'Transactional mail is counted but never capped.',
              })}
              contentGutterX
              contentGutterY
            >
              <BillingUsageComponent org={org} hosts={hosts ?? []} />
            </CardDisplay>
          ),
        },
        {
          size: { xs: 12, md: 4 },
          children: (
            <CardDisplay
              header={'Metered usage estimate'}
              help={docsHelp('billing', {
                anchor: '#usage-meters',
                excerpt:
                  'A cost estimate for metered overages this period, ' +
                  'based on current usage across your sites.',
              })}
              contentGutterX
              contentGutterY
            >
              <BillingMeteredEstimateComponent org={org} hosts={hosts ?? []} />
            </CardDisplay>
          ),
        },
        {
          size: { xs: 12 },
          children: (
            // `CardColumns`, not another masonry band: within a band
            // `GridItems masonry` groups items by their `size`, so three cards
            // declaring one width would share ONE column and leave half the
            // page empty. This lets the browser place the breaks.
            <CardColumns
              spacing={3}
              items={[
                {
                  key: 'usage-history',
                  children: (
                    <CardDisplay
                      header={'Usage history'}
                      help={docsHelp('billing', {
                        anchor: '#usage-meters',
                        excerpt:
                          'How your metered usage has moved over the last ' +
                          'twelve months, from your monthly billing rollups.',
                      })}
                      contentGutterX
                      contentGutterY
                    >
                      <BillingUsageHistoryComponent org={org} />
                    </CardDisplay>
                  ),
                },
                {
                  key: 'storage-cap',
                  children: (
                    <div id="storage-overage">
                      <CardDisplay
                        header={'Storage cap'}
                        subheader={
                          'Extra storage past your included allowance is billed ' +
                          'on your monthly invoice. Set a cap if you would ' +
                          'rather uploads stopped instead.'
                        }
                        help={docsHelp('billing', {
                          anchor: '#storage-overage',
                          excerpt:
                            'Uploads past your included storage are refused ' +
                            'unless you turn on metered storage, which carries a ' +
                            'monthly spend limit you set.',
                        })}
                        contentGutterX
                        contentGutterY
                      >
                        <BillingStorageOverageCardComponent
                          orgId={orgId}
                          canManage={can('billing.manage')}
                        />
                      </CardDisplay>
                    </div>
                  ),
                },
                {
                  key: 'usage-budget',
                  children: (
                    <div id="usage-budget">
                      <CardDisplay
                        header={'Monthly usage budget'}
                        subheader={
                          'Get alerted as your metered usage passes each ' +
                          'percentage of an amount you choose. A budget warns ' +
                          'you — it never stops anything.'
                        }
                        help={docsHelp('billing', {
                          anchor: '#usage-budget',
                          excerpt:
                            'Set a monthly usage budget and the percentages you ' +
                            'want to hear about; alerts arrive in the console ' +
                            'and by email.',
                        })}
                        contentGutterX
                        contentGutterY
                      >
                        <BillingUsageBudgetCardComponent
                          orgId={orgId}
                          canManage={can('billing.manage')}
                        />
                      </CardDisplay>
                    </div>
                  ),
                },
              ]}
            />
          ),
        },
      ]}
    />
  )
}
BillingUsageSection.displayName = 'Page:BillingUsage'

export default BillingUsageSection
