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

import { EMAIL_NODE_ROOT_ID, renderEmailHtml } from './email-render'
import {
  SYSTEM_EMAIL_TEMPLATES,
  buildDefaultEmailNodeMap,
  getSystemEmailTemplate,
  isSystemEmailEditable,
} from './system-email-catalog'

describe('SYSTEM_EMAIL_TEMPLATES', () => {
  it('has unique keys', () => {
    const keys = SYSTEM_EMAIL_TEMPLATES.map((entry) => entry.key)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('uses storage-safe keys, since they are Firestore document ids', () => {
    for (const entry of SYSTEM_EMAIL_TEMPLATES) {
      expect(entry.key).toMatch(/^[a-z][a-z0-9-]*$/)
    }
  })

  it('gives every entry the fields the staff list renders', () => {
    for (const entry of SYSTEM_EMAIL_TEMPLATES) {
      expect(entry.name.length).toBeGreaterThan(0)
      expect(entry.description.length).toBeGreaterThan(0)
      expect(entry.defaultSubject.length).toBeGreaterThan(0)
      expect(entry.source.length).toBeGreaterThan(0)
    }
  })

  it('declares unique, brace-free merge tokens with samples', () => {
    for (const entry of SYSTEM_EMAIL_TEMPLATES) {
      const names = entry.mergeTokens.map((token) => token.name)
      expect(new Set(names).size).toBe(names.length)
      for (const token of entry.mergeTokens) {
        // Templates write `{{token}}`; the registry stores the bare name.
        expect(token.name).not.toMatch(/[{}]/)
        expect(token.sample.length).toBeGreaterThan(0)
      }
    }
  })

  it('only references tokens it declares in the default subject', () => {
    for (const entry of SYSTEM_EMAIL_TEMPLATES) {
      const used = [...entry.defaultSubject.matchAll(/\{\{([^}]+)\}\}/g)].map(
        (match) => match[1].trim(),
      )
      const declared = new Set(entry.mergeTokens.map((token) => token.name))
      for (const token of used) {
        expect(declared.has(token)).toBe(true)
      }
    }
  })

  describe('defaultBody (AGL-764)', () => {
    it('gives every editable template a non-empty starting body', () => {
      // The editor seeds the first version from this; without it staff start
      // from a blank placeholder instead of the email the product sends.
      for (const entry of SYSTEM_EMAIL_TEMPLATES) {
        if (!isSystemEmailEditable(entry)) continue
        expect(entry.defaultBody?.length ?? 0).toBeGreaterThan(0)
      }
    })

    it('only references tokens it declares, across every default block', () => {
      for (const entry of SYSTEM_EMAIL_TEMPLATES) {
        const declared = new Set(entry.mergeTokens.map((token) => token.name))
        for (const block of entry.defaultBody ?? []) {
          const text = block.block === 'button' ? block.href : block.text
          const used = [...text.matchAll(/\{\{([^}]+)\}\}/g)].map((m) =>
            m[1].trim(),
          )
          for (const token of used) {
            // A token the template does not supply is blanked before sending
            // (AGL-750), so a typo here ships an email with a gap.
            expect(declared.has(token)).toBe(true)
          }
        }
      }
    })

    it('gives Firebase-delivered templates no body (they have no editor)', () => {
      for (const entry of SYSTEM_EMAIL_TEMPLATES) {
        if (isSystemEmailEditable(entry)) continue
        expect(entry.defaultBody).toBeUndefined()
      }
    })
  })

  describe('delivery ownership', () => {
    it('marks the auth emails as Firebase-delivered', () => {
      // These are the ones a besigner template cannot reach yet (AGL-751).
      // If this ever flips to 'resend' without the takeover shipping, staff
      // get an editor that silently does nothing.
      expect(getSystemEmailTemplate('password-reset')?.deliveredBy).toBe(
        'firebase',
      )
      expect(getSystemEmailTemplate('email-verification')?.deliveredBy).toBe(
        'firebase',
      )
    })

    it('marks the emails Aglyn sends itself as Resend-delivered', () => {
      for (const key of ['org-invite', 'usage-summary', 'erasure-hold-alert']) {
        expect(getSystemEmailTemplate(key)?.deliveredBy).toBe('resend')
      }
    })

    it('treats only Resend-delivered entries as editable', () => {
      for (const entry of SYSTEM_EMAIL_TEMPLATES) {
        expect(isSystemEmailEditable(entry)).toBe(
          entry.deliveredBy === 'resend',
        )
      }
    })
  })

  describe('buildDefaultEmailNodeMap (AGL-766)', () => {
    it('roots the map at EMAIL_NODE_ROOT_ID so the renderer finds it', () => {
      const map = buildDefaultEmailNodeMap(getSystemEmailTemplate('org-invite')!)
      expect(map[EMAIL_NODE_ROOT_ID]?.componentId).toBe('div')
      // Every node reachable from the root — no orphans, no dangling child ids.
      const seen = new Set<string>()
      const walk = (id: string) => {
        const node = map[id]
        if (!node || seen.has(id)) return
        seen.add(id)
        for (const child of node.nodes ?? []) {
          expect(map[child]).toBeTruthy()
          walk(child)
        }
      }
      walk(EMAIL_NODE_ROOT_ID)
      expect(seen.size).toBe(Object.keys(map).length)
    })

    it('renders the org-invite default to non-empty html with its tokens', () => {
      const map = buildDefaultEmailNodeMap(getSystemEmailTemplate('org-invite')!)
      const { html } = renderEmailHtml({
        nodes: map as never,
        rootId: EMAIL_NODE_ROOT_ID,
        merge: { 'org.name': 'Test Org', 'invite.role': 'editor' },
      })
      expect(html).toContain('invited to join Test Org as editor')
      // The Sign in button block made it through too.
      expect(html.toLowerCase()).toContain('sign in')
    })

    it('turns button blocks into emailButton nodes with the href', () => {
      const map = buildDefaultEmailNodeMap(getSystemEmailTemplate('org-invite')!)
      const button = Object.values(map).find(
        (node) => node.componentId === 'emailButton',
      )
      expect(button?.props?.href).toBe('{{signInUrl}}')
    })
  })

  describe('getSystemEmailTemplate', () => {
    it('finds a known key', () => {
      expect(getSystemEmailTemplate('org-invite')?.name).toBe(
        'Organization invite',
      )
    })

    it('returns undefined for an unknown key rather than throwing', () => {
      expect(getSystemEmailTemplate('not-a-template')).toBeUndefined()
    })
  })
})
