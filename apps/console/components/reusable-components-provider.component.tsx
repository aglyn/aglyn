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
import {
  canvas,
  components,
  createResourceUid,
  decodeStoredNodes,
  detachInstanceSubtree,
  NodeType,
  replaceSubtreeWithInstance,
  reusableComponentDefinitionFrom,
  reusableComponentKindForView,
  reusableComponentKindOf,
  reusableComponentPaletteSlot,
  REUSABLE_COMPONENT_KIND_EMAIL,
  REUSABLE_EMAIL_BLOCK_CATEGORY,
  REUSABLE_INSTANCE_COMPONENT_ID,
} from '@aglyn/aglyn'
import {
  ComponentPromotionContext,
  useAglynBesignerFlag,
} from '@aglyn/besigner-ui'
import { mdiPackageVariant } from '@aglyn/shared-data-mdi'
import { useLoading } from '@aglyn/shared-ui-jsx'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
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
  /**
   * Whether this canvas offers Save as reusable component. On by default.
   *
   * Off for a document that borrows another site's components rather than
   * authoring them: a platform email draws the platform marketing site's
   * email blocks (AGL-3318), and a promotion there would create a component
   * on that site from outside its own editor, under no workspace's plan.
   * Detach stays, since it rewrites only the document open here. Edit
   * component stays too, and opens nothing on a route that names no site,
   * which has no link to build.
   */
  allowPromote?: boolean
  children?: JSX.Children
}

/**
 * Console-side reusable-component flows (AGL-35): provides promote/demote
 * callbacks to the designer's Attributes panel, hosts the promote dialog,
 * and registers each host component definition as an element-drawer preset
 * under "Your components" — or, for a reusable email block, under "Your email
 * blocks", which only an email's drawer offers (AGL-3287).
 */
export function ReusableComponentsProvider(
  props: ReusableComponentsProviderProps,
) {
  const { hostId, editingFormId, allowPromote = true, children } = props
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
  /**
   * What a promotion here makes (AGL-3287): an email block in an email's
   * editor, a page component anywhere else. Read off the canvas's own view —
   * the flag that also decides what the drawer offers — so a block saved out
   * of an email is offered in emails and never on a page it cannot render on.
   * Before this, a header promoted out of an email became a PAGE component,
   * which the drawer then hid from every email, the one it came from included.
   */
  const [viewType] = useAglynBesignerFlag('viewType')
  const promoteKind = reusableComponentKindForView(viewType)
  const promotesEmailBlock = promoteKind === REUSABLE_COMPONENT_KIND_EMAIL

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

  // Element drawer: one preset per definition — under "Your components" on a
  // page, and under "Your email blocks" in an email (AGL-3287).
  useEffect(() => {
    const definitions = (componentDocs ?? []).filter(
      (definition: any) => !definition.deletedAt,
    )
    if (!definitions.length) return
    const presets: Aglyn.PresetSchema[] = definitions.map(
      (definition: any) => ({
        $id: `hostcmp:${definition.$id}`,
        type: NodeType.PRESET,
        displayName: definition.displayName ?? definition.$id,
        // The component's own icon when it has one (AGL-1193); the purple
        // package glyph is what "no icon chosen" looks like, not a brand.
        icon: definition.icon?.iconPath
          ? { path: definition.icon.iconPath }
          : { path: mdiPackageVariant.path, sx: { color: '#9c27b0' } },
        // The group, and for an email block the email bundle it is filed
        // under (AGL-3287). The drawer's view filter reads the ENTRY's own
        // `pluginId`, so an email block is offered in emails alone, and a page
        // component — which names no bundle — never in one. The node inserted
        // below is an ordinary instance either way, so the canvas draws both
        // through the same graft.
        ...reusableComponentPaletteSlot(reusableComponentKindOf(definition)),
        data: {
          $id: null,
          componentId: REUSABLE_INSTANCE_COMPONENT_ID,
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
    components.registerPreset(presets)
    return () => {
      components.unregisterPreset(presets.map((preset) => preset.$id))
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
      // The definition the new document holds, through the recipe core owns
      // (AGL-2908), so this dialog and the plugin's own Save as reusable
      // component write the same shape.
      const definitionNodes = reusableComponentDefinitionFrom(
        canvas.toJSON().nodes as any,
        node.$id,
      )
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
          // A page component sends no kind, exactly as before (AGL-3287).
          ...(promotesEmailBlock && { kind: promoteKind }),
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
      canvas.applyNodes(
        replaceSubtreeWithInstance(
          canvas.toJSON().nodes as any,
          node.$id,
          created.id,
          name || 'Component',
        ) as any,
      )
      setPromoteNode(null)
      enqueueSnackbar(
        promotesEmailBlock
          ? `Saved "${name}" — add it to any email from ` +
              `${REUSABLE_EMAIL_BLOCK_CATEGORY}. Change it once and every ` +
              'email using it follows.'
          : `Saved "${name}" — this element now follows the component, and ` +
              'you can insert it anywhere from Your components',
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
    promoteKind,
    promotesEmailBlock,
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
          nodes: decodeStoredNodes(stored.nodes),
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
        const all = canvas.toJSON().nodes as Record<string, any>
        const next = detachInstanceSubtree(
          all,
          node.$id,
          definition,
          () => createResourceUid(),
        )
        // A no-op means the selected node is not an instance the canvas
        // knows about — say so rather than claiming a detach that never
        // happened.
        if (next === all) throw new Error('Instance not found on this screen')
        canvas.applyNodes(next as any)
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
  //
  // `onPromote` is left out rather than stubbed when promotion is off: the
  // Attributes panel draws Save as reusable component only when it is there.
  const contextValue = useMemo(
    () => ({
      ...(allowPromote ? { onPromote: handlePromote } : {}),
      onDemote: handleDemote,
      onEditComponent: handleEditComponent,
      definitions,
      formDesigns,
    }),
    [
      allowPromote,
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
          {promotesEmailBlock ? (
            // Where the saved block will be offered (AGL-3287), since it is
            // not where a page component is.
            <DialogContentText variant="body2">
              {`You can add it to any email from ${REUSABLE_EMAIL_BLOCK_CATEGORY}.`}
            </DialogContentText>
          ) : null}
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
