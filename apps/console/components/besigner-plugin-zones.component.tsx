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

import {
  BesignerInspectorExtrasContext,
  type BesignerInspected,
} from '@aglyn/besigner-ui/contexts/inspector-extras-context'
import { BesignerToolbarExtrasContext } from '@aglyn/besigner-ui/contexts/toolbar-extras-context'
import { useContext, type ReactNode } from 'react'
import { HostIdContext } from './host-id-provider'
import PluginWidgetSlot from './plugin-widget-slot.component'

/** The toolbar's plugin controls, for the site the editor names. */
function BesignerToolbarZone() {
  const hostId = useContext(HostIdContext)
  return <PluginWidgetSlot slot="besignerToolbar" hostId={hostId ?? null} />
}

/** The Attributes panel's plugin section, for the element selected. */
function BesignerInspectorZone({ node }: BesignerInspected) {
  const hostId = useContext(HostIdContext)
  return <PluginWidgetSlot slot="besignerInspector" hostId={hostId ?? null} node={node} />
}

const TOOLBAR = <BesignerToolbarZone />

const inspectorSection = (inspected: BesignerInspected) => (
  <BesignerInspectorZone node={inspected.node} />
)

/**
 * The besigner's plugin zones (AGL-2984), supplied once for every editor in
 * the route group — screens, layouts, components, forms, templates, email
 * designs and the platform email templates — so a plugin control appears on
 * each editor the designer opens rather than only on the ones that mount it.
 *
 * The designer draws both where it draws them, below the editor's host
 * guard, which is where each zone reads the site: `null` on an editor that
 * names no site. An editor page that supplies its own section overrides the
 * inspector's here.
 */
export default function BesignerPluginZones({ children }: { children: ReactNode }) {
  return (
    <BesignerToolbarExtrasContext.Provider value={TOOLBAR}>
      <BesignerInspectorExtrasContext.Provider value={inspectorSection}>
        {children}
      </BesignerInspectorExtrasContext.Provider>
    </BesignerToolbarExtrasContext.Provider>
  )
}
