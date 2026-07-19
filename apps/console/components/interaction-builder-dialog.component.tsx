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
import { nodeElementSelector } from '@aglyn/besigner-ui'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { collection, doc, limit, query, setDoc } from 'firebase/firestore'
import { useCallback, useMemo, useState } from 'react'
import { useFirestore } from '@aglyn/tenant-feature-instance'
import useFirestoreCollection from '../hooks/use-firestore-collection'
import { buildInteractionCandidate } from './interaction-builder-doc'

export interface InteractionBuilderState {
  /** Existing action id when editing; null for a new interaction. */
  id: string | null
  nodeId: string
  event: string
}

export interface InteractionBuilderDialogProps {
  hostId: string
  state: InteractionBuilderState
  /** Existing action doc when editing. */
  existing?: any
  onClose: () => void
}

type StepDraft = Record<string, any> & { type: string }

const STEP_TYPES: Array<{ value: string; label: string }> = [
  // Element, menu & drawer choreography (AGL-562; menu commands
  // AGL-568) — the nav-menu headliners.
  { value: 'toggleElement', label: 'Show/hide an element' },
  { value: 'showElement', label: 'Show an element' },
  { value: 'hideElement', label: 'Hide an element' },
  { value: 'toggleMenu', label: 'Open/close a menu' },
  { value: 'openMenu', label: 'Open a menu' },
  { value: 'closeMenu', label: 'Close a menu' },
  { value: 'toggleDrawer', label: 'Open/close a drawer' },
  { value: 'openDrawer', label: 'Open a drawer' },
  { value: 'closeDrawer', label: 'Close a drawer' },
  { value: 'toggleClass', label: 'Toggle a class' },
  { value: 'addClass', label: 'Append a class' },
  { value: 'removeClass', label: 'Remove a class' },
  { value: 'siteAlert', label: 'Show a message' },
  { value: 'runWorkflow', label: 'Run a workflow' },
  { value: 'showOverlay', label: 'Open an overlay' },
  { value: 'redirect', label: 'Go to a URL' },
  { value: 'trackGaEvent', label: 'Track an analytics event' },
]

/** Human phrasing for the default interaction name per trigger. */
const TRIGGER_PHRASES: Record<string, string> = {
  elementClick: 'clicked',
  elementHoverEnter: 'hovered',
  elementHoverLeave: 'hover ends',
  elementVisible: 'seen',
}

/**
 * Fluent interaction builder (AGL-319): the whole trigger + actions +
 * frequency configuration in one dialog on the canvas — replacing the
 * old "create disabled, finish on the Workflows page" detour. Pickers
 * only for workflows/overlays (id-based, AGL-261); class steps default
 * to this element and Test runs them against the live canvas DOM.
 */
export function InteractionBuilderDialog(props: InteractionBuilderDialogProps) {
  const { hostId, state, existing, onClose } = props
  const firestore = useFirestore()
  const { enqueueSnackbar } = useSnackbar()

  const { data: workflowDocs } = useFirestoreCollection<any>(
    () => query(collection(firestore, 'hosts', hostId, 'workflows'), limit(100)),
    [firestore, hostId],
    { idField: '$id' },
  )
  const { data: overlayDocs } = useFirestoreCollection<any>(
    () => query(collection(firestore, 'hosts', hostId, 'overlays'), limit(50)),
    [firestore, hostId],
    { idField: '$id' },
  )
  // Screen picker for redirects (AGL-339): stored by id, rename-safe.
  const { data: screenDocs } = useFirestoreCollection<any>(
    () => query(collection(firestore, 'hosts', hostId, 'screens'), limit(200)),
    [firestore, hostId],
    { idField: '$id' },
  )

  const selector = nodeElementSelector(state.nodeId)
  const [name, setName] = useState<string>(
    existing?.name ?? `When ${TRIGGER_PHRASES[state.event] ?? 'seen'} — ${state.nodeId.slice(0, 8)}`,
  )
  const [event, setEvent] = useState<string>(
    existing?.trigger?.event ?? state.event,
  )
  // New interactions default to every occurrence (AGL-562): menu and
  // drawer choreography only makes sense repeatable; existing docs keep
  // their stored frequency.
  const [frequency, setFrequency] = useState<string>(
    existing
      ? existing.trigger?.oncePerVisitor
        ? 'visitor'
        : existing.trigger?.oncePerSession
          ? 'session'
          : existing.trigger?.cooldownMinutes
            ? 'cooldown'
            : existing.trigger?.everyTime
              ? 'every'
              : 'always'
      : 'every',
  )
  const [cooldownMinutes, setCooldownMinutes] = useState<number>(
    existing?.trigger?.cooldownMinutes ?? 60,
  )
  const [steps, setSteps] = useState<StepDraft[]>(
    existing?.steps?.length
      ? existing.steps
      : [{ type: 'toggleClass', selector, className: '' }],
  )

  const updateStep = (index: number, patch: Partial<StepDraft> | null) => {
    setSteps((prev) => {
      const next = [...prev]
      if (patch === null) next.splice(index, 1)
      else next[index] = { ...next[index], ...patch }
      return next
    })
  }

  // Serialize once, pruning the `undefined` step fields the action-type
  // reset leaves behind (AGL-570): this Firestore has no
  // `ignoreUndefinedProperties`, so a raw `undefined` rejects the whole
  // write — the reason element interactions never reached the actions
  // collection. buildInteractionCandidate strips them.
  const candidate = useMemo(
    () =>
      buildInteractionCandidate({
        name,
        event,
        selector,
        frequency,
        cooldownMinutes,
        steps,
      }),
    [name, event, selector, frequency, cooldownMinutes, steps],
  )

  // Canvas element targets for the show/hide + drawer steps (AGL-562):
  // the same live-canvas resolution the props panel's NODE_SELECT uses.
  const canvasNodes = useMemo(
    () => (Aglyn.canvas.toJSON().nodes ?? {}) as Record<string, any>,
    [],
  )
  const elementTargetOptions = useMemo(
    () =>
      Object.entries(canvasNodes)
        .filter(([id]) => Boolean(id))
        .map(([id, node]) => {
          const displayName =
            Aglyn.components.getSchema(node?.componentId)?.displayName ??
            node?.componentId ??
            'Element'
          const text =
            typeof node?.props?.children === 'string'
              ? node.props.children.trim().slice(0, 24)
              : ''
          return {
            value: nodeElementSelector(id),
            nodeId: id,
            componentId: String(node?.componentId ?? ''),
            label: `${displayName}${text ? ` "${text}"` : ''} · ${id.slice(0, 6)}`,
          }
        })
        .sort((a, b) => a.label.localeCompare(b.label)),
    [canvasNodes],
  )
  const drawerTargetOptions = useMemo(
    () =>
      elementTargetOptions.filter(
        (option) => option.componentId === 'muiDrawer',
      ),
    [elementTargetOptions],
  )
  // Menu targets (AGL-568): Dropdown/Mega Menu elements on this canvas.
  const menuTargetOptions = useMemo(
    () =>
      elementTargetOptions.filter(
        (option) =>
          option.componentId === 'muiNavMenu' ||
          option.componentId === 'muiMegaMenu',
      ),
    [elementTargetOptions],
  )

  const problem = Aglyn.validateHostAction(candidate as any)

  // Test (AGL-314/319): class steps execute against the canvas DOM so
  // the designer sees the result immediately; everything else explains
  // itself via a snackbar.
  const handleTest = useCallback(() => {
    for (const step of steps) {
      if (
        step.type === 'toggleClass' ||
        step.type === 'addClass' ||
        step.type === 'removeClass'
      ) {
        document
          .querySelectorAll(String(step.selector || selector))
          .forEach((element) => {
            if (step.type === 'addClass') element.classList.add(step.className)
            else if (step.type === 'removeClass') {
              element.classList.remove(step.className)
            } else element.classList.toggle(step.className)
          })
      } else if (
        step.type === 'showElement' ||
        step.type === 'hideElement' ||
        step.type === 'toggleElement'
      ) {
        // Element choreography (AGL-562): try the live DOM; the canvas
        // shadow root is closed, so a zero-match run explains itself.
        Aglyn.ensureElementHiddenStyle()
        const touched = Aglyn.applyElementVisibility(
          step.type === 'showElement'
            ? 'show'
            : step.type === 'hideElement'
              ? 'hide'
              : 'toggle',
          String(step.selector || selector),
        )
        if (!touched) {
          enqueueSnackbar(
            `"${STEP_TYPES.find((entry) => entry.value === step.type)?.label}" runs on the live site`,
            { variant: 'info', persist: false },
          )
        }
      } else if (
        step.type === 'openDrawer' ||
        step.type === 'closeDrawer' ||
        step.type === 'toggleDrawer' ||
        step.type === 'openMenu' ||
        step.type === 'closeMenu' ||
        step.type === 'toggleMenu'
      ) {
        // Canvas drawers and menus render inline (not command-driven)
        // while editing, so the command only shows on the live site.
        enqueueSnackbar(
          `"${STEP_TYPES.find((entry) => entry.value === step.type)?.label}" runs on the live site`,
          { variant: 'info', persist: false },
        )
      } else if (step.type === 'siteAlert') {
        enqueueSnackbar(step.message || '(empty message)', {
          variant: (step.severity as any) || 'info',
          persist: false,
        })
      } else {
        enqueueSnackbar(
          `"${STEP_TYPES.find((entry) => entry.value === step.type)?.label ?? step.type}" runs on the live site`,
          { variant: 'info', persist: false },
        )
      }
    }
  }, [steps, selector, enqueueSnackbar])

  const handleSave = useCallback(async () => {
    if (problem) return
    const id = state.id ?? Aglyn.createResourceUid()
    try {
      // `candidate` is already pruned of `undefined` (AGL-570); wrap the
      // write so any real failure surfaces instead of a silent
      // unhandled rejection that leaves the dialog open with no feedback.
      await setDoc(
        doc(firestore, 'hosts', hostId, 'actions', id),
        {
          ...candidate,
          updatedAt: new Date(),
          ...(state.id ? {} : { createdAt: new Date() }),
        },
        { merge: true },
      )
    } catch (error) {
      console.error(error)
      enqueueSnackbar('Could not save the interaction', { variant: 'error' })
      return
    }
    enqueueSnackbar('Interaction saved and enabled', {
      variant: 'success',
      persist: false,
    })
    onClose()
  }, [problem, state.id, candidate, firestore, hostId, enqueueSnackbar, onClose])

  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>
        {state.id ? 'Edit interaction' : 'New interaction'}
      </DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <TextField
          label="Name"
          value={name}
          onChange={(inputEvent) => setName(inputEvent.target.value)}
          size="small"
          sx={{ mt: 1 }}
        />
        <Stack direction="row" spacing={1}>
          <TextField
            label="When"
            value={event}
            onChange={(inputEvent) => setEvent(inputEvent.target.value)}
            size="small"
            select
            sx={{ minWidth: 200 }}
          >
            <MenuItem value="elementClick">{'This element is clicked'}</MenuItem>
            {/* Hover choreography (AGL-562). */}
            <MenuItem value="elementHoverEnter">
              {'This element is hovered'}
            </MenuItem>
            <MenuItem value="elementHoverLeave">
              {'The pointer leaves this element'}
            </MenuItem>
            <MenuItem value="elementVisible">
              {'This element scrolls into view'}
            </MenuItem>
          </TextField>
          <TextField
            label="How often"
            value={frequency}
            onChange={(inputEvent) => setFrequency(inputEvent.target.value)}
            size="small"
            select
            sx={{ minWidth: 170 }}
          >
            {/* Repeatable firing (AGL-562) vs the legacy once-per-view. */}
            <MenuItem value="every">{'Every time'}</MenuItem>
            <MenuItem value="always">{'Once per page view'}</MenuItem>
            <MenuItem value="session">{'Once per session'}</MenuItem>
            <MenuItem value="visitor">{'Once per visitor'}</MenuItem>
            <MenuItem value="cooldown">{'With a cooldown'}</MenuItem>
          </TextField>
          {frequency === 'cooldown' ? (
            <TextField
              label="Minutes"
              value={cooldownMinutes}
              onChange={(inputEvent) =>
                setCooldownMinutes(
                  Math.max(1, Math.round(Number(inputEvent.target.value)) || 1),
                )
              }
              size="small"
              sx={{ width: 100 }}
              slotProps={{ htmlInput: { inputMode: 'numeric' } }}
            />
          ) : null}
        </Stack>

        <Divider textAlign="left">{'Then'}</Divider>
        {steps.map((step, index) => (
          <Stack key={index} spacing={1}>
            <Stack direction="row" spacing={1}>
              <TextField
                label="Action"
                value={step.type}
                onChange={(inputEvent) => {
                  const nextType = inputEvent.target.value
                  updateStep(index, {
                    type: nextType,
                    // Reset type-specific fields, keep the selector.
                    className: undefined,
                    message: undefined,
                    workflowId: undefined,
                    overlayId: undefined,
                    url: undefined,
                    eventName: undefined,
                    // Drawer commands (AGL-572) default to this element
                    // when it is itself a drawer, mirroring the menu
                    // default below; anything else broadcasts to the
                    // page's first drawer — the Menu Button's built-in
                    // zero-config behavior.
                    drawerNodeId:
                      ['openDrawer', 'closeDrawer', 'toggleDrawer'].includes(
                        nextType,
                      ) &&
                      drawerTargetOptions.some(
                        (option) => option.nodeId === state.nodeId,
                      )
                        ? state.nodeId
                        : undefined,
                    // Menu commands (AGL-568) default to this element
                    // when it is itself a menu — "Open menu (this
                    // element)" with zero extra picking.
                    menuNodeId:
                      ['openMenu', 'closeMenu', 'toggleMenu'].includes(
                        nextType,
                      ) &&
                      menuTargetOptions.some(
                        (option) => option.nodeId === state.nodeId,
                      )
                        ? state.nodeId
                        : undefined,
                    selector: step.selector ?? selector,
                  })
                }}
                size="small"
                select
                sx={{ minWidth: 220 }}
              >
                {STEP_TYPES.map((entry) => (
                  <MenuItem key={entry.value} value={entry.value}>
                    {entry.label}
                  </MenuItem>
                ))}
              </TextField>
              {['showElement', 'hideElement', 'toggleElement'].includes(
                step.type,
              ) ? (
                // Element target (AGL-562): the canvas element picker,
                // persisted as the node's stable data-aglyn selector.
                <TextField
                  label="Element"
                  value={String(step.selector ?? selector)}
                  onChange={(inputEvent) =>
                    updateStep(index, { selector: inputEvent.target.value })
                  }
                  size="small"
                  select
                  sx={{ flex: 1 }}
                >
                  {elementTargetOptions.map((option) => (
                    <MenuItem key={option.value} value={option.value}>
                      {option.nodeId === state.nodeId
                        ? `This element · ${option.label}`
                        : option.label}
                    </MenuItem>
                  ))}
                  {elementTargetOptions.every(
                    (option) => option.value !== String(step.selector ?? selector),
                  ) ? (
                    <MenuItem value={String(step.selector ?? selector)}>
                      {'Custom selector'}
                    </MenuItem>
                  ) : null}
                </TextField>
              ) : null}
              {['openDrawer', 'closeDrawer', 'toggleDrawer'].includes(
                step.type,
              ) ? (
                // Drawer target (AGL-562/AGL-572): drawers on this
                // canvas; empty addresses the page's first drawer, and
                // the picker pre-selects this element when it is itself
                // a drawer (mirroring the menu default).
                <TextField
                  label="Drawer"
                  value={step.drawerNodeId ?? ''}
                  onChange={(inputEvent) =>
                    updateStep(index, {
                      drawerNodeId: inputEvent.target.value || undefined,
                    })
                  }
                  size="small"
                  select
                  sx={{ flex: 1 }}
                  helperText={
                    drawerTargetOptions.length
                      ? undefined
                      : 'No drawer on this screen yet — add one from the ' +
                        'Navigation group'
                  }
                >
                  <MenuItem value="">{'First drawer on the page'}</MenuItem>
                  {drawerTargetOptions.map((option) => (
                    <MenuItem key={option.nodeId} value={option.nodeId}>
                      {option.nodeId === state.nodeId
                        ? `This element · ${option.label}`
                        : option.label}
                    </MenuItem>
                  ))}
                </TextField>
              ) : null}
              {['openMenu', 'closeMenu', 'toggleMenu'].includes(
                step.type,
              ) ? (
                // Menu target (AGL-568): Dropdown/Mega Menu elements on
                // this canvas; empty addresses the page's first menu.
                <TextField
                  label="Menu"
                  value={step.menuNodeId ?? ''}
                  onChange={(inputEvent) =>
                    updateStep(index, {
                      menuNodeId: inputEvent.target.value || undefined,
                    })
                  }
                  size="small"
                  select
                  sx={{ flex: 1 }}
                  helperText={
                    menuTargetOptions.length
                      ? undefined
                      : 'No menu on this screen yet — add one from the ' +
                        'Navigation group'
                  }
                >
                  <MenuItem value="">{'First menu on the page'}</MenuItem>
                  {menuTargetOptions.map((option) => (
                    <MenuItem key={option.nodeId} value={option.nodeId}>
                      {option.nodeId === state.nodeId
                        ? `This element · ${option.label}`
                        : option.label}
                    </MenuItem>
                  ))}
                </TextField>
              ) : null}
              {['toggleClass', 'addClass', 'removeClass'].includes(step.type) ? (
                <>
                  <TextField
                    label="Class"
                    value={step.className ?? ''}
                    onChange={(inputEvent) =>
                      updateStep(index, { className: inputEvent.target.value })
                    }
                    size="small"
                    sx={{ width: 140 }}
                    placeholder="is-open"
                  />
                  <TextField
                    label="Target"
                    value={step.selector ?? selector}
                    onChange={(inputEvent) =>
                      updateStep(index, { selector: inputEvent.target.value })
                    }
                    size="small"
                    sx={{ flex: 1 }}
                    helperText="This element by default; any CSS selector works"
                  />
                </>
              ) : null}
              {step.type === 'siteAlert' ? (
                <TextField
                  label="Message"
                  value={step.message ?? ''}
                  onChange={(inputEvent) =>
                    updateStep(index, { message: inputEvent.target.value })
                  }
                  size="small"
                  sx={{ flex: 1 }}
                />
              ) : null}
              {step.type === 'runWorkflow' ? (
                <TextField
                  label="Workflow"
                  value={step.workflowId ?? ''}
                  onChange={(inputEvent) => {
                    const workflow = (workflowDocs ?? []).find(
                      (item: any) => item.$id === inputEvent.target.value,
                    )
                    updateStep(index, {
                      workflowId: inputEvent.target.value,
                      workflowName: workflow?.name,
                    })
                  }}
                  size="small"
                  select
                  sx={{ flex: 1 }}
                >
                  {(workflowDocs ?? [])
                    .filter((workflow: any) => !workflow.deletedAt)
                    .map((workflow: any) => (
                      <MenuItem key={workflow.$id} value={workflow.$id}>
                        {workflow.name ?? workflow.$id}
                      </MenuItem>
                    ))}
                </TextField>
              ) : null}
              {step.type === 'showOverlay' ? (
                <TextField
                  label="Overlay"
                  value={step.overlayId ?? ''}
                  onChange={(inputEvent) => {
                    const overlay = (overlayDocs ?? []).find(
                      (item: any) => item.$id === inputEvent.target.value,
                    )
                    updateStep(index, {
                      overlayId: inputEvent.target.value,
                      overlayName: overlay?.name,
                    })
                  }}
                  size="small"
                  select
                  sx={{ flex: 1 }}
                >
                  {(overlayDocs ?? []).map((overlay: any) => (
                    <MenuItem key={overlay.$id} value={overlay.$id}>
                      {overlay.name ?? overlay.$id}
                    </MenuItem>
                  ))}
                </TextField>
              ) : null}
              {step.type === 'redirect' ? (
                <>
                  <TextField
                    label="Screen"
                    value={step.screenId ?? ''}
                    onChange={(inputEvent) =>
                      updateStep(index, {
                        screenId: inputEvent.target.value || undefined,
                        ...(inputEvent.target.value ? { url: undefined } : {}),
                      })
                    }
                    size="small"
                    select
                    sx={{ flex: 1 }}
                  >
                    <MenuItem value="">{'Custom URL…'}</MenuItem>
                    {(screenDocs ?? []).map((screen: any) => (
                      <MenuItem key={screen.$id} value={screen.$id}>
                        {screen.displayName ?? screen.slug ?? screen.$id}
                      </MenuItem>
                    ))}
                  </TextField>
                  {!step.screenId ? (
                    <TextField
                      label="URL"
                      value={step.url ?? ''}
                      onChange={(inputEvent) =>
                        updateStep(index, { url: inputEvent.target.value })
                      }
                      size="small"
                      sx={{ flex: 1 }}
                      placeholder="/contact"
                    />
                  ) : null}
                </>
              ) : null}
              {step.type === 'trackGaEvent' ? (
                <TextField
                  label="Event name"
                  value={step.eventName ?? ''}
                  onChange={(inputEvent) =>
                    updateStep(index, { eventName: inputEvent.target.value })
                  }
                  size="small"
                  sx={{ flex: 1 }}
                  placeholder="cta_click"
                />
              ) : null}
              {steps.length > 1 ? (
                <Button
                  size="small"
                  color="error"
                  onClick={() => updateStep(index, null)}
                >
                  {'✕'}
                </Button>
              ) : null}
            </Stack>
          </Stack>
        ))}
        <Button
          size="small"
          sx={{ alignSelf: 'flex-start' }}
          onClick={() =>
            setSteps((prev) => [
              ...prev,
              { type: 'siteAlert', message: '', severity: 'info' },
            ])
          }
        >
          {'Add action'}
        </Button>
        {problem && name.trim() ? (
          <Alert severity="warning">{problem}</Alert>
        ) : null}
        <Typography variant="caption" color="text.secondary">
          {'Saved interactions are enabled immediately — no Workflows-page ' +
            'detour.'}
        </Typography>
      </DialogContent>
      <DialogActions>
        <Button onClick={handleTest}>{'Test'}</Button>
        <Button onClick={onClose}>{'Cancel'}</Button>
        <Button
          variant="contained"
          color="secondary"
          disabled={Boolean(problem) || !name.trim()}
          onClick={handleSave}
        >
          {state.id ? 'Save' : 'Create'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
InteractionBuilderDialog.displayName = 'InteractionBuilderDialog'

export default InteractionBuilderDialog
