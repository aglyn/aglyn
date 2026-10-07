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
import { authorizedFetch } from '@aglyn/shared-util-http/authorized-token'
import {
  useFirestore,
  useFirestoreDoc,
  useUser,
} from '@aglyn/tenant-feature-instance'
import { FormControlLabel, Stack, Switch, Typography } from '@mui/material'
import { doc, setDoc } from 'firebase/firestore'
import { useCallback, useEffect, useState } from 'react'
import * as CommerceModel from '../../model'

export interface CustomerNotificationsCardProps {
  hostId: string
}

/**
 * Which order messages the store sends its buyers (AGL-3610), on
 * `hosts/{hostId}/settings/store.buyerNotifications`. Every moment is ON
 * unless switched off here — transaction messages are on by default for every
 * store — and each switch writes only its own key, so this card can never
 * overwrite the store settings card's fields beside it.
 *
 * The "Also send as texts" switch appears only when the platform can send
 * texts (the receipt route's channel answer), so the card never offers a
 * channel that does not exist.
 */
export function CustomerNotificationsCard(props: CustomerNotificationsCardProps) {
  const { hostId } = props
  const firestore = useFirestore()
  const { data: user } = useUser()
  const { enqueueSnackbar } = useSnackbar()
  const { data: store } = useFirestoreDoc<any>(
    () => doc(firestore, 'hosts', hostId, 'settings', 'store'),
    [firestore, hostId],
  )
  const [smsAvailable, setSmsAvailable] = useState(false)
  const [saving, setSaving] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    void authorizedFetch(
      user,
      `/api/commerce/order-receipt-send?hostId=${encodeURIComponent(hostId)}`,
    )
      .then((response) => (response.ok ? response.json() : {}))
      .then((payload: any) => {
        if (live) setSmsAvailable(payload?.sms === true)
      })
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [hostId, user])

  const settings = store?.buyerNotifications
  const handleToggle = useCallback(
    async (key: CommerceModel.BuyerNotificationEvent | 'texts', on: boolean) => {
      setSaving(key)
      try {
        await setDoc(
          doc(firestore, 'hosts', hostId, 'settings', 'store'),
          { buyerNotifications: { [key]: on } },
          { merge: true },
        )
      } catch (error) {
        console.error(error)
        enqueueSnackbar('That setting could not be saved. Try again.', {
          variant: 'error',
        })
      } finally {
        setSaving(null)
      }
    },
    [enqueueSnackbar, firestore, hostId],
  )

  return (
    <CardDisplay
      header={'Customer notifications'}
      help={pluginDocsHelp('commerce')}
      contentGutterX
      contentGutterY
    >
      <Stack spacing={1}>
        <Typography variant="body2" color="text.secondary">
          {'The emails your customers get about their orders. Each one links ' +
            'to a private order status page with shipments and tracking. ' +
            'Change their wording and colors under Emails.'}
        </Typography>
        {CommerceModel.BUYER_NOTIFICATION_EVENTS.map((event) => {
          const label = CommerceModel.BUYER_NOTIFICATION_LABELS[event]
          return (
            <FormControlLabel
              key={event}
              control={
                <Switch
                  size="small"
                  checked={CommerceModel.buyerNotificationEnabled(settings, event)}
                  disabled={saving === event}
                  onChange={(change) => handleToggle(event, change.target.checked)}
                />
              }
              label={
                <Stack>
                  <Typography variant="body2">{label.label}</Typography>
                  <Typography variant="caption" color="text.secondary">
                    {label.description}
                  </Typography>
                </Stack>
              }
            />
          )
        })}
        {smsAvailable ? (
          <FormControlLabel
            control={
              <Switch
                size="small"
                checked={CommerceModel.buyerNotificationEnabled(settings, 'texts')}
                disabled={saving === 'texts'}
                onChange={(change) => handleToggle('texts', change.target.checked)}
              />
            }
            label={
              <Stack>
                <Typography variant="body2">{'Also send as texts'}</Typography>
                <Typography variant="caption" color="text.secondary">
                  {'When an order has the customer’s phone number for updates. ' +
                    'Customers can reply STOP to opt out.'}
                </Typography>
              </Stack>
            }
          />
        ) : null}
      </Stack>
    </CardDisplay>
  )
}
CustomerNotificationsCard.displayName = 'CustomerNotificationsCard'

export default CustomerNotificationsCard
