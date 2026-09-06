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

import { CRM_VIEW_NAME_MAX, type CrmViewFilterClause } from '@aglyn/aglyn'
import {
  mdiBookmarkOutline,
  mdiCheck,
  mdiChevronDown,
  mdiContentSaveOutline,
  mdiDeleteOutline,
  mdiPencilOutline,
  mdiPlus,
  mdiShareVariantOutline,
  mdiStar,
  mdiStarOutline,
} from '@aglyn/shared-data-mdi'
import { MdiIcon, useConfirmationContext } from '@aglyn/shared-ui-jsx'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import {
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControlLabel,
  IconButton,
  ListItemIcon,
  ListItemText,
  ListSubheader,
  Menu,
  MenuItem,
  Stack,
  Switch,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material'
import { useCallback, useState } from 'react'
import type { CrmSavedViewController } from '../hooks/use-crm-saved-view'

/** A filter set offered in the menu beside the saved views — a Contacts segment. */
export interface CrmViewPreset {
  id: string
  label: string
  filters: CrmViewFilterClause[]
  /** Removes the preset where it lives; absent when the reader may not. */
  onRemove?: () => void | Promise<void>
}

export interface CrmViewsControlProps {
  controller: CrmSavedViewController
  /** What the plain, unnarrowed list is called — "All contacts". */
  allLabel: string
  /** Filter sets from elsewhere, offered under their own heading. */
  presets?: readonly CrmViewPreset[]
  presetsLabel?: string
  /**
   * Offered when the working filters can be kept as a segment; the section
   * writes it, because a segment is the contacts list's own record.
   */
  onSaveAsSegment?: (() => void) | null
}

type NameDialog =
  | { mode: 'create'; name: string; shared: boolean }
  | { mode: 'rename'; name: string }
  | null

/**
 * The views control above a CRM list (AGL-2617): the current view's name,
 * the menu of saved views, and everything a reader does to one.
 *
 * A button that reads as the list's title — "All contacts", "My open
 * leads" — and opens a menu in two halves: the views to choose from (mine,
 * then shared, then any presets the section offers), and the acts on the
 * one that is open. Save, Save as, Rename, Share, Set as default and Delete
 * sit in the same menu rather than in a toolbar, because most of them apply
 * to the open view and a row of six buttons for one list says less than a
 * menu that shows only what applies.
 *
 * ## What the reader can do to a view is decided here, once
 *
 * The rules let the creator or an org-wide member change a view; the
 * controller says so as `canEdit`, and the menu shows the editing acts
 * only then. A colleague opening a shared view sees Save as — a copy of
 * their own — and not Save, so the one write the rules would refuse is the
 * one the menu does not offer.
 *
 * ## "Modified" is said, not implied
 *
 * A view whose filters the reader has changed is shown as modified beside
 * its name, so a list that reads "My open leads" and shows something else
 * cannot pass for the saved one. Reset returns to the saved state; Save
 * makes the change the view's.
 *
 * Naming happens in a dialog — a form above the list is what this feature
 * is here to retire — and deleting asks first through the console's shared
 * confirmation.
 */
export function CrmViewsControl(props: CrmViewsControlProps) {
  const {
    controller,
    allLabel,
    presets = [],
    presetsLabel = 'Segments',
    onSaveAsSegment,
  } = props
  const {
    views,
    current,
    currentId,
    missing,
    dirty,
    canEdit,
    uid,
    busy,
    isDefault,
    defaultViewId,
  } = controller
  const { enqueueSnackbar } = useSnackbar()
  const { confirm } = useConfirmationContext()
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const [dialog, setDialog] = useState<NameDialog>(null)
  const close = () => setAnchor(null)

  const mine = views.filter((view) => view.ownerUid === uid)
  const shared = views.filter((view) => view.ownerUid !== uid)

  const attempt = useCallback(
    async (work: () => Promise<unknown>, done: string, failed: string) => {
      try {
        await work()
        enqueueSnackbar(done, { variant: 'success', persist: false })
      } catch (error) {
        console.error(error)
        enqueueSnackbar(failed, { variant: 'error', allowDuplicate: true })
      }
    },
    [enqueueSnackbar],
  )

  const title = current
    ? current.name
    : missing
      ? 'View not found'
      : allLabel

  const submitDialog = async () => {
    if (!dialog) return
    const name = dialog.name.trim()
    if (!name) return
    setDialog(null)
    if (dialog.mode === 'create') {
      await attempt(
        () => controller.saveAs(name, dialog.shared),
        `View "${name}" saved`,
        'The view could not be saved.',
      )
    } else {
      await attempt(
        () => controller.rename(name),
        `Renamed to "${name}"`,
        'The view could not be renamed.',
      )
    }
  }

  const handleDelete = async () => {
    close()
    if (!current) return
    const name = current.name
    try {
      await confirm({
        title: `Delete the view "${name}"?`,
        description: current.shared
          ? 'Everyone on the team who opens it will lose it; the contacts themselves are untouched.'
          : 'The contacts themselves are untouched.',
        confirmationText: 'Delete view',
        confirmationButtonProps: { color: 'error' },
      })
    } catch {
      return
    }
    await attempt(
      () => controller.remove(),
      `View "${name}" deleted`,
      'The view could not be deleted.',
    )
  }

  const check = (on: boolean) =>
    on ? (
      <ListItemIcon>
        <MdiIcon path={mdiCheck.path} size={0.8} />
      </ListItemIcon>
    ) : (
      <ListItemIcon />
    )

  return (
    <>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
        <Button
          size="small"
          variant="outlined"
          color="inherit"
          onClick={(event) => setAnchor(event.currentTarget)}
          endIcon={<MdiIcon path={mdiChevronDown.path} size={0.8} />}
          startIcon={<MdiIcon path={mdiBookmarkOutline.path} size={0.8} />}
          aria-haspopup="menu"
          aria-label={`View: ${title}`}
          disabled={busy}
          sx={{ textTransform: 'none', fontWeight: (theme) => theme.typography.fontWeightMedium }}
        >
          {title}
        </Button>
        {dirty ? (
          <Chip
            size="small"
            variant="outlined"
            color="warning"
            label={current ? 'Modified' : 'Filtered'}
          />
        ) : null}
        {isDefault ? (
          <Chip
            size="small"
            variant="outlined"
            icon={<MdiIcon path={mdiStar.path} size={0.6} />}
            label="Default"
          />
        ) : null}
      </Stack>
      <Menu
        anchorEl={anchor}
        open={Boolean(anchor)}
        onClose={close}
        slotProps={{ list: { dense: true, 'aria-label': 'Saved views' } }}
      >
        <MenuItem
          selected={!currentId}
          onClick={() => {
            close()
            controller.select(null)
          }}
        >
          {check(!currentId)}
          <ListItemText primary={allLabel} />
        </MenuItem>
        {mine.length ? <ListSubheader disableSticky>{'My views'}</ListSubheader> : null}
        {mine.map((view) => (
          <MenuItem
            key={view.$id}
            selected={view.$id === currentId}
            onClick={() => {
              close()
              controller.select(view.$id)
            }}
          >
            {check(view.$id === currentId)}
            <ListItemText
              primary={view.name}
              secondary={
                view.shared
                  ? view.$id === defaultViewId
                    ? 'Shared · your default'
                    : 'Shared'
                  : view.$id === defaultViewId
                    ? 'Your default'
                    : undefined
              }
            />
          </MenuItem>
        ))}
        {shared.length ? (
          <ListSubheader disableSticky>{'Shared with the team'}</ListSubheader>
        ) : null}
        {shared.map((view) => (
          <MenuItem
            key={view.$id}
            selected={view.$id === currentId}
            onClick={() => {
              close()
              controller.select(view.$id)
            }}
          >
            {check(view.$id === currentId)}
            <ListItemText
              primary={view.name}
              secondary={view.$id === defaultViewId ? 'Your default' : undefined}
            />
          </MenuItem>
        ))}
        {presets.length ? <ListSubheader disableSticky>{presetsLabel}</ListSubheader> : null}
        {presets.map((preset) => (
          <MenuItem
            key={preset.id}
            onClick={() => {
              close()
              // A preset narrows the plain list; saving it makes it a view.
              if (currentId) controller.select(null)
              controller.setFilters(preset.filters)
            }}
          >
            <ListItemIcon />
            <ListItemText primary={preset.label} />
            {preset.onRemove ? (
              <Tooltip title={`Delete segment ${preset.label}`}>
                <IconButton
                  size="small"
                  edge="end"
                  aria-label={`Delete segment ${preset.label}`}
                  onClick={(event) => {
                    // The row's own click applies the preset; this removes it.
                    event.stopPropagation()
                    close()
                    void attempt(
                      async () => preset.onRemove?.(),
                      `Segment "${preset.label}" deleted`,
                      'The segment could not be deleted.',
                    )
                  }}
                >
                  <MdiIcon path={mdiDeleteOutline.path} size={0.7} />
                </IconButton>
              </Tooltip>
            ) : null}
          </MenuItem>
        ))}
        <Divider />
        {current && canEdit ? (
          <MenuItem
            disabled={!dirty || busy}
            onClick={() => {
              close()
              void attempt(
                () => controller.save(),
                `View "${current.name}" saved`,
                'The view could not be saved.',
              )
            }}
          >
            <ListItemIcon>
              <MdiIcon path={mdiContentSaveOutline.path} size={0.8} />
            </ListItemIcon>
            <ListItemText primary="Save changes" />
          </MenuItem>
        ) : null}
        <MenuItem
          disabled={!uid || busy}
          onClick={() => {
            close()
            setDialog({ mode: 'create', name: '', shared: false })
          }}
        >
          <ListItemIcon>
            <MdiIcon path={mdiPlus.path} size={0.8} />
          </ListItemIcon>
          <ListItemText primary={current ? 'Save as new view…' : 'Save as view…'} />
        </MenuItem>
        {dirty ? (
          <MenuItem
            onClick={() => {
              close()
              controller.reset()
            }}
          >
            <ListItemIcon />
            <ListItemText primary={current ? 'Discard changes' : 'Clear filters'} />
          </MenuItem>
        ) : null}
        {onSaveAsSegment ? (
          <MenuItem
            onClick={() => {
              close()
              onSaveAsSegment()
            }}
          >
            <ListItemIcon />
            <ListItemText
              primary="Save as segment…"
              secondary="Usable as a campaign audience"
            />
          </MenuItem>
        ) : null}
        {current && canEdit ? (
          <MenuItem
            disabled={busy}
            onClick={() => {
              close()
              setDialog({ mode: 'rename', name: current.name })
            }}
          >
            <ListItemIcon>
              <MdiIcon path={mdiPencilOutline.path} size={0.8} />
            </ListItemIcon>
            <ListItemText primary="Rename…" />
          </MenuItem>
        ) : null}
        {current && canEdit ? (
          <MenuItem
            disabled={busy}
            onClick={() => {
              close()
              void attempt(
                () => controller.setShared(!current.shared),
                current.shared ? 'The view is yours alone again' : 'The view is shared with the team',
                'The view could not be changed.',
              )
            }}
          >
            <ListItemIcon>
              <MdiIcon path={mdiShareVariantOutline.path} size={0.8} />
            </ListItemIcon>
            <ListItemText primary={current.shared ? 'Stop sharing' : 'Share with the team'} />
          </MenuItem>
        ) : null}
        {currentId && current ? (
          <MenuItem
            disabled={busy}
            onClick={() => {
              close()
              void attempt(
                () => controller.setDefault(isDefault ? null : current.$id),
                isDefault
                  ? `${allLabel} opens first again`
                  : `"${current.name}" opens first from now on`,
                'The default could not be changed.',
              )
            }}
          >
            <ListItemIcon>
              <MdiIcon path={isDefault ? mdiStar.path : mdiStarOutline.path} size={0.8} />
            </ListItemIcon>
            <ListItemText
              primary={isDefault ? 'Clear default' : 'Set as default'}
              secondary={isDefault ? undefined : 'Opens first when you come here'}
            />
          </MenuItem>
        ) : defaultViewId ? (
          <MenuItem
            disabled={busy}
            onClick={() => {
              close()
              void attempt(
                () => controller.setDefault(null),
                `${allLabel} opens first again`,
                'The default could not be changed.',
              )
            }}
          >
            <ListItemIcon>
              <MdiIcon path={mdiStarOutline.path} size={0.8} />
            </ListItemIcon>
            <ListItemText primary={`Make ${allLabel.toLowerCase()} the default`} />
          </MenuItem>
        ) : null}
        {current && canEdit ? (
          <MenuItem disabled={busy} onClick={() => void handleDelete()}>
            <ListItemIcon>
              <MdiIcon path={mdiDeleteOutline.path} size={0.8} />
            </ListItemIcon>
            <ListItemText primary="Delete view…" />
          </MenuItem>
        ) : null}
      </Menu>
      <Dialog
        open={dialog !== null}
        onClose={() => setDialog(null)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>
          {dialog?.mode === 'rename' ? 'Rename view' : 'Save as view'}
        </DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            {dialog?.mode === 'create' ? (
              <Typography variant="body2" color="text.secondary">
                {'The filters, columns and sort as they are now, under a name you can open from the views menu or link to.'}
              </Typography>
            ) : null}
            <TextField
              autoFocus
              size="small"
              label="Name"
              value={dialog?.name ?? ''}
              onChange={(event) =>
                setDialog((prev) =>
                  prev ? { ...prev, name: event.target.value.slice(0, CRM_VIEW_NAME_MAX) } : prev,
                )
              }
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  void submitDialog()
                }
              }}
              slotProps={{ htmlInput: { maxLength: CRM_VIEW_NAME_MAX } }}
            />
            {dialog?.mode === 'create' ? (
              <FormControlLabel
                control={
                  <Switch
                    size="small"
                    checked={dialog.shared}
                    onChange={(event) =>
                      setDialog((prev) =>
                        prev?.mode === 'create'
                          ? { ...prev, shared: event.target.checked }
                          : prev,
                      )
                    }
                  />
                }
                label="Share with the team"
              />
            ) : null}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialog(null)}>{'Cancel'}</Button>
          <Button
            variant="contained"
            disabled={!dialog?.name.trim() || busy}
            onClick={() => void submitDialog()}
          >
            {dialog?.mode === 'rename' ? 'Rename' : 'Save view'}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  )
}
CrmViewsControl.displayName = 'CrmViewsControl'

export default CrmViewsControl
