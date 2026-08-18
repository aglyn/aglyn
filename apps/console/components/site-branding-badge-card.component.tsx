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

import * as Aglyn from '@aglyn/aglyn'
import { AppLink, CardDisplay } from '@aglyn/shared-ui-jsx'
import { Alert, Stack, Typography } from '@mui/material'
import { docsHelp } from '../constants/docs-links'
import { useCurrentOrg } from '../hooks/use-current-org'
import { useOrgSlug } from '../hooks/use-org-scope'

/**
 * "Made with Aglyn" badge state (AGL-2081).
 *
 * `removeBranding` is enforced in four places in the tenant renderer
 * (`load-page-data.ts:417,533,678,790`) and had NO console surface at all —
 * not a toggle, not a state, not a locked branch. The badge appeared on a
 * site or it did not, and no screen in the console mentioned it, explained
 * it, or named what changed it.
 *
 * There is deliberately nothing to toggle here: the entitlement IS the
 * switch, and offering a control that only ever refuses would be worse than
 * offering none. What an owner needs is the FACT — does my published site
 * carry the badge — plus where the answer is decided. That is what this
 * renders.
 *
 * Held until `orgReady`. `checkEntitlement(undefined)` resolves the FREE
 * tier, so an ungated read tells a paying site it shows a badge it does not.
 */
export function SiteBrandingBadgeCard() {
  const orgSlug = useOrgSlug()
  const { org, ready: orgReady } = useCurrentOrg()
  const removesBranding = Aglyn.checkEntitlement(org as never, 'removeBranding')
  const planLabel =
    Aglyn.planLabelGrantingFeature('removeBranding') ?? 'a paid plan'

  return (
    <CardDisplay
      header={'Aglyn badge'}
      help={docsHelp('billing', {
        anchor: '#tiers--entitlements',
        excerpt:
          'Published sites on the Free plan carry a small "Made with Aglyn" badge; paid plans drop it.',
      })}
      contentGutterX
      contentGutterY
    >
      {!orgReady ? (
        <Typography variant="body2" color="text.secondary">
          {'Checking your plan…'}
        </Typography>
      ) : removesBranding ? (
        <Stack spacing={0.5}>
          <Typography variant="body2">
            {'Your published pages do not show the “Made with Aglyn” badge.'}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {'Included on your plan. Nothing to switch on.'}
          </Typography>
        </Stack>
      ) : (
        <Alert
          severity="info"
          action={
            orgSlug ? (
              <AppLink
                componentVariant="button"
                color="inherit"
                size="small"
                href={`/${orgSlug}/billing`}
              >
                {'Upgrade'}
              </AppLink>
            ) : undefined
          }
        >
          {'Your published pages show a small “Made with Aglyn” badge. ' +
            `${planLabel} and above remove it.`}
        </Alert>
      )}
    </CardDisplay>
  )
}

export default SiteBrandingBadgeCard
