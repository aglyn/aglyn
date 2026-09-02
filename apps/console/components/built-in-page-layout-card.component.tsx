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

import { CardDisplay } from '@aglyn/shared-ui-jsx'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { MenuItem, TextField, Typography } from '@mui/material'
import {
  collection,
  deleteField,
  doc,
  limit,
  query,
  updateDoc,
} from 'firebase/firestore'
import { useCallback } from 'react'
import { useFirestore } from '@aglyn/tenant-feature-instance'
import { docsHelp } from '../constants/docs-links'
import useFirestoreCollection from '../hooks/use-firestore-collection'
import useFirestoreDoc from '../hooks/use-firestore-doc'

export interface BuiltInPageLayoutCardProps {
  hostId: string
}

/**
 * Which layout wraps the pages the platform builds (AGL-2513) — search
 * results, and the article a collection with no entry template falls back to.
 *
 * The sibling of the error-pages and auth-screens cards, and deliberately the
 * ODD one: those designate a SCREEN, this designates a LAYOUT. A built-in
 * page's content is composed by the platform, so what it can borrow from the
 * site is the chrome around it. Offering a screen picker here would offer a
 * page whose body is thrown away.
 *
 * Left unset it follows the home page's layout, which is what every site got
 * implicitly before this card existed — so the default is not a blank page,
 * and a site with one layout never has to open this.
 */
export function BuiltInPageLayoutCard(props: BuiltInPageLayoutCardProps) {
  const { hostId } = props
  const firestore = useFirestore()
  const { enqueueSnackbar } = useSnackbar()
  const { data: host } = useFirestoreDoc<any>(
    () => doc(firestore, 'hosts', hostId),
    [firestore, hostId],
    { idField: '$id' },
  )
  const { data: layoutDocs } = useFirestoreCollection<any>(
    // 50, the same bound the besigner's own layout picker takes. A settings
    // card's listener is counted against the Setup page's document budget
    // (AGL-2501), and this one is a picker over a list that is single digits
    // on every real site.
    () => query(collection(firestore, 'hosts', hostId, 'layouts'), limit(50)),
    [firestore, hostId],
    { idField: '$id' },
  )
  const layouts = [...(layoutDocs ?? [])]
    .filter((layout: any) => !layout.deletedAt)
    .sort((a: any, b: any) =>
      String(a.displayName ?? '').localeCompare(String(b.displayName ?? '')),
    )

  const handleChange = useCallback(
    async (value: string) => {
      await updateDoc(doc(firestore, 'hosts', hostId), {
        builtInPageLayoutId: value || deleteField(),
      })
      enqueueSnackbar(
        value ? 'Built-in page layout set' : 'Following the home page layout',
        { variant: 'success', persist: false },
      )
    },
    [firestore, hostId, enqueueSnackbar],
  )

  return (
    <CardDisplay
      header="Built-in page layout"
      help={docsHelp('siteSearch', {
        anchor: '#the-layout-built-in-pages-use',
        excerpt:
          'Choose the layout the search results page and untemplated blog ' +
          'entries render inside, so they carry the site\u2019s own header ' +
          'and footer.',
      })}
      contentGutterX
      contentGutterY
    >
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        {'Some pages are built for you rather than designed: search results, ' +
          'and blog articles on a collection with no entry template. Choose ' +
          'the layout they render inside, so they carry the same header, ' +
          'navigation and footer as the rest of the site.'}
      </Typography>
      <TextField
        select
        size="small"
        label="Layout"
        helperText={
          'Left unset, these pages follow the layout your home page uses.'
        }
        value={host?.builtInPageLayoutId ?? ''}
        onChange={(event) => void handleChange(event.target.value)}
        sx={{ minWidth: 280 }}
      >
        <MenuItem value="">{'Same as the home page'}</MenuItem>
        {layouts.map((layout: any) => (
          <MenuItem key={layout.$id} value={layout.$id}>
            {layout.displayName ?? layout.$id}
          </MenuItem>
        ))}
      </TextField>
    </CardDisplay>
  )
}
BuiltInPageLayoutCard.displayName = 'BuiltInPageLayoutCard'

export default BuiltInPageLayoutCard
