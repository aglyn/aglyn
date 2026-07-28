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

/**
 * The one markdown toolbar (AGL-984). Blog bodies and marketplace READMEs
 * are the same dialect edited by the same component, so they get the same
 * control: grouped MUI toggle buttons — marks, block kind, inserts — plus
 * the Visual / Markdown switch when the host page offers both surfaces.
 *
 * `context` is what the visual editor reports about the caret, so Bold on a
 * bold run reads pressed. Every button preventDefaults on mousedown: the
 * editor's DOM selection has to survive the click, or the command would
 * apply to nothing.
 */

import CodeIcon from '@mui/icons-material/Code'
import FormatBoldIcon from '@mui/icons-material/FormatBold'
import FormatItalicIcon from '@mui/icons-material/FormatItalic'
import FormatListBulletedIcon from '@mui/icons-material/FormatListBulleted'
import ImageIcon from '@mui/icons-material/Image'
import InsertLinkIcon from '@mui/icons-material/InsertLink'
import TableChartIcon from '@mui/icons-material/TableChart'
import TitleIcon from '@mui/icons-material/Title'
import {
  Box,
  Divider,
  Paper,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from '@mui/material'
import type { ReactNode } from 'react'
import type {
  MarkdownEditorCommand,
  MarkdownEditorContext,
} from './markdown-visual-editor.component'

export interface MarkdownEditorToolbarProps {
  onCommand: (command: MarkdownEditorCommand) => void
  /** Caret context from the visual editor; absent on the markdown surface. */
  context?: MarkdownEditorContext | null
  /** Shown when the host page offers both editing surfaces. */
  mode?: 'visual' | 'markdown'
  onModeChange?: (mode: 'visual' | 'markdown') => void
  /** Extra actions pinned to the right (AI assist). */
  children?: ReactNode
}

/** Groups sit flush inside one bar, MUI's grouped-toggle customization. */
const groupSx = {
  '& .MuiToggleButtonGroup-grouped': {
    m: 0.5,
    border: 0,
    borderRadius: 1,
    px: 1,
    '&.Mui-disabled': { border: 0 },
  },
} as const

interface ToolbarButtonProps {
  command: MarkdownEditorCommand
  label: string
  icon: ReactNode
  onCommand: (command: MarkdownEditorCommand) => void
  selected?: boolean
}

function ToolbarButton({
  command,
  label,
  icon,
  onCommand,
  selected,
}: ToolbarButtonProps) {
  return (
    <Tooltip title={label}>
      <ToggleButton
        value={command}
        aria-label={label}
        selected={Boolean(selected)}
        // Not onChange: an insert is an action, not a state the group owns.
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => onCommand(command)}
      >
        {icon}
      </ToggleButton>
    </Tooltip>
  )
}

export function MarkdownEditorToolbar({
  onCommand,
  context,
  mode,
  onModeChange,
  children,
}: MarkdownEditorToolbarProps) {
  const kind = context?.kind
  return (
    <Paper
      elevation={0}
      variant="outlined"
      sx={{
        display: 'flex',
        alignItems: 'center',
        flexWrap: 'wrap',
        borderRadius: 1,
      }}
    >
      <ToggleButtonGroup size="small" sx={groupSx}>
        <ToolbarButton
          command="bold"
          label="Bold"
          icon={<FormatBoldIcon fontSize="small" />}
          onCommand={onCommand}
          selected={context?.bold}
        />
        <ToolbarButton
          command="italic"
          label="Italic"
          icon={<FormatItalicIcon fontSize="small" />}
          onCommand={onCommand}
          selected={context?.italic}
        />
      </ToggleButtonGroup>

      <Divider flexItem orientation="vertical" sx={{ my: 1 }} />

      <ToggleButtonGroup size="small" sx={groupSx}>
        <ToolbarButton
          command="heading"
          label="Heading"
          icon={<TitleIcon fontSize="small" />}
          onCommand={onCommand}
          selected={kind === 'heading2'}
        />
        <ToolbarButton
          command="heading3"
          label="Subheading"
          icon={<TitleIcon sx={{ fontSize: 16 }} />}
          onCommand={onCommand}
          selected={kind === 'heading3'}
        />
        <ToolbarButton
          command="list"
          label="Bullet list"
          icon={<FormatListBulletedIcon fontSize="small" />}
          onCommand={onCommand}
          selected={kind === 'listItem'}
        />
      </ToggleButtonGroup>

      <Divider flexItem orientation="vertical" sx={{ my: 1 }} />

      <ToggleButtonGroup size="small" sx={groupSx}>
        <ToolbarButton
          command="link"
          label="Link"
          icon={<InsertLinkIcon fontSize="small" />}
          onCommand={onCommand}
        />
        <ToolbarButton
          command="image"
          label="Image"
          icon={<ImageIcon fontSize="small" />}
          onCommand={onCommand}
        />
        <ToolbarButton
          command="code"
          label="Code block"
          icon={<CodeIcon fontSize="small" />}
          onCommand={onCommand}
        />
        <ToolbarButton
          command="table"
          label="Table"
          icon={<TableChartIcon fontSize="small" />}
          onCommand={onCommand}
        />
      </ToggleButtonGroup>

      <Box sx={{ flexGrow: 1 }} />

      {children}

      {mode && onModeChange ? (
        <>
          <Divider flexItem orientation="vertical" sx={{ my: 1 }} />
          <ToggleButtonGroup
            exclusive
            size="small"
            value={mode}
            onChange={(_event, next) => {
              if (next) onModeChange(next as 'visual' | 'markdown')
            }}
            sx={groupSx}
          >
            <ToggleButton value="visual" aria-label="Visual editor">
              <Typography variant="caption">{'Visual'}</Typography>
            </ToggleButton>
            <ToggleButton value="markdown" aria-label="Markdown source">
              <Typography variant="caption">{'Markdown'}</Typography>
            </ToggleButton>
          </ToggleButtonGroup>
        </>
      ) : null}
    </Paper>
  )
}

export default MarkdownEditorToolbar
