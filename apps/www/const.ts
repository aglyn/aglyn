export const currentYear = new Date().getFullYear()

export const APP = {
  LEGAL_NAME: 'Aglyn LLC',
  VERSION: `${process.env.VERSION}`,
  BUILD_ID: `${process.env.BUILD_ID}`,
  COMMIT_REF: `${process.env.COMMIT_REF}`,
  IS_PRODUCTION: process.env.NODE_ENV === 'production',
}

export namespace Core {
  export enum IconVariant {
    // Data
    Property = 'variable',
    Document = 'book-variant',
    Collection = 'book-variant-multiple',

    // Data-Type
    String = 'code-string',
    Array = 'code-array',
    Object = 'code-braces-box',

    // User
    Login = 'login-variant',
    Logout = 'logout-variant',
  }
}

export const productNames = {
  www: '.com',
}

export const mainNavigation = [
  // {
  //   children: 'Features',
  // },
  // {
  //   children: 'Partners',
  //   items: [],
  // },
  // {
  //   children: 'Company',
  //   items: [],
  // },
  {
    children: 'Get Access',
    variant: 'contained',
    color: 'secondary',
    href: '/contact',
  },
]

export const footerNavigation = [
  {
    children: 'Resources',
    items: [
      {
        children: 'Get access',
        href: '/contact',
      },
      {
        children: 'Features (coming soon)',
        href: '/features',
        disabled: true,
      },
    ],
  },
  {
    children: 'Company',
    items: [
      {
        children: 'Contact',
        href: '/contact',
      },
    ],
  },
  {
    children: 'Legal',
    items: [
      {
        children: 'Privacy',
        href: '/legal/privacy',
      },
    ],
  },
]

export const tailNavigation = [
  {
    children: 'Contact',
    href: '/contact',
  },
  // {
  //   children: 'License',
  //   href: '/',
  // },
  {
    children: 'Privacy',
    href: '/legal/privacy',
  },
  // {
  //   children: 'Support',
  //   href: '/',
  // },
]
