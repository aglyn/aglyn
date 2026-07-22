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

import { ICON_VARIANT_SEARCH } from '@aglyn/shared-data-enums'
import { AppLink } from '@aglyn/shared-ui-jsx'
import { Button } from '@mui/material'
import EmptyState from './empty-state.component'

export interface ArtifactNotFoundProps {
  /** Singular noun for the artifact, e.g. "layout". */
  noun: string
  /** Where "Back to …" goes. */
  listUrl: string
  /** Plural label for the list, e.g. "layouts". */
  listLabel: string
  /** The id that was asked for, echoed so a typo is visible. */
  id?: string
}

/**
 * Not-found body for an artifact detail page (AGL-706).
 *
 * These pages used to render an empty but EDITABLE form for an id with no
 * document, so a mistyped URL was indistinguishable from an artifact that had
 * lost its content — which is exactly how a one-character typo cost a whole
 * bogus bug investigation (AGL-705).
 *
 * The id is echoed deliberately: resource ids mix `l`, `I` and `1`, which are
 * near-identical in this typeface, so seeing the id you actually asked for
 * next to the list is usually enough to spot the transposition.
 */
export function ArtifactNotFound(props: ArtifactNotFoundProps) {
  const { noun, listUrl, listLabel, id } = props
  return (
    <EmptyState
      iconPath={ICON_VARIANT_SEARCH.path}
      title={`This ${noun} isn’t here`}
      description={
        (id ? `No ${noun} with the id “${id}” exists on this site. ` : '') +
        'The link may be out of date, or the ' +
        `${noun} may have been deleted. Open it from the list to be sure of ` +
        'the id.'
      }
      action={
        <Button
          variant="contained"
          color="secondary"
          component={AppLink as any}
          {...({ componentVariant: 'naked' } as any)}
          href={listUrl}
        >
          {`Back to ${listLabel}`}
        </Button>
      }
    />
  )
}
ArtifactNotFound.displayName = 'ArtifactNotFound'

export default ArtifactNotFound
