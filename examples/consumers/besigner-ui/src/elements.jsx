import { ComponentCategory, components, FEATURE_FLAG, NodeType } from '@aglyn/aglyn'
import { createAglynComponent } from '@aglyn/aglyn-node-renderer'
import { forwardRef } from 'react'

// The element types the editor offers. In Aglyn itself they come from plugins
// (`@aglyn/plugins-mui` and others); here they are four plain React
// components. The editor hands each one a ref and the props it needs for
// selection and drag and drop, so each forwards both to its element.

const Page = forwardRef(function Page(props, ref) {
  return <main ref={ref} {...props} />
})

const Section = forwardRef(function Section(props, ref) {
  return <section ref={ref} {...props} />
})

const Heading = forwardRef(function Heading({ text, ...props }, ref) {
  return (
    <h2 ref={ref} {...props}>
      {text}
    </h2>
  )
})

const Paragraph = forwardRef(function Paragraph({ text, ...props }, ref) {
  return (
    <p ref={ref} {...props}>
      {text}
    </p>
  )
})

const PLUGIN_ID = 'example'

// SVG paths for the icons the element tree and the Elements tab draw.
const ICONS = {
  page: 'M14,2H6A2,2 0 0,0 4,4V20A2,2 0 0,0 6,22H18A2,2 0 0,0 20,20V8L14,2M18,20H6V4H13V9H18V20Z',
  section: 'M3,3H21V21H3V3M5,5V19H19V5H5Z',
  heading: 'M5,4V7H10.5V19H13.5V7H19V4H5Z',
  paragraph: 'M3,6H21V8H3V6M3,11H21V13H3V11M3,16H15V18H3V16Z',
}

/** The one attribute a text element has: its text, edited in the inspector. */
const TEXT_ATTRIBUTE = { name: 'text', label: 'Text content', component: 'textarea' }

const leaf = { selfClosing: FEATURE_FLAG.ENABLED }

const ELEMENTS = [
  [{ $id: 'page', displayName: 'Page', category: ComponentCategory.LAYOUT }, Page],
  [{ $id: 'section', displayName: 'Section', category: ComponentCategory.LAYOUT }, Section],
  [{ $id: 'heading', displayName: 'Heading', category: ComponentCategory.TEXT, flags: leaf, attributes: [TEXT_ATTRIBUTE] }, Heading],
  [{ $id: 'paragraph', displayName: 'Paragraph', category: ComponentCategory.TEXT, flags: leaf, attributes: [TEXT_ATTRIBUTE] }, Paragraph],
]

/** What the Elements tab offers to add: one of each, with starting text. */
const PRESETS = [
  ['section', 'Section', {}],
  ['heading', 'Heading', { text: 'A new heading' }],
  ['paragraph', 'Paragraph', { text: 'A new paragraph.' }],
]

/** Registers the element types and their presets with the core, once per page. */
export function registerElements() {
  if (components.getFactory('page')) return
  for (const [schema, component] of ELEMENTS) {
    const entry = createAglynComponent({ ...schema, pluginId: PLUGIN_ID, icon: { path: ICONS[schema.$id] } }, component)
    components.registerComponent(entry.component, entry.schema)
  }
  components.registerPreset(
    PRESETS.map(([componentId, displayName, props]) => ({
      $id: `${PLUGIN_ID}-${componentId}`,
      type: NodeType.PRESET,
      displayName,
      description: `Adds a ${displayName.toLowerCase()}.`,
      category: components.getSchema(componentId).category,
      icon: { path: ICONS[componentId] },
      pluginId: PLUGIN_ID,
      data: { $id: null, componentId, pluginId: PLUGIN_ID, props },
    })),
  )
}
