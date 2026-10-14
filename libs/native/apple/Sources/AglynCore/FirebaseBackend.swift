// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import FirebaseAuth
import FirebaseCore
import FirebaseFirestore
import Foundation

/// Configures the Firebase SDKs in code from an `AglynConfig`: there is no
/// `GoogleService-Info.plist`, which is also how a self-hosted build is set up.
public enum AglynFirebase {
  @MainActor private static var configured = false

  @MainActor
  public static func configure(_ config: AglynConfig) {
    AglynBrand.name = config.brandName
    guard !configured else { return }
    configured = true
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
    var built: Query = collection(query.collection)
    for constraint in query.allFilters { built = constraint.apply(to: built) }
    for order in query.order { built = built.order(by: fieldPath(order.field), descending: order.descending) }
    if let limit = query.limit { built = built.limit(to: limit) }
    return built
  }

  public func count(_ query: FirestoreQuery) async throws -> Int? {
    let snapshot = try await built(query).count.getAggregation(source: .server)
    return snapshot.count.intValue
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
