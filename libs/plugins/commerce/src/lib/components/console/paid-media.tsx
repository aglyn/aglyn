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

import {
  formatMediaRef,
  paidMediaAssetOf,
  parsePaidMediaSource,
  type PickedMedia,
  useMediaPicker,
} from '@aglyn/aglyn'
import { useConfirmationContext } from '@aglyn/shared-ui-jsx'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { authorizedFetch } from '@aglyn/shared-util-http/authorized-token'
import { useFirestore, useUser } from '@aglyn/tenant-feature-instance'
import { Button, Chip, Stack, Tooltip, Typography } from '@mui/material'
import { doc, getDoc } from 'firebase/firestore'
import { useCallback, useEffect, useState } from 'react'

/**
 * A product's members videos (AGL-2814) and paid downloads (AGL-2847) are
 * private files.
 *
 * The stream and download routes only ever hand a buyer a link that expires,
 * and they can only do that for a PRIVATE asset: a public one already has a
 * URL that works for anyone, forever, and the routes refuse to deliver it. So
 * adding a file to a product makes it private, and the product editor shows,
 * per file, whether that is still true.
 *
 * Making a file private is visible outside the product. A trailer that is
 * also on a public page stops playing there, and every public link to it that
 * was already shared dies. The author is told which places use it before
 * confirming, from the same where-used scan the media library runs before a
 * delete.
 */

/** A where-used row, reduced to what the confirmation reads. */
export interface PaidMediaReference {
  kind: string
  id: string
  name: string
  hostId: string
  collectionId?: string
}

/** How far the where-used scan got before the author was asked. */
export type PaidMediaUsageCheck = 'full' | 'partial' | 'failed'

/** Which list a flow adds to, for the words it uses. */
export type PaidMediaKind = 'video' | 'download'

const PAID_MEDIA_COPY: Record<
  PaidMediaKind,
  { title: string; lead: string; notAdded: string; unusable: string; choose: string }
> = {
  video: {
    title: 'Make this video private?',
    lead:
      'Members videos are private: buyers play them through a link that ' +
      'expires, and nobody else can open them.',
    notAdded: 'The video was not added.',
    unusable: 'Members cannot play it until it is private.',
    choose: 'Choose the video from the media library, so its links can expire.',
  },
  download: {
    title: 'Make this file private?',
    lead:
      'Paid downloads are private: buyers get a link that expires, and nobody ' +
      'else can open the file.',
    notAdded: 'The file was not added.',
    unusable: 'Buyers cannot download it until it is private.',
    choose: 'Choose the file from the media library, so its links can expire.',
  },
}

/** The request body that names an asset's library to the media routes. */
export function paidMediaScopeBody(
  scope: string,
): { orgId: string } | { hostId: string } {
  return scope.startsWith('org:')
    ? { orgId: scope.slice('org:'.length).split(':')[0] }
    : { hostId: scope }
}

/**
 * Where an asset is used, apart from the product it is being added to. That
 * product's own row is not a place making it private could break.
 */
export function usesBesideProduct(
  references: readonly PaidMediaReference[],
  product: { hostId: string; productId?: string },
): PaidMediaReference[] {
  return references.filter(
    (reference) =>
      !(
        product.productId &&
        reference.kind === 'plugin' &&
        reference.collectionId === 'products' &&
        reference.hostId === product.hostId &&
        reference.id === product.productId
      ),
  )
}

/** What the author reads before a video becomes private. */
export function paidMediaConfirmation(options: {
  others: readonly PaidMediaReference[]
  checked: PaidMediaUsageCheck
  kind?: PaidMediaKind
}): string {
  const { others, checked } = options
  const { lead } = PAID_MEDIA_COPY[options.kind ?? 'video']
  let usage: string
  if (others.length) {
    const names = others
      .slice(0, 3)
      .map((reference) => `“${reference.name}”`)
      .join(', ')
    const more = others.length > 3 ? ` and ${others.length - 3} more` : ''
    usage = `It is also used on ${names}${more}, and it stops showing there.`
  } else if (checked === 'full') {
    usage = 'Nothing else uses it.'
  } else if (checked === 'partial') {
    usage =
      'We could not check everywhere it might be used, so something else ' +
      'could still rely on it.'
  } else {
    usage = 'We could not check where else it is used.'
  }
  return `${lead} ${usage} Any public link to it that was already shared stops working too.`
}

/**
 * Adds a picked file to a product as paid media, making it private first when
 * it is not, and makes an already-added one private.
 */
export function usePaidMediaAttach(product: {
  hostId: string
  productId?: string
  kind?: PaidMediaKind
}) {
  const { hostId, productId } = product
  const kind = product.kind ?? 'video'
  const copy = PAID_MEDIA_COPY[kind]
  const { data: user } = useUser()
  const { confirm } = useConfirmationContext()
  const { enqueueSnackbar } = useSnackbar()

  const protect = useCallback(
    async (
      asset: { scope: string; mediaId: string },
      options: { adding: boolean },
    ): Promise<boolean> => {
      const scopeBody = paidMediaScopeBody(asset.scope)
      let others: PaidMediaReference[] = []
      let checked: PaidMediaUsageCheck = 'failed'
      try {
        const response = await authorizedFetch(user, '/api/media/references', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...scopeBody, mediaId: asset.mediaId }),
        })
        if (response.ok) {
          const payload = await response.json()
          others = usesBesideProduct(
            Array.isArray(payload?.references) ? payload.references : [],
            { hostId, productId },
          )
          checked = payload?.complete ? 'full' : 'partial'
        }
      } catch {
        // Said in the confirmation instead: "we could not check" is not
        // "nothing uses it".
      }
      const confirmed = await confirm({
        title: copy.title,
        description: paidMediaConfirmation({ others, checked, kind }),
        confirmationText: 'Make private',
      })
        .then(() => true)
        .catch(() => false)
      if (!confirmed) return false
      const response = await authorizedFetch(user, '/api/media/folders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...scopeBody,
          action: 'set-private',
          mediaId: asset.mediaId,
          private: true,
        }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        const reason = String(payload?.error ?? 'Could not make the video private')
        enqueueSnackbar(
          `${reason}. ${options.adding ? copy.notAdded : copy.unusable}`,
          { variant: 'error', allowDuplicate: true },
        )
        return false
      }
      if (payload?.rawUrlCleared === false) {
        enqueueSnackbar(
          'The video is private, but an old public download link to it could ' +
            'not be confirmed dead. Make it private again from the media ' +
            'library to retry.',
          { variant: 'warning', persist: false },
        )
      }
      return true
    },
    [confirm, copy, enqueueSnackbar, hostId, kind, productId, user],
  )

  /** The value to store on the product, or null when nothing was added. */
  const attach = useCallback(
    async (picked: PickedMedia): Promise<string | null> => {
      const reference =
        picked.mediaScope && picked.mediaId
          ? formatMediaRef(picked.mediaScope, picked.mediaId)
          : undefined
      if (!reference || !picked.mediaScope || !picked.mediaId) {
        enqueueSnackbar(copy.choose, { variant: 'warning', persist: false })
        return null
      }
      if (picked.private) return reference
      const madePrivate = await protect(
        { scope: picked.mediaScope, mediaId: picked.mediaId },
        { adding: true },
      )
      return madePrivate ? reference : null
    },
    [copy, enqueueSnackbar, protect],
  )

  return { attach, protect }
}

type Protection = 'checking' | 'private' | 'public' | 'missing' | 'unknown'

/**
 * Whether one stored paid file can be delivered, read off its media document.
 * A public one gets the button that fixes it.
 */
export function PaidMediaProtection(props: {
  url: string
  hostId: string
  productId?: string
  kind?: PaidMediaKind
}) {
  const { url, hostId, productId, kind } = props
  const firestore = useFirestore()
  const { protect } = usePaidMediaAttach({ hostId, productId, kind })
  const [protection, setProtection] = useState<Protection>('checking')
  const [generation, setGeneration] = useState(0)
  const source = parsePaidMediaSource(url)
  const asset = paidMediaAssetOf(url)

  useEffect(() => {
    const target = paidMediaAssetOf(url)
    if (!target) return
    let active = true
    setProtection('checking')
    const reference = target.scope.startsWith('org:')
      ? doc(
          firestore,
          'orgs',
          target.scope.slice('org:'.length).split(':')[0],
          'media',
          target.mediaId,
        )
      : doc(firestore, 'hosts', target.scope, 'media', target.mediaId)
    getDoc(reference)
      .then((snapshot) => {
        if (!active) return
        if (!snapshot.exists() || snapshot.get('deletedAt')) {
          setProtection('missing')
        } else {
          setProtection(snapshot.get('private') === true ? 'private' : 'public')
        }
      })
      .catch(() => {
        if (active) setProtection('unknown')
      })
    return () => {
      active = false
    }
  }, [firestore, url, generation])

  if (source.kind === 'external') {
    return (
      <Tooltip title="Served by another site, so its links cannot be made to expire.">
        <Chip size="small" label="Hosted elsewhere" />
      </Tooltip>
    )
  }
  if (source.kind === 'malformed') {
    return <Chip size="small" color="error" label="Cannot be played" />
  }
  if (!asset) return null
  if (protection === 'private') {
    return (
      <Tooltip title="Buyers get a link that expires.">
        <Chip size="small" color="success" label="Private" />
      </Tooltip>
    )
  }
  if (protection === 'public') {
    return (
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
        <Tooltip title="Anyone with its link can open a public file, so buyers cannot get it until it is private.">
          <Chip size="small" color="warning" label="Public" />
        </Tooltip>
        <Button
          size="small"
          onClick={() =>
            void protect(asset, { adding: false }).then((madePrivate) => {
              if (madePrivate) setGeneration((value) => value + 1)
            })
          }
        >
          {'Make private'}
        </Button>
      </Stack>
    )
  }
  if (protection === 'missing') {
    return <Chip size="small" color="error" label="Not in the media library" />
  }
  return null
}

/** One entry of a product's members video list. */
export interface MembersVideo {
  url: string
  title?: string
}

/**
 * A product's members videos: each with whether it can play, and the button
 * that adds one.
 *
 * Its own component so the product editor's body stays free while the editor
 * is closed: the editor is rendered on every visit to the catalog, and this
 * only mounts inside the open dialog.
 */
export function MembersVideosField(props: {
  hostId: string
  productId?: string
  videos: readonly MembersVideo[]
  onChange: (videos: MembersVideo[]) => void
}) {
  const { hostId, productId, videos, onChange } = props
  const { pickMedia } = useMediaPicker()
  const { attach } = usePaidMediaAttach({ hostId, productId })
  return (
    <>
      {videos.map((video, index) => (
        <Stack key={index} direction="row" spacing={1} sx={{ alignItems: 'center' }}>
          <Typography variant="body2" sx={{ flex: 1 }} noWrap>
            {`🎬 ${video.title || video.url}`}
          </Typography>
          <PaidMediaProtection url={video.url} hostId={hostId} productId={productId} />
          <Button
            size="small"
            color="error"
            onClick={() =>
              onChange(videos.filter((_item, itemIndex) => itemIndex !== index))
            }
          >
            {'✕'}
          </Button>
        </Stack>
      ))}
      <Button
        size="small"
        sx={{ alignSelf: 'flex-start' }}
        onClick={() =>
          void (async () => {
            // A private file is the only kind a members video can be, so the
            // picker offers private files here and nowhere else.
            const media = await pickMedia?.({ allowPrivate: true })
            if (!media) return
            const url = await attach(media)
            if (!url) return
            onChange([...videos, { url, title: media.fileName ?? '' }])
          })()
        }
      >
        {'Add members video'}
      </Button>
    </>
  )
}

/**
 * The button that adds a paid download (AGL-2847): the picker offers private
 * files, and a public one is made private before it is added.
 *
 * Its own component for the same reason as {@link MembersVideosField}: the
 * product editor's body runs while the editor is closed, and this only mounts
 * inside the open dialog.
 */
export function PaidDownloadAddButton(props: {
  hostId: string
  productId?: string
  onAdd: (file: { url: string; fileName: string }) => void
}) {
  const { hostId, productId, onAdd } = props
  const { pickMedia } = useMediaPicker()
  const { attach } = usePaidMediaAttach({ hostId, productId, kind: 'download' })
  return (
    <Button
      size="small"
      onClick={() =>
        void (async () => {
          const media = await pickMedia?.({ allowPrivate: true })
          if (!media) return
          const url = await attach(media)
          if (!url) return
          onAdd({ url, fileName: media.fileName ?? 'download' })
        })()
      }
    >
      {'Add file (media library)'}
    </Button>
  )
}
