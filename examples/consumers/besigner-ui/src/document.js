import { canvas, NODE_ROOT_ID } from '@aglyn/aglyn'
import { focus } from '@aglyn/besigner'
import { registerElements } from './elements.jsx'

/**
 * A stored document: a flat map of node id to node, each naming its
 * component, its props and its children in order. This is the shape Aglyn
 * saves, so a real one can be loaded the same way.
 */
export const SAMPLE_DOCUMENT = {
  [NODE_ROOT_ID]: { $id: NODE_ROOT_ID, componentId: 'page', pluginId: 'example', nodes: ['hero'] },
  hero: { $id: 'hero', componentId: 'section', pluginId: 'example', parentId: NODE_ROOT_ID, nodes: ['title', 'intro'] },
  title: {
    $id: 'title',
    componentId: 'heading',
    pluginId: 'example',
    parentId: 'hero',
    props: { text: 'Besigner, outside the console' },
    nodes: [],
  },
  intro: {
    $id: 'intro',
    componentId: 'paragraph',
    pluginId: 'example',
    parentId: 'hero',
    props: { text: 'Select an element on the canvas or in the element tree, then style it on the right.' },
    nodes: [],
  },
}

/** Loads a document into the canvas the editor draws, replacing what was there. */
export function loadDocument(nodes = SAMPLE_DOCUMENT) {
  registerElements()
  focus.clearSelection()
  canvas.reset()
  canvas.setNodes(nodes)
}

/** The document as it stands now, in the shape `loadDocument` takes back. */
export function currentDocument() {
  return canvas.serializedNodes
}
