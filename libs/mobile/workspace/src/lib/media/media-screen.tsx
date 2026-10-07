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

import type { MediaSort } from '@aglyn/aglyn/app-utils/media-filter'
import { searchWords, uploadMedia } from '@aglyn/mobile-core'
import type { MobileScreenProps } from '@aglyn/mobile-plugin-host'
import {
  Button,
  ChipRow,
  EmptyState,
  Icon,
  ListFooter,
  SearchField,
  Skeleton,
  SplitView,
  Text,
  useLayout,
  useMobileTheme,
} from '@aglyn/mobile-ui'
import type { Firestore } from 'firebase/firestore'
import { useMemo, useState } from 'react'
import { FlatList, Image, Pressable, View } from 'react-native'
import { WORKSPACE_MEDIA_ITEM_SCREEN } from '../screen-ids'
import { showRefusal } from '../shared/actions'
import { damTransport, pickPhoto, type PhotoSource } from './device-files'
import { consoleOrigin, libraryFor, useLibraryAccess } from './library-access'
import { MediaDetail, SHEET_DISMISS_MS } from './media-detail'
import {
  damScopeOf,
  libraryPath,
  MEDIA_SORT_CHIPS,
  MEDIA_TYPE_CHIPS,
  mediaGridColumns,
  mediaImageUrl,
  mediaKindIcon,
  mediaViewQuery,
  type MediaDoc,
  type MediaFolderPick,
  type MediaLibrary,
} from './media-model'
import { PhotoSourceSheet } from './photo-source-sheet'
import { useLivePlan, useMediaFolders } from './use-media'

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

function MediaTile({
  media,
  selected,
  onPress,
  size,
}: {
  media: MediaDoc
  selected: boolean
  onPress: () => void
  size: number
}) {
  const theme = useMobileTheme()
  // A thumbnail that will not load (offline, or a CDN that is not serving) falls back to the file's icon.
  const [failed, setFailed] = useState(false)
  const thumb = media.kind === 'image' && !failed ? mediaImageUrl(media, consoleOrigin(), 320) : null
  return (
    <Pressable
      testID={`media-${media.$id}`}
      accessibilityRole="button"
      accessibilityLabel={media.fileName ?? media.$id}
      accessibilityState={selected ? { selected: true } : undefined}
      onPress={onPress}
      style={{ width: size, padding: theme.space(0.5) }}
    >
      <View
        style={{
          height: size - theme.space(1),
          borderRadius: theme.radius,
          borderWidth: selected ? 2 : 1,
          borderColor: selected ? theme.colors.primary.main : theme.colors.divider,
          backgroundColor: theme.colors.background.paper,
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
        }}
      >
        {thumb ? (
          <Image
            source={{ uri: thumb }}
            resizeMode="cover"
            onError={() => setFailed(true)}
            style={{ width: '100%', height: '100%' }}
          />
        ) : (
          <Icon name={mediaKindIcon(media.kind)} size={32} />
        )}
      </View>
      <Text variant="caption" tone="secondary" numberOfLines={1}>
        {media.fileName ?? media.$id}
      </Text>
    </Pressable>
  )
}

/*==========================================
 * THE MEDIA LIBRARY.
 *
 * The console's library filters, as chips over its one query: the library
 * (this site's or the workspace's), Type, the folder (every file, no folder,
 * or one top-level folder), the sort and the search. A grid of thumbnails,
 * two across on a phone; on a tablet the grid and the open file side by
 * side. Upload takes a photo or picks one and sends it through the
 * console's upload routes into the folder that is open.
 *=========================================*/

export default function MediaScreen({ params, context }: MobileScreenProps) {
  const layout = useLayout()
  const initial = useMemo(() => libraryFor(params, context), [params, context])
  const [library, setLibrary] = useState<MediaLibrary | null>(initial)
  const [type, setType] = useState('all')
  const [folder, setFolder] = useState<MediaFolderPick>('all')
  const [sort, setSort] = useState<MediaSort>('newest')
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<string | null>(null)
  const [choosing, setChoosing] = useState(false)
  const [uploading, setUploading] = useState(false)
  const access = useLibraryAccess(context, library)

  const blocked = Boolean(access.scopeTokens && access.scopeTokens.length === 0)
  const enabled = Boolean(library) && access.ready && !blocked
  const plan = useMemo(
    () => mediaViewQuery({ type, folder, sort, search: searchWords(search) }, access.scopeTokens),
    [type, folder, sort, search, access.scopeTokens],
  )
  const list = useLivePlan<MediaDoc>({
    firestore: context.firestore,
    path: library ? libraryPath(library) : null,
    plan,
    enabled,
  })
  const folders = useMediaFolders({
    firestore: context.firestore,
    path: library ? libraryPath(library, 'mediaFolders') : null,
    scopeTokens: access.scopeTokens,
    enabled,
  })

  const libraryChips = [
    ...(context.hostId ? [{ value: `site:${context.hostId}`, label: 'This site' }] : []),
    ...(context.orgId ? [{ value: `org:${context.orgId}`, label: 'Workspace' }] : []),
  ]
  const libraryKey = library ? `${library.kind}:${library.kind === 'site' ? library.hostId : library.orgId}` : ''
  const folderChips = [
    { value: 'all', label: 'All files' },
    { value: 'root', label: 'No folder' },
    ...folders
      .filter((entry) => !entry.parentId)
      .map((entry) => ({ value: entry.$id, label: entry.name || 'Untitled folder' })),
  ]

  const pickLibrary = (value: string) => {
    const [kind, id] = value.split(':')
    setLibrary(kind === 'site' ? { kind: 'site', hostId: id } : { kind: 'org', orgId: id })
    setFolder('all')
    setSelected(null)
  }

  const open = (media: MediaDoc) => {
    if (!library) return
    if (layout.split) setSelected(media.$id)
    else
      context.navigate(WORKSPACE_MEDIA_ITEM_SCREEN, {
        mediaId: media.$id,
        library: library.kind,
        scopeId: library.kind === 'site' ? library.hostId : library.orgId,
      })
  }

  const upload = async (source: PhotoSource) => {
    setChoosing(false)
    if (!library) return
    await wait(SHEET_DISMISS_MS)
    const file = await pickPhoto(source)
    if (!file) return
    setUploading(true)
    try {
      const asset = await uploadMedia(damTransport(context.api), context.firestore as Firestore, {
        scope: damScopeOf(library),
        file,
        folderId: folder === 'all' || folder === 'root' ? null : folder,
      })
      if (layout.split) setSelected(asset.mediaId)
    } catch (error) {
      showRefusal('Could not upload the photo', error)
    } finally {
      setUploading(false)
    }
  }

  const columns = mediaGridColumns(layout.width, layout.split)
  const paneWidth = layout.split ? Math.round(layout.width * 0.58) : layout.width
  const tileSize = Math.floor((paneWidth - 16) / columns)

  const grid = !library ? (
    <EmptyState icon="images-outline" title="Pick a workspace first" />
  ) : blocked ? (
    <EmptyState icon="lock-closed-outline" title="No files are shared with you here" />
  ) : !list.ready ? (
    <View style={{ padding: 16, gap: 12 }} testID="media-loading">
      <Skeleton height={tileSize > 0 ? Math.min(tileSize, 160) : 120} />
      <Skeleton height={16} width="50%" />
    </View>
  ) : list.error ? (
    <EmptyState icon="warning-outline" title="This library could not be loaded" body="Check your connection and try again." />
  ) : (
    <FlatList
      testID="media-grid"
      key={`grid-${columns}`}
      data={list.rows}
      numColumns={columns}
      keyExtractor={(row) => row.$id}
      contentContainerStyle={{ paddingHorizontal: 8 }}
      onEndReached={list.loadMore}
      onEndReachedThreshold={0.5}
      ListEmptyComponent={
        type !== 'all' || folder !== 'all' || search.trim() ? (
          <EmptyState icon="search-outline" title="No files match these filters" />
        ) : (
          <EmptyState icon="images-outline" title="No files yet" body="Photos you upload show up here." />
        )
      }
      ListFooterComponent={<ListFooter hasMore={list.hasMore} onLoadMore={list.loadMore} />}
      renderItem={({ item }) => (
        <MediaTile media={item} size={tileSize} selected={layout.split && item.$id === selected} onPress={() => open(item)} />
      )}
    />
  )

  const listPane = (
    <View style={{ flex: 1 }}>
      {libraryChips.length > 1 ? (
        <ChipRow testID="media-library" options={libraryChips} value={libraryKey} onChange={pickLibrary} />
      ) : null}
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <View style={{ flex: 1 }}>
          <SearchField testID="media-search" value={search} onChangeText={setSearch} placeholder="Search files" />
        </View>
        {access.canWrite ? (
          <View style={{ paddingTop: 8, paddingRight: 16 }}>
            <Button
              testID="media-upload"
              title="Upload"
              icon="cloud-upload-outline"
              busy={uploading}
              onPress={() => setChoosing(true)}
            />
          </View>
        ) : null}
      </View>
      <ChipRow testID="media-type" options={MEDIA_TYPE_CHIPS} value={type} onChange={setType} />
      <ChipRow testID="media-folder" options={folderChips} value={folder} onChange={setFolder} />
      <ChipRow<MediaSort> testID="media-sort" options={MEDIA_SORT_CHIPS} value={sort} onChange={setSort} />
      {plan.notices.map((notice) => (
        <Text key={notice} variant="caption" tone="secondary" style={{ paddingHorizontal: 16 }}>
          {notice}
        </Text>
      ))}
      {grid}
      <PhotoSourceSheet
        visible={choosing}
        title="Upload a photo"
        onClose={() => setChoosing(false)}
        onPick={(source) => void upload(source)}
      />
    </View>
  )

  return (
    <SplitView
      listWidth={paneWidth}
      list={listPane}
      detail={
        selected && library ? (
          <MediaDetail key={`${libraryKey}:${selected}`} library={library} mediaId={selected} context={context} />
        ) : (
          <EmptyState icon="image-outline" title="Pick a file to see it here" />
        )
      }
    />
  )
}

