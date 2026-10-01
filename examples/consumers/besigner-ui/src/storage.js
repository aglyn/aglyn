// Where this example keeps the document between visits: the browser's
// localStorage. A real app saves the same JSON wherever it stores documents.

const KEY = 'aglyn-example:document'

export function readSavedDocument() {
  try {
    const saved = globalThis.localStorage?.getItem(KEY)
    return saved ? JSON.parse(saved) : null
  } catch {
    return null
  }
}

export function saveDocument(nodes) {
  globalThis.localStorage?.setItem(KEY, JSON.stringify(nodes))
}

export function clearSavedDocument() {
  globalThis.localStorage?.removeItem(KEY)
}
