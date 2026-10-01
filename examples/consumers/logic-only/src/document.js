import { canvas, components, NODE_ROOT_ID } from '@aglyn/aglyn'
import { canMoveNodeIn, canMoveNodeOut, clipboard, focus, moveNodeIn, moveNodeOut } from '@aglyn/besigner'
import { registerComponents } from './components.jsx'

/**
 * A stored document: a flat map of node id to node, each naming its
 * component, its props and its children in order. This is the shape Aglyn
 * saves, so a real one can be loaded the same way.
 */
export const SAMPLE_DOCUMENT = {
  [NODE_ROOT_ID]: { $id: NODE_ROOT_ID, componentId: 'page', pluginId: 'example', nodes: ['hero', 'features'] },
  hero: { $id: 'hero', componentId: 'section', pluginId: 'example', parentId: NODE_ROOT_ID, nodes: ['title', 'intro'] },
  title: { $id: 'title', componentId: 'heading', pluginId: 'example', parentId: 'hero', props: { text: 'Build your own editor' }, nodes: [] },
  intro: {
    $id: 'intro',
    componentId: 'paragraph',
    pluginId: 'example',
    parentId: 'hero',
    props: { text: 'The node model and the editing rules come from Aglyn. The UI is yours.' },
    nodes: [],
  },
  features: { $id: 'features', componentId: 'section', pluginId: 'example', parentId: NODE_ROOT_ID, nodes: ['feature'] },
  feature: {
    $id: 'feature',
    componentId: 'paragraph',
    pluginId: 'example',
    parentId: 'features',
    props: { text: 'Select, move, copy, paste, undo and redo.' },
    nodes: [],
  },
}

/** Loads a document into the canvas, replacing whatever was there. */
export function loadDocument(nodes = SAMPLE_DOCUMENT) {
  registerComponents()
  canvas.reset()
  canvas.setNodes(nodes)
  focus.clearSelection()
}

/** A node's name in the outline: its type, and its text when it has some. */
export function labelOf(node) {
  const type = components.getLabel(node.componentId) ?? node.componentId
  return node.props?.text ? `${type}: ${node.props.text}` : type
}

/** The document as rows for a tree view, depth first. */
export function outline(node = canvas.rootNode, depth = 0) {
  if (!node) return []
  return [{ node, depth }, ...node.children.flatMap((child) => outline(child, depth + 1))]
}

/** The one selected node, or undefined. */
export function selectedNode() {
  return focus.getSelected()[0]
}

/**
 * What the toolbar can do right now. Every answer comes from
 * `@aglyn/besigner`, so the buttons follow the same rules as Aglyn's editor.
 */
export function availableActions() {
  const node = selectedNode()
  return {
    copy: Boolean(node),
    paste: clipboard.hasContent(),
    moveOut: Boolean(node) && canMoveNodeOut(node),
    moveIn: Boolean(node) && canMoveNodeIn(node),
    undo: canvas.canUndo,
    redo: canvas.canRedo,
  }
}

/**
 * The editing commands. Each returns a sentence for the status line, or
 * throws nothing: a refusal is reported, not raised.
 */
export const commands = {
  select(node) {
    focus.setSelectedNode(node)
    return `Selected ${labelOf(node)}`
  },
  copy() {
    const count = clipboard.copyNodes(focus.getSelected())
    return `Copied ${count} element${count === 1 ? '' : 's'}`
  },
  paste() {
    const result = clipboard.pasteInto(selectedNode())
    if (result.error) return result.error
    focus.setSelectedNode(result.nodes[0])
    return `Pasted ${result.nodes.length} element${result.nodes.length === 1 ? '' : 's'}`
  },
  moveOut() {
    const result = moveNodeOut(selectedNode())
    return result.error ?? 'Moved out of its container'
  },
  moveIn() {
    const result = moveNodeIn(selectedNode())
    return result.error ?? 'Moved into the container above it'
  },
  undo() {
    canvas.undo()
    return 'Undone'
  },
  redo() {
    canvas.redo()
    return 'Redone'
  },
}
