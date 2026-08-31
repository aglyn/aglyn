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
// Same placement rationale as media-picker-context.ts: lives in
// @aglyn/aglyn without a 'use client' banner so both the console app and
// relocated feature plugins share one context module.
import { createContext, useContext, useEffect, type ReactNode } from 'react'

/**
 * Lets any surface publish controls into the PAGE header — the bar carrying
 * the surface icon, title and breadcrumb — from inside the page body.
 *
 * WHY A CONTEXT AND NOT A PROP. A route that owns its own `DashboardLayout`
 * passes `headerRight` directly, which is how Screens, Layouts, Components
 * and Templates put their readout and create button up there. A plugin
 * surface has no such route: the console shell's generic host page owns the
 * layout and renders the surface as a CHILD, and a child cannot set its
 * parent's prop. The console app provides `setHeaderActions` from the layout
 * that owns the header; a surface publishes through {@link PageHeaderActions}
 * and stays free of console-app imports.
 *
 * WHICH HEADER A CONTROL BELONGS IN is a separate question this context
 * deliberately does not answer. A surface with NO section navigation —
 * Screens, Layouts, Components, Templates, Forms — puts its quota readout and
 * create button in the page header. A surface that renders a vertical section
 * rail keeps them in the CARD header, beside the section content the rail
 * switches between, where they read as the section's rather than the whole
 * surface's; in the plugin registry the deciding fact is whether the nav item
 * declares `sections`. Refusing a publish from a section-bearing surface
 * would enforce that rule one case too far — a hub can have an action that is
 * genuinely about the whole surface, and this module cannot tell which it is
 * looking at.
 */
export interface PageHeaderActionsContextValue {
  /**
   * Renders `actions` in the page header; `null` empties the slot.
   *
   * Absent when no provider is mounted, so a surface rendered outside one —
   * a test harness, a storybook mount — publishes nothing rather than
   * throwing.
   */
  setHeaderActions?: (actions: ReactNode) => void
}

export const PageHeaderActionsContext =
  createContext<PageHeaderActionsContextValue>({})
PageHeaderActionsContext.displayName = 'PageHeaderActionsContext'

/** Hook form of {@link PageHeaderActionsContext}. */
export function usePageHeaderActions(): PageHeaderActionsContextValue {
  return useContext(PageHeaderActionsContext)
}

export interface PageHeaderActionsProps {
  /** The controls to render in the page header. */
  children?: ReactNode
}

/**
 * Publishes its children into the page header, and renders nothing where it
 * sits.
 *
 * Written inside the component that OWNS the controls — the card holding the
 * listener a quota readout counts from, the state a create button toggles —
 * so the header and the body read one source. A page that computed the same
 * numbers a second time to fill its header would be paying for a second
 * listener over the collection the card is already watching.
 *
 * THE SLOT IS EMPTIED ON UNMOUNT, which is what keeps a create button off a
 * detail route. A list card and a detail card are different components, so
 * navigating between them unmounts this publisher, and the cleanup runs in
 * the same commit the incoming surface mounts in — the header never carries
 * the outgoing surface's actions over the new one.
 *
 * One slot, so the last surface to publish holds it. Nothing renders two
 * surfaces of one page at once, and a slot that concatenated would stack a
 * hidden surface's buttons beside the visible one's.
 */
export function PageHeaderActions(props: PageHeaderActionsProps): null {
  const { children } = props
  const { setHeaderActions } = usePageHeaderActions()
  useEffect(() => {
    setHeaderActions?.(children ?? null)
    return () => setHeaderActions?.(null)
  }, [setHeaderActions, children])
  return null
}
PageHeaderActions.displayName = 'PageHeaderActions'
