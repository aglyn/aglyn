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
import isEqual from 'lodash-es/isEqual'
import { useCallback, useEffect, useRef, useState } from 'react'
import * as Besigner from '@aglyn/besigner'
import {
  type BesignerDraftIds,
  clearBesignerDraft,
} from '../drafts/besigner-draft-store'
import {
  type BesignerDraftState,
  useBesignerDraft,
} from './use-besigner-draft'

/**
 * How the host application surfaces a message. Deliberately a plain
 * callback rather than a snackbar dependency: the console passes its
 * `enqueueSnackbar`, and an embedder outside the console passes whatever it
 * has (a toast, a console.log, nothing at all).
 */
export type BesignerNotify = (
  message: string,
  options?: {
    variant?: 'info' | 'success' | 'warning' | 'error'
    /**
     * Presentation hints, passed through rather than derived from `variant`
     * because the console's four editors deliberately mix them — a
     * near-limit warning is transient, a concurrent-edit warning is not.
     * An embedder without these concepts can ignore them.
     */
    persist?: boolean
    allowDuplicate?: boolean
  },
) => void

/**
 * Begins a loading indication and returns the function that ends it. Same
 * contract as the console's `queueLoading`; defaults to a no-op.
 */
export type BesignerQueueLoading = () => () => void

/**
 * What this editor believes the stored document looked like when it last
 * agreed with it, handed to `save` so a store can make the write
 * conditional (AGL-1301) — a Firestore provider runs the same comparison
 * inside a transaction, closing the window where a save lands between
 * another writer's commit and the local snapshot's delivery.
 */
export interface BesignerSaveBaseline {
  /** `versionStamp(...)` of the stored `updatedAt` at load/last agreement. */
  baseStamp: string | null
  /** The stored nodes as of that agreement, in STORED shape. */
  baseNodes: Aglyn.ProcessableNodes | undefined
}

export interface BesignerDocumentSource<TData = unknown> {
  /** The stored node map, or undefined while loading. */
  nodes: Aglyn.ProcessableNodes | undefined
  /** Whatever the store stamps on write; used to detect concurrent edits. */
  updatedAt?: unknown
  /**
   * The snapshot `nodes` came from still carries writes this client made
   * that the store has NOT acknowledged (Firestore's
   * `snapshot.metadata.hasPendingWrites`).
   *
   * It decides whether the loaded document may be adopted as the *saved*
   * state. It may not: a queued write is replayed into the first snapshot
   * after a reload, so believing it would mean recording work the server
   * never took as "already saved" — after which the editor is clean, Save is
   * dead, and the canvas and the document disagree in silence (AGL-1262).
   * Omitted (undefined) reads as confirmed, which is right for every store
   * that has no such queue.
   */
  pendingWrites?: boolean
  status?: 'idle' | 'loading' | 'success' | 'error'
  error?: { message?: string } | null
  /**
   * Persists the node map. Rejecting surfaces as an error notification —
   * except `ConcurrentEditError`, which surfaces through the same refusal
   * UX as the listener-side guard (AGL-1301). `baseline` is what this
   * editor last agreed the stored document looked like; a store that can
   * make the write conditional should (see `saveNodesGuarded`), and one
   * that cannot may ignore it.
   */
  save: (
    nodes: Record<string, unknown>,
    baseline?: BesignerSaveBaseline,
  ) => Promise<void>
  data?: TData
}

export interface UseBesignerDocumentOptions<TData = unknown>
  extends BesignerDocumentSource<TData> {
  /**
   * The word used in user-facing copy — 'screen', 'layout', 'component',
   * 'template', 'email'. Keeps each editor's messages accurate without
   * forking the logic.
   */
  noun: string
  /** Canvas view type; reset to SCREEN on unmount. */
  viewType?: Aglyn.HostViewType
  /**
   * Identity of the open document. Changing it re-arms the canvas reset,
   * which is what stops one document's nodes leaking into the next.
   */
  documentKey?: string
  /**
   * Identity for the local crash-recovery draft (AGL-1256). Omit and drafts
   * are simply off for this editor.
   *
   * Deliberately separate from `documentKey`, which is not unique enough to
   * key storage on: both email editors build it as
   * `${templateKey}:${versionId}`, so a platform template and every host's
   * override of the same key produce the same string.
   */
  draft?: BesignerDraftIds
  notify?: BesignerNotify
  queueLoading?: BesignerQueueLoading
  /** Called after a successful save, for activity logging. */
  onSaved?: () => void
  /**
   * Overrides the success message. Defaults to `"<Noun> saved successfully"`;
   * templates say simply "Template saved" and that copy is preserved rather
   * than normalised by the extraction.
   */
  savedMessage?: string
  /**
   * Maps the stored node map into what the canvas should render, for
   * documents whose storage shape is not a canvas tree.
   *
   * Reusable components and component-kind templates store a *definition*,
   * rooted at the promoted node rather than the canvas root — rendering one
   * unwrapped gives a canvas with no root and a blank editor (AGL-680).
   * Defaults to identity; putting a document back into its stored shape is
   * the caller's `save`, which already owns that direction (AGL-681).
   */
  toCanvasNodes?: (
    nodes: Aglyn.ProcessableNodes,
  ) => Aglyn.ProcessableNodes
  /**
   * The inverse of `toCanvasNodes`: maps the canvas tree back into the
   * stored shape, and may refuse the save with a message.
   *
   * Runs *before* the size guard, so the guard measures what will actually
   * be written rather than the canvas representation of it. A component-kind
   * template that no longer has a single top-level element is rejected here
   * (AGL-681).
   */
  fromCanvasNodes?: (
    canvasNodes: Record<string, unknown>,
  ) => { nodes: Record<string, unknown> } | { error: string }
}

export interface UseBesignerDocumentResult {
  /** True when the canvas differs from the last agreed state. */
  saveAvailable: boolean
  /** True when someone else wrote this document since we loaded it. */
  remoteChanged: boolean
  handleSave: () => Promise<void> | void
  /**
   * Announce a write this editor is about to make to the SAME document
   * outside `handleSave` — component properties are the first (AGL-1247).
   *
   * Without it the write's own echo is indistinguishable from a colleague's
   * and trips the conflict guard, which pauses saving until reload: the
   * editor accuses you of being someone else.
   */
  markOwnWrite: () => void
  /**
   * Unsaved work recovered from local storage after a crash or reload, and
   * the two things the author can do about it (AGL-1256). Always present;
   * `available` is false when there is nothing to offer.
   */
  draft: BesignerDraftState
  /** JSON editor plumbing, identical in every editor. */
  jsonOpen: boolean
  openJsonEditor: () => void
  closeJsonEditor: () => void
  handleJsonSave: (event: unknown, value: unknown) => void
  /**
   * The document could not be read AND there is nothing to show for it
   * (AGL-1066).
   *
   * Deliberately NOT "the read errored". Under `persistentLocalCache` a
   * refused listen still serves the document from IndexedDB, and a refused
   * listen can now reach `status: 'error'` — so an editor with a canvas full
   * of the author's work would otherwise be replaced by "Not found" about two
   * seconds into a stale session, mid-edit. Whether the console should keep
   * SERVING that cached document is the question AGL-1066 settled as "keep
   * serving, but stop presenting it as live"; the presentation half is the
   * shell's re-auth banner and the refusal on save, not blanking the canvas.
   *
   * When the read failed and nothing ever arrived there is genuinely nothing
   * to render, and this is true — which is the state the "Not found" branch
   * was written for.
   */
  hasError: boolean
  notFound: boolean
  /**
   * The document is on screen but the server has stopped answering for it
   * (AGL-1066) — cached content, no refresh coming. Saving is already refused
   * by the seed guards; this is what an editor would surface to say why.
   */
  staleContent: boolean
}

const noopQueueLoading: BesignerQueueLoading = () => () => undefined
const noopNotify: BesignerNotify = () => undefined

/**
 * Pushes a stored node map into the shared canvas singleton.
 *
 * The canvas root is guaranteed here rather than per editor (AGL-931). A map
 * without one leaves the hierarchy showing 'Invalid node' with Add Element
 * disabled — an editor the document can never be repaired from — and only
 * the two definition-shaped editors passed a `toCanvasNodes` that repaired
 * it. Doing it at the one point every editor loads through means no route
 * can be added that forgets.
 */
export function setLocalNodes(value: Aglyn.ProcessableNodes) {
  const parsed = Aglyn.canvas.processNodesToDenormalized(value)
  return Aglyn.canvas.setNodes(
    Aglyn.ensureCanvasRoot(parsed) as typeof parsed,
  )
}

/**
 * The document-agnostic half of a besigner editor.
 *
 * Everything here was copy-pasted across the console's four besigner routes
 * (screens, layouts, components, templates) — canvas lifecycle, first load,
 * concurrent-write detection (AGL-674), the size-guarded save (AGL-678) and
 * the JSON editor. None of it is about hosts, orgs, themes or publishing,
 * so none of it belongs in a console route.
 *
 * It has **no console and no host dependency** by design: the caller
 * supplies the document source and the notify/loading adapters. That is
 * what lets besigner drive a document that has no host — the platform email
 * templates — and, longer term, run outside the console entirely.
 */
export function useBesignerDocument<TData = unknown>(
  options: UseBesignerDocumentOptions<TData>,
): UseBesignerDocumentResult {
  const {
    nodes,
    updatedAt,
    pendingWrites,
    status,
    error,
    save,
    noun,
    viewType,
    documentKey,
    draft: draftIds,
    notify = noopNotify,
    queueLoading = noopQueueLoading,
    onSaved,
    savedMessage,
    toCanvasNodes,
    fromCanvasNodes,
  } = options

  const saveAvailable = !Aglyn.canvas.isInitialSame
  const errored = Boolean(error) || status === 'error'
  // See `UseBesignerDocumentResult.hasError` — an errored read that still has
  // a document to show is stale, not missing (AGL-1066).
  const hasError = errored && !nodes
  const staleContent = errored && Boolean(nodes)
  /**
   * `!== 'loading'` rather than `=== 'success'` (AGL-1066).
   *
   * A refused read with nothing cached used to sit on `'loading'` forever and
   * now reaches `'error'`, so gating on `'success'` would have quietly stopped
   * recognising a missing document at the moment it started being reachable.
   * `hasError` covers the errored half either way; this keeps the two verdicts
   * from both going false and rendering an editor over nothing.
   */
  const notFound = status !== 'loading' && !nodes

  // The canvas is a singleton shared by every editing session; without a
  // reset on leave, client-side navigation to another document keeps (and
  // could save) this one's nodes.
  useEffect(() => {
    return () => {
      Aglyn.canvas.reset()
      Besigner.focus.clearFocusStatus()
    }
  }, [documentKey])

  // The view type decides which components the drawer offers (an email
  // document must not be able to insert a nav bar). Reset on leave so the
  // next session on the singleton canvas is unaffected.
  useEffect(() => {
    if (!viewType) return undefined
    if (!Besigner.doesBesignerAppExist()) return undefined
    const app = Besigner.getBesignerApp()
    Besigner.setBesignerFlag(app, { flag: 'viewType', value: () => viewType })
    return () => {
      Besigner.setBesignerFlag(app, {
        flag: 'viewType',
        value: () => Aglyn.HostViewType.SCREEN,
      })
    }
  }, [viewType])

  useEffect(() => {
    if (status === 'loading') return queueLoading()
    return undefined
  }, [status])

  // Conflict detection (AGL-674). Two people editing one version both write
  // the WHOLE node map, so without this the later save silently replaces the
  // earlier one and neither is told. `baseStamp` is what the document looked
  // like when this editor last agreed with it.
  const baseStampRef = useRef<string | null>(null)
  /**
   * The stored nodes as of the last agreement, in STORED shape. Kept
   * alongside the stamp because the stamp is an app-level FIELD a writer can
   * forget: admin scripts have updated `nodes` without touching `updatedAt`,
   * and such a write was invisible to the stamp guard and got clobbered
   * (AGL-1301). The web SDK exposes no server-side `updateTime` on a
   * snapshot, so a change in the content itself is the strongest signal a
   * client can key on.
   */
  const baseNodesRef = useRef<Aglyn.ProcessableNodes | undefined>(undefined)
  /** Set when we save, so the resulting snapshot is adopted, not flagged. */
  const expectOwnWriteRef = useRef(false)
  const [remoteChanged, setRemoteChanged] = useState(false)

  useEffect(() => {
    if (nodes && !Aglyn.canvas.didSetInitial) {
      setLocalNodes(toCanvasNodes ? toCanvasNodes(nodes) : nodes)
      // The loaded document becomes the "saved" baseline ONLY when the store
      // has acknowledged it. A snapshot still carrying our own queued write
      // shows the work (never hide it) but records nothing as saved, so the
      // editor stays dirty and the work can still be written for real
      // (AGL-1262). Without this the editor adopts an unacknowledged edit as
      // the saved state and can never save again — not by re-editing, not by
      // restoring the draft, whose content is the same.
      Aglyn.canvas.updateInitialNodes(undefined, {
        confirmed: !pendingWrites,
      })
      baseStampRef.current = Aglyn.versionStamp(updatedAt)
      baseNodesRef.current = nodes
    }
  }, [nodes, pendingWrites])

  useEffect(() => {
    const stored = Aglyn.versionStamp(updatedAt)
    const stampMoved = Aglyn.hasConcurrentWrite(baseStampRef.current, stored)
    // A writer that forgot the stamp still cannot hide: the content moved.
    const nodesMoved =
      nodes != null &&
      baseNodesRef.current != null &&
      !isEqual(nodes, baseNodesRef.current)
    if (!stampMoved && !nodesMoved) return
    if (expectOwnWriteRef.current) {
      // This is the echo of our own save landing.
      expectOwnWriteRef.current = false
      baseStampRef.current = stored
      baseNodesRef.current = nodes
      return
    }
    setRemoteChanged(true)
  }, [updatedAt, nodes])

  // Crash net (AGL-1256). Shares the conflict guard's stamp so the restore
  // prompt can tell "your unsaved work" from "your unsaved work, and someone
  // else has saved since".
  const draft = useBesignerDraft({
    ids: draftIds,
    loaded: Aglyn.canvas.didSetInitial,
    dirty: saveAvailable,
    storedStamp: Aglyn.versionStamp(updatedAt),
  })

  const handleSave = useCallback(async () => {
    const canvasNodes = Aglyn.canvas.toJSON().nodes as Record<string, unknown>
    const prepared = fromCanvasNodes
      ? fromCanvasNodes(canvasNodes)
      : { nodes: canvasNodes }

    // "Nothing to save" is a claim about the STORED document, so check it
    // against the stored document — not against a baseline that can be
    // wrong. When the two disagree the baseline lied, and this click is the
    // author's only way out: a Save that quietly does nothing while the
    // canvas and the document differ is how work is lost in silence
    // (AGL-1262). `nodes` absent means the document has not loaded, and
    // saving the empty canvas over it would be the worse bug.
    if (!saveAvailable) {
      const agrees =
        !nodes || 'error' in prepared || isEqual(prepared.nodes, nodes)
      if (agrees) {
        return notify('Already saved', { variant: 'info', persist: false })
      }
    }
    // Refuse rather than merge. A wrong automatic merge of a whole node map
    // is worse than a refusal the user can act on — and their work is still
    // in the canvas either way.
    if (remoteChanged) {
      return notify(new Aglyn.ConcurrentEditError().message, {
        variant: 'warning',
        allowDuplicate: true,
      })
    }
    const dequeueLoading = queueLoading()

    if ('error' in prepared) {
      dequeueLoading()
      return notify(prepared.error, {
        variant: 'warning',
        allowDuplicate: true,
      })
    }
    const nextNodes = prepared.nodes
    // Size guard (AGL-678): the node map is stored as one msgpack blob and
    // Firestore rejects documents over 1 MiB. Nothing checked this before,
    // so an oversized document simply stopped saving with a generic error
    // and no way to tell which content was to blame.
    const size = Aglyn.measureNodeMap(nextNodes)
    if (size.tooLarge) {
      dequeueLoading()
      const worst = size.largest[0]
      return notify(
        `This ${noun} is ${Aglyn.formatBytes(size.bytes)} and too large to ` +
          'save. Move repeated sections into reusable components, or replace ' +
          'inlined images with uploads from the media library' +
          (worst
            ? ` — the largest element is ${Aglyn.formatBytes(worst.bytes)}.`
            : '.'),
        { variant: 'error', allowDuplicate: true },
      )
    }
    if (size.nearLimit) {
      notify(
        `Heads up: this ${noun} is ${Aglyn.formatBytes(size.bytes)}. Past ` +
          'about 900 KB it stops saving — moving repeated sections into ' +
          'reusable components is the usual fix.',
        { variant: 'warning', persist: false },
      )
    }

    try {
      // The baseline rides along so the store can refuse a stale save
      // SERVER-side (AGL-1301) — the listener guard above only knows about
      // writes whose snapshot has already arrived.
      await save(nextNodes, {
        baseStamp: baseStampRef.current,
        baseNodes: baseNodesRef.current,
      })
      Aglyn.canvas.updateInitialNodes(nextNodes as never)
      // The draft dies with the save that made it redundant (AGL-1256). This
      // is the rule that keeps a crash net from quietly becoming free version
      // history: a draft can only ever hold work that was never saved, so it
      // can never be used to roll a document back to an earlier saved state.
      // That is what the `versioning` entitlement sells.
      if (draftIds) clearBesignerDraft(draftIds)
      // Fire-and-forget attribution (AGL-676) — an audit miss must not break
      // the edit that triggered it.
      onSaved?.()
      // Our own write moves the stamp; the new value arrives on the next
      // snapshot, so mark it as ours rather than somebody else's edit.
      expectOwnWriteRef.current = true
      setRemoteChanged(false)
      notify(
        savedMessage ??
          `${noun.charAt(0).toUpperCase()}${noun.slice(1)} saved successfully`,
        { variant: 'success', persist: false },
      )
    } catch (saveError) {
      // A store-side refusal of a stale baseline (AGL-1301) is the SAME
      // conflict the guard above refuses, caught later — surface it the same
      // way, and pause saving so the next click does not retry blind. Name
      // check rather than instanceof: the error may cross a lib boundary.
      if ((saveError as Error | undefined)?.name === 'ConcurrentEditError') {
        setRemoteChanged(true)
        notify((saveError as Error).message, {
          variant: 'warning',
          allowDuplicate: true,
        })
      } else {
        notify(`Error: ${JSON.stringify(saveError)}`, {
          variant: 'error',
          allowDuplicate: true,
        })
      }
    } finally {
      dequeueLoading()
    }
    return undefined
  }, [
    saveAvailable,
    remoteChanged,
    nodes,
    save,
    notify,
    queueLoading,
    noun,
    onSaved,
    savedMessage,
    fromCanvasNodes,
    draftIds,
  ])

  // Same flag `handleSave` sets, for writes that do not go through it.
  const markOwnWrite = useCallback(() => {
    expectOwnWriteRef.current = true
  }, [])

  const [jsonOpen, setJsonOpen] = useState(false)
  const openJsonEditor = useCallback(() => setJsonOpen(true), [])
  const closeJsonEditor = useCallback(() => setJsonOpen(false), [])
  const handleJsonSave = useCallback((_event: unknown, value: unknown) => {
    Aglyn.canvas.applyNodes(value as never)
    setJsonOpen(false)
  }, [])

  return {
    saveAvailable,
    remoteChanged,
    handleSave,
    markOwnWrite,
    draft,
    jsonOpen,
    openJsonEditor,
    closeJsonEditor,
    handleJsonSave,
    hasError,
    notFound,
    staleContent,
  }
}

export default useBesignerDocument
