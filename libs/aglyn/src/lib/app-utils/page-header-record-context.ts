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
 * Lets a surface name the RECORD it is showing, for the page header and the
 * breadcrumb trail — the sibling of `PageHeaderActions`, which does the same
 * for the header's controls.
 *
 * WHAT A RECORD DETAIL PAGE OWES ITS READER. The heading of a page about one
 * thing names that thing, and the trail ends on it. A detail page whose
 * heading reads `Forms` says only which list the reader came from, which the
 * breadcrumb above it already said, and it reads identically on every row of
 * that list — so two tabs open on two different forms are one string.
 *
 * WHY A CONTEXT AND NOT A PROP, for the same reason the actions seam is one:
 * a route that owns its `DashboardLayout` passes `header` and
 * `breadcrumbItems` directly, and the detail pages that do — Screens,
 * Components, Layouts, Templates, entries — already name their record that
 * way and never touch this. A PLUGIN surface has no such route. The console
 * shell's generic host page owns the layout, builds the heading from the nav
 * item's label and the trail from the surface and section, and renders the
 * surface as a CHILD; a child cannot set its parent's props. So the record
 * arrives here, published by whichever descendant loaded it.
 *
 * WHAT IT REPLACES, precisely: the heading's text and the heading's SECTION
 * suffix, and it appends one crumb. The icon stays the surface's — a form is
 * still a form — and every crumb above it stays exactly as the route built
 * it, so the trail still walks back through the surface and the section the
 * record sits under.
 */
export interface PageHeaderRecordValue {
  /**
   * The record's own name, which becomes the page heading and the last crumb.
   *
   * Empty and absent both mean "not yet": a surface calls this with whatever
   * it has this render, and a half-loaded name would flash the heading
   * through a wrong string on the way to the right one. Until a name arrives
   * the route's own heading stands, which already names the surface.
   */
  title?: string
}

export interface PageHeaderRecordContextValue {
  /**
   * Names the record the page is about; `null` clears it.
   *
   * Absent when no provider is mounted, so a surface rendered outside one —
   * a test harness, a storybook mount — publishes nothing rather than
   * throwing.
   */
  setHeaderRecord?: (record: PageHeaderRecordValue | null) => void
}

export const PageHeaderRecordContext =
  createContext<PageHeaderRecordContextValue>({})
PageHeaderRecordContext.displayName = 'PageHeaderRecordContext'

/** Hook form of {@link PageHeaderRecordContext}. */
export function usePageHeaderRecord(): PageHeaderRecordContextValue {
  return useContext(PageHeaderRecordContext)
}

export type PageHeaderRecordProps = PageHeaderRecordValue

/**
 * Names the page's record in the header and the trail, and renders nothing
 * where it sits.
 *
 * Written inside the component that LOADED the record, so the heading and the
 * body read one document. A shell that resolved the name a second time to
 * fill its own header would be paying for a second read of a document the
 * page is already holding — and would answer differently while the two were
 * in flight.
 *
 * THE SLOT IS EMPTIED ON UNMOUNT, which is what keeps one record's name off
 * the next page. A list and a detail view are different components, so
 * navigating between them unmounts this publisher and the cleanup runs in the
 * same commit the incoming surface mounts in.
 *
 * Published from a PRIMITIVE rather than an object, deliberately: the effect's
 * dependency is the string itself, so a surface that re-renders while its data
 * settles publishes once per actual change rather than once per render.
 *
 * The record is named, never LINKED. `BreadcrumbsComponent` renders its last
 * crumb as text whatever it is handed, because the level the reader is
 * standing on is a label rather than a way to get there — so an href here
 * would be an option that silently does nothing.
 */
export function PageHeaderRecord(props: PageHeaderRecordProps): null {
  const { title } = props
  const { setHeaderRecord } = usePageHeaderRecord()
  useEffect(() => {
    setHeaderRecord?.(title ? { title } : null)
    return () => setHeaderRecord?.(null)
  }, [setHeaderRecord, title])
  return null
}
PageHeaderRecord.displayName = 'PageHeaderRecord'
