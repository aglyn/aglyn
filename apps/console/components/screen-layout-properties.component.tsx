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
import { MAX_LAYOUT_CHAIN_DEPTH, stripUndefinedDeep } from '@aglyn/aglyn'
import { PropertyValuesForm } from '@aglyn/besigner-ui'
import { Button, Stack, Typography } from '@mui/material'
import { doc, type Firestore, getDoc } from 'firebase/firestore'
import { useEffect, useState } from 'react'

/**
 * A screen's values for the properties of the layouts it renders inside
 * (AGL-2893), edited in Screen Properties with the Attributes panel's own
 * controls and stored on the screen version beside its layout binding.
 */

/** One layout of a screen's chain that declares properties. */
export interface LayoutPropertiesLink {
  layoutId: string
  displayName?: string
  props: Aglyn.ReusableComponentProp[]
}

/**
 * The values as they are stored: nothing a page left unset. An empty field, a
 * cleared list and a value the form never had are all "use the layout's
 * default", which is what an absent key already says — and Firestore refuses
 * an `undefined` anywhere in a map.
 */
export function cleanLayoutPropValues(
  values: Record<string, unknown> | null | undefined,
): Record<string, Aglyn.ReusableComponentPropValue> {
  const cleaned: Record<string, Aglyn.ReusableComponentPropValue> = {}
  for (const [name, value] of Object.entries(values ?? {})) {
    if (value === undefined || value === null || value === '') continue
    if (Array.isArray(value) && !value.length) continue
    cleaned[name] = stripUndefinedDeep(value) as Aglyn.ReusableComponentPropValue
  }
  return cleaned
}

/**
 * The layouts a screen renders inside that declare properties, innermost
 * first.
 *
 * The layout the screen names is passed in from the page's own live reads.
 * The layouts it renders inside are read once each time the list is wanted,
 * the way Preview walks them: a chain's length is only known by walking it,
 * and a hook count cannot vary.
 */
export function useLayoutChainProperties(options: {
  firestore: Firestore
  hostId: string
  layoutId: string | null | undefined
  layout: Pick<Aglyn.AglynLayout, 'displayName' | 'layoutId'> | null | undefined
  layoutVersion: Pick<Aglyn.AglynLayoutVersion, 'props'> | null | undefined
  /** Whether the list is wanted now — the ancestors are read only then. */
  enabled: boolean
}): LayoutPropertiesLink[] {
  const { firestore, hostId, layoutId, layout, layoutVersion, enabled } = options
  const parentId = layout?.layoutId
  const [ancestors, setAncestors] = useState<LayoutPropertiesLink[]>([])

  useEffect(() => {
    if (!enabled || !layoutId || !parentId) {
      // The same empty list rather than a new one, so a re-run of this effect
      // is never itself a change to render again for.
      setAncestors((current) => (current.length ? [] : current))
      return
    }
    let cancelled = false
    void (async () => {
      const found: LayoutPropertiesLink[] = []
      const seen = new Set<string>([String(layoutId)])
      let current: string | undefined = String(parentId)
      while (
        current &&
        !seen.has(current) &&
        found.length + 1 < MAX_LAYOUT_CHAIN_DEPTH
      ) {
        seen.add(current)
        try {
          const layoutSnapshot = await getDoc(
            doc(firestore, 'hosts', hostId, 'layouts', current),
          )
          const versionId = layoutSnapshot.get('versionId')
          if (versionId) {
            const versionSnapshot = await getDoc(
              doc(
                firestore,
                'hosts',
                hostId,
                'layouts',
                current,
                'versions',
                String(versionId),
              ),
            )
            const props = versionSnapshot.get('props')
            if (Array.isArray(props) && props.length) {
              found.push({
                layoutId: current,
                displayName: layoutSnapshot.get('displayName'),
                props,
              })
            }
          }
          const next = layoutSnapshot.get('layoutId')
          current = next ? String(next) : undefined
        } catch (error) {
          // The outer layouts' values are worth offering, not worth failing
          // the dialog over.
          console.error(error)
          break
        }
      }
      if (!cancelled) setAncestors(found)
    })()
    return () => {
      cancelled = true
    }
  }, [enabled, firestore, hostId, layoutId, parentId])

  const own = layoutVersion?.props
  return [
    ...(layoutId && Array.isArray(own) && own.length
      ? [{ layoutId: String(layoutId), displayName: layout?.displayName, props: own }]
      : []),
    ...ancestors,
  ]
}

/** One layout's values, saved together. */
function LayoutValuesEditor(props: {
  link: LayoutPropertiesLink
  stored: Record<string, unknown> | undefined
  onSave: (layoutId: string, values: Record<string, unknown>) => Promise<void>
}) {
  const { link, stored, onSave } = props
  const [draft, setDraft] = useState<Record<string, unknown> | undefined>()
  const [saving, setSaving] = useState(false)
  const changed =
    draft !== undefined &&
    JSON.stringify(cleanLayoutPropValues(draft)) !==
      JSON.stringify(cleanLayoutPropValues(stored))
  return (
    <Stack spacing={1}>
      <Typography variant="body2" sx={{ fontWeight: 600 }}>
        {`${link.displayName ?? link.layoutId} properties`}
      </Typography>
      <PropertyValuesForm
        declared={link.props}
        values={stored}
        noun="layout"
        onChange={setDraft}
      />
      <Button
        size="small"
        variant="outlined"
        disabled={!changed || saving}
        onClick={async () => {
          if (!draft) return
          setSaving(true)
          try {
            await onSave(link.layoutId, cleanLayoutPropValues(draft))
            setDraft(undefined)
          } finally {
            setSaving(false)
          }
        }}
        sx={{ alignSelf: 'flex-start' }}
      >
        {'Save layout values'}
      </Button>
    </Stack>
  )
}

export interface ScreenLayoutPropertiesProps {
  links: readonly LayoutPropertiesLink[]
  /** The version's stored values, keyed by layout id. */
  stored: Aglyn.AglynScreenVersion['layoutPropValues'] | null | undefined
  onSave: (layoutId: string, values: Record<string, unknown>) => Promise<void>
}

/**
 * The properties of each layout the screen renders inside, one group per
 * layout, each set and saved on this version.
 */
export function ScreenLayoutProperties(props: ScreenLayoutPropertiesProps) {
  const { links, stored, onSave } = props
  if (!links.length) return null
  return (
    <Stack spacing={2}>
      <Typography variant="caption" color="text.secondary">
        {'The values this version gives the layout’s properties. Leave one '}
        {'empty to use the layout’s default. Saved with the button under '}
        {'each layout, and published with this version.'}
      </Typography>
      {links.map((link) => (
        <LayoutValuesEditor
          key={link.layoutId}
          link={link}
          stored={stored?.[link.layoutId]}
          onSave={onSave}
        />
      ))}
    </Stack>
  )
}

export default ScreenLayoutProperties
