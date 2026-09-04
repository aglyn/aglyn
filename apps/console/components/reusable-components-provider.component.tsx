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
import { ComponentPromotionContext } from '@aglyn/besigner-ui'
import { mdiPackageVariant } from '@aglyn/shared-data-mdi'
import { useLoading } from '@aglyn/shared-ui-jsx'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  TextField,
} from '@mui/material'
import { doc, getDoc } from 'firebase/firestore'
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  useFirestore,
  useHostResourceApi,
} from '@aglyn/tenant-feature-instance'
import { hasEntitlement } from '../constants/entitlements'
import { buildRoute, Route } from '../constants/route-links'
import useCurrentOrg from '../hooks/use-current-org'
import useHostComponentDefinitions from '../hooks/use-host-component-definitions'
import useHostFormDesigns from '../hooks/use-host-form-designs'
import { useOrgSlug } from '../hooks/use-org-scope'
import { useHostSubdomain } from './host-id-provider'

export interface ReusableComponentsProviderProps {
  hostId: string
  /**
   * The form this canvas IS, when it is a form's own besigner.
   *
   * Its published design is withheld from the graft below, and the reason is
   * structural rather than a preference: `checkFormContract` requires a form
   * design's `form` node to name the form it is the design of, so the document
   * open in a form editor always places itself. Grafting there would paint the
   * last PUBLISHED version over the draft being edited — the author's unsaved
   * fields would vanish behind the copy they are trying to replace.
   *
   * Only forms need this. A component definition cannot instance itself; the
   * editor refuses the reference and the graft bounds it anyway.
   */
  editingFormId?: string
  children?: JSX.Children
}

/** Node ids of a subtree, root included, walked through `nodes` arrays. */
function collectSubtreeIds(
  rootId: string,
  nodesById: Record<string, any>,
): string[] {
  const ids: string[] = []
  const queue = [rootId]
  while (queue.length) {
    const id = queue.shift() as string
    if (!nodesById[id] || ids.includes(id)) continue
    ids.push(id)
    const children = nodesById[id]?.nodes
    if (Array.isArray(children)) queue.push(...children)
  }
  return ids
}

/**
 * Console-side reusable-component flows (AGL-35): provides promote/demote
 * callbacks to the designer's Attributes panel, hosts the promote dialog,
 * and registers each host component definition as an element-drawer preset
 * under "Your components".
 */
export function ReusableComponentsProvider(
  props: ReusableComponentsProviderProps,
) {
  const { hostId, editingFormId, children } = props
  const firestore = useFirestore()
  const createHostResource = useHostResourceApi()
  const { enqueueSnackbar } = useSnackbar()
  const { queueLoading } = useLoading()
  const { org, ready: orgReady } = useCurrentOrg()
  const orgSlug = useOrgSlug()
  const hostSubdomain = useHostSubdomain()
  const [promoteNode, setPromoteNode] = useState<Aglyn.NodeSchema<any> | null>(
    null,
  )
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')

  // Shared with the canvas's reusable-instance graft (AGL-1217): one query,
  // one listener, one set of skip rules for both readers.
  const { docs: componentDocs, definitions } =
    useHostComponentDefinitions(hostId)

  // The same arrangement for form entities: a placed form draws the fields its
  // entity publishes, so the canvas shows what the page will render rather
  // than the copy of the fields the screen happens to hold. Read here because
  // this provider already wraps every besigner surface — a second provider
  // would be a second place for the canvas to be told what a document is.
  const { designs: hostFormDesigns } = useHostFormDesigns(hostId)
  // A form's own editor is the one canvas that must NOT resolve itself — see
  // `editingFormId`. Withheld here rather than at the graft so every consumer
  // of the context sees one answer to "what does this canvas resolve".
  const formDesigns = useMemo(() => {
    if (!hostFormDesigns || !editingFormId) return hostFormDesigns
    if (!(editingFormId in hostFormDesigns)) return hostFormDesigns
    const next = { ...hostFormDesigns }
    delete next[editingFormId]
    return next
  }, [hostFormDesigns, editingFormId])

  // Element drawer: one preset per definition, category "Your components".
  useEffect(() => {
    const definitions = (componentDocs ?? []).filter(
      (definition: any) => !definition.deletedAt,
    )
    if (!definitions.length) return
    const presets: Aglyn.PresetSchema[] = definitions.map(
      (definition: any) => ({
        $id: `hostcmp:${definition.$id}`,
        type: Aglyn.NodeType.PRESET,
        displayName: definition.displayName ?? definition.$id,
        // The component's own icon when it has one (AGL-1193); the purple
        // package glyph is what "no icon chosen" looks like, not a brand.
        icon: definition.icon?.iconPath
          ? { path: definition.icon.iconPath }
          : { path: mdiPackageVariant.path, sx: { color: '#9c27b0' } },
        category: Aglyn.REUSABLE_COMPONENT_CATEGORY,
        data: {
          $id: null,
          componentId: Aglyn.REUSABLE_INSTANCE_COMPONENT_ID,
          pluginId: 'mui',
          props: {
            refId: definition.$id,
            // Names the editor placeholder (AGL-1193) — a canvas of
            // identical dashed boxes is unreadable once chrome is promoted.
            name: definition.displayName ?? definition.$id,
          },
        },
      }),
    )
    Aglyn.components.registerPreset(presets)
    return () => {
      Aglyn.components.unregisterPreset(presets.map((preset) => preset.$id))
    }
  }, [componentDocs])

  const handlePromote = useCallback(
    (node: Aglyn.NodeSchema<any>) => {
      // AGL-1380: this provider wraps the besigner, which mounts well before
      // the org billing doc settles. `hasEntitlement` on an undefined `org`
      // answers NO, so promoting a node in that window told a Starter+ org
      // the feature it pays for is not on its plan.
      if (!orgReady) {
        return void enqueueSnackbar(
          'Checking your plan — try again in a moment',
          { variant: 'info', persist: false },
        )
      }
      if (!hasEntitlement('reusableComponents', org)) {
        return void enqueueSnackbar(
          'Reusable components require a Starter plan — see Billing to upgrade',
          { variant: 'warning', persist: false },
        )
      }
      setName(String(node?.componentSchema?.displayName ?? 'Component'))
      setDescription('')
      setPromoteNode(node)
    },
    [org, orgReady, enqueueSnackbar],
  )

  const handlePromoteConfirm = useCallback(async () => {
    const node = promoteNode
    if (!node) return
    const dequeue = queueLoading()
    try {
      const all = Aglyn.canvas.toJSON().nodes as Record<string, any>
      const subtreeIds = collectSubtreeIds(node.$id, all)
      const definitionNodes: Record<string, any> = {}
      for (const id of subtreeIds) {
        const { componentSchema: _cs, resolvedProps: _rp, ...plain } = all[id]
        definitionNodes[id] =
          id === node.$id ? { ...plain, parentId: null } : plain
      }
      // Creation rides the resources API (AGL-473): reusable components
      // render on the live site, so the Starter+ entitlement is enforced
      // server-side, not just by hiding the promote button.
      const created = await createHostResource({
        hostId,
        resource: 'reusableComponent',
        data: {
          displayName: name || 'Component',
          ...(description && { description }),
          rootId: node.$id,
          nodes: definitionNodes,
        },
      })
      // Swap the promoted subtree for an instance of what we just created
      // (AGL-1193). Leaving it inline made the promoting document the ONE
      // place that would never track the component it defined — edit "Site
      // nav" later and the layout that created it silently keeps the old
      // copy. The canvas shows instances as a named placeholder rather than
      // the definition's content (definitions graft at render, not in the
      // editor), which is the same thing inserting one from "Your
      // components" has always looked like.
      Aglyn.canvas.applyNodes(
        Aglyn.replaceSubtreeWithInstance(
          Aglyn.canvas.toJSON().nodes as any,
          node.$id,
          created.id,
          name || 'Component',
        ) as any,
      )
      setPromoteNode(null)
      enqueueSnackbar(
        `Saved "${name}" — this element now follows the component, and you ` +
          'can insert it anywhere from Your components',
        { variant: 'success', persist: false },
      )
    } catch (error: any) {
      console.error(error)
      enqueueSnackbar(error?.message ?? 'An error has occurred', {
        variant: 'error',
        allowDuplicate: true,
      })
    } finally {
      dequeue()
    }
  }, [
    promoteNode,
    name,
    description,
    createHostResource,
    firestore,
    hostId,
    queueLoading,
    enqueueSnackbar,
  ])

  const handleDemote = useCallback(
    async (node: Aglyn.NodeSchema<any>) => {
      const refId = (node?.props as any)?.refId as string | undefined
      if (!refId) return
      const dequeue = queueLoading()
      try {
        const snapshot = await getDoc(
          doc(firestore, 'hosts', hostId, 'components', refId),
        )
        const stored = snapshot.data() as any
        // BOTH stored forms (AGL-1151). A converter-less `getDoc`, so a
        // promoted definition arrives as `Bytes` — and `detachInstanceSubtree`
        // below walks `definition.nodes` to materialize the subtree, so an
        // undecoded one writes a byte array into the author's canvas.
        const definition = stored && {
          ...stored,
          nodes: Aglyn.decodeStoredNodes(stored.nodes),
        }
        if (!definition?.nodes || !definition?.rootId) {
          throw new Error('Definition missing')
        }
        // Materialize what the instance was RENDERING (AGL-1314), not the
        // definition as stored: `detachInstanceSubtree` runs the graft's own
        // `{{prop.*}}` substitution and root-override merge, so the copy
        // keeps the author's text, its bound media and the styling the page
        // was showing. Copying `definition.nodes` verbatim here is what left
        // detached heroes rendering literal `{{prop.headline}}` markers.
        // Fresh ids, except the root, which keeps the instance node's id so
        // the parent's child list and the current selection stay valid.
        const all = Aglyn.canvas.toJSON().nodes as Record<string, any>
        const next = Aglyn.detachInstanceSubtree(
          all,
          node.$id,
          definition,
          () => Aglyn.createResourceUid(),
        )
        // A no-op means the selected node is not an instance the canvas
        // knows about — say so rather than claiming a detach that never
        // happened.
        if (next === all) throw new Error('Instance not found on this screen')
        Aglyn.canvas.applyNodes(next as any)
        enqueueSnackbar('Detached — this copy no longer follows the component', {
          variant: 'success',
          persist: false,
        })
      } catch (error) {
        console.error(error)
        enqueueSnackbar('An error has occurred', {
          variant: 'error',
          allowDuplicate: true,
        })
      } finally {
        dequeue()
      }
    },
    [firestore, hostId, queueLoading, enqueueSnackbar],
  )

  /**
   * "Edit component" on a selected instance (AGL-1303 phase 1): opens the
   * component's own besigner in a NEW TAB, same as the Preview button's
   * window.open idiom — the author keeps their place on the page that
   * uses it.
   *
   * What propagates back, precisely (AGL-1898). This comment used to say a
   * SAVE over there rides AGL-1301's co-editing, and both halves are wrong
   * — the same correction `38b19d5fc` made in `useHostComponentDefinitions`
   * and missed here, leaving the false version at the feature's own entry
   * point. AGL-1301's co-editing did land for component documents, but its
   * RTDB room is keyed by document and a screen besigner never subscribes
   * to a component's. What actually carries the change is
   * `useHostComponentDefinitions` — a live `onSnapshot` over the host's
   * `components` collection, whose new map re-grafts every open instance
   * preview. That watches the PARENT doc, which only PUBLISH writes; the
   * component editor's Save writes the version doc and is invisible here.
   * So the loop today is edit → Save → Publish → other tabs update.
   *
   * The version to open follows the component detail page's own default:
   * the working `versionId` pointer. A component that predates versioning
   * has none and needs one MINTED before its besigner can open, and the
   * detail page is the one place that knows what an initial version looks
   * like — so those (rare, old) components land there, one click from the
   * same besigner, rather than this callback growing a second minting
   * path that could drift.
   */
  const handleEditComponent = useCallback(
    (node: Aglyn.NodeSchema<any>) => {
      const refId = (node?.props as any)?.refId as string | undefined
      if (!refId || !orgSlug || !hostSubdomain) return
      const definitionDoc = (componentDocs ?? []).find(
        (definition: any) => definition?.$id === refId,
      ) as { versionId?: string } | undefined
      const versionId = definitionDoc?.versionId
      const url = versionId
        ? buildRoute(Route.COMPONENT_BESIGNER, {
            orgSlug,
            host: hostSubdomain,
            componentId: refId,
            versionId,
          })
        : buildRoute(Route.COMPONENT_DETAILS, {
            orgSlug,
            host: hostSubdomain,
            componentId: refId,
          })
      window.open(url, '_blank', 'noopener,noreferrer')
    },
    [componentDocs, orgSlug, hostSubdomain],
  )

  // The definitions the designer needs (AGL-1247/1251/1193): declared props
  // for the Attributes panel, the tree itself so the canvas can render an
  // instance instead of a dashed box, and the chosen icon. Straight off the
  // hook rather than a second mapping of the same docs — two maps of the
  // same type will eventually disagree about which fields a definition has.
  const contextValue = useMemo(
    () => ({
      onPromote: handlePromote,
      onDemote: handleDemote,
      onEditComponent: handleEditComponent,
      definitions,
      formDesigns,
    }),
    [
      handlePromote,
      handleDemote,
      handleEditComponent,
      definitions,
      formDesigns,
    ],
  )

  return (
    <ComponentPromotionContext.Provider value={contextValue}>
      {children}
      <Dialog
        open={Boolean(promoteNode)}
        onClose={() => setPromoteNode(null)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>{'Save as reusable component'}</DialogTitle>
        <DialogContent
          sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}
        >
          <TextField
            label="Name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            size="small"
            autoFocus
            sx={{ mt: 1 }}
          />
          <TextField
            label="Description"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            size="small"
            multiline
            minRows={2}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPromoteNode(null)}>{'Cancel'}</Button>
          <Button
            variant="contained"
            color="primary"
            disabled={!name.trim()}
            onClick={handlePromoteConfirm}
          >
            {'Save component'}
          </Button>
        </DialogActions>
      </Dialog>
    </ComponentPromotionContext.Provider>
  )
}
ReusableComponentsProvider.displayName = 'ReusableComponentsProvider'

export default ReusableComponentsProvider
