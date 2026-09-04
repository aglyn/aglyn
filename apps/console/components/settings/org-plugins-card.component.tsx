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

import { AppLink, CardDisplay } from '@aglyn/shared-ui-jsx'
import { Typography } from '@mui/material'
import { buildRoute, Route } from '../../constants/route-links'
import { docsHelp } from '../../constants/docs-links'
import { useOrgSlug } from '../../hooks/use-org-scope'

/**
 * A signpost, not a feature (AGL-2501): plugin management lives on its own
 * page, and a reader who looks for it in Settings should be told where rather
 * than find nothing.
 */
export function OrgPluginsCard() {
  const orgSlug = useOrgSlug()


  return (
<CardDisplay
  header={'Plugins'}
  help={docsHelp('installYourFirstPlugin', {
    anchor: '#step-7-off',
    excerpt:
      'Turning plugins on and off moved to its own ' +
      'Plugins section. This card points you there.',
  })}
  contentGutterX
  contentGutterY
>
  <Typography variant="body2" color="text.secondary">
    {'Enabling plugins, configuring them, and ' +
      'managing marketplace installs now live in '}
    <AppLink
      href={buildRoute(Route.ORG_MARKETPLACE_INSTALLED, { orgSlug })}
    >
      {'Marketplace › Installed'}
    </AppLink>
    {'.'}
  </Typography>
</CardDisplay>
  )
}
OrgPluginsCard.displayName = 'OrgPluginsCard'

export default OrgPluginsCard
