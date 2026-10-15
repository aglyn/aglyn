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
 * What the product editor tells an author before a file becomes private paid media (AGL-2814, AGL-2847): the where-used rows
 * the media library reports, which of them are other places than the product being edited, and the sentence the author
 * confirms. Pure, so the native apps replay it from the contracts' function cases and say the same words.
 */

/** A where-used row, reduced to what the confirmation reads. */
export interface PaidMediaReference {
  kind: string
  id: string
  name: string
  hostId: string
  collectionId?: string
}

/** How far the where-used scan got before the author was asked. */
export type PaidMediaUsageCheck = 'full' | 'partial' | 'failed'

/** Which list a flow adds to, for the words it uses. */
export type PaidMediaKind = 'video' | 'download'

export const PAID_MEDIA_COPY: Record<
  PaidMediaKind,
  { title: string; lead: string; notAdded: string; unusable: string; choose: string }
> = {
  video: {
    title: 'Make this video private?',
    lead:
      'Members videos are private: buyers play them through a link that ' +
      'expires, and nobody else can open them.',
    notAdded: 'The video was not added.',
    unusable: 'Members cannot play it until it is private.',
    choose: 'Choose the video from the media library, so its links can expire.',
  },
  download: {
    title: 'Make this file private?',
    lead:
      'Paid downloads are private: buyers get a link that expires, and nobody ' +
      'else can open the file.',
    notAdded: 'The file was not added.',
    unusable: 'Buyers cannot download it until it is private.',
    choose: 'Choose the file from the media library, so its links can expire.',
  },
}

/** The request body that names an asset's library to the media routes. */
export function paidMediaScopeBody(
  scope: string,
): { orgId: string } | { hostId: string } {
  return scope.startsWith('org:')
    ? { orgId: scope.slice('org:'.length).split(':')[0] }
    : { hostId: scope }
}

/**
 * Where an asset is used, apart from the product it is being added to. That
 * product's own row is not a place making it private could break.
 */
export function usesBesideProduct(
  references: readonly PaidMediaReference[],
  product: { hostId: string; productId?: string },
): PaidMediaReference[] {
  return references.filter(
    (reference) =>
      !(
        product.productId &&
        reference.kind === 'plugin' &&
        reference.collectionId === 'products' &&
        reference.hostId === product.hostId &&
        reference.id === product.productId
      ),
  )
}

/** What the author reads before a video becomes private. */
export function paidMediaConfirmation(options: {
  others: readonly PaidMediaReference[]
  checked: PaidMediaUsageCheck
  kind?: PaidMediaKind
}): string {
  const { others, checked } = options
  const { lead } = PAID_MEDIA_COPY[options.kind ?? 'video']
  let usage: string
  if (others.length) {
    const names = others
      .slice(0, 3)
      .map((reference) => `“${reference.name}”`)
      .join(', ')
    const more = others.length > 3 ? ` and ${others.length - 3} more` : ''
    usage = `It is also used on ${names}${more}, and it stops showing there.`
  } else if (checked === 'full') {
    usage = 'Nothing else uses it.'
  } else if (checked === 'partial') {
    usage =
      'We could not check everywhere it might be used, so something else ' +
      'could still rely on it.'
  } else {
    usage = 'We could not check where else it is used.'
  }
  return `${lead} ${usage} Any public link to it that was already shared stops working too.`
}

