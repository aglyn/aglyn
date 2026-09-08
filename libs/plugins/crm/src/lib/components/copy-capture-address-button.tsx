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

import { mdiContentCopy } from '@aglyn/shared-data-mdi'
import { MdiIcon } from '@aglyn/shared-ui-jsx'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { IconButton } from '@mui/material'

/** The helper both surfaces print beside the address (AGL-2657). */
export const CAPTURE_ADDRESS_HELPER =
  'Forward a reply, or BCC this address from your mailbox, to file it on this record.'

/** The accessible name of the copy button, for the specs and the reader. */
export const COPY_CAPTURE_ADDRESS_LABEL = 'Copy the capture address'

/**
 * Puts the capture address on the clipboard (AGL-2657) — the one act a
 * member does with it, since the address is pasted into a mailbox and
 * never typed. The toast says it happened; a browser that refuses the
 * clipboard is told so rather than left to wonder.
 */
export function CopyCaptureAddressButton(props: { address: string }) {
  const { address } = props
  const { enqueueSnackbar } = useSnackbar()
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(address)
      enqueueSnackbar('Address copied', { variant: 'success', persist: false })
    } catch (cause) {
      console.error(cause)
      enqueueSnackbar('The address could not be copied', {
        variant: 'error',
        allowDuplicate: true,
      })
    }
  }
  return (
    <IconButton
      size="small"
      aria-label={COPY_CAPTURE_ADDRESS_LABEL}
      onClick={() => void copy()}
    >
      <MdiIcon path={mdiContentCopy.path} size={0.8} />
    </IconButton>
  )
}
CopyCaptureAddressButton.displayName = 'CopyCaptureAddressButton'

export default CopyCaptureAddressButton
