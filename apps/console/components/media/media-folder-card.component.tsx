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
import { useDraggable, useDroppable } from '@dnd-kit/core'
import FolderIcon from '@mui/icons-material/Folder'
import MoreVertIcon from '@mui/icons-material/MoreVert'
import {
  Box,
  Card,
  IconButton,
  Menu,
  MenuItem,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material'
import { type MouseEvent, useCallback, useState } from 'react'

export interface MediaFolderCardProps {
  folder: Aglyn.AglynHostMediaFolder
  /** Number of assets directly in this folder. */
  count: number
  /** Open (navigate into) the folder. */
  onOpen: () => void
  /** Picker/read-only mode hides folder-management actions. */
  readOnly?: boolean
  onNewSubfolder?: () => void
  onRename?: () => void
  onDelete?: () => void
}

const THUMB_HEIGHT = 116

/**
 * A folder tile for the DAM grid (AGL-818/819). Mirrors MediaAssetCard's
 * shape so folders and files line up in one unified grid — folders render
 * first. The whole tile opens the folder; an overflow menu carries New
 * subfolder / Rename / Delete. It is also a dnd-kit drop target (drag files
 * or folders onto it to reorganize) and draggable (drag it into another
 * folder). Uses `gridfolder:` / `gridfolderdrag:` ids so it never collides
 * with the rail's `folder:` droppables for the same folder.
 */
export function MediaFolderCard(props: MediaFolderCardProps) {
  const {
    folder,
    count,
    onOpen,
    readOnly,
    onNewSubfolder,
    onRename,
    onDelete,
  } = props
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null)
  const openMenu = (event: MouseEvent<HTMLElement>) => {
    event.stopPropagation()
    setMenuAnchor(event.currentTarget)
  }
  const closeMenu = () => setMenuAnchor(null)
  const runAction = (action?: () => void) => (event: MouseEvent<HTMLElement>) => {
    event.stopPropagation()
    closeMenu()
    action?.()
  }

  const { setNodeRef: setDropRef, isOver } = useDroppable({
    id: `gridfolder:${folder.$id}`,
    disabled: readOnly,
  })
  const {
    setNodeRef: setDragRef,
    attributes,
    listeners,
    isDragging,
  } = useDraggable({ id: `gridfolderdrag:${folder.$id}`, disabled: readOnly })
  const setCardRef = useCallback(
    (node: HTMLElement | null) => {
      setDropRef(node)
      setDragRef(node)
    },
    [setDropRef, setDragRef],
  )
  const isDropTarget = isOver && !isDragging

  return (
    <Card
      ref={setCardRef}
      variant="outlined"
      onClick={onOpen}
      {...attributes}
      {...listeners}
      sx={{
        opacity: isDragging ? 0.4 : 1,
        position: 'relative',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        cursor: 'pointer',
        transition: (theme) =>
          theme.transitions.create(['box-shadow', 'border-color', 'transform']),
        borderColor: isDropTarget ? 'secondary.main' : 'divider',
        transform: isDropTarget ? 'scale(1.02)' : undefined,
        boxShadow: isDropTarget ? 4 : undefined,
        '&:hover': {
          boxShadow: isDropTarget ? 4 : 2,
          borderColor: isDropTarget ? 'secondary.main' : 'text.disabled',
        },
        '&:hover .media-card-affordance, &:focus-within .media-card-affordance':
          { opacity: 1 },
      }}
    >
      <Box
        sx={{
          height: THUMB_HEIGHT,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          bgcolor: isDropTarget ? 'secondary.main' : 'action.hover',
          color: isDropTarget ? 'secondary.contrastText' : 'text.secondary',
          transition: (theme) => theme.transitions.create(['background-color']),
        }}
      >
        <FolderIcon sx={{ fontSize: 56 }} />
      </Box>
      <Stack
        direction="row"
        spacing={0.5}
        sx={{ alignItems: 'flex-start', px: 1, py: 0.75, minWidth: 0 }}
      >
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Tooltip title={folder.name} enterDelay={600}>
            <Typography
              variant="caption"
              noWrap
              component="div"
              sx={{ fontWeight: 600 }}
            >
              {folder.name}
            </Typography>
          </Tooltip>
          <Typography
            variant="caption"
            color="text.secondary"
            noWrap
            component="div"
          >
            {count === 1 ? '1 file' : `${count} files`}
          </Typography>
        </Box>
        {readOnly ? null : (
          <IconButton
            className="media-card-affordance"
            size="small"
            aria-label="Folder actions"
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
        {onNewSubfolder ? (
          <MenuItem onClick={runAction(onNewSubfolder)}>
            {'New subfolder'}
          </MenuItem>
        ) : null}
        {onRename ? (
          <MenuItem onClick={runAction(onRename)}>{'Rename'}</MenuItem>
        ) : null}
        {onDelete ? (
          <MenuItem onClick={runAction(onDelete)} sx={{ color: 'error.main' }}>
            {'Delete'}
          </MenuItem>
        ) : null}
      </Menu>
    </Card>
  )
}
MediaFolderCard.displayName = 'MediaFolderCard'

export default MediaFolderCard
