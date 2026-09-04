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

import * as Aglyn from '@aglyn/aglyn'
import * as Besigner from '@aglyn/besigner'
import { useConfirmationContext } from '@aglyn/shared-ui-jsx'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import { useCallback } from 'react'

/**
 * Replaces the whole node map as ONE undoable step, without the foreign-node
 * overlay `applyNodes` carries.
 *
 * That overlay is the interesting part. `applyNodes` re-applies every node a
 * peer has touched (`withForeignNodes(map, 0)`) because the maps IT serves —
 * a raw-JSON paste, a per-browser draft the crash net offers back — were
 * composed without any knowledge of the peer's later work, and publishing
 * them would roll that work back under this session's id (AGL-2486).
 *
 * Neither caller here is composed elsewhere. Both read the LIVE map at click
 * time and hand back a transformation of it, so there is no staleness for
 * the overlay to protect against — and applying it would be actively wrong:
 * a repair would have the peer's copy of the very nodes it just removed put
 * straight back, and a clear would be left holding whatever the peer had
 * touched, parented to elements that no longer exist. Which is the orphan
 * shape AGL-1363 is about.
 *
 * A clear DOES discard a co-editor's work, and nothing here pretends
 * otherwise — {@link useClearCanvasCallback} says so in the dialog when
 * there is a peer to lose.
 */
function replaceDocument(nodes: Record<string, any>): void {
  Aglyn.canvas.saveHistory()
  Aglyn.canvas.setNodes(nodes as never)
  Besigner.focus.clearFocusStatus()
}

/**
 * Whether the component registry is populated enough to be trusted about
 * what an element type IS.
 *
 * An empty registry answers "unknown" for every component in the document,
 * and a repair that believed it would delete all of it — the same shape as a
 * stubbed resolver making every capacity ceiling read zero. So the check is
 * simply not offered until there is something to check against.
 */
function componentResolver():
  | ((componentId: string) => boolean)
  | undefined {
  if (!Object.keys(Aglyn.components.factories ?? {}).length) return undefined
  return (componentId: string) =>
    Boolean(Aglyn.components.getFactory(componentId as never))
}

/** Groups findings for the preview, most consequential first. */
function summarize(result: Aglyn.CanvasRepairResult) {
  const removed = result.findings.filter((f) => f.action === 'removed')
  const moved = result.findings.filter((f) => f.action === 'reparented')
  const linked = result.findings.filter(
    (f) => f.action === 'unlinked' || f.action === 'relisted',
  )
  return { removed, moved, linked }
}

function FindingList({
  title,
  findings,
}: {
  title: string
  findings: Aglyn.CanvasRepairFinding[]
}) {
  if (!findings.length) return null
  return (
    <Box sx={{ mt: 2 }}>
      <Typography variant="subtitle2">{title}</Typography>
      <Box component="ul" sx={{ m: 0, pl: 3 }}>
        {/* Capped: a badly damaged document can carry dozens, and a dialog
            the author has to scroll to reach its own buttons is one they
            will dismiss without reading. */}
        {findings.slice(0, 12).map((finding, index) => (
          <Typography
            component="li"
            variant="body2"
            key={`${finding.nodeId}-${index}`}
          >
            <strong>{finding.label ?? finding.nodeId}</strong>
            {' — '}
            {finding.detail}
          </Typography>
        ))}
        {findings.length > 12 ? (
          <Typography component="li" variant="body2" color="text.secondary">
            {`and ${findings.length - 12} more`}
          </Typography>
        ) : null}
      </Box>
    </Box>
  )
}

/**
 * `Edit ▸ Repair page` — strip what the canvas cannot render and keep
 * everything that still works (AGL-2555).
 *
 * ⚠️ Never silent. The repair is computed first and shown to the author as a
 * list of what it would remove, move and relink; nothing is written until
 * they accept it. A quiet repair that deletes content is worse than the
 * corruption it is treating, because the author never learns which of their
 * work is gone.
 *
 * A sound document says so and writes nothing at all — an author who runs
 * this on a hunch should get an answer, not an undo entry.
 */
export function useRepairDocumentCallback(
  /** What this editor edits — 'page' on a screen, 'document' elsewhere. */
  noun = 'document',
): () => Promise<void> {
  const { confirm } = useConfirmationContext()

  return useCallback(async () => {
    const current = Aglyn.canvas.toJSON().nodes as Record<string, any>
    const result = Aglyn.repairCanvasNodes(current, {
      isKnownComponent: componentResolver(),
    })

    if (result.healthy) {
      await confirm({
        title: 'Nothing to repair',
        description: `Every element is intact and connected to the ${noun}. Nothing was changed.`,
        confirmationText: 'Close',
        cancellationButtonProps: { sx: { display: 'none' } },
      }).catch(() => {})
      return
    }

    const { removed, moved, linked } = summarize(result)
    return confirm({
      title: `Repair ${noun}`,
      description: (
        <Box>
          <Typography variant="body2">
            {`This ${noun} has ${result.findings.length} problem${
              result.findings.length === 1 ? '' : 's'
            }. ${result.kept} element${
              result.kept === 1 ? '' : 's'
            } will be kept.`}
          </Typography>
          {removed.length ? (
            <Alert severity="warning" sx={{ mt: 2 }}>
              {`${removed.length} element${
                removed.length === 1 ? ' will be' : 's will be'
              } removed. This cannot be recovered after you save, though Undo will step back before it.`}
            </Alert>
          ) : null}
          <FindingList title="Removed" findings={removed} />
          <FindingList title="Moved to the top level" findings={moved} />
          <FindingList title="Reconnected" findings={linked} />
        </Box>
      ),
      confirmationText: 'Repair',
      confirmationButtonProps: { color: removed.length ? 'error' : 'primary' },
    })
      .then(() => replaceDocument(result.nodes))
      .catch(() => {})
  }, [confirm, noun])
}

/**
 * `Edit ▸ Clear canvas` — empty the document without touching the screen
 * (AGL-2554).
 *
 * The screen record, its SEO fields, the layout binding, the parent and
 * slug, the id and the version history all stay. Deleting the screen and
 * recreating it is what an author had to do instead, and that throws every
 * one of those away — and pushes a fresh screen back through the window
 * where a blank page is briefly live.
 *
 * Works on a document the hierarchy cannot render, which is the case that
 * needs it most: `'Invalid node'` rows are not selectable, so Delete Element
 * cannot reach them, and Add Element only appends.
 */
export function useClearCanvasCallback(
  /** What this editor edits — 'page' on a screen, 'document' elsewhere. */
  noun = 'document',
): () => Promise<void> {
  const { confirm } = useConfirmationContext()

  return useCallback(() => {
    const remote = Aglyn.canvas.hasRemoteEdits
    return confirm({
      title: 'Clear canvas?',
      description: (
        <Box>
          <Typography variant="body2">
            {`Every element will be removed. The ${noun} itself — its settings, its address and its version history — is not affected, and Undo steps back.`}
          </Typography>
          {remote ? (
            <Alert severity="warning" sx={{ mt: 2 }}>
              {`Someone else has edited this ${noun} since you opened it. Clearing removes their work too.`}
            </Alert>
          ) : null}
        </Box>
      ),
      confirmationText: 'Clear canvas',
      confirmationButtonProps: { color: 'error' },
    })
      .then(() => {
        const current = Aglyn.canvas.toJSON().nodes as Record<string, any>
        replaceDocument(Aglyn.clearCanvasNodes(current))
      })
      .catch(() => {})
  }, [confirm, noun])
}

export default useRepairDocumentCallback
