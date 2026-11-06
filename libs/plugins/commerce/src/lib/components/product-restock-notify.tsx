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

import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import TextField from '@mui/material/TextField'
import { useState } from 'react'

/*
 * THE BACK-IN-STOCK ALERT on a product page, in its own chunk (split out of
 * the Product detail block for AGL-4205): only a page showing a sold-out
 * variant downloads it.
 */

export interface ProductRestockNotifyProps {
  hostId: string
  productId: string
  /** The site's fetch, which carries its App Check and session. */
  siteFetch: (input: string, init?: RequestInit) => Promise<Response>
}

/** An email field and "Notify me": the store emails the shopper when it is back. */
export function ProductRestockNotify(props: ProductRestockNotifyProps) {
  const { hostId, productId, siteFetch } = props
  const [notifyEmail, setNotifyEmail] = useState('')
  const [notifyState, setNotifyState] = useState<'idle' | 'done'>('idle')
  return notifyState === 'done' ? (
    <Alert severity="success" sx={{ mb: 2 }}>
      {'We will email you when it is back.'}
    </Alert>
  ) : (
    <Box sx={{ display: 'flex', gap: 1, mb: 2 }}>
      <TextField
        placeholder="you@example.com"
        type="email"
        // Third instance of the nameless-input defect (AGL-2392).
        // Named for its job rather than "Email address": this row
        // appears inside a product page that may also carry the
        // newsletter block, and two fields both announced as
        // "Email address" is barely better than none.
        slotProps={{
          htmlInput: {
            'aria-label': 'Email address for back-in-stock alert',
          },
        }}
        value={notifyEmail}
        onChange={(event) => setNotifyEmail(event.target.value)}
        size="small"
        sx={{ flex: 1 }}
      />
      <Button
        size="small"
        variant="outlined"
        disabled={!notifyEmail.trim()}
        onClick={async () => {
          const response = await siteFetch('/api/commerce/notify-restock', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              hostId,
              productId: productId,
              email: notifyEmail,
            }),
          }).catch(() => null)
          if (response?.ok) setNotifyState('done')
        }}
      >
        {'Notify me'}
      </Button>
    </Box>
  )
}

ProductRestockNotify.displayName = 'ProductRestockNotify'

export default ProductRestockNotify
