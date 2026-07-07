import * as Aglyn from '@aglyn/aglyn'
import { schema as appBar } from './components/app-bar'
import { schema as button } from './components/button'
import {
  socialLinksSchema as socialLinks,
  videoEmbedSchema as videoEmbed,
} from './components/blocks'
import { schema as container } from './components/container'
import {
  formFieldSchema as formField,
  formSchema as form,
} from './components/form'
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
import { registerLegacyMuiPlugin } from './legacy-plugin'

// These ids are persisted in screen documents and must never change
// without a document migration.
const PERSISTED_COMPONENT_IDS = [
  'form',
  'formField',
  'image',
  'layoutSlot',
  'muiAppBar',
  'muiButton',
  'muiContainer',
  'muiList',
  'muiListItem',
  'muiListItemText',
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

describe('plugins-ui-mui', () => {
  it('registers the mui plugin dependency with the legacy runtime', () => {
    registerLegacyMuiPlugin()
    expect(Aglyn.plugins.getDependency(BUNDLE_ID)).toBeTruthy()
  })

  it('is idempotent', () => {
    registerLegacyMuiPlugin()
    expect(() => registerLegacyMuiPlugin()).not.toThrow()
  })

  it('keeps the persisted legacy component ids in the plugin', () => {
    const schemas = [
      appBar,
      button,
      form,
      formField,
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
