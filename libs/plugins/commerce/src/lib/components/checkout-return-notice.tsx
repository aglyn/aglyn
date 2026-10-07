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
import Snackbar from '@mui/material/Snackbar'
import { useCheckoutReturnNotice } from '../utils/use-checkout-return-notice'

/**
 * Tells a shopper returned from checkout that their payment did not go
 * through (AGL-3606). A snackbar rather than an inline alert because the
 * cart that mounts it may be a closed drawer behind a badge, and the message
 * is about the whole page's purchase, not about the block it sits in.
 */
export function CheckoutReturnNotice({
  hostId,
  siteFetch,
}: {
  hostId: string
  siteFetch?: typeof fetch
}) {
  const [notice, dismiss] = useCheckoutReturnNotice(hostId, siteFetch)
  return (
    <Snackbar
      open={Boolean(notice)}
      onClose={(_event, reason) => {
        // A click elsewhere on the page is not the shopper reading this.
        if (reason !== 'clickaway') dismiss()
      }}
      anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
    >
      {/* Always an element: the exit transition still renders the child. */}
      <Alert severity={notice?.severity ?? 'info'} onClose={dismiss} role="alert">
        {notice?.message ?? ''}
      </Alert>
    </Snackbar>
  )
}
