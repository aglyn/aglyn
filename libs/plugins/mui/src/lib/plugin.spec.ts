import * as Aglyn from '@aglyn/aglyn'
import { schema as appBar } from './components/app-bar'
import { schema as button } from './components/button'
import {
  socialLinksSchema as socialLinks,
  videoEmbedSchema as videoEmbed,
} from './components/blocks'
import { schema as container } from './components/container'
import {
  drawerSchema as drawer,
  drawerToggleSchema as drawerToggle,
} from './components/drawer'
import {
  formFieldSchema as formField,
  formSchema as form,
} from './components/form'
import {
  megaMenuSchema as megaMenu,
  navMenuSchema as navMenu,
} from './components/nav-menu'
import { schema as functionWidget } from './components/function-widget'
import { schema as image } from './components/image'
import { schema as layoutSlot } from './components/layout-slot'
import { schema as list } from './components/list'
import { schema as listItem } from './components/list-item'
import { schema as listItemText } from './components/list-item-text'
import { schema as product } from './components/product'
import { schema as reusableInstance } from './components/reusable-instance'
import { schema as searchBox } from './components/search-box'
import { schema as screenLink } from './components/screen-link'
import { schema as stack } from './components/stack'
import { schema as toolbar } from './components/toolbar'
import { schema as typography } from './components/typography'
import { BUNDLE_ID } from './constants/bundle-common'
import { MUI_BUNDLE, registerMuiPlugin } from './plugin'

// These ids are persisted in screen documents and must never change
// without a document migration.
const PERSISTED_COMPONENT_IDS = [
  'form',
  'formField',
  'functionWidget',
  'image',
  'layoutSlot',
  'muiAppBar',
  'muiButton',
  'muiContainer',
  'muiDrawer',
  'muiDrawerToggle',
  'muiList',
  'muiListItem',
  'muiListItemText',
  'muiMegaMenu',
  'muiNavMenu',
  'muiScreenLink',
  'muiStack',
  'muiToolbar',
  'muiTypography',
  'product',
  'reusableInstance',
  'searchBox',
  'socialLinks',
  'videoEmbed',
]

describe('plugins-mui', () => {
  it('registers the mui plugin dependency with the legacy runtime', () => {
    registerMuiPlugin()
    expect(Aglyn.plugins.getDependency(BUNDLE_ID)).toBeTruthy()
  })

  it('is idempotent', () => {
    registerMuiPlugin()
    expect(() => registerMuiPlugin()).not.toThrow()
  })

  it('registers every component under a distinct id (AGL-1201)', () => {
    // The registry keys schemas by `$id`, so two entries sharing one
    // collapse *silently* there and every node persisted against the
    // loser renders as the winner. It can only be caught before
    // registration, on the manifest itself.
    const ids = MUI_BUNDLE.map((entry) => entry.schema.$id)
    expect(ids.length).toBeGreaterThan(0)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('gives every preset a distinct id (AGL-1201)', () => {
    // Same collapse, and here it also breaks unregistration: destroy()
    // removes the shared id once and leaves a ghost in the drawer.
    const ids = MUI_BUNDLE.flatMap((entry) =>
      (entry.presets ?? []).map((preset) => preset.$id),
    )
    expect(ids.length).toBeGreaterThan(0)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('names every element and points it at a category (AGL-1201)', () => {
    for (const { schema } of MUI_BUNDLE) {
      // A blank displayName renders as an unnamed row in the ELEMENTS
      // drawer and in the hierarchy panel.
      expect(schema.displayName).toBeTruthy()
      expect(schema.category).toBeTruthy()
      expect(schema.pluginId).toBe(BUNDLE_ID)
    }
  })

  it('gives every preset a component that is registered (AGL-1201)', () => {
    // A preset pointing at an unregistered componentId drops onto the
    // canvas as an empty box with no error anywhere.
    const registered = new Set(MUI_BUNDLE.map((entry) => entry.schema.$id))
    for (const entry of MUI_BUNDLE) {
      for (const preset of entry.presets ?? []) {
        const walk = (node: any) => {
          expect(registered.has(node.componentId)).toBe(true)
          for (const child of node.nodes ?? []) walk(child)
        }
        walk(preset.data)
      }
    }
  })

  it('keeps the persisted legacy component ids in the plugin', () => {
    const schemas = [
      appBar,
      button,
      drawer,
      drawerToggle,
      form,
      formField,
      megaMenu,
      navMenu,
      functionWidget,
      image,
      container,
      layoutSlot,
      list,
      listItem,
      listItemText,
      product,
      reusableInstance,
      screenLink,
      searchBox,
      socialLinks,
      videoEmbed,
      stack,
      toolbar,
      typography,
    ]
    const ids = schemas.map((i) => i.$id).sort()
    expect(ids).toEqual(PERSISTED_COMPONENT_IDS)
  })
})
