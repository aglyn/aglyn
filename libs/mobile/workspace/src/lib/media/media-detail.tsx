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

import { replaceMedia, useLiveDoc } from '@aglyn/mobile-core'
import type { MobilePluginContext } from '@aglyn/mobile-plugin-host'
import { Button, Card, EmptyState, Field, Icon, ListRow, Screen, Skeleton, Text, useMobileTheme } from '@aglyn/mobile-ui'
import { useState } from 'react'
import { Image, View } from 'react-native'
import { confirmAction, showNotice, showRefusal } from '../shared/actions'
import { formatBytes, formatDay, millisOf } from '../shared/format'
import { damTransport, pickPhoto, type PhotoSource } from './device-files'
import { consoleOrigin, useLibraryAccess } from './library-access'
import {
  damScopeOf,
  libraryPath,
  mediaDimensions,
  mediaImageUrl,
  mediaKindIcon,
  type MediaDoc,
  type MediaLibrary,
} from './media-model'
import { PhotoSourceSheet } from './photo-source-sheet'

/** How long the sheet takes to leave before the picker can be presented over the screen. */
export const SHEET_DISMISS_MS = 350

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** What `/api/media/references` answers, as the console's "Used on" list reads it. */
interface UsageRef {
  kind: string
  id: string
  name: string
  hostSubdomain?: string
  live?: boolean
}

const REF_KIND_LABEL: Record<string, string> = {
  screen: 'Page',
  layout: 'Layout',
  entry: 'Content',
  component: 'Component',
  site: 'Site settings',
  email: 'Email',
  plugin: 'Item',
}

type Usage = { refs: UsageRef[]; complete: boolean } | null

/*==========================================
 * ONE ASSET.
 *
 * Its preview and what the console's details drawer says of it. Replace
 * puts a new photo's bytes into THIS asset (`/api/media/replace`, through
 * `replaceMedia`): same id, same CDN path, so every page that shows it shows
 * the new photo. It carries the revision the screen was looking at, and the
 * route refuses (409) when someone changed the asset since. An image is
 * replaced only by an image, as the console's own replace insists. "Where
 * it's used" is the console's reference scan, asked on demand.
 *=========================================*/

export function MediaDetail({
  library,
  mediaId,
  context,
}: {
  library: MediaLibrary
  mediaId: string
  context: MobilePluginContext
}) {
  const theme = useMobileTheme()
  const media = useLiveDoc<Omit<MediaDoc, '$id'>>(context.firestore, [...libraryPath(library), mediaId])
  const access = useLibraryAccess(context, library)
  const [choosing, setChoosing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [usage, setUsage] = useState<Usage>(null)
  const [scanning, setScanning] = useState(false)
  const [previewFailed, setPreviewFailed] = useState(false)

  if (!media.ready) {
    return (
      <View style={{ padding: 16, gap: 12 }} testID="media-detail-loading">
        <Skeleton height={220} />
        <Skeleton height={16} width="60%" />
      </View>
    )
  }
  if (media.error || !media.data) {
    return <EmptyState icon="image-outline" title="This file is no longer in the library" />
  }
  const asset = media.data as MediaDoc
  const preview = asset.kind === 'image' && !previewFailed ? mediaImageUrl(asset, consoleOrigin(), 1280) : null
  const canReplace = access.canWrite && asset.kind === 'image'

  const replaceWith = async (source: PhotoSource) => {
    setChoosing(false)
    await wait(SHEET_DISMISS_MS)
    const file = await pickPhoto(source)
    if (!file) return
    const confirmed = await confirmAction({
      title: 'Replace this file?',
      message: `Every page that shows "${asset.fileName ?? 'this file'}" will show the new photo. This cannot be undone.`,
      confirmLabel: 'Replace',
      destructive: true,
    })
    if (!confirmed) return
    setBusy(true)
    try {
      const expectedUpdatedAtMs = millisOf(asset.updatedAt) ?? undefined
      await replaceMedia(damTransport(context.api), {
        scope: damScopeOf(library),
        mediaId,
        file,
        ...(expectedUpdatedAtMs ? { expectedUpdatedAtMs } : {}),
      })
      showNotice('File replaced', 'Pages that show it now show the new photo.')
    } catch (error) {
      showRefusal('Could not replace the file', error)
    } finally {
      setBusy(false)
    }
  }

  const scanUsage = async () => {
    setScanning(true)
    try {
      const payload = await context.api.request<{ references?: UsageRef[]; coverage?: string }>(
        '/api/media/references',
        { method: 'POST', body: { ...damScopeOf(library), mediaId } },
      )
      setUsage({
        refs: payload?.references ?? [],
        complete: payload?.coverage === 'full' || payload?.coverage === 'published',
      })
    } catch (error) {
      showRefusal('Could not check where it is used', error)
    } finally {
      setScanning(false)
    }
  }

  return (
    <Screen>
      <View
        style={{
          height: 240,
          borderRadius: theme.radius,
          backgroundColor: theme.colors.background.paper,
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
        }}
      >
        {preview ? (
          <Image
            testID="media-preview"
            source={{ uri: preview }}
            accessibilityLabel={asset.alt || asset.fileName}
            resizeMode="contain"
            onError={() => setPreviewFailed(true)}
            style={{ width: '100%', height: '100%' }}
          />
        ) : (
          <Icon name={mediaKindIcon(asset.kind)} size={56} />
        )}
      </View>
      <Card
        title={asset.fileName ?? mediaId}
        actions={
          canReplace ? (
            <Button
              testID="media-replace"
              title="Replace"
              variant="text"
              icon="swap-horizontal-outline"
              busy={busy}
              onPress={() => setChoosing(true)}
            />
          ) : null
        }
      >
        <Field label="Type" value={asset.contentType ?? asset.kind ?? 'Unknown'} />
        <Field label="Size" value={formatBytes(asset.sizeBytes) ?? 'Unknown'} testID="media-size" />
        {mediaDimensions(asset) ? <Field label="Dimensions" value={mediaDimensions(asset) as string} testID="media-dimensions" /> : null}
        <Field label="Alt text" value={asset.alt?.trim() ? asset.alt : 'Missing'} testID="media-alt" />
        {formatDay(asset.createdAt) ? <Field label="Uploaded" value={formatDay(asset.createdAt) as string} /> : null}
      </Card>
      {access.canWrite ? (
        <Card
          title="Where it's used"
          actions={
            <Button
              testID="media-usage"
              title={usage ? 'Check again' : 'Check'}
              variant="text"
              busy={scanning}
              onPress={() => void scanUsage()}
            />
          }
        >
          {!usage ? (
            <Text tone="secondary">Find the pages and content that show this file.</Text>
          ) : usage.refs.length ? (
            usage.refs.map((ref) => (
              <ListRow
                key={`${ref.kind}:${ref.id}`}
                icon="link-outline"
                title={ref.name || ref.id}
                subtitle={[REF_KIND_LABEL[ref.kind] ?? 'Item', ref.hostSubdomain, ref.live ? 'Published' : null]
                  .filter(Boolean)
                  .join(' · ')}
              />
            ))
          ) : (
            <Text tone="secondary" testID="media-usage-none">
              {usage.complete ? 'Nothing uses this file.' : 'Nothing found, but not everything could be checked.'}
            </Text>
          )}
        </Card>
      ) : null}
      <PhotoSourceSheet
        visible={choosing}
        title="Replace with"
        onClose={() => setChoosing(false)}
        onPick={(source) => void replaceWith(source)}
      />
    </Screen>
  )
}
