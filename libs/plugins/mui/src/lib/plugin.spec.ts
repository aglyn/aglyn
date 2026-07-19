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
import { registerMuiPlugin } from './plugin'

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
