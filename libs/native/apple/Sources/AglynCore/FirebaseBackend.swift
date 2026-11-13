// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import DeviceCheck
import FirebaseAnalytics
import FirebaseAppCheck
import FirebaseAuth
import FirebaseCore
import FirebaseCrashlytics
import FirebaseFirestore
import Foundation

/// Configures the Firebase SDKs in code from an `AglynConfig`: there is no
/// `GoogleService-Info.plist`, which is also how a self-hosted build is set up.
public enum AglynFirebase {
  @MainActor private static var configured = false
  /// Where the REST clients take their App Check token: Firebase's, once `configure` installed it.
  @MainActor public private(set) static var appCheck: AppCheckTokenProvider = NoAppCheck()

  @MainActor
  public static func configure(_ config: AglynConfig) {
    AglynBrand.name = config.brandName
    guard !configured else { return }
    configured = true
    // App Check goes in before the app is configured: Auth and Firestore look it up when they start.
    if config.appCheck {
      AppCheck.setAppCheckProviderFactory(AglynAppCheckProviderFactory())
      appCheck = FirebaseAppCheckTokens()
    }
    let options = FirebaseOptions(
      googleAppID: config.firebase.appID,
      gcmSenderID: config.firebase.messagingSenderID ?? "000000000000")
    options.apiKey = config.firebase.apiKey
    options.projectID = config.firebase.projectID
    options.storageBucket = config.firebase.storageBucket
    FirebaseApp.configure(options: options)
    startTelemetry(config)

    if let host = config.authEmulatorHost, let (name, port) = split(host) {
      Auth.auth().useEmulator(withHost: name, port: port)
    }
    let settings = Firestore.firestore().settings
    if let host = config.firestoreEmulatorHost {
      settings.host = host
      settings.isSSLEnabled = false
      settings.cacheSettings = MemoryCacheSettings()
    }
    Firestore.firestore().settings = settings
  }

  /// Whether this build may collect crash reports and Analytics: the config's say (a release build on production), and
  /// never a DEBUG build whatever its config says.
  static func collects(_ config: AglynConfig) -> Bool {
    #if DEBUG
      return false
    #else
      return config.telemetry
    #endif
  }

  /// Crashlytics and Analytics (AGL-4067). Info.plist keeps both off (`FirebaseCrashlyticsCollectionEnabled`,
  /// `FIREBASE_ANALYTICS_COLLECTION_ENABLED`), so nothing is sent before this decides; the choice is set on every launch,
  /// so a build that stops collecting stops at once.
  @MainActor private static func startTelemetry(_ config: AglynConfig) {
    let collecting = collects(config)
    Crashlytics.crashlytics().setCrashlyticsCollectionEnabled(collecting)
    Analytics.setAnalyticsCollectionEnabled(collecting)
    if !collecting { Crashlytics.crashlytics().deleteUnsentReports() }
    Telemetry.start(collecting: collecting, sink: FirebaseTelemetrySink(), app: config.app)
  }

  private static func split(_ hostPort: String) -> (String, Int)? {
    guard let colon = hostPort.lastIndex(of: ":"), let port = Int(hostPort[hostPort.index(after: colon)...])
    else { return nil }
    return (String(hostPort[..<colon]), port)
  }
}

/// Firebase App Check's provider for this device: App Attest on iPhone and iPad, DeviceCheck on a Mac
/// (App Attest is not offered there). Firebase's providers keep the attested key and its artifact,
/// re-attest after `DCError.invalidKey`, cache the token for its lifetime, refresh it before it lapses
/// and share one exchange among concurrent callers.
final class AglynAppCheckProviderFactory: NSObject, AppCheckProviderFactory {
  func createProvider(with app: FirebaseApp) -> AppCheckProvider? {
    let attestation = AppCheckAttestation.choose(
      appAttestSupported: DCAppAttestService.shared.isSupported, deviceCheckSupported: DCDevice.current.isSupported)
    switch attestation {
    case .appAttest: return AppAttestProvider(app: app)
    case .deviceCheck: return DeviceCheckProvider(app: app)
    case nil:
      print("Aglyn: this device offers neither App Attest nor DeviceCheck, so Firebase App Check sends no token.")
      return nil
    }
  }
}

/// Firebase App Check's current token, for the REST clients.
struct FirebaseAppCheckTokens: AppCheckTokenProvider {
  func token(forceRefresh: Bool) async throws -> String? {
    guard let app = FirebaseApp.app(), let appCheck = AppCheck.appCheck(app: app) else { return nil }
    return try await appCheck.token(forcingRefresh: forceRefresh).token
  }
}

/// The Firebase SDK's Firestore behind the `FirestoreReader` interface.
public final class FirebaseFirestoreReader: FirestoreReader, @unchecked Sendable {
  private let db: Firestore

  public init(_ db: Firestore = Firestore.firestore()) {
    self.db = db
  }

  private final class Registration: FirestoreListening {
    let handle: ListenerRegistration
    let keeper: SeedConfirmationKeeper?
    init(_ handle: ListenerRegistration, keeper: SeedConfirmationKeeper? = nil) {
      self.handle = handle
      self.keeper = keeper
    }
    func remove() {
      handle.remove()
      guard let keeper else { return }
      Task { @MainActor in keeper.reset() }
    }
  }

  private func collection(_ path: [String]) -> CollectionReference {
    db.collection(path.joined(separator: "/"))
  }

  static func plain(_ value: Any) -> Any {
    switch value {
    case let timestamp as Timestamp: return timestamp.dateValue()
    case let array as [Any]: return array.map(plain)
    case let map as [String: Any]: return map.mapValues(plain)
    case let reference as DocumentReference: return reference.path
    default: return value
    }
  }

  /// A document as its listener reports it: `fromCache` is the keep's, not the snapshot's (AGL-4047).
  private static func document(_ snapshot: DocumentSnapshot, fromCache: Bool) -> FirestoreDocument {
    FirestoreDocument(
      id: snapshot.documentID,
      data: (snapshot.data(with: .estimate) ?? [:]).mapValues(plain),
      fromCache: fromCache)
  }

  private static func cached(_ document: FirestoreDocument) -> FirestoreDocument {
    FirestoreDocument(id: document.id, data: document.data, fromCache: true)
  }

  private func built(_ query: FirestoreQuery) -> Query {
    var built: Query =
      query.collectionGroup ? db.collectionGroup(query.collection.last ?? "") : collection(query.collection)
    for constraint in query.allFilters { built = constraint.apply(to: built) }
    for order in query.order { built = built.order(by: fieldPath(order.field), descending: order.descending) }
    if let limit = query.limit { built = built.limit(to: limit) }
    return built
  }

  public func count(_ query: FirestoreQuery) async throws -> Int? {
    do {
      let snapshot = try await built(query.wholeMatch).count.getAggregation(source: .server)
      return snapshot.count.intValue
    } catch {
      Telemetry.record(error, Telemetry.firestoreContext("count", query.collection))
      throw error
    }
  }

  public func sum(_ query: FirestoreQuery, field: String) async throws -> Double? {
    let total = AggregateField.sum(field)
    do {
      let snapshot = try await built(query.wholeMatch).aggregate([total]).getAggregation(source: .server)
      return (snapshot.get(total) as? NSNumber)?.doubleValue
    } catch {
      Telemetry.record(error, Telemetry.firestoreContext("sum", query.collection))
      throw error
    }
  }

  @MainActor
  public func listen(
    _ query: FirestoreQuery,
    _ onChange: @escaping @MainActor (Result<[FirestoreDocument], Error>) -> Void
  ) -> FirestoreListening {
    // A confirmation is kept through a short fall back to the cache (AGL-4047); on its lapse the last rows are
    // delivered again as the cache's.
    let keeper = SeedConfirmationKeeper()
    var last: [FirestoreDocument] = []
    keeper.onLapse = { onChange(.success(last.map(Self.cached))) }
    let handle = built(query).addSnapshotListener(includeMetadataChanges: query.includeMetadataChanges) { snapshot, error in
      MainActor.assumeIsolated {
        guard let snapshot else {
          let error = error ?? URLError(.unknown)
          Telemetry.record(error, Telemetry.firestoreContext("listen", query.collection))
          keeper.reset()
          onChange(.failure(error))
          return
        }
        let fromCache = keeper.report(fromCache: snapshot.metadata.isFromCache)
        last = snapshot.documents.map { Self.document($0, fromCache: fromCache) }
        onChange(.success(last))
      }
    }
    return Registration(handle, keeper: keeper)
  }

  @MainActor
  public func listenAnswer(
    _ query: FirestoreQuery,
    _ onChange: @escaping @MainActor (Result<FirestoreAnswer<[FirestoreDocument]>, Error>) -> Void
  ) -> FirestoreListening {
    let keeper = SeedConfirmationKeeper()
    var last: [FirestoreDocument] = []
    keeper.onLapse = { onChange(.success(FirestoreAnswer(last.map(Self.cached), fromCache: true))) }
    let handle = built(query).addSnapshotListener(includeMetadataChanges: query.includeMetadataChanges) { snapshot, error in
      MainActor.assumeIsolated {
        guard let snapshot else {
          let error = error ?? URLError(.unknown)
          Telemetry.record(error, Telemetry.firestoreContext("listen", query.collection))
          keeper.reset()
          onChange(.failure(error))
          return
        }
        // Kept through a short fall back to the cache (AGL-4047).
        let fromCache = keeper.report(fromCache: snapshot.metadata.isFromCache)
        last = snapshot.documents.map { Self.document($0, fromCache: fromCache) }
        onChange(.success(FirestoreAnswer(last, fromCache: fromCache)))
      }
    }
    return Registration(handle, keeper: keeper)
  }

  @MainActor
  public func listenDocumentAnswer(
    _ path: [String],
    _ onChange: @escaping @MainActor (Result<FirestoreAnswer<FirestoreDocument?>, Error>) -> Void
  ) -> FirestoreListening {
    let keeper = SeedConfirmationKeeper()
    var last: FirestoreDocument?
    keeper.onLapse = { onChange(.success(FirestoreAnswer(last.map(Self.cached), fromCache: true))) }
    let handle = db.document(path.joined(separator: "/")).addSnapshotListener(includeMetadataChanges: true) {
      snapshot, error in
      MainActor.assumeIsolated {
        guard let snapshot else {
          let error = error ?? URLError(.unknown)
          Telemetry.record(error, Telemetry.firestoreContext("listen_document", path))
          keeper.reset()
          onChange(.failure(error))
          return
        }
        // Kept through a short fall back to the cache (AGL-4047).
        let fromCache = keeper.report(fromCache: snapshot.metadata.isFromCache)
        last = snapshot.exists ? Self.document(snapshot, fromCache: fromCache) : nil
        onChange(.success(FirestoreAnswer(last, fromCache: fromCache)))
      }
    }
    return Registration(handle, keeper: keeper)
  }

  @MainActor
  public func listenDocument(
    _ path: [String],
    _ onChange: @escaping @MainActor (Result<FirestoreDocument?, Error>) -> Void
  ) -> FirestoreListening {
    // Metadata changes too, so a cached answer the server then confirms reaches
    // the screen with `fromCache` false (an editor's stale-seed guard reads it).
    // A confirmation is kept through a short fall back to the cache (AGL-4047).
    let keeper = SeedConfirmationKeeper()
    var last: FirestoreDocument?
    keeper.onLapse = { onChange(.success(last.map(Self.cached))) }
    let handle = db.document(path.joined(separator: "/")).addSnapshotListener(includeMetadataChanges: true) {
      snapshot, error in
      MainActor.assumeIsolated {
        guard let snapshot else {
          let error = error ?? URLError(.unknown)
          Telemetry.record(error, Telemetry.firestoreContext("listen_document", path))
          keeper.reset()
          onChange(.failure(error))
          return
        }
        let fromCache = keeper.report(fromCache: snapshot.metadata.isFromCache)
        last = snapshot.exists ? Self.document(snapshot, fromCache: fromCache) : nil
        onChange(.success(last))
      }
    }
    return Registration(handle, keeper: keeper)
  }

  private static func writable(_ value: Any) -> Any {
    switch value {
    case FirestoreSentinel.serverTimestamp: return FieldValue.serverTimestamp()
    case FirestoreSentinel.delete: return FieldValue.delete()
    case let map as [String: Any]: return map.mapValues(writable)
    default: return value
    }
  }

  public func setDocument(_ path: [String], _ fields: [String: Any], merge: Bool) async throws {
    try await recorded("set", path) {
      try await db.document(path.joined(separator: "/")).setData(fields.mapValues(Self.writable), merge: merge)
    }
  }

  public func deleteDocument(_ path: [String]) async throws {
    try await recorded("delete", path) { try await db.document(path.joined(separator: "/")).delete() }
  }

  public func updateDocument(_ path: [String], _ fields: [String: Any]) async throws {
    try await recorded("update", path) {
      try await db.document(path.joined(separator: "/")).updateData(fields.mapValues(Self.writable))
    }
  }

  /// Runs a write, telling Telemetry when it fails (the caller still shows its own "could not save").
  private func recorded(_ operation: String, _ path: [String], _ write: () async throws -> Void) async throws {
    do { try await write() } catch {
      Telemetry.record(error, Telemetry.firestoreContext(operation, path))
      throw error
    }
  }
}

/// Telemetry's Firebase end: Crashlytics for errors, breadcrumbs, the uid and custom keys; Analytics for events. Both SDKs
/// are thread-safe. Only `Telemetry` calls it, and only once collection is on.
final class FirebaseTelemetrySink: TelemetrySink, @unchecked Sendable {
  func record(_ error: Error, context: String) {
    Crashlytics.crashlytics().record(error: error, userInfo: ["context": context])
  }

  func breadcrumb(_ message: String) {
    Crashlytics.crashlytics().log(message)
  }

  func setUser(_ uid: String?) {
    Crashlytics.crashlytics().setUserID(uid ?? "")
    Analytics.setUserID(uid)
  }

  func setValue(_ value: String, forKey key: String) {
    Crashlytics.crashlytics().setCustomValue(value, forKey: key)
  }

  func log(_ event: String, parameters: [String: String]) {
    Analytics.logEvent(event, parameters: parameters.isEmpty ? nil : parameters)
  }
}
