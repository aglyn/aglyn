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
  CONSOLE_WIDGET_SLOTS,
  type ConsolePublishableArtifact,
} from '@aglyn/aglyn'
import { CardDisplay } from '@aglyn/shared-ui-jsx'
import { Button, Stack, Typography } from '@mui/material'
import { useState } from 'react'
import { docsHelp } from '../constants/docs-links'
import useCurrentOrg from '../hooks/use-current-org'
import PluginWidgetSlot, { useSlotWidgets } from './plugin-widget-slot.component'

/**
 * Save-as-template (AGL-137): publishes this host's published screens +
 * theme to the marketplace library as a site template (free or paid).
 *
 * The card says what it has — this site — and the publish itself is drawn
 * through the `hostArtifactPublish` zone (AGL-3080), the same widget the
 * layouts and components pages open: the route, the listing form, the price
 * floor and the publisher agreement it may need to ask for (AGL-3407) are
 * the marketplace's, not the console's. With nothing drawing that zone there
 * is nowhere to publish to, so the card is not shown at all.
 */
export function SiteTemplateCard(props: { hostId: string }) {
  const { hostId } = props
  const { orgId } = useCurrentOrg()
  const [target, setTarget] = useState<ConsolePublishableArtifact | null>(null)
  const { widgets } = useSlotWidgets([CONSOLE_WIDGET_SLOTS.hostArtifactPublish])
  if (!widgets.length) return null

  return (
    <CardDisplay
      header={'Site template'}
      help={docsHelp('saveATemplate', {
        anchor: '#save-your-site-as-a-template',
      })}
      contentGutterX
      contentGutterY
    >
      <Stack spacing={1.5}>
        <Typography variant="body2" color="text.secondary">
          {'Publish this site — every published screen plus the theme — ' +
            'as a template others can start from. Re-publishing bumps the ' +
            'version.'}
        </Typography>
        <Button
          size="small"
          variant="contained"
          color="primary"
          sx={{ alignSelf: 'flex-start' }}
          onClick={() =>
            setTarget({ kind: 'site', hostId, orgId: orgId ?? null })
          }
        >
          {'Publish as template'}
        </Button>
      </Stack>
      <PluginWidgetSlot
        slot={CONSOLE_WIDGET_SLOTS.hostArtifactPublish}
        artifact={target}
        onClose={() => setTarget(null)}
      />
    </CardDisplay>
  )
}
SiteTemplateCard.displayName = 'SiteTemplateCard'

export default SiteTemplateCard
