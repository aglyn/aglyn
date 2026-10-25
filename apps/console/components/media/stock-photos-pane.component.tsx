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

import { STOCK_PHOTO_QUERY_MAX_CHARS } from '@aglyn/aglyn/plugin-manager/stock-photo-provider'
import {
  createStockPhotoPickerClient,
  STOCK_PHOTO_PICKER_ROUTE,
  type StockPhotoPickerClient,
  type StockPhotoPickerHit,
  type StockPhotoPickerTarget,
} from '@aglyn/aglyn/app-utils/stock-photos/stock-photo-picker'
import { StockPhotoSearchPanel } from '@aglyn/shared-ui-jsx/components/stock-photo-search.component'
import { authorizedFetch } from '@aglyn/shared-util-http/authorized-token'
import { useUser } from '@aglyn/tenant-feature-instance'
import { LinearProgress } from '@mui/material'
import { useEffect, useMemo } from 'react'

export interface StockPhotosPaneProps {
  target: StockPhotoPickerTarget
  /** Where a used photo is saved, as a sentence ends. */
  libraryName: string
  selectedKey?: string | null
  onSelect: (hit: StockPhotoPickerHit, context: { previewUrl: string | null; libraryLabel: string }) => void
  /** The client bound to the member, for the dialog's confirm button; `null` once the pane is gone. */
  onClient: (client: StockPhotoPickerClient | null) => void
}

/**
 * The media picker's Stock photos tab (AGL-4066), bound to this app: the
 * shared search panel, talking to the console's route with the signed-in
 * member's credentials. Mounted only while the tab is open.
 */
export function StockPhotosPane(props: StockPhotosPaneProps) {
  const { target, libraryName, selectedKey, onSelect, onClient } = props
  const { data: user } = useUser()
  const client = useMemo(
    () =>
      user === undefined
        ? null
        : createStockPhotoPickerClient(
            (body) =>
              authorizedFetch(user, STOCK_PHOTO_PICKER_ROUTE, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
              }),
            target,
          ),
    [user, target],
  )
  useEffect(() => {
    onClient(client)
    return () => onClient(null)
  }, [client, onClient])
  if (!client) return <LinearProgress aria-label="Loading stock photos" />
  return (
    <StockPhotoSearchPanel
      client={client}
      libraryName={libraryName}
      maxQueryLength={STOCK_PHOTO_QUERY_MAX_CHARS}
      selectedKey={selectedKey}
      onSelect={onSelect}
    />
  )
}
StockPhotosPane.displayName = 'StockPhotosPane'

export default StockPhotosPane
