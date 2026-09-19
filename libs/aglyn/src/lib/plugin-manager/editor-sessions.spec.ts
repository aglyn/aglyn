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

import {
  editorSessionsRevision,
  notifyEditorSessionChanged,
  openEditorSession,
  registerEditorSession,
  resetEditorSessionsForTests,
  stageEditorSessionFields,
  subscribeEditorSessions,
  type EditorSession,
} from './editor-sessions'

/**
 * An editor as the seam sees it: its own form state, its own selection, its
 * own live pointer and its own new-version flow. Nothing here can save.
 */
function openEditor(documentId = 'screen-1', versionId = 'v-1') {
  const state = {
    form: { 'seo.title': null, 'seo.description': null } as Record<string, string | null>,
    selected: null as string | null,
    live: false,
    revealed: 0,
    versionFlows: 0,
  }
  const session: EditorSession = {
    documentKind: 'screen',
    documentId,
    versionId,
    isLiveVersion: () => state.live,
    selectedNodeId: () => state.selected,
    createVersion: () => {
      state.versionFlows += 1
    },
    fields: {
      'seo.title': (value) => {
        state.form['seo.title'] = value
      },
      'seo.description': (value) => {
        state.form['seo.description'] = value
      },
    },
    revealFields: () => {
      state.revealed += 1
    },
  }
  const unregister = registerEditorSession(session)
  return { state, unregister }
}

afterEach(() => resetEditorSessionsForTests())

describe('editor sessions', () => {
  it('answers with no session while no editor is open', () => {
    expect(openEditorSession()).toBeUndefined()
  })

  it('answers the selection and the live pointer when asked, not when registered', () => {
    const editor = openEditor()
    const session = openEditorSession() as EditorSession
    expect(session.selectedNodeId?.()).toBeNull()
    expect(session.isLiveVersion()).toBe(false)

    editor.state.selected = 'hero'
    editor.state.live = true
    expect(session.selectedNodeId?.()).toBe('hero')
    expect(session.isLiveVersion()).toBe(true)
  })

  it('stages into the editor’s own form, reveals it, and touches no other field', () => {
    const editor = openEditor()
    const result = stageEditorSessionFields(openEditorSession() as EditorSession, {
      'seo.title': 'Pricing for teams',
    })
    expect(result).toEqual({ staged: ['seo.title'], unknown: [] })
    expect(editor.state.form).toEqual({
      'seo.title': 'Pricing for teams',
      'seo.description': null,
    })
    expect(editor.state.revealed).toBe(1)
  })

  it('names the keys the editor does not have, and reveals nothing for them alone', () => {
    const editor = openEditor()
    expect(
      stageEditorSessionFields(openEditorSession() as EditorSession, {
        'seo.keywords': 'x',
      }),
    ).toEqual({ staged: [], unknown: ['seo.keywords'] })
    expect(editor.state.revealed).toBe(0)
  })

  it('starts the editor’s own new-version flow and creates nothing itself', () => {
    const editor = openEditor()
    openEditorSession()?.createVersion?.()
    expect(editor.state.versionFlows).toBe(1)
  })

  it('a remount that registers first is not closed by the earlier mount’s cleanup', () => {
    const first = openEditor('screen-1', 'v-1')
    const second = openEditor('screen-1', 'v-2')
    first.unregister()
    expect(openEditorSession()?.versionId).toBe('v-2')
    second.unregister()
    expect(openEditorSession()).toBeUndefined()
    // An unregister that already ran is a no-op, not a second removal.
    second.unregister()
    expect(openEditorSession()).toBeUndefined()
  })

  it('notifies subscribers on open, on close and on a changed answer', () => {
    const heard: number[] = []
    const unsubscribe = subscribeEditorSessions(() => heard.push(editorSessionsRevision()))
    const editor = openEditor()
    notifyEditorSessionChanged()
    editor.unregister()
    unsubscribe()
    openEditor('screen-2')
    expect(heard).toEqual([1, 2, 3])
  })

  it('refuses a session that cannot name what it has open', () => {
    const live = () => false
    expect(() =>
      registerEditorSession({ documentKind: 'screen', documentId: ' ', versionId: 'v', isLiveVersion: live }),
    ).toThrow('document id')
    expect(() =>
      registerEditorSession({ documentKind: '', documentId: 'd', versionId: 'v', isLiveVersion: live }),
    ).toThrow('document kind')
    expect(() =>
      registerEditorSession({
        documentKind: 'screen',
        documentId: 'd',
        versionId: 'v',
      } as unknown as EditorSession),
    ).toThrow('isLiveVersion')
  })

  /**
   * The seam is not one plugin's. Two plugins with nothing to do with each
   * other act on the same open editor, and neither imports it.
   */
  describe('serves unrelated plugins through the same session', () => {
    it('a translations plugin stages a translated title the author saves the usual way', () => {
      const editor = openEditor('screen-4')
      const translations = {
        offerTitle(title: string) {
          const session = openEditorSession()
          return session ? stageEditorSessionFields(session, { 'seo.title': `${title} (fr)` }) : null
        },
      }
      expect(translations.offerTitle('Tarifs')).toEqual({ staged: ['seo.title'], unknown: [] })
      expect(editor.state.form['seo.title']).toBe('Tarifs (fr)')
    })

    it('a review plugin anchors a comment on the selection of the version open', () => {
      const editor = openEditor('screen-5', 'v-9')
      editor.state.selected = 'pricing-table'
      const review = {
        anchor() {
          const session = openEditorSession()
          return session
            ? {
                document: `${session.documentKind}/${session.documentId}`,
                version: session.versionId,
                element: session.selectedNodeId?.() ?? null,
              }
            : null
        },
      }
      expect(review.anchor()).toEqual({
        document: 'screen/screen-5',
        version: 'v-9',
        element: 'pricing-table',
      })
    })
  })
})
