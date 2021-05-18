
export const currentYear = new Date().getFullYear()

export const APP = {
  LEGAL_NAME: 'Aglyn LLC',
  PKG_VERSION: `${process.env.PKG_VERSION}`,
  LIB_BUILD_ID: `${process.env.LIB_BUILD_ID}`,
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
