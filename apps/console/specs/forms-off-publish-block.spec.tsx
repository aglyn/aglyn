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

/**
 * The besigner refuses to publish a form on a site that switched Forms off
 * (AGL-3029).
 *
 * On such a site the published page draws no form and `/api/forms/submit`
 * refuses every submission, so a page, layout or component carrying one would
 * go live as an empty space. Every besigner action that puts a version live
 * asks `useFormsPublishBlock` first; the form's own designer passes the same
 * answer into the contract check. This pins the hook's answer, and that each
 * of those actions asks it BEFORE the write that publishes.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  EnabledPluginsContext,
  FORMS_OFF_FOR_SITE_PAGE_VIOLATION,
} from '@aglyn/aglyn'
import { renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'

const mockEnqueueSnackbar = jest.fn()
jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar: mockEnqueueSnackbar }),
}))

import useFormsPublishBlock from '../hooks/use-forms-publish-block'

const REPO_ROOT = join(__dirname, '../../..')
const read = (path: string) => readFileSync(join(REPO_ROOT, path), 'utf8')

/** A contact section holding a form, as a canvas or a stored version holds it. */
const WITH_FORM = {
  root: { $id: 'root', componentId: 'muiStack', nodes: ['form'] },
  form: { $id: 'form', componentId: 'form', parentId: 'root', nodes: [] },
}
const WITHOUT_FORM = { root: { $id: 'root', componentId: 'muiStack', nodes: [] } }

function hookOn(site: readonly string[] | undefined) {
  const wrapper = ({ children }: { children: ReactNode }) =>
    site === undefined ? (
      <>{children}</>
    ) : (
      <EnabledPluginsContext.Provider value={site}>{children}</EnabledPluginsContext.Provider>
    )
  return renderHook(() => useFormsPublishBlock(), { wrapper }).result.current
}

beforeEach(() => {
  mockEnqueueSnackbar.mockClear()
})

describe('useFormsPublishBlock', () => {
  it('refuses a publish carrying a form on a site that switched Forms off, and says why', () => {
    const block = hookOn(['mui', 'commerce'])
    expect(block.formsOnForSite).toBe(false)
    expect(block.refuse(WITH_FORM)).toBe(true)
    expect(mockEnqueueSnackbar).toHaveBeenCalledWith(
      FORMS_OFF_FOR_SITE_PAGE_VIOLATION.message,
      expect.objectContaining({ variant: 'warning', persist: true }),
    )
  })

  it('lets the rest of the site publish', () => {
    expect(hookOn(['mui', 'commerce']).refuse(WITHOUT_FORM)).toBe(false)
    expect(mockEnqueueSnackbar).not.toHaveBeenCalled()
  })

  it('refuses nothing on a site that runs Forms, or where no site set was published', () => {
    expect(hookOn(['mui', 'forms']).refuse(WITH_FORM)).toBe(false)
    expect(hookOn(undefined).refuse(WITH_FORM)).toBe(false)
    expect(hookOn(undefined).formsOnForSite).toBeUndefined()
    expect(mockEnqueueSnackbar).not.toHaveBeenCalled()
  })
})

const EDITOR = 'apps/console/app/(editor)/[orgSlug]/hosts/[host]'

/**
 * Each action that puts a version live, the call that asks, and the write it
 * must come before.
 */
const PUBLISH_ACTIONS: Array<{ file: string; opens: string; asks: string; writes: string }> = [
  {
    file: `${EDITOR}/screens/[screenId]/versions/[versionId]/besigner/page.tsx`,
    opens: 'const handleSaveAndPublish = useCallback(async () => {',
    asks: 'if (refuseFormsOff(canvas.toJSON().nodes)) return',
    writes: 'await updateScreenDoc({ versionId } as any)',
  },
  {
    file: `${EDITOR}/layouts/[layoutId]/versions/[versionId]/besigner/page.tsx`,
    opens: 'const handleSaveAndPublish = useCallback(async () => {',
    asks: 'if (refuseFormsOff(canvas.toJSON().nodes)) return',
    writes: 'await handleSave()',
  },
  {
    file: `${EDITOR}/components/[componentId]/versions/[versionId]/besigner/page.tsx`,
    opens: 'const promoteToSites = useCallback(async () => {',
    asks: 'if (refuseFormsOff(canvas.toJSON().nodes)) return',
    writes: 'await updateDoc(',
  },
  {
    file: 'apps/console/components/besigner-versions.component.tsx',
    opens: 'const handlePublish = useCallback(',
    asks: "if (refuseFormsOff(decodeStoredNodes(target.get('nodes')))) return",
    writes: 'await updateDoc(doc(firestore, ...parentPath), {',
  },
]

describe('every besigner publish asks before it writes', () => {
  it.each(PUBLISH_ACTIONS)('$file', ({ file, opens, asks, writes }) => {
    const source = read(file)
    const opened = source.indexOf(opens)
    expect(opened).toBeGreaterThan(-1)
    const asked = source.indexOf(asks, opened)
    const wrote = source.indexOf(writes, opened)
    expect(asked).toBeGreaterThan(opened)
    expect(wrote).toBeGreaterThan(asked)
  })

  it('the form designer hands the site’s answer to the contract check', () => {
    const source = read(`${EDITOR}/forms/[formId]/versions/[versionId]/besigner/page.tsx`)
    const checked = source.indexOf('const violations = checkFormContract({')
    expect(checked).toBeGreaterThan(-1)
    expect(source.slice(checked, checked + 200)).toContain('formsOnForSite,')
  })
})
