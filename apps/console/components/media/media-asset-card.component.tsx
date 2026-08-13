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

import type * as Aglyn from '@aglyn/aglyn'
import { describeScope, isOrgWideScope } from '@aglyn/aglyn'
import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import LockOutlinedIcon from '@mui/icons-material/LockOutlined'
import MoreVertIcon from '@mui/icons-material/MoreVert'
import VisibilityOffOutlinedIcon from '@mui/icons-material/VisibilityOffOutlined'
import {
  Box,
  Card,
  CardMedia,
  Checkbox,
  IconButton,
  Menu,
  MenuItem,
  Stack,
  Chip,
  Tooltip,
  Typography,
} from '@mui/material'
import { type MouseEvent, useState } from 'react'
import { mediaFileTypeIcon } from '../../utils/media-file-icon'
import { mediaThumbnailSrc } from '../../utils/media-src'

export interface MediaAssetCardProps {
  media: Aglyn.AglynHostMedia
  /** Human-readable byte formatter shared with the library toolbar. */
  formatBytes: (bytes: number) => string
  /** Picker mode: clicking the card selects it; row actions are hidden. */
  onSelect?: (media: Aglyn.AglynHostMedia) => void
  /** Selection (non-picker multi-select). */
  selectable?: boolean
  selected?: boolean
  /**
   * `range` reports that ⇧ was held (AGL-1462): act on everything between the
   * last plainly-clicked card and this one. The card only reports the
   * modifier — what a range MEANS is the grid's question, since only the grid
   * knows the order the cards are drawn in.
   */
  onToggleSelect?: (checked: boolean, options?: { range?: boolean }) => void
  /** Overflow-menu actions (non-picker). */
  onCopyUrl?: () => void
  onReplace?: () => void
  onDetails?: () => void
  onDelete?: () => void
  /** Toggle the AGL-1051 private flag; omitted where the caller can't. */
  onSetPrivate?: (makePrivate: boolean) => void
}

const THUMB_HEIGHT = 116

/**
 * A single asset tile for the DAM grid (AGL-817). One consistent card used
 * by the library and every picker: fixed-height thumbnail, filename that
 * never wraps (tooltip on hover), a size/type caption, and — instead of the
 * old three inline buttons that clipped in narrow cells — a single overflow
 * menu revealed on hover. In picker mode the whole tile is the click target.
 */
export function MediaAssetCard(props: MediaAssetCardProps) {
  const {
    media,
    formatBytes,
    onSelect,
    selectable,
    selected,
    onToggleSelect,
    onCopyUrl,
    onReplace,
    onDetails,
    onDelete,
    onSetPrivate,
  } = props
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null)
  const picker = Boolean(onSelect)
  const contentType = String(media.contentType ?? '')
  const isVideo = contentType.startsWith('video/')
  // Only an image has a thumbnail to draw. Everything else — PDF, ZIP, and
  // any type the allowlist grows later — gets a glyph, because the `<img>`
  // this used to fall through to renders an EMPTY card (AGL-1463).
  const isImage = contentType.startsWith('image/')
  const { Icon: FileTypeIcon, label: fileTypeLabel } =
    mediaFileTypeIcon(contentType)
  const fileName = media.fileName ?? (media as any).$id

  const openMenu = (event: MouseEvent<HTMLElement>) => {
    event.stopPropagation()
    setMenuAnchor(event.currentTarget)
  }
  const closeMenu = () => setMenuAnchor(null)
  const runAction = (action?: () => void) => () => {
    closeMenu()
    action?.()
  }

  // The primary click: select in picker mode, open details otherwise —
  // except a ⇧-click on a selectable card, which extends the selection
  // (AGL-1462). Opening the details drawer on ⇧-click would be the one
  // gesture nobody means by it, and the checkbox is a 20px target that only
  // appears on hover, so the card body has to answer ⇧ too.
  const handlePrimary =
    selectable || picker || onDetails
      ? (event: MouseEvent<HTMLElement>) => {
          if (selectable && event.shiftKey) {
            event.preventDefault()
            return onToggleSelect?.(true, { range: true })
          }
          if (picker) return onSelect?.(media)
          onDetails?.()
        }
      : undefined

  const thumbSx = {
    height: THUMB_HEIGHT,
    objectFit: 'cover' as const,
    cursor: handlePrimary ? 'pointer' : undefined,
    bgcolor: 'action.hover',
  }

  return (
    <Card
      variant="outlined"
      sx={{
        position: 'relative',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        transition: (theme) =>
          theme.transitions.create(['box-shadow', 'border-color']),
        borderColor: selected ? 'primary.main' : 'divider',
        '&:hover': {
          boxShadow: 2,
          borderColor: selected ? 'primary.main' : 'text.disabled',
        },
        // Reveal the checkbox + overflow affordances on hover/focus-within.
        '&:hover .media-card-affordance, &:focus-within .media-card-affordance':
          { opacity: 1 },
      }}
    >
      {selectable ? (
        <Checkbox
          className="media-card-affordance"
          size="small"
          checked={Boolean(selected)}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
          onChange={(event) =>
            onToggleSelect?.(event.target.checked, {
              // A checkbox `change` carries the originating mouse event, so
              // ⇧-clicking the box ranges exactly as ⇧-clicking the tile does.
              range: Boolean(
                (event.nativeEvent as { shiftKey?: boolean })?.shiftKey,
              ),
            })
          }
          sx={{
            position: 'absolute',
            top: 2,
            left: 2,
            zIndex: 2,
            p: 0.25,
            opacity: selected ? 1 : 0,
            transition: (theme) => theme.transitions.create('opacity'),
            bgcolor: 'background.paper',
            borderRadius: 1,
            '&:hover': { bgcolor: 'background.paper' },
          }}
        />
      ) : null}
      {picker && selected ? (
        <CheckCircleIcon
          color="primary"
          sx={{ position: 'absolute', top: 4, right: 4, zIndex: 2 }}
        />
      ) : null}

      {isVideo ? (
        <CardMedia
          component="video"
          src={media.url}
          muted
          onClick={handlePrimary}
          sx={thumbSx}
        />
      ) : isImage ? (
        <CardMedia
          component="img"
          // The 320px WebP variant, not the full-size original. The tile is
          // THUMB_HEIGHT tall; `media.url` was the raw Cloud Storage URL, so
          // a grid of 24 assets pulled megabytes of originals from Storage
          // on every view and never touched the edge cache. Video stays on
          // `media.url` deliberately — `serveMediaCdn` ignores `Range`.
          image={mediaThumbnailSrc(media, 320)}
          alt={media.alt || fileName || ''}
          onClick={handlePrimary}
          sx={thumbSx}
        />
      ) : (
        // The terminal branch, deliberately: every remaining type lands here
        // and `mediaFileTypeIcon` always answers, so no content type can
        // reach the grid without a glyph.
        <CardMedia
          onClick={handlePrimary}
          sx={{
            ...thumbSx,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'text.secondary',
          }}
        >
          <FileTypeIcon fontSize="large" titleAccess={fileTypeLabel} />
        </CardMedia>
      )}

      <Stack
        direction="row"
        spacing={0.5}
        sx={{ alignItems: 'flex-start', px: 1, py: 0.75, minWidth: 0 }}
      >
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Tooltip title={fileName} enterDelay={600}>
            <Typography variant="caption" noWrap component="div" sx={{ fontWeight: 500 }}>
              {fileName}
            </Typography>
          </Tooltip>
          <Typography
            variant="caption"
            color="text.secondary"
            noWrap
            component="div"
          >
            {`${fileTypeLabel} · ${formatBytes(media.sizeBytes ?? 0)}`}
          </Typography>
          {/* Restriction is visible without opening the drawer (AGL-1045).
              Only shown when it is actually restricted — badging every
              org-wide asset would be noise on the common case. */}
          {media.visibleTo && !isOrgWideScope(media.visibleTo) ? (
            <Tooltip title={describeScope(media.visibleTo)}>
              <Chip
                size="small"
                icon={<LockOutlinedIcon />}
                label={describeScope(media.visibleTo)}
                sx={{ mt: 0.5, maxWidth: '100%' }}
              />
            </Tooltip>
          ) : null}
          {/* Private is a different fact from restricted (AGL-1051) and
              gets its own badge, not a variant of the scope chip: this one
              says the bytes need a signed link and the file cannot go on a
              page at all. Someone scanning the grid for "why won't this
              one work" needs to see it without opening anything. */}
          {media.private ? (
            <Tooltip title="Private — needs a signed link, and cannot be placed on a page">
              <Chip
                size="small"
                color="warning"
                icon={<VisibilityOffOutlinedIcon />}
                label="Private"
                sx={{ mt: 0.5, maxWidth: '100%' }}
              />
            </Tooltip>
          ) : null}
        </Box>
        {picker ? null : (
          <IconButton
            className="media-card-affordance"
            size="small"
            aria-label="File actions"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={openMenu}
            sx={{
              mt: -0.25,
              mr: -0.5,
              opacity: { xs: 1, md: 0 },
              transition: (theme) => theme.transitions.create('opacity'),
            }}
          >
            <MoreVertIcon fontSize="small" />
          </IconButton>
        )}
      </Stack>

      <Menu anchorEl={menuAnchor} open={Boolean(menuAnchor)} onClose={closeMenu}>
        {/* A private asset has no permanent URL to copy — offering the item
            would hand over a link that 404s (AGL-1051). */}
        {onCopyUrl && !media.private ? (
          <MenuItem onClick={runAction(onCopyUrl)}>{'Copy URL'}</MenuItem>
        ) : null}
        {onSetPrivate ? (
          <MenuItem onClick={runAction(() => onSetPrivate(!media.private))}>
            {media.private ? 'Publish file' : 'Make private'}
          </MenuItem>
        ) : null}
        {onReplace ? (
          <MenuItem onClick={runAction(onReplace)}>{'Replace file'}</MenuItem>
        ) : null}
        {onDetails ? (
          <MenuItem onClick={runAction(onDetails)}>{'Details'}</MenuItem>
        ) : null}
        {onDelete ? (
          <MenuItem
            onClick={runAction(onDelete)}
            sx={{ color: 'error.main' }}
          >
            {'Delete'}
          </MenuItem>
        ) : null}
      </Menu>
    </Card>
  )
}
MediaAssetCard.displayName = 'MediaAssetCard'

export default MediaAssetCard
