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

import * as Aglyn from '@aglyn/aglyn'
import { useDraggable, useDroppable } from '@dnd-kit/core'
import MoreVertIcon from '@mui/icons-material/MoreVert'
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Menu,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { type MouseEvent, useCallback, useState } from 'react'

export type MediaFolder = Aglyn.AglynHostMediaFolder

export interface MediaFolderRailProps {
  folders: MediaFolder[]
  /** 'all' = no folder scoping; null = root ("No folder"); id = folder. */
  current: string | null | 'all'
  onSelect: (folderId: string | null | 'all') => void
  /** Asset count per folder id; `root` key counts folderless assets. */
  counts: Record<string, number>
  onCreate: (name: string, parentId: string | null) => Promise<string | null>
  onRename: (folder: MediaFolder, name: string) => Promise<void>
  onDelete: (folder: MediaFolder) => Promise<void>
  /** Picker mode renders without DnD hooks and without folder actions. */
  readOnly?: boolean
}

/** Droppable + draggable rail row; DnD ids are `folder:{id}`. */
function FolderRow(props: {
  folder: MediaFolder
  depth: number
  selected: boolean
  count: number
  readOnly?: boolean
  onSelect: () => void
  onMenu: (event: MouseEvent<HTMLElement>, folder: MediaFolder) => void
}) {
  const { folder, depth, selected, count, readOnly, onSelect, onMenu } = props
  const { setNodeRef: setDropRef, isOver } = useDroppable({
    id: `folder:${folder.$id}`,
    disabled: readOnly,
  })
  const {
    setNodeRef: setDragRef,
    attributes,
    listeners,
  } = useDraggable({ id: `folderdrag:${folder.$id}`, disabled: readOnly })

  return (
    <Stack
      ref={setDropRef}
      direction="row"
      onClick={onSelect}
      sx={{
        alignItems: 'center',
        pl: 1 + depth * 1.5,
        pr: 0.5,
        py: 0.25,
        borderRadius: 1,
        cursor: 'pointer',
        bgcolor: isOver
          ? 'primary.main'
          : selected
            ? 'action.selected'
            : undefined,
        color: isOver ? 'primary.contrastText' : undefined,
        '&:hover': { bgcolor: isOver ? 'primary.main' : 'action.hover' },
      }}
    >
      <Typography
        ref={setDragRef}
        {...attributes}
        {...listeners}
        variant="body2"
        noWrap
        sx={{ flex: 1, py: 0.5 }}
      >
        {folder.name}
      </Typography>
      <Typography variant="caption" color="text.secondary" sx={{ px: 0.5 }}>
        {count || ''}
      </Typography>
      {readOnly ? null : (
        <IconButton
          size="small"
          onClick={(event) => {
            event.stopPropagation()
            onMenu(event, folder)
          }}
        >
          <MoreVertIcon fontSize="inherit" />
        </IconButton>
      )}
    </Stack>
  )
}
FolderRow.displayName = 'FolderRow'

/**
 * Folder tree rail (AGL-172): root + nested folders with asset counts,
 * New/Rename/Delete actions, and dnd-kit drop targets so asset cards and
 * folders can be dragged onto rows. Every move is also possible via the
 * row menu — DnD is an enhancement, not the only path.
 */
export function MediaFolderRail(props: MediaFolderRailProps) {
  const { folders, current, onSelect, counts, onCreate, onRename, onDelete } =
    props
  const readOnly = props.readOnly

  const [menu, setMenu] = useState<{
    anchor: HTMLElement
    folder: MediaFolder
  } | null>(null)
  const [prompt, setPrompt] = useState<{
    title: string
    value: string
    action: (name: string) => Promise<void>
  } | null>(null)
  const [promptBusy, setPromptBusy] = useState(false)

  const { setNodeRef: setRootDropRef, isOver: rootOver } = useDroppable({
    id: 'folder:root',
    disabled: readOnly,
  })

  const handlePromptSave = useCallback(async () => {
    if (!prompt) return
    setPromptBusy(true)
    try {
      await prompt.action(prompt.value)
      setPrompt(null)
    } finally {
      setPromptBusy(false)
    }
  }, [prompt])

  const renderChildren = (parentId: string | null, depth: number) =>
    folders
      .filter((folder) => (folder.parentId ?? null) === parentId)
      .map((folder) => (
        <Box key={folder.$id}>
          <FolderRow
            folder={folder}
            depth={depth}
            selected={current === folder.$id}
            count={counts[folder.$id] ?? 0}
            readOnly={readOnly}
            onSelect={() => onSelect(folder.$id)}
            onMenu={(event, target) =>
              setMenu({ anchor: event.currentTarget, folder: target })
            }
          />
          {renderChildren(folder.$id, depth + 1)}
        </Box>
      ))

  return (
    <Stack spacing={0.5} sx={{ minWidth: 180, maxWidth: 220 }}>
      <Stack
        direction="row"
        onClick={() => onSelect('all')}
        sx={{
          alignItems: 'center',
          px: 1,
          py: 0.75,
          borderRadius: 1,
          cursor: 'pointer',
          bgcolor: current === 'all' ? 'action.selected' : undefined,
          '&:hover': { bgcolor: 'action.hover' },
        }}
      >
        <Typography variant="body2" sx={{ flex: 1, fontWeight: 600 }}>
          {'All files'}
        </Typography>
      </Stack>
      <Stack
        ref={setRootDropRef}
        direction="row"
        onClick={() => onSelect(null)}
        sx={{
          alignItems: 'center',
          px: 1,
          py: 0.75,
          borderRadius: 1,
          cursor: 'pointer',
          bgcolor: rootOver
            ? 'primary.main'
            : current === null
              ? 'action.selected'
              : undefined,
          color: rootOver ? 'primary.contrastText' : undefined,
          '&:hover': { bgcolor: rootOver ? 'primary.main' : 'action.hover' },
        }}
      >
        <Typography variant="body2" sx={{ flex: 1 }}>
          {'No folder'}
        </Typography>
        <Typography variant="caption" color="text.secondary">
          {counts['root'] || ''}
        </Typography>
      </Stack>
      {renderChildren(null, 0)}
      {readOnly ? null : (
        <Button
          size="small"
          sx={{ alignSelf: 'flex-start' }}
          onClick={() =>
            setPrompt({
              title: 'New folder',
              value: '',
              action: async (name) => {
                await onCreate(name, null)
              },
            })
          }
        >
          {'New folder'}
        </Button>
      )}
      <Menu
        anchorEl={menu?.anchor}
        open={Boolean(menu)}
        onClose={() => setMenu(null)}
      >
        <MenuItem
          onClick={() => {
            const folder = menu?.folder
            setMenu(null)
            if (!folder) return
            setPrompt({
              title: `New folder in "${folder.name}"`,
              value: '',
              action: async (name) => {
                await onCreate(name, folder.$id)
              },
            })
          }}
        >
          {'New subfolder'}
        </MenuItem>
        <MenuItem
          onClick={() => {
            const folder = menu?.folder
            setMenu(null)
            if (!folder) return
            setPrompt({
              title: 'Rename folder',
              value: folder.name,
              action: (name) => onRename(folder, name),
            })
          }}
        >
          {'Rename'}
        </MenuItem>
        <MenuItem
          onClick={() => {
            const folder = menu?.folder
            setMenu(null)
            if (folder) void onDelete(folder)
          }}
        >
          {'Delete'}
        </MenuItem>
      </Menu>
      <Dialog
        open={Boolean(prompt)}
        onClose={() => setPrompt(null)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>{prompt?.title}</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            fullWidth
            size="small"
            label="Name"
            value={prompt?.value ?? ''}
            onChange={(event) =>
              setPrompt((prev) =>
                prev ? { ...prev, value: event.target.value } : prev,
              )
            }
            sx={{ mt: 1 }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPrompt(null)}>{'Cancel'}</Button>
          <Button
            variant="contained"
            color="primary"
            disabled={promptBusy || !prompt?.value.trim()}
            onClick={handlePromptSave}
          >
            {'Save'}
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  )
}
MediaFolderRail.displayName = 'MediaFolderRail'

export default MediaFolderRail
