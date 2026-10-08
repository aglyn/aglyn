/**
 * @license
 * Copyright 2026 Aglyn LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The Emails page's own rows for the Aglyn app's Emails screens (AGL-3669):
 * two email designs (Besigner screens of kind `email` with their first
 * versions), a manual list with members and a rule list, two topics (one
 * retired) and two suppressed addresses.
 *
 * Shapes are what the console writes: a design is the pair
 * `emailDesignDocuments` builds plus the screen search keys
 * (`displayNameSearchFields`); a list is `nameSearchFields(name)` + `kind`;
 * a member is what `enrollListMember` writes (`email`, `via`,
 * `searchTokens`); a suppression is what `suppression-add` stamps
 * (`email`, `emailTokens`, `reason`, `createdAt`).
 */

export async function seedEmail({ put, orgId, hostId, now, nameSearchFields }) {
  const designs = [
    { id: 'seed-email-welcome', versionId: 'seed-email-welcome-v1', name: 'Welcome email' },
    { id: 'seed-email-newsletter', versionId: 'seed-email-newsletter-v1', name: 'Monthly newsletter' },
  ]
  for (const design of designs) {
    const keys = nameSearchFields(design.name)
    await put(`hosts/${hostId}/screens/${design.id}`, {
      displayName: design.name,
      kind: 'email',
      versionId: design.versionId,
      nameLower: keys.nameLower,
      nameTokens: keys.nameTokens,
      nameReversed: keys.nameReversed,
      createdAt: now,
    })
    await put(`hosts/${hostId}/screens/${design.id}/versions/${design.versionId}`, {
      screenId: design.id,
      nodes: {
        '_@_': { $id: '_@_', componentId: 'div', nodes: [`${design.id}-s`] },
        [`${design.id}-s`]: { $id: `${design.id}-s`, componentId: 'emailSection', pluginId: 'email', parentId: '_@_', nodes: [`${design.id}-t`] },
        [`${design.id}-t`]: {
          $id: `${design.id}-t`,
          componentId: 'emailText',
          pluginId: 'email',
          parentId: `${design.id}-s`,
          props: { children: 'Hello {{contact.firstName}},', variant: 'body' },
        },
      },
    })
  }

  await put(`orgs/${orgId}/lists/seed-list-newsletter`, { ...nameSearchFields('Newsletter'), kind: 'manual', createdAt: now })
  await put(`orgs/${orgId}/lists/seed-list-vip`, {
    ...nameSearchFields('VIP customers'),
    kind: 'dynamic',
    rule: { field: 'lifecycleStage', op: '==', value: 'customer' },
    createdAt: now,
  })
  const members = [
    ['ava@example.test', 'Ava Brooks'],
    ['noah@example.test', 'Noah Patel'],
    ['mia@example.test', 'Mia Chen'],
  ]
  for (const [email, name] of members) {
    const id = email.replace(/[^a-z0-9]/g, '-')
    const words = `${name} ${email}`.toLowerCase().split(/[\s@.]+/).filter(Boolean)
    const searchTokens = [...new Set(words.flatMap((word) => [...word.slice(0, 12)].map((_, i) => word.slice(0, i + 1))))]
    await put(`orgs/${orgId}/lists/seed-list-newsletter/members/${id}`, { email, name, via: 'manual', searchTokens, createdAt: now })
  }

  await put(`orgs/${orgId}/emailTopics/seed-topic-news`, { name: 'Product news', description: 'What is new in the shop.', archived: false })
  await put(`orgs/${orgId}/emailTopics/seed-topic-events`, { name: 'Events', description: 'Workshops and pop-ups.', archived: true })

  for (const [email, reason] of [
    ['bounced@example.test', 'bounce'],
    ['complained@example.test', 'complaint'],
  ]) {
    const id = email.replace(/[^a-z0-9]/g, '-')
    const emailTokens = [...new Set(email.split(/[@.]+/).flatMap((word) => [...word.slice(0, 12)].map((_, i) => word.slice(0, i + 1))))]
    await put(`hosts/${hostId}/suppressions/${id}`, { email, emailTokens, reason, createdAt: now })
  }
}
