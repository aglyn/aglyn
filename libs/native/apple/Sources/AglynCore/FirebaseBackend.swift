// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import DeviceCheck
import FirebaseAppCheck
import FirebaseAuth
import FirebaseCore
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
    init(_ handle: ListenerRegistration) { self.handle = handle }
    func remove() { handle.remove() }
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

  private static func document(_ snapshot: DocumentSnapshot) -> FirestoreDocument {
    FirestoreDocument(
      id: snapshot.documentID,
      data: (snapshot.data(with: .estimate) ?? [:]).mapValues(plain),
      fromCache: snapshot.metadata.isFromCache)
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
    let snapshot = try await built(query).count.getAggregation(source: .server)
    return snapshot.count.intValue
  }

  public func sum(_ query: FirestoreQuery, field: String) async throws -> Double? {
    let total = AggregateField.sum(field)
    var whole = query
    whole.limit = nil
    let snapshot = try await built(whole).aggregate([total]).getAggregation(source: .server)
    return (snapshot.get(total) as? NSNumber)?.doubleValue
  }

  @MainActor
  public func listen(
    _ query: FirestoreQuery,
    _ onChange: @escaping @MainActor (Result<[FirestoreDocument], Error>) -> Void
  ) -> FirestoreListening {
    let handle = built(query).addSnapshotListener(includeMetadataChanges: query.includeMetadataChanges) { snapshot, error in
      let result: Result<[FirestoreDocument], Error> =
        if let snapshot { .success(snapshot.documents.map(Self.document)) }
        else { .failure(error ?? URLError(.unknown)) }
      MainActor.assumeIsolated { onChange(result) }
    }
    return Registration(handle)
  }

  @MainActor
  public func listenDocument(
    _ path: [String],
    _ onChange: @escaping @MainActor (Result<FirestoreDocument?, Error>) -> Void
  ) -> FirestoreListening {
    // Metadata changes too, so a cached answer the server then confirms reaches
    // the screen with `fromCache` false (an editor's stale-seed guard reads it).
    let handle = db.document(path.joined(separator: "/")).addSnapshotListener(includeMetadataChanges: true) {
      snapshot, error in
      let result: Result<FirestoreDocument?, Error> =
        if let snapshot { .success(snapshot.exists ? Self.document(snapshot) : nil) }
        else { .failure(error ?? URLError(.unknown)) }
      MainActor.assumeIsolated { onChange(result) }
    }
    return Registration(handle)
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
    try await db.document(path.joined(separator: "/")).setData(
      fields.mapValues(Self.writable), merge: merge)
  }

  public func deleteDocument(_ path: [String]) async throws {
    try await db.document(path.joined(separator: "/")).delete()
  }

  public func updateDocument(_ path: [String], _ fields: [String: Any]) async throws {
    try await db.document(path.joined(separator: "/")).updateData(fields.mapValues(Self.writable))
  }
}
