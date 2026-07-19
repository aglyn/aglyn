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
import { mdiLockOutline } from '@aglyn/shared-data-mdi'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Typography from '@mui/material/Typography'
import { forwardRef, useEffect, useState, type ReactNode } from 'react'
import { BUNDLE_ID } from '../constants/bundle-common'
import { generatePresetId } from '../utils/generate-preset-id'

// Component ids are persisted in screen documents; never rename.
export const ID: Aglyn.ComponentId = 'gate'

export interface GateProps {
  /** Product id granting access; blank = any live subscription. */
  productId?: string
  teaserText?: string
  ctaLabel?: string
  /** Where the CTA sends non-members (product or sign-in page). */
  ctaHref?: string
  children?: ReactNode
}

/**
 * Content gate (AGL-309): renders children only for entitled members
 * (purchase or live subscription, checked by the server-enforced gate
 * API). Non-members see the teaser + CTA. Layout gating only — media
 * that must stay secret should use the gated video block (AGL-315) or
 * download links (AGL-302), which enforce on the server end-to-end.
 */
const Gate = forwardRef<HTMLDivElement, GateProps>((props, ref) => {
  const { productId, teaserText, ctaLabel, ctaHref, children, ...rest } = props
  const { hostId } = Aglyn.useSite()
  const [state, setState] = useState<
    'checking' | 'entitled' | 'blocked' | 'anonymous'
  >('checking')

  useEffect(() => {
    if (!hostId) return
    let active = true
    void fetch(
      `/api/commerce/gate?hostId=${encodeURIComponent(hostId)}` +
        `&productId=${encodeURIComponent(productId || 'any')}`,
    )
      .then((response) => response.json())
      .then((payload) => {
        if (!active) return
        setState(
          payload?.entitled
            ? 'entitled'
            : payload?.signedIn
              ? 'blocked'
              : 'anonymous',
        )
      })
      .catch(() => {
        if (active) setState('blocked')
      })
    return () => {
      active = false
    }
  }, [hostId, productId])

  // Besigner canvas: children render with a members-only frame so the
  // designer sees what they are building (the preview-as-member state).
  if (!hostId) {
    return (
      <Box
        ref={ref}
        {...rest}
        sx={{
          border: '1px dashed',
          borderColor: 'secondary.main',
          borderRadius: 1,
          p: 1,
        }}
      >
        <Typography variant="caption" color="secondary">
          {'🔒 Members only — visitors see the teaser'}
        </Typography>
        <Box>{children}</Box>
      </Box>
    )
  }
  if (state === 'checking') return <Box ref={ref} {...rest} />
  if (state === 'entitled') {
    return (
      <Box ref={ref} {...rest}>
        {children}
      </Box>
    )
  }
  return (
    <Box
      ref={ref}
      {...rest}
      sx={{
        p: 4,
        textAlign: 'center',
        border: 1,
        borderColor: 'divider',
        borderRadius: 1,
      }}
    >
      <Typography variant="h6" gutterBottom>
        {'🔒 Members only'}
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        {teaserText ||
          (state === 'anonymous'
            ? 'Sign in or subscribe to unlock this content.'
            : 'Subscribe to unlock this content.')}
      </Typography>
      <Button
        variant="contained"
        color="primary"
        href={ctaHref || (state === 'anonymous' ? '/account' : '/shop')}
      >
        {ctaLabel || (state === 'anonymous' ? 'Sign in' : 'Get access')}
      </Button>
    </Box>
  )
})
Gate.displayName = 'AglynGate'

export const schema: Aglyn.ComponentSchema<GateProps> = {
  $id: ID,
  pluginId: BUNDLE_ID,
  displayName: 'Members gate',
  category: Aglyn.ComponentCategory.COMMERCE,
  attributes: [
    {
      name: 'productId',
      label: 'Required product id',
      description:
        'Members who bought or subscribe to this product get in; blank ' +
        'accepts any live subscription.',
      component: Aglyn.FieldComponentType.PRODUCT_SELECT,
    },
    {
      name: 'teaserText',
      label: 'Teaser text',
      description: 'Shown to non-members.',
      component: Aglyn.FieldComponentType.TEXT_FIELD,
    },
    {
      name: 'ctaLabel',
      label: 'CTA label',
      description: 'Button text for non-members.',
      component: Aglyn.FieldComponentType.TEXT_FIELD,
    },
    {
      name: 'ctaHref',
      label: 'CTA link',
      description: 'Where the button sends non-members.',
      component: Aglyn.FieldComponentType.TEXT_FIELD,
    },
  ],
  icon: { path: mdiLockOutline.path, sx: { color: '#2e7d32' } },
}

export const presets: Aglyn.PresetSchema[] = [
  {
    $id: generatePresetId(ID),
    type: Aglyn.NodeType.PRESET,
    displayName: 'Members gate',
    pluginId: BUNDLE_ID,
    description: 'Wraps content only entitled members can see',
    category: Aglyn.ComponentCategory.COMMERCE,
    icon: { path: mdiLockOutline.path, sx: { color: '#2e7d32' } },
    data: {
      $id: null,
      componentId: ID,
      pluginId: BUNDLE_ID,
      props: {},
    },
  },
]

export default Gate
