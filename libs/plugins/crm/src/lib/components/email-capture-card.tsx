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

import { pluginDocsHelp } from '@aglyn/aglyn'
import { CardDisplay, useConfirmationContext } from '@aglyn/shared-ui-jsx'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import {
  Button,
  FormHelperText,
  InputAdornment,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import {
  CAPTURE_ADDRESS_HELPER,
  CopyCaptureAddressButton,
} from './copy-capture-address-button'
import { useCrmInboundAddress } from './use-crm-inbound-address'

export interface EmailCaptureCardProps {
  /** The site the section is read under, or `null` at the organization level. */
  hostId: string | null
  /** Whether the reader may rotate the address — a workspace owner or admin. */
  canManage: boolean
  /** Whether the scope and the role are known, so the address may be asked for. */
  ready: boolean
}

/** The accessible name of the rotate action. */
export const ROTATE_CAPTURE_ADDRESS_LABEL = 'Rotate address'

/**
 * "Email capture" — the workspace's one address for filing mail on
 * records (AGL-2657), with Copy and Rotate.
 *
 * The address is the organization's, so the card reads the same under a
 * site and at the organization level; what differs is only which route
 * variant answers. Rotation is behind a confirmation because it is the
 * one destructive act here: the old address goes quiet the moment the new
 * token is written, and every mailbox rule that carried it stops filing
 * without a word — the confirmation is where that word is said.
 */
export function EmailCaptureCard(props: EmailCaptureCardProps) {
  const { hostId, canManage, ready } = props
  const capture = useCrmInboundAddress(hostId, { enabled: ready })
  const { confirm } = useConfirmationContext()
  const { enqueueSnackbar } = useSnackbar()

  const handleRotate = async () => {
    const confirmed = await confirm({
      title: 'Rotate the capture address?',
      description:
        'The current address stops filing mail the moment it is replaced, and ' +
        'anything sent to it afterwards is dropped. Update every mailbox rule ' +
        'and shortcut that carries it.',
      confirmationText: ROTATE_CAPTURE_ADDRESS_LABEL,
      confirmationButtonProps: { color: 'error' },
    })
      .then(() => true)
      .catch(() => false)
    if (!confirmed) return
    const result = await capture.rotate()
    if (result.ok === false) {
      enqueueSnackbar(result.error, { variant: 'error', allowDuplicate: true })
      return
    }
    enqueueSnackbar('Capture address rotated', { variant: 'success', persist: false })
  }

  const canRotate = ready && canManage && capture.status === 'ready' && !capture.rotating
  return (
    <CardDisplay
      header={'Email capture'}
      help={pluginDocsHelp('crmSettings', { anchor: '#email-capture' })}
      contentGutterX
      contentGutterY
      HeaderProps={{
        action: (
          <Button variant="outlined" disabled={!canRotate} onClick={() => void handleRotate()}>
            {ROTATE_CAPTURE_ADDRESS_LABEL}
          </Button>
        ),
      }}
    >
      <Stack spacing={1}>
        <Typography variant="body2" color="text.secondary">
          {'One address for the whole workspace. A message forwarded or copied ' +
            'to it is filed on the timeline of the contact or lead it was with; ' +
            'the site the record belongs to is read off the record.'}
        </Typography>
        {capture.status === 'ready' ? (
          <TextField
            size="small"
            label="Capture address"
            value={capture.address}
            slotProps={{
              input: {
                readOnly: true,
                endAdornment: (
                  <InputAdornment position="end">
                    <CopyCaptureAddressButton address={capture.address} />
                  </InputAdornment>
                ),
              },
              inputLabel: { shrink: true },
            }}
            sx={{ maxWidth: 520 }}
          />
        ) : capture.status === 'error' ? (
          <Typography variant="body2" color="error">
            {capture.error}
          </Typography>
        ) : (
          <Typography variant="body2" color="text.secondary">
            {'Loading the address…'}
          </Typography>
        )}
        <FormHelperText>
          {`${CAPTURE_ADDRESS_HELPER} Only mail from or to somebody already in ` +
            'the CRM is filed; anything else is dropped and noted in the ' +
            'organization’s activity feed by its sender’s domain.'}
        </FormHelperText>
        {ready && !canManage ? (
          <Typography variant="caption" color="text.secondary">
            {'Only a workspace owner or admin can rotate the address.'}
          </Typography>
        ) : null}
      </Stack>
    </CardDisplay>
  )
}
EmailCaptureCard.displayName = 'EmailCaptureCard'

export default EmailCaptureCard
