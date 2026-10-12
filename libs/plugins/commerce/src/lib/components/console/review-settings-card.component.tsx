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
import { CardDisplay } from '@aglyn/shared-ui-jsx'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { useFirestore, useFirestoreDoc, useUser } from '@aglyn/tenant-feature-instance'
import { writeSiteWideChange } from '@aglyn/tenant-feature-instance/hooks/helpers/site-wide-change'
import {
  FormControlLabel,
  MenuItem,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material'
import { doc } from 'firebase/firestore'
import { useCallback, useEffect, useState } from 'react'
import * as CommerceModel from '../../model'

export interface ReviewSettingsCardProps {
  hostId: string
}

/**
 * Who may review the store's products, and the review-request email
 * (AGL-3736), on `hosts/{hostId}/settings/store.reviews`. Each control writes
 * only its own key, so this card never overwrites the store settings card's
 * fields beside it. Defaults: verified buyers only, the email on, 7 days.
 */
export function ReviewSettingsCard(props: ReviewSettingsCardProps) {
  const { hostId } = props
  const firestore = useFirestore()
  const { data: user } = useUser()
  const { enqueueSnackbar } = useSnackbar()
  const { data: store } = useFirestoreDoc<any>(
    () => doc(firestore, 'hosts', hostId, 'settings', 'store'),
    [firestore, hostId],
  )
  const settings = CommerceModel.reviewSettingsFrom(store)
  const [days, setDays] = useState(String(settings.requestDelayDays))
  useEffect(() => setDays(String(settings.requestDelayDays)), [settings.requestDelayDays])
  const [saving, setSaving] = useState<string | null>(null)

  const save = useCallback(
    async (key: 'policy' | 'requestEmail' | 'requestDelayDays', value: unknown) => {
      setSaving(key)
      try {
        // The policy decides what the product page's review form draws, so
        // the write carries the site's cache drop (AGL-3386).
        await writeSiteWideChange({
          firestore,
          user,
          hostId,
          write: (batch) =>
            batch.set(
              doc(firestore, 'hosts', hostId, 'settings', 'store'),
              { reviews: { [key]: value } },
              { merge: true },
            ),
        })
      } catch (error) {
        console.error(error)
        enqueueSnackbar('That setting could not be saved. Try again.', { variant: 'error' })
      } finally {
        setSaving(null)
      }
    },
    [enqueueSnackbar, firestore, hostId, user],
  )

  const commitDays = () => {
    const parsed = Math.round(Number(days))
    const bounded = Number.isFinite(parsed)
      ? Math.min(
          CommerceModel.REVIEW_REQUEST_DELAY_MAX_DAYS,
          Math.max(CommerceModel.REVIEW_REQUEST_DELAY_MIN_DAYS, parsed),
        )
      : CommerceModel.REVIEW_REQUEST_DELAY_DEFAULT_DAYS
    setDays(String(bounded))
    if (bounded !== settings.requestDelayDays) void save('requestDelayDays', bounded)
  }

  return (
    <CardDisplay
      header={'Reviews'}
      help={pluginDocsHelp('catalog', { anchor: '#review-settings' })}
      contentGutterX
      contentGutterY
    >
      <Stack spacing={1.5}>
        <TextField
          label="Who can review"
          value={settings.policy}
          onChange={(event) => void save('policy', event.target.value)}
          disabled={saving === 'policy'}
          size="small"
          select
          sx={{ maxWidth: 360 }}
          helperText={
            settings.policy === 'verified'
              ? 'Customers who bought the product: signed in to their account, or ' +
                'through the link in their review-request email. Their reviews ' +
                'publish right away with a "Verified buyer" badge.'
              : 'Anyone may review. Customers who bought the product still get the ' +
                '"Verified buyer" badge and publish right away; everyone else gives a ' +
                'name and email (never shown) and waits for your approval.'
          }
        >
          <MenuItem value="verified">{'Verified buyers only (recommended)'}</MenuItem>
          <MenuItem value="anyone">{'Anyone'}</MenuItem>
        </TextField>
        <FormControlLabel
          control={
            <Switch
              size="small"
              checked={settings.requestEmail}
              disabled={saving === 'requestEmail'}
              onChange={(change) => void save('requestEmail', change.target.checked)}
            />
          }
          label={
            <Stack>
              <Typography variant="body2">{'Ask customers for a review'}</Typography>
              <Typography variant="caption" color="text.secondary">
                {'One email per order, after it is fulfilled, with a link for each ' +
                  'product. Each link works once, for 60 days. Change its wording ' +
                  'under Emails → Review request.'}
              </Typography>
            </Stack>
          }
        />
        <TextField
          label="Send the request (days after fulfillment)"
          value={days}
          onChange={(event) => setDays(event.target.value)}
          onBlur={commitDays}
          disabled={!settings.requestEmail || saving === 'requestDelayDays'}
          size="small"
          type="number"
          slotProps={{
            htmlInput: {
              min: CommerceModel.REVIEW_REQUEST_DELAY_MIN_DAYS,
              max: CommerceModel.REVIEW_REQUEST_DELAY_MAX_DAYS,
            },
          }}
          sx={{ maxWidth: 280 }}
          helperText={`Between ${CommerceModel.REVIEW_REQUEST_DELAY_MIN_DAYS} and ${CommerceModel.REVIEW_REQUEST_DELAY_MAX_DAYS} days. Give the order time to arrive.`}
        />
        <Typography variant="caption" color="text.secondary">
          {'Verified reviews are published as written, good or bad. You can hide ' +
            'or reject one only for spam, abuse, being off-topic or sharing ' +
            'private information.'}
        </Typography>
      </Stack>
    </CardDisplay>
  )
}
ReviewSettingsCard.displayName = 'ReviewSettingsCard'

export default ReviewSettingsCard
