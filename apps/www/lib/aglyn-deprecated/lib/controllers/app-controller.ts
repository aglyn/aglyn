/**
 * @license
 * Copyright 2021 Aglyn LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

// import 'firebase/firestore'
import {DoD} from '@aglyn/shared-data-types'
import {getApps} from '@firebase/app'
import {type Analytics, getAnalytics as getFbAnalytics} from 'firebase/analytics'

import 'firebase/analytics'
import {type FirebaseApp, getApp as getFbApp, initializeApp} from 'firebase/app'
import {
  type Auth,
  connectAuthEmulator,
  createUserWithEmailAndPassword,
  getAuth as getFbAuth,
  onAuthStateChanged as onFbAuthStateChanged,
  setPersistence,
  signInWithEmailAndPassword,
  signOut,
  type User as AuthUser,
  type UserCredential,
} from 'firebase/auth'
// import 'firebase/auth'
import {
  collection,
  type CollectionReference,
  connectFirestoreEmulator,
  doc,
  type DocumentData,
  type DocumentReference,
  type DocumentSnapshot,
  type Firestore,
  getFirestore as getFbFirestore,
} from 'firebase/firestore'
import {type Permission, type Role, type User} from '../types'

import {CollectionRefController} from './CollectionRefController'
import {DatabaseRefController} from './DatabaseRefController'
import {DocumentRefController} from './DocumentRefController'
import {FieldRefController} from './FieldRefController'


export type FbApp = FirebaseApp
export type FbAuth = Auth
export type FbFirestore = Firestore
export type FbAnalytics = Analytics
export type FbUserCredential = UserCredential
export type FbUser = AuthUser

export type FbDocumentData = DocumentData
export type FbDocumentRef<T = FbDocumentData> = DocumentReference<T>
export type FbDocumentSnapshot<T = FbDocumentData> = DocumentSnapshot<T>

export type FbCollectionRef<T = FbDocumentData> = CollectionReference<T>

/**
 * Describes the initial configuration for the application controller
 */
export interface AppControllerConfig {
  /**
   * The app unique ID, if none provided defaults to '[DEFAULT]'
   */
  appName?: string
  /**
   * For multi-tenancy
   * @see https://cloud.google.com/identity-platform/docs/multi-tenancy-authentication
   */
  tenantId?: string
  /**
   * Default browser auth persistence
   */
  authPersistence?: DoD.Persist
  /**
   * URL of local firebase auth emulator, only used if set
   */
  authEmulator?: string
  /**
   * URL of local firebase firestore emulator, only used if set
   */
  firestoreEmulator?: {host: string, port: number}

  // =================
  // START – FIREBASE PROJECT CONFIG
  // =================
  apiKey: string
  authDomain: string
  databaseURL: string
  projectId: string
  storageBucket: string
  messagingSenderId: string
  appId: string
  /**
   * Google Analytics measurement ID
   */
  measurementId: string
  // =================
  // END – FIREBASE PROJECT CONFIG START
  // =================
}

/**
 * System collection IDs
 */
export enum SysCid {
  USERS = 'users',
  ROLES = 'roles',
  PERMISSIONS = 'permissions',
}

export interface AppController {
  [name: string]: (...args: any[]) => any
  getConfig: () => AppControllerConfig
  getApp: () => FbApp
  getAnalytics: () => FbAnalytics
  getAuth: () => FbAuth
  getFirestore: () => FbFirestore
  getCurrentUser: () => FbUser
  signInUser: (
    email: string,
    password: string,
    onSuccess?: (user: FbUserCredential) => void,
    onError?: (error: any) => void,
    persistence?: DoD.Persist,
  ) => Promise<void>
  signUpUser: (
    email: string,
    password: string,
    onSuccess?: (user: FbUserCredential) => void,
    onError?: (error: any) => void,
    persistence?: DoD.Persist,
  ) => Promise<void>
  signOutUser: (onSuccess?: () => void, onError?: (error: any) => void) => Promise<void>
  onAuthStateChange: (...params: Parameters<typeof onFbAuthStateChanged> extends [unknown, ...infer U] ? U : never) => ReturnType<typeof onFbAuthStateChanged>
  setAuthPersistence: (
    onSuccess?: () => void,
    onError?: (error: any) => void,
    override?: DoD.Persist,
  ) => Promise<void>
  getCollectionRef: <T extends FbDocumentData>(cid: string) => FbCollectionRef<T>
  getUsersCollectionRef: () => FbCollectionRef<User>
  getUserDocumentRef: (uid: DoD.PKey) => FbDocumentRef<User>
  getCurrentUserDocumentRef: () => FbDocumentRef<User>
  getDodDatabase: (dbId: DoD.PKey) => DatabaseRefController<any>
  setDodDatabase: (dbId: DoD.PKey, value: DoD.Ref.Database) => void
  getDodCollection: (dbId: DoD.PKey, cId: DoD.PKey) => CollectionRefController<any>
  getDodDocument: (dbId: DoD.PKey, cId: DoD.PKey, dId: DoD.PKey) => DocumentRefController<any>
  getDodField: (
    dbId: DoD.PKey,
    cId: DoD.PKey,
    dId: DoD.PKey,
    fId: DoD.PKey,
  ) => FieldRefController<any>
}

const testDb: DoD.Ref.Database = {
  schemas: {
    'test_collection': {
      name: {singular: 'Test Collection', plural: 'Test Collections'},
      created: Date.now(),
      fields: {
        sjdf5lgnc: {
          name: {singular: 'First Name', plural: 'First Names'},
          type: DoD.FT.Tag.text,
        },
        sdkgmlr34: {
          name: {singular: 'Last Name', plural: 'Last Names'},
          type: DoD.FT.Tag.text,
        },
      },
    },
  },
  instances: {
    'test_collection': {
      test_document: {
        sjdf5lgnc: 'Zach',
        sdkgmlr34: 'Gover',
      },
    },
  },
}

/**
 * The default application configuration object, can be
 * merged with a custom config to set overrides
 */
export const defaultAppConfig: AppControllerConfig = {
  appName: '[DEFAULT]',
  authPersistence: DoD.Persist.SESSION,

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
export function withAppController(options: Partial<AppControllerConfig> = defaultAppConfig): AppController {

  let app: FbApp

  /////////////////////////////
  // MARK: Config
  /////////////////////////////

  const config: AppControllerConfig = {
    ...defaultAppConfig,
    ...options,
  }

  // console.debug('config', config)

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

  let existingApp = false
  let setAuth = false
  let setFirestore = false
  let analytics: FbAnalytics = null

  const setupAuth = (auth: FbAuth): FbAuth => {
    setAuth = true
    if (config.authEmulator) {
      console.debug('setting auth emulator')
      connectAuthEmulator(auth, config.authEmulator)
    }
    return auth
  }

  const setupFirestore = (firestore: FbFirestore): FbFirestore => {
    setFirestore = true
    if (config.firestoreEmulator) {
      console.debug('setting firestore emulator')
      const {host, port} = config.firestoreEmulator
      connectFirestoreEmulator(firestore, host, port)
    }
    return firestore
  }

  const getConfig = (): AppControllerConfig => {
    return config
  }
  const getApp = (): FbApp => {
    return app ?? getFbApp(config.appName)
  }
  const getAnalytics = (): FbAnalytics => {
    if (firebaseConfig.measurementId) {
      if (analytics) {
        return analytics
      }
      return analytics = getFbAnalytics(app ?? app)
    }
    return null
  }
  const getAuth = (): FbAuth => {
    const auth = getFbAuth(app ?? app)
    return !setAuth && !existingApp && auth ? setupAuth(auth) : auth
  }
  const getFirestore = (): FbFirestore => {
    const firestore = getFbFirestore(app)
    return !setFirestore && !existingApp && firestore ? setupFirestore(firestore) : firestore
  }


  /////////////////////////////
  // MARK: Initialization
  /////////////////////////////

  try {
    console.debug(`Beginning app setup(${config.appName})`)
    // Check if app is already initialized
    const apps = getApps()
    if (apps.some(i => i.name === config.appName)) {
      console.debug(`Retrieving app already initialized(${config.appName})`)
      existingApp = true
      app = getFbApp(config.appName)
    }
    else {
      console.debug(`Initializing app(${config.appName})`)
      app = initializeApp(firebaseConfig, config.appName)
    }
    console.debug(`Finished app setup(${config.appName})`)
  }
  catch (error) {
    console.error(`Error initializing app(${config.appName})`, error)
    throw error
  }


  /////////////////////////////
  // MARK: Db store shortcuts
  /////////////////////////////

  const getCollectionRef = <T extends FbDocumentData>(cid: string): FbCollectionRef<T> => {
    return collection(getFirestore(), cid) as FbCollectionRef<T>
  }


  /////////////////////////////
  // MARK: Auth methods
  /////////////////////////////

  const getCurrentUser = (): FbUser => {
    return getAuth()?.currentUser
  }
  const setAuthPersistence = async (
    onSuccess?: () => void,
    onError?: (error: any) => void,
    override?: DoD.Persist,
  ) => {
    await setPersistence(getAuth(), {type: DoD.Persist[override ?? config.authPersistence]})
      .then(() => onSuccess && onSuccess())
      .catch((error) => onError && onError(error))
  }
  const signInUser = async (
    email: string,
    password: string,
    onSuccess?: (user: FbUserCredential) => void,
    onError?: (error: any) => void,
    persistence?: DoD.Persist,
  ) => {
    await setAuthPersistence(
      async () => {
        await signInWithEmailAndPassword(getAuth(), email, password)
          .then((user) => onSuccess && onSuccess(user))
          .catch((error) => onError && onError(error))
      },
      (error) => onError && onError(error),
      persistence,
    )
  }
  const signUpUser = async (
    email: string,
    password: string,
    onSuccess?: (user: FbUserCredential) => void,
    onError?: (error: any) => void,
    persistence?: DoD.Persist,
  ) => {
    await setAuthPersistence(
      async () => {
        await createUserWithEmailAndPassword(getAuth(), email, password)
          .then((user) => onSuccess && onSuccess(user))
          .catch((error) => onError && onError(error))
      },
      (error) => onError && onError(error),
      persistence,
    )
  }
  const signOutUser = async (
    onSuccess?: () => void,
    onError?: (error: any) => void,
  ) => {
    await signOut(getAuth())
      .then(() => onSuccess && onSuccess())
      .catch((error) => onError && onError(error))
  }
  const onAuthStateChange = (
    ...params: Parameters<typeof onFbAuthStateChanged> extends [unknown, ...infer U] ? U : never
  ) => {
    return onFbAuthStateChanged(
      getAuth(),
      ...params,
    )
  }


  /////////////////////////////
  // MARK: User methods
  /////////////////////////////

  const getUsersCollectionRef = (): FbCollectionRef<User> => {
    return getCollectionRef(SysCid.USERS)
  }
  const getUserDocumentRef = (uid: DoD.PKey): FbDocumentRef<User> => {
    return doc(getUsersCollectionRef(), uid)
  }
  const getCurrentUserDocumentRef = (): FbDocumentRef<User> => {
    const uid = getCurrentUser()?.uid ?? ''
    return getUserDocumentRef(uid)
  }

  /////////////////////////////
  // MARK: Roles & Permissions
  /////////////////////////////

  const getRolesCollectionRef = (): FbCollectionRef<Role> => {
    return getCollectionRef(SysCid.ROLES)
  }
  const getRoleDocumentRef = (id: DoD.PKey): FbDocumentRef<Role> => {
    return doc(getRolesCollectionRef(), id)
  }
  const getPermissionsCollectionRef = (): FbCollectionRef<Permission> => {
    return getCollectionRef(SysCid.PERMISSIONS)
  }
  const getPermissionDocumentRef = (id: DoD.PKey): FbDocumentRef<Permission> => {
    return doc(getPermissionsCollectionRef(), id)
  }


  /////////////////////////////
  // MARK: Dod methods
  /////////////////////////////

  const databases: {[databaseId: string]: DoD.Ref.Database} = {}

  const getDodDatabase = (dbId: DoD.PKey): DatabaseRefController<any> => {
    const db = databases[dbId]
    return DatabaseRefController.from(dbId, db.schemas, db.instances)
  }
  const setDodDatabase = (dbId: DoD.PKey, value: DoD.Ref.Database) => {
    databases[dbId] = value
  }
  const getDodCollection = (
    dbId: DoD.PKey,
    cId: DoD.PKey,
  ): CollectionRefController<any> => {
    const db = getDodDatabase(dbId)
    const c = db?.get(cId)
    return !c ? null : CollectionRefController.from(cId, db.meta.schema[cId], c)
  }
  const getDodDocument = (
    dbId: DoD.PKey,
    cId: DoD.PKey,
    dId: DoD.PKey,
  ): DocumentRefController<any> => {
    const c = getDodCollection(dbId, cId)
    const doc = c?.get(dId)
    return !doc ? null : DocumentRefController.from(dId, c.meta.schema.fields, doc)
  }
  const getDodField = (
    dbId: DoD.PKey,
    cId: DoD.PKey,
    dId: DoD.PKey,
    fId: DoD.PKey,
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
    onAuthStateChange,
    setAuthPersistence,

    getCollectionRef,

    getUsersCollectionRef,
    getUserDocumentRef,
    getCurrentUserDocumentRef,

    getRolesCollectionRef,
    getRoleDocumentRef,
    getPermissionsCollectionRef,
    getPermissionDocumentRef,

    getDodDatabase,
    setDodDatabase,
    getDodCollection,
    getDodDocument,
    getDodField,
  }
}
