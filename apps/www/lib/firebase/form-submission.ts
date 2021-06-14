/**
 * @license
 * Copyright (c) 2021 Aglyn LLC
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the root directory of this source tree.
 */

import fbStore from './fb-store'
import { createDocumentId, createTimestamp } from './tools'


interface SaveFormSubmitParams {
  formId: string
  fields: Record<string, any>
}

export async function saveFormSubmit({ formId, fields }: SaveFormSubmitParams) {
  const docRef = fbStore.collection('forms').doc(createDocumentId())
  return await docRef.set({
    formId: formId,
    fields: { ...fields },
    createdAt: createTimestamp(),
  })
}
