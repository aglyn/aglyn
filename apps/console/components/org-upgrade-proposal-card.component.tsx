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
  standingUpgradeProposal,
  upgradeProposalDestination,
  upgradeProposalHeadline,
} from '@aglyn/aglyn/app-utils/upgrade-proposal'
import { AppLink, CardDisplay } from '@aglyn/shared-ui-jsx'
import { Button, Typography } from '@mui/material'
import { docsHelp } from '../constants/docs-links'
import useBranding from '../hooks/use-branding'
import useCurrentOrg from '../hooks/use-current-org'
import useOrgPermissions from '../hooks/use-org-permissions'
import { useOrgScope, useOrgSlug } from '../hooks/use-org-scope'

/**
 * The plan the platform team proposed for this workspace (AGL-3466), on the
 * org home and on Billing.
 *
 * Shown only to the people who can act on it — holders of `billing.manage`,
 * the owner and admins by default — and only while the proposal stands and
 * no subscription is live. Everyone else sees nothing, which is also what
 * this renders while the permissions or the org document are still loading:
 * a card that flashed and vanished would be worse than one that arrives.
 *
 * Its one button goes to Billing with the plan preselected. It never starts
 * a checkout: buying is a decision the owner makes on that page.
 */
export function OrgUpgradeProposalCard() {
  const { org, ready } = useCurrentOrg()
  const { can, loaded } = useOrgPermissions()
  const { currentOrg } = useOrgScope()
  const orgSlug = useOrgSlug()
  const { branding } = useBranding()
  const proposal = ready ? standingUpgradeProposal(org) : null
  if (!proposal || !loaded || !can('billing.manage') || !orgSlug) return null
  const destination = upgradeProposalDestination(orgSlug, proposal)
  return (
    <CardDisplay
      header={upgradeProposalHeadline(proposal, {
        orgName: org?.name ?? currentOrg?.orgName ?? null,
        productName: branding.productName,
      })}
      help={docsHelp('billing', { anchor: '#upgrade-proposal' })}
      HeaderProps={{
        action: (
          <Button
            size="small"
            variant="contained"
            component={AppLink}
            href={destination}
          >
            {'Review the plan'}
          </Button>
        ),
      }}
      contentGutterX
      contentGutterY
      sx={{ mb: 2 }}
    >
      <Typography variant="body2" color="text.secondary">
        {'When you are ready, start the subscription from Billing, where the ' +
          'plan is already selected. Nothing changes until you do.'}
      </Typography>
      {proposal.note ? (
        <Typography variant="body2" sx={{ mt: 1 }}>
          {proposal.note}
        </Typography>
      ) : null}
    </CardDisplay>
  )
}
OrgUpgradeProposalCard.displayName = 'OrgUpgradeProposalCard'

export default OrgUpgradeProposalCard
