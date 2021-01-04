import firebase from 'firebase/app'

import { PKey } from '../interfaces/dod'
import { FT, Ref } from '../interfaces/dod'
import { Persist } from '../types'

import 'firebase/analytics'
import 'firebase/auth'
// import 'firebase/firestore'

import { CollectionRefController } from './CollectionRefController'
import { DatabaseRefController } from './DatabaseRefController'
import { DocumentRefController } from './DocumentRefController'
import { FieldRefController } from './FieldRefController'

export type FbApp = firebase.app.App
export type FbAuth = firebase.auth.Auth
export type FbFirestore = firebase.firestore.Firestore
export type FbAnalytics = firebase.analytics.Analytics
export type FbUserCredential = firebase.auth.UserCredential
export type FbUser = firebase.User
export type FbStore = firebase.firestore.Firestore

export type FbDocumentData = firebase.firestore.DocumentData
export type FbDocumentRef<T = FbDocumentData> = firebase.firestore.DocumentReference<T>
export type FbDocumentSnapshot<T = FbDocumentData> = firebase.firestore.DocumentSnapshot<T>

export type FbCollectionRef<T = FbDocumentData> = firebase.firestore.CollectionReference<T>

export interface UserDocument<User extends FbUser = FbUser> extends FbDocumentData {
  uid: User['uid']
  email: User['email']
  birthday?: number
  firstName?: string
  lastName?: string
  middleInitial?: string
}

/**
 * Describes the initial configuration for the application controller
 */
export interface AppControllerConfig {
  appName?: string
  tenantId?: string
  authPersistence?: Persist

  apiKey: string
  authDomain: string
  databaseURL: string
  projectId: string
  storageBucket: string
  messagingSenderId: string
  appId: string
  measurementId: string
}

export enum SysCid {
  USERS = 'users',
}

export interface AppController {
  [name: string]: (...args: any[]) => any
  getConfig: () => AppControllerConfig
  getApp: () => FbApp
  getAnalytics: () => FbAnalytics
  getAuth: () => FbAuth
  getFirestore: () => FbFirestore
  getCurrentUser: () => FbUser
  signInUser: (email: string, password: string, onSuccess?: (user: FbUserCredential) => void, onError?: (error: any) => void, persistence?: Persist) => Promise<void>
  signUpUser: (email: string, password: string, onSuccess?: (user: FbUserCredential) => void, onError?: (error: any) => void, persistence?: Persist) => Promise<void>
  signOutUser: (onSuccess?: () => void, onError?: (error: any) => void) => Promise<void>
  setAuthPersistence: (onSuccess?: () => void, onError?: (error: any) => void, override?: Persist) => Promise<void>
  getCollectionRef: <T extends firebase.firestore.DocumentData>(cid: string) => FbCollectionRef<T>
  getUsersCollectionRef: () => FbCollectionRef<UserDocument>
  getUserDocumentRef: (uid: PKey) => Promise<FbDocumentRef<UserDocument>>
  getCurrentUserDocumentRef: () => Promise<FbDocumentRef<UserDocument>>
  getDodDatabase: (dbId: PKey) => DatabaseRefController<any>
  setDodDatabase: (dbId: PKey, value: Ref.Database) => void
  getDodCollection: (dbId: PKey, cId: PKey) => CollectionRefController<any>
  getDodDocument: (dbId: PKey, cId: PKey, dId: PKey) => DocumentRefController<any>
  getDodField: (dbId: PKey, cId: PKey, dId: PKey, fId: PKey) => FieldRefController<any>
}

export const persistAsAuthPersist = {
  [Persist.NONE]: firebase.auth.Auth.Persistence.NONE,
  [Persist.SESSION]: firebase.auth.Auth.Persistence.SESSION,
  [Persist.LOCAL]: firebase.auth.Auth.Persistence.LOCAL,
}

const testDb: Ref.Database = {
  schemas: {
    'test_collection': {
      name: { singular: 'Test Collection', plural: 'Test Collections' },
      created: Date.now(),
      fields: {
        sjdf5lgnc: {
          name: { singular: 'First Name', plural: 'First Names' },
          type: FT.Tag.text
        },
        sdkgmlr34: {
          name: { singular: 'Last Name', plural: 'Last Names' },
          type: FT.Tag.text
        },
      }
    }
  },
  instances: {
    'test_collection': {
      test_document: {
        sjdf5lgnc: 'Zach',
        sdkgmlr34: 'Gover',
      }
    }
  }
}

testDb

/**
 * The default application configuration object, can be
 * merged with a custom config to set overrides
 */
export const defaultAppConfig: AppControllerConfig = {
  appName: '[DEFAULT]',
  authPersistence: Persist.SESSION,

  apiKey: process.env.NEXT_PUBLIC_FIREBASE_PUBLIC_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  databaseURL: process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
  measurementId: process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID,

  // databases: {
  //   test_db: testDb
  // }
}

let app: FbApp

/**
 * All top level support
 *
 *
 * @see https://firebase.google.com/docs/firestore/storage-size
 *
 * String sizes are calculated as the number of UTF-8 encoded bytes + 1.
 * - For example:
 *    - The collection ID `tasks` uses 5 bytes + 1 byte, for a total of 6 bytes.
 *    - The field name `description` uses 11 bytes + 1 byte, for a total of 12 bytes.
 *
 * Document ID size is the string size for a string ID or 8 bytes for an integer ID.
 *    - String ID: size of string
 *    - Integer ID: 8 bytes
 *
 * The size of a document name is the sum of:
 *    - The size of each collection ID and document ID in the path to the document
 *    - 16 additional bytes
 *
 *
 * Field *VALUE* size based on Data Type
 * |  Type                  |  Size
 * |—————————————————————————————————————————————————————————————————————————
 * |  Array                 |  The sum of the sizes of its values
 * |  Boolean               |  1 byte
 * |  Bytes                 |  Byte length
 * |  Date and time         |  8 bytes
 * |  Floating-point number |  8 bytes
 * |  Geographical point    |  16 bytes
 * |  Integer               |  8 bytes
 * |  Map                   |  The map size, calculated same way as document size
 * |  Null                  |  1 byte
 * |  Reference             |  The document name size
 * |  Text string           |  Number of UTF-8 encoded bytes + 1
 * |—————————————————————————————————————————————————————————————————————————
 *
 * For example, a boolean field named done would use 6 bytes:
 *    - 5 bytes for the done field name
 *    - 1 byte for the boolean value
 *
 * The size of a document is the sum of:
 *    - The document name size
 *    - The sum of the string size of each field name
 *    - The sum of the size of each field value
 *    - 32 additional bytes
 *
 * @export
 * @function withAppController
 */
export function withAppController(options: AppControllerConfig = defaultAppConfig): AppController {

  /////////////////////////////
  // MARK: Config
  /////////////////////////////

  const config: AppControllerConfig = {
    ...defaultAppConfig,
    ...options
  }

  const firebaseConfig = {
    apiKey: config.apiKey,
    authDomain: config.authDomain,
    databaseURL: config.databaseURL,
    projectId: config.projectId,
    storageBucket: config.storageBucket,
    messagingSenderId: config.messagingSenderId,
    appId: config.appId,
    measurementId: config.measurementId,
  }

  /////////////////////////////
  // MARK: Instances
  /////////////////////////////

  // let app: FbApp = null
  let auth: FbAuth = null
  let analytics: FbAnalytics = null
  let firestore: FbFirestore = null

  const getConfig = (): AppControllerConfig => {
    return config
  }
  const getApp = (): FbApp => {
    return app
  }
  const getAnalytics = (): FbAnalytics => {
    return analytics
  }
  const getAuth = (): FbAuth => {
    return auth
  }
  const getFirestore = (): FbFirestore => {
    return firestore
  }


  /////////////////////////////
  // MARK: Initialization
  /////////////////////////////

  try {
    console.info(`Beginning app initializing(${config.appName})`)
    if (!firebase.apps.length) {
      app = firebase.initializeApp(firebaseConfig, config.appName)
    } else {
      app = firebase.app()
    }
    auth = app.auth()
    if (typeof window !== undefined && !firebase.apps.length) {
      analytics = app.analytics()
      firestore = app.firestore()
    }
    console.info(`Finished app initialization(${config.appName})`)
  }
  catch (error) {
    console.error(`Error initializing app(${config.appName})`, error)
    throw error
  }


  /////////////////////////////
  // MARK: Db store shortcuts
  /////////////////////////////

  const getCollectionRef = <T extends FbDocumentData>(cid: string): FbCollectionRef<T> => {
    return firestore.collection(cid) as FbCollectionRef<T>
  }


  /////////////////////////////
  // MARK: Auth methods
  /////////////////////////////

  const getCurrentUser = (): FbUser => {
    return auth.currentUser
  }
  const setAuthPersistence = async (
    onSuccess?: () => void,
    onError?: (error: any) => void,
    override?: Persist,
  ) => {
    await auth
      .setPersistence(persistAsAuthPersist[override ?? config.authPersistence])
      .then(() => onSuccess && onSuccess())
      .catch((error) => onError && onError(error))
  }
  const signInUser = async (
    email: string,
    password: string,
    onSuccess?: (user: FbUserCredential) => void,
    onError?: (error: any) => void,
    persistence?: Persist,
  ) => {
    await setAuthPersistence(
      async () => {
        await auth.signInWithEmailAndPassword(email, password)
          .then((user) => onSuccess && onSuccess(user))
          .catch((error) => onError && onError(error))
      },
      (error) => onError && onError(error),
      persistence
    )
  }
  const signUpUser = async (
    email: string,
    password: string,
    onSuccess?: (user: FbUserCredential) => void,
    onError?: (error: any) => void,
    persistence?: Persist,
  ) => {
    await setAuthPersistence(
      async () => {
        await auth.createUserWithEmailAndPassword(email, password)
          .then((user) => onSuccess && onSuccess(user))
          .catch((error) => onError && onError(error))
      },
      (error) => onError && onError(error),
      persistence
    )
  }
  const signOutUser = async (
    onSuccess?: () => void,
    onError?: (error: any) => void
  ) => {
    await auth.signOut()
      .then(() => onSuccess && onSuccess())
      .catch((error) => onError && onError(error))
  }


  /////////////////////////////
  // MARK: User methods
  /////////////////////////////

  const getUsersCollectionRef = (): FbCollectionRef<UserDocument> => {
    return getCollectionRef(SysCid.USERS)
  }
  const getUserDocumentRef = async (uid: PKey): Promise<FbDocumentRef<UserDocument>> => {
    return await getUsersCollectionRef().doc(uid)
  }
  const getCurrentUserDocumentRef = (): Promise<FbDocumentRef<UserDocument>> => {
    const uid = getCurrentUser()?.uid ?? ''
    return getUserDocumentRef(uid)
  }


  /////////////////////////////
  // MARK: Dod methods
  /////////////////////////////

  const databases: { [databaseId: string]: Ref.Database } = {}

  const getDodDatabase = (dbId: PKey): DatabaseRefController<any> => {
    const db = databases[dbId]
    return DatabaseRefController.from(dbId, db.schemas, db.instances)
  }
  const setDodDatabase = (dbId: PKey, value: Ref.Database) => {
    databases[dbId] = value
  }
  const getDodCollection = (
    dbId: PKey,
    cId: PKey
  ): CollectionRefController<any> => {
    const db = getDodDatabase(dbId)
    const c = db?.get(cId)
    return !c ? null : CollectionRefController.from(cId, db.meta.schema[cId], c)
  }
  const getDodDocument = (
    dbId: PKey,
    cId: PKey,
    dId: PKey
  ): DocumentRefController<any> => {
    const c = getDodCollection(dbId, cId)
    const doc = c?.get(dId)
    return !doc ? null : DocumentRefController.from(dId, c.meta.schema.fields, doc)
  }
  const getDodField = (
    dbId: PKey,
    cId: PKey,
    dId: PKey,
    fId: PKey
  ): FieldRefController<any> => {
    const doc = getDodDocument(dbId, cId, dId)
    const f = doc?.get(fId)
    return !f ? null : FieldRefController.from(fId, doc.meta.schema[fId], f)
  }


  return {
    getConfig,
    getApp,
    getAnalytics,
    getAuth,
    getFirestore,
    getCurrentUser,
    signInUser,
    signUpUser,
    signOutUser,
    setAuthPersistence,
    getCollectionRef,
    getUsersCollectionRef,
    getUserDocumentRef,
    getCurrentUserDocumentRef,
    getDodDatabase,
    setDodDatabase,
    getDodCollection,
    getDodDocument,
    getDodField,
  }
}