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
import { mdiEmailOutline } from '@aglyn/shared-data-mdi'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import { forwardRef, useState } from 'react'
import { BUNDLE_ID } from '../constants/bundle-common'
import { generatePresetId } from '../utils/generate-preset-id'

// Component ids are persisted in screen documents; never rename.
export const ID: Aglyn.ComponentId = 'newsletter-signup'

export interface NewsletterSignupProps {
  heading?: string
  buttonLabel?: string
  successText?: string
}

/**
 * Newsletter signup block (AGL-301): consented email capture straight
 * into the contacts CRM (source `newsletter`), ready for email-campaign
 * audiences.
 */
const NewsletterSignup = forwardRef<HTMLDivElement, NewsletterSignupProps>(
  (props, ref) => {
    const { heading, buttonLabel, successText, ...rest } = props
    const { hostId } = Aglyn.useSite()
    const [email, setEmail] = useState('')
    const [state, setState] = useState<'idle' | 'busy' | 'done' | 'error'>(
      'idle',
    )

    const handleSubscribe = async () => {
      if (!hostId || state === 'busy') return
      setState('busy')
      try {
        const response = await fetch('/api/commerce/newsletter', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ hostId, email }),
        })
        setState(response.ok ? 'done' : 'error')
      } catch {
        setState('error')
      }
    }

    if (state === 'done') {
      return (
        <Box ref={ref} {...rest} sx={{ py: 1 }}>
          <Typography variant="body2">
            {successText || 'You’re on the list — thanks!'}
          </Typography>
        </Box>
      )
    }

    return (
      <Box ref={ref} {...rest}>
        {heading ? (
          <Typography variant="subtitle1" gutterBottom>
            {heading}
          </Typography>
        ) : null}
        <Box sx={{ display: 'flex', gap: 1 }}>
          <TextField
            type="email"
            placeholder="you@example.com"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            size="small"
            sx={{ flex: 1, maxWidth: 320 }}
            error={state === 'error'}
            helperText={state === 'error' ? 'Enter a valid email' : undefined}
          />
          <Button
            variant="contained"
            color="primary"
            disabled={!hostId || state === 'busy' || !email.trim()}
            onClick={handleSubscribe}
          >
            {state === 'busy' ? '…' : buttonLabel || 'Subscribe'}
          </Button>
        </Box>
      </Box>
    )
  },
)
NewsletterSignup.displayName = 'AglynNewsletterSignup'

export const schema: Aglyn.ComponentSchema<NewsletterSignupProps> = {
  $id: ID,
  pluginId: BUNDLE_ID,
  displayName: 'Newsletter signup',
  category: Aglyn.ComponentCategory.DATA_DISPLAY,
  icon: { path: mdiEmailOutline.path, sx: { color: '#2e7d32' } },
  flags: { selfClosing: Aglyn.FEATURE_FLAG.ENABLED },
  attributes: [
    {
      name: 'heading',
      label: 'Heading',
      description: 'Shown above the field.',
      component: Aglyn.FieldComponentType.TEXT_FIELD,
    },
    {
      name: 'buttonLabel',
      label: 'Button label',
      description: 'Defaults to "Subscribe".',
      component: Aglyn.FieldComponentType.TEXT_FIELD,
    },
    {
      name: 'successText',
      label: 'Success text',
      description: 'Shown after subscribing.',
      component: Aglyn.FieldComponentType.TEXT_FIELD,
    },
  ],
}

export const presets: Aglyn.PresetSchema[] = [
  {
    $id: generatePresetId(ID),
    type: Aglyn.NodeType.PRESET,
    displayName: 'Newsletter signup',
    pluginId: BUNDLE_ID,
    description: 'Consented email capture into contacts',
    category: Aglyn.ComponentCategory.DATA_DISPLAY,
    icon: { path: mdiEmailOutline.path, sx: { color: '#2e7d32' } },
    data: {
      $id: null,
      componentId: ID,
      pluginId: BUNDLE_ID,
      props: { heading: 'Get updates and offers' },
    },
  },
]

export default NewsletterSignup
