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

import * as Aglyn from '@aglyn/aglyn'
import { mdiFileSign } from '@aglyn/shared-data-mdi'
import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import { forwardRef, useEffect, useState } from 'react'
import { WAIVERS_PICKER_ATTRIBUTE, WAIVERS_PLUGIN_ID, WAIVERS_SIGN_COMPONENT_ID } from '../constants/bundle-common'
import { WaiverSignFlow } from './waiver-sign-flow.component'

// Component ids are persisted in screen documents; never rename.
export const ID: Aglyn.ComponentId = WAIVERS_SIGN_COMPONENT_ID

export interface SignWaiverProps {
  /** The waiver this element signs, picked in the Besigner; empty lists the site's published waivers. */
  waiverId?: string
  /** Heading over the list of waivers, when the site publishes more than one. */
  heading?: string
}

/**
 * Sign waiver (AGL-4042): the site's published waivers, signed on the page.
 * A waiver picked in the Besigner opens straight to its form; otherwise one
 * published waiver opens straight away and several are listed to choose
 * from. A link to the page with `?waiver=` opens that one whatever was
 * picked, so a share link works on any page holding the element. Signs
 * through the site's own public door, so the signer's audit trail names the
 * site's address.
 */
const SignWaiver = forwardRef<HTMLDivElement, SignWaiverProps>((props, ref) => {
  // Node styles ride the renderer-merged sx; recompose (stack.ts pattern).
  const { heading, waiverId: picked, sx, ...rest } = props as SignWaiverProps & { sx?: unknown }
  const nodeSx = (Array.isArray(sx) ? sx : [sx]) as never[]
  const { hostId } = Aglyn.useSite()
  const [linked, setLinked] = useState<string | null>(null)
  useEffect(() => {
    setLinked(new URLSearchParams(window.location.search).get('waiver'))
  }, [])
  const waiverId = linked || picked || null

  if (!hostId) {
    return (
      <Box
        ref={ref}
        {...rest}
        sx={[
          { p: 3, border: 1, borderStyle: 'dashed', borderColor: 'divider', borderRadius: 1, color: 'text.secondary' },
          ...nodeSx,
        ]}
      >
        <Typography variant="body2">{'Sign waiver: your published waivers are signed here.'}</Typography>
      </Box>
    )
  }
  return (
    <Box ref={ref} {...rest} sx={[{ width: '100%', maxWidth: (theme) => theme.breakpoints.values.sm, mx: 'auto' }, ...nodeSx]}>
      <WaiverSignFlow hostId={hostId} waiverId={waiverId} mode="online" heading={heading} />
    </Box>
  )
})
SignWaiver.displayName = 'SignWaiver'

export const schema: Aglyn.ComponentSchema<SignWaiverProps> = {
  $id: ID,
  pluginId: WAIVERS_PLUGIN_ID,
  displayName: 'Sign Waiver',
  description: 'Your published waivers, signed right on the page, with a signed copy emailed to the signer.',
  category: Aglyn.ComponentCategory.FORMS,
  icon: { path: mdiFileSign.path, sx: { color: 'primary.main' } },
  flags: { selfClosing: Aglyn.FEATURE_FLAG.ENABLED },
  attributes: [
    {
      name: 'waiverId',
      description:
        'The waiver this element signs. Leave it empty to list every waiver the site publishes. Write and publish waivers on the Waivers page.',
      // The `waivers` entity picker (plugins.config.json) lists the site's
      // waivers by title under this type and stores the chosen one's id.
      component: WAIVERS_PICKER_ATTRIBUTE as Aglyn.FieldComponentType,
      label: 'Waiver',
    },
    {
      name: 'heading',
      description: 'Shown above the list when no waiver is chosen and the site publishes more than one.',
      component: Aglyn.FieldComponentType.TEXT_FIELD,
      label: 'Heading',
    },
  ],
}

export const presets: Aglyn.PresetSchema[] = [
  {
    $id: `${WAIVERS_PLUGIN_ID}:${ID}`,
    type: Aglyn.NodeType.PRESET,
    displayName: 'Sign Waiver',
    pluginId: WAIVERS_PLUGIN_ID,
    description: 'Riders and guests sign your waiver before they arrive',
    category: Aglyn.ComponentCategory.FORMS,
    icon: { path: mdiFileSign.path, sx: { color: 'primary.main' } },
    data: { $id: null, componentId: ID, pluginId: WAIVERS_PLUGIN_ID, props: {} },
  },
]

export default SignWaiver
