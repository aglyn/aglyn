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

// By path: which sources exist is editor business, kept out of every barrel.
import {
  listPageRecordSources,
  type PageRecordAnswer,
  type PageRecordSource,
  subscribePageRecordSources,
} from '@aglyn/aglyn/app-utils/page-record-sources'
// Deep, not the designer barrel, so a surface that renders no besigner can
// mount this without loading one.
import { CanvasPageRecordContext } from '@aglyn/besigner-ui/contexts/canvas-page-record-context'
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react'

type ReadyAnswer = Extract<PageRecordAnswer, { status: 'ready' }>

export interface BesignerPageRecordProviderProps {
  /** The site whose page the canvas edits. */
  hostId: string
  /** The page in the editor. */
  screenId: string
  children?: JSX.Children
}

/**
 * Draws a record template on the canvas for one of its records (AGL-3475).
 *
 * Asks every registered page-record source about the page in the editor —
 * one reader per source, so a source that registers while the canvas is open
 * mounts its own hook rather than changing which hooks a mounted one calls —
 * and hands the first that serves it to the canvas, which lays the record
 * over every element's render copy. A page no source serves gets nothing, and
 * the canvas shows its tokens as written, exactly as it always did.
 *
 * Nothing here names a kind of data; the data plugin's source is one answer.
 */
export function BesignerPageRecordProvider(props: BesignerPageRecordProviderProps) {
  const { hostId, screenId, children } = props
  const sources = useSyncExternalStore(
    subscribePageRecordSources,
    listPageRecordSources,
    listPageRecordSources,
  )
  const [answers, setAnswers] = useState<Record<string, PageRecordAnswer | undefined>>({})
  const report = useCallback((id: string, answer: PageRecordAnswer | undefined) => {
    setAnswers((previous) => (previous[id] === answer ? previous : { ...previous, [id]: answer }))
  }, [])
  const ready = useMemo(
    () =>
      sources
        .map((source) => answers[source.id])
        .find((answer): answer is ReadyAnswer => answer?.status === 'ready'),
    [sources, answers],
  )
  return (
    <CanvasPageRecordContext.Provider value={ready}>
      {children}
      {sources.map((source) => (
        <PageRecordReader
          key={source.id}
          source={source}
          hostId={hostId}
          screenId={screenId}
          report={report}
        />
      ))}
    </CanvasPageRecordContext.Provider>
  )
}
BesignerPageRecordProvider.displayName = 'BesignerPageRecordProvider'

/** Calls one source's hook unconditionally and files its answer. Renders nothing. */
function PageRecordReader(props: {
  source: PageRecordSource
  hostId: string
  screenId: string
  report: (id: string, answer: PageRecordAnswer | undefined) => void
}) {
  const { source, hostId, screenId, report } = props
  const answer = source.usePageRecord({ hostId, screenId })
  useEffect(() => {
    report(source.id, answer)
  }, [report, source.id, answer])
  // Withdrawn with the reader, so a source that unregisters stops drawing.
  useEffect(() => () => report(source.id, undefined), [report, source.id])
  return null
}

export default BesignerPageRecordProvider
