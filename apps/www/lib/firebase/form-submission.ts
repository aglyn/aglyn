/**
 * @license
 * Copyright (c) 2021 Aglyn LLC
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the root directory of this source tree.
 */

import fbStore from './fb-store'
import { createDocumentId, createTimestamp } from './tools'


export async function saveFormSubmit(formId: string, fields: Record<string, any>) {
  const docRef = fbStore.collection('forms').doc(createDocumentId())
  return await docRef.set({
    formId: formId,
    fields: { ...fields },
    createdAt: createTimestamp(),
  })
}
