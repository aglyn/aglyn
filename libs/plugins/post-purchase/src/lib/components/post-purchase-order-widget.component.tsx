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

import { pluginDocsHelp } from '@aglyn/aglyn/app-utils/docs-help'
import { CardDisplay } from '@aglyn/shared-ui-jsx'
import { StatusChip, type StatusTone } from '@aglyn/shared-ui-jsx/components/status-chip.component'
import { Alert, Stack, Typography } from '@mui/material'
import { useEffect, useState } from 'react'
import { POST_PURCHASE_API_ROUTES } from '../constants/api-routes'
import { POST_PURCHASE_VENDOR_LABELS } from '../constants/bundle-common'
import type { PostPurchaseOrderView } from '../model/post-purchase-settings'
import { formatCents, usePostPurchaseAvailability, usePostPurchaseFetch } from './post-purchase-api'

/** What `orderDetail` hands a widget: the site and the order. */
export interface PostPurchaseOrderWidgetProps {
  hostId: string
  order: { id: string; currency?: string }
}

const PROTECTION_STATUS: Record<NonNullable<PostPurchaseOrderView['protection']>['status'], { label: string; tone: StatusTone }> = {
  registered: { label: 'Covered', tone: 'success' },
  registering: { label: 'Opening', tone: 'info' },
  cancelled: { label: 'Canceled', tone: 'neutral' },
  failed: { label: 'Needs attention', tone: 'error' },
}

/**
 * TRACKING AND PROTECTION on an order (AGL-3635): whether the buyer's
 * package protection is open at Route, which parcels AfterShip follows, and
 * when Narvar last had the order. Draws nothing for an order none of them
 * touched, and nothing where the deployment offers no service.
 */
export function PostPurchaseOrderWidget(props: PostPurchaseOrderWidgetProps) {
  const { hostId, order } = props
  const availability = usePostPurchaseAvailability(hostId)
  const request = usePostPurchaseFetch()
  const [view, setView] = useState<PostPurchaseOrderView | null>(null)

  useEffect(() => {
    if (!availability.available || !order?.id) return
    let live = true
    request<{ order: PostPurchaseOrderView }>(POST_PURCHASE_API_ROUTES.order, { query: { hostId, recordId: order.id } })
      .then((answer) => live && setView(answer.order))
      .catch(() => live && setView(null))
    return () => {
      live = false
    }
  }, [availability.available, hostId, order?.id, request])

  if (!availability.available || !view) return null
  if (!view.protection && !view.trackedParcels.length && !view.narvar) return null
  const protection = view.protection
  return (
    <CardDisplay
      header="Tracking and protection"
      help={pluginDocsHelp('postPurchase', {
        anchor: '#on-the-order',
        excerpt: 'Package protection on this order, the parcels a service follows, and what was sent to Narvar.',
      })}
      contentGutterX
      contentGutterY
    >
      <Stack spacing={1.5}>
        {protection ? (
          <Stack spacing={0.5}>
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
              <Typography variant="subtitle2">{'Package protection'}</Typography>
              <StatusChip {...PROTECTION_STATUS[protection.status]} data-testid="post-purchase-protection-status" />
            </Stack>
            <Typography variant="body2" color="text.secondary">
              {`${formatCents(protection.premiumCents, order.currency ?? 'usd')} paid by the buyer${
                protection.policyId ? ` · Route policy ${protection.policyId}` : ''
              }`}
            </Typography>
            {protection.error ? <Alert severity="warning">{protection.error}</Alert> : null}
          </Stack>
        ) : null}
        {view.trackedParcels.map((parcel) => (
          <Typography key={parcel.trackingNumber} variant="body2">
            {`${parcel.trackingNumber} · followed by ${POST_PURCHASE_VENDOR_LABELS[parcel.vendor]}`}
          </Typography>
        ))}
        {view.narvar ? (
          view.narvar.error ? (
            <Alert severity="warning">{`Narvar: ${view.narvar.error}`}</Alert>
          ) : (
            <Typography variant="body2" color="text.secondary">
              {`Sent to Narvar ${new Date(view.narvar.syncedAtMs).toLocaleString()}`}
            </Typography>
          )
        ) : null}
      </Stack>
    </CardDisplay>
  )
}

export default PostPurchaseOrderWidget
