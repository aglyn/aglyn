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

import type { AiSiteContact } from '../model/ai-site-details'
import type { AiLayoutBlock, AiLayoutItem, AiLayoutSection } from './ai-layout-language'

/**
 * The business's phone and email on its pages (AGL-3979), by code.
 *
 * Told them, a model writes them into the copy where it sees fit — a header
 * button that calls, a line in an About page. Two places are not left to it:
 * the footer, which is on every page, and the page that places the site's
 * form, which is where a visitor goes to get in touch. Each shows the phone
 * and the email, as links that call and write, wherever the design did not
 * already show them. Nothing is added for a detail the person did not give,
 * so a start without them builds exactly the pages it built before.
 */

/** The longest a contact link's words may be: a Page Link's label, which the palette holds to 40. */
export const AI_LAYOUT_CONTACT_LABEL_MAX = 40

const digitsOf = (value: string) => value.replace(/\D/g, '')

/** Whether words carry the phone number (by its digits) or the email address the job was given. */
function says(text: string | undefined, contact: AiSiteContact): { phone: boolean; email: boolean } {
  const value = text ?? ''
  const digits = digitsOf(contact.phone)
  return {
    phone: Boolean(contact.phone) && digits.length >= 7 && digitsOf(value).includes(digits),
    email: Boolean(contact.email) && value.toLowerCase().includes(contact.email.toLowerCase()),
  }
}

/** Whether a link names the phone or the email (`phone`, `tel:…`, `email`, `mailto:…`). */
function links(to: string | undefined): { phone: boolean; email: boolean } {
  const lower = (to ?? '').trim().toLowerCase()
  return {
    phone: lower === 'phone' || lower === 'call' || lower.startsWith('tel:'),
    email: lower === 'email' || lower === 'mail' || lower.startsWith('mailto:'),
  }
}

/** Which of the phone and the email some blocks already show, in their words or as links. */
export function aiLayoutContactShown(
  blocks: readonly AiLayoutBlock[],
  contact: AiSiteContact,
): { phone: boolean; email: boolean } {
  const shown = { phone: false, email: false }
  const note = (found: { phone: boolean; email: boolean }) => {
    shown.phone ||= found.phone
    shown.email ||= found.email
  }
  for (const block of blocks) {
    note(says(block.text, contact))
    note(links(block.to))
    for (const item of block.items ?? []) {
      note(says(`${item.title} ${item.text}`, contact))
      note(links(item.to))
    }
  }
  return shown
}

/**
 * A contact link's words, kept whole (AGL-3979): words that carry the phone
 * number or the email are a label a cut would break — "Email
 * hello@harborline.co" cut to a button's 28 characters is "Email" — so they
 * keep up to {@link AI_LAYOUT_CONTACT_LABEL_MAX}, and past that the bare number
 * or address. `''` for words that carry neither.
 */
export function aiLayoutContactLabel(text: string | undefined, contact: AiSiteContact | null | undefined): string {
  if (!contact) return ''
  const value = (text ?? '').replace(/\s+/g, ' ').trim()
  const found = says(value, contact)
  if (!found.phone && !found.email) return ''
  if (value.length <= AI_LAYOUT_CONTACT_LABEL_MAX) return value
  return (found.email ? contact.email : contact.phone).slice(0, AI_LAYOUT_CONTACT_LABEL_MAX)
}

/** The lines that link what is not yet shown: the phone, then the email. */
export function aiLayoutContactItems(
  contact: AiSiteContact,
  shown: { phone: boolean; email: boolean } = { phone: false, email: false },
): AiLayoutItem[] {
  return [
    ...(contact.phoneHref && !shown.phone ? [{ title: contact.phone, text: '', to: 'phone' }] : []),
    ...(contact.emailHref && !shown.email ? [{ title: contact.email, text: '', to: 'email' }] : []),
  ]
}

/**
 * A page's sections with the phone and email in the section that places the
 * site's form (AGL-3979), where no section of the page shows them yet: a list
 * of the two links, under the words beside the form — in their column, in a
 * row — or, in a section of one column, just before the form. The sections
 * as given where there is no such section or nothing to add.
 */
export function aiLayoutWithContactLines(
  sections: readonly AiLayoutSection[],
  formSection: number | null,
  contact: AiSiteContact | null | undefined,
): readonly AiLayoutSection[] {
  if (!contact || formSection === null || !sections[formSection]) return sections
  const shown = aiLayoutContactShown(sections.flatMap((section) => section.blocks), contact)
  const items = aiLayoutContactItems(contact, shown)
  if (!items.length) return sections
  const section = sections[formSection]
  const blocks = [...section.blocks]
  const formAt = blocks.findIndex((block) => block.kind === 'form')
  const form = formAt === -1 ? null : blocks[formAt]
  const cols = section.cols && section.cols.length >= 2 ? section.cols.length : 0
  const besideForm = cols
    ? [...blocks].reverse().find((block) => block.kind !== 'form' && block.col !== undefined && block.col !== form?.col)
    : undefined
  const list: AiLayoutBlock = {
    kind: 'list',
    items,
    ...(besideForm?.col !== undefined ? { col: besideForm.col } : form?.col !== undefined ? { col: form.col } : {}),
  }
  if (besideForm) blocks.splice(blocks.lastIndexOf(besideForm) + 1, 0, list)
  else if (formAt !== -1) blocks.splice(formAt, 0, list)
  else blocks.push(list)
  return sections.map((each, index) => (index === formSection ? { ...section, blocks } : each))
}
