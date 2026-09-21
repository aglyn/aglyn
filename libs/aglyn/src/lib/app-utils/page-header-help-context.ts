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

// Same placement rationale as page-header-actions-context.ts: lives in
// @aglyn/aglyn without a 'use client' banner so both the console app and
// relocated feature plugins share one context module.
import { createContext, useContext, useEffect } from 'react'

/**
 * Lets a surface say where its header's help `?` should LAND — the third
 * sibling of `PageHeaderActions` and `PageHeaderRecord`, which do the same
 * for the header's controls and its heading.
 *
 * WHAT A PAGE OWES THE READER WHO CLICKS `?`. AGL-2200 is the issue that
 * found this: `DashboardLayout` could only name a topic, so all seven
 * Plugins/Marketplace pages opened the same "Plugins & Marketplace" tooltip
 * and dropped the reader at the top of one long page. Naming a heading is
 * what turns the affordance from "here is the manual" into an answer.
 *
 * WHY A CONTEXT AND NOT A DECLARATION, which is the difference from the two
 * siblings' rationale. A surface's own help IS declarable — the nav item
 * carries `header.docsTopic`, and a section could carry an anchor — but the
 * pages that need this are the ENTITY pages beneath a surface that owns its
 * subtree (`ConsoleNavItem.ownsSubtree`). Those have no declaration to hang
 * one on: the set of ids is a property of the workspace's data, and what a
 * listing's `?` should explain ("what the badges mean") is a different page
 * of the docs from what the hub's explains ("install & upgrade"). A static
 * list cannot say that, and a route that owns its own layout never had to.
 *
 * TWO STRINGS, and deliberately not the console's `DocsHelpTarget`. That type
 * is keyed to the console's own registry, which a plugin may not import —
 * plugins carry their own generated subset (`PLUGIN_DOCS`). The console
 * resolves whatever arrives against its registry and falls back when it does
 * not recognize it, exactly as it already does for `header.docsTopic`: a
 * third-party plugin can name any string, and the alternative to a fallback
 * is a help button that throws on hover (AGL-1074).
 */
export interface PageHeaderHelpValue {
  /** Docs topic key. Resolved by the shell; an unknown one falls back. */
  topic: string
  /** Heading anchor on that page, including the leading `#`. */
  anchor?: string
}

export interface PageHeaderHelpContextValue {
  /**
   * Points the header's help at a topic; `null` restores the route's own.
   *
   * Absent when no provider is mounted, so a surface rendered outside one —
   * a test harness, a storybook mount — publishes nothing rather than
   * throwing.
   */
  setHeaderHelp?: (help: PageHeaderHelpValue | null) => void
}

export const PageHeaderHelpContext =
  createContext<PageHeaderHelpContextValue>({})
PageHeaderHelpContext.displayName = 'PageHeaderHelpContext'

/** Hook form of {@link PageHeaderHelpContext}. */
export function usePageHeaderHelp(): PageHeaderHelpContextValue {
  return useContext(PageHeaderHelpContext)
}

export type PageHeaderHelpProps = PageHeaderHelpValue

/**
 * Points the page header's help at this page's own docs, and renders nothing
 * where it sits.
 *
 * THE SLOT IS EMPTIED ON UNMOUNT, which is what keeps one page's answer off
 * the next one. Navigating from a listing back to the hub unmounts this
 * publisher and the cleanup runs in the same commit the hub mounts in, so
 * the `?` returns to the surface's declared topic rather than going on
 * explaining badges.
 *
 * Published from PRIMITIVES rather than an object, deliberately: the effect's
 * dependencies are the two strings, so a surface that re-renders while its
 * data settles publishes once per actual change rather than once per render.
 */
export function PageHeaderHelp(props: PageHeaderHelpProps): null {
  const { topic, anchor } = props
  const { setHeaderHelp } = usePageHeaderHelp()
  useEffect(() => {
    setHeaderHelp?.(topic ? { topic, anchor } : null)
    return () => setHeaderHelp?.(null)
  }, [setHeaderHelp, topic, anchor])
  return null
}
PageHeaderHelp.displayName = 'PageHeaderHelp'
