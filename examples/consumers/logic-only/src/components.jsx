import { components, FEATURE_FLAG } from '@aglyn/aglyn'

// The element types this example's documents are made of. In Aglyn itself
// they come from plugins (`@aglyn/plugins-mui` and others); here they are
// three plain React components, which is all the core asks for.

export function Page({ children }) {
  return <main className="page">{children}</main>
}

export function Section({ children }) {
  return <section className="section">{children}</section>
}

export function Heading({ text }) {
  return <h2>{text}</h2>
}

export function Paragraph({ text }) {
  return <p>{text}</p>
}

const PLUGIN_ID = 'example'

/** Registers the element types with the core, once per page. */
export function registerComponents() {
  if (components.getFactory('page')) return
  components.registerComponent(Page, { $id: 'page', pluginId: PLUGIN_ID, displayName: 'Page' })
  components.registerComponent(Section, { $id: 'section', pluginId: PLUGIN_ID, displayName: 'Section' })
  // A heading and a paragraph hold text, not children. Marking them
  // self-closing is what makes a paste beside one land as its sibling.
  const leaf = { selfClosing: FEATURE_FLAG.ENABLED }
  components.registerComponent(Heading, { $id: 'heading', pluginId: PLUGIN_ID, displayName: 'Heading', flags: leaf })
  components.registerComponent(Paragraph, { $id: 'paragraph', pluginId: PLUGIN_ID, displayName: 'Paragraph', flags: leaf })
}
