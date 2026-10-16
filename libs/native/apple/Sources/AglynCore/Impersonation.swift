// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import Foundation

/// A support session: a staff member signed in as a customer, through `/api/admin/impersonate`. The customer's session is
/// held in memory only and never reaches the Keychain, and the staff member's own session is set aside untouched and returns
/// when the support session ends, so quitting the app ends it too.
public struct Impersonation: Equatable, Sendable {
  /// The customer the staff member is signed in as.
  public let customer: AglynUser
  /// The staff member, for the banner and the audit trail that names them.
  public let staffEmail: String?

  public init(customer: AglynUser, staffEmail: String?) {
    self.customer = customer
    self.staffEmail = staffEmail
  }

  /// The banner's words, the console's (`ImpersonationBanner`): who the session is, who opened it, and that it is audited.
  public var banner: String {
    "You are impersonating \(customer.email ?? "this account") (staff: \(staffEmail ?? "unknown")). Actions are audited."
  }
}

/// Whether a support session is on, readable from anywhere (a Firestore read is not on the main actor).
public final class ImpersonationFlag: @unchecked Sendable {
  private let lock = NSLock()
  private var on = false

  public init() {}

  public var isOn: Bool { lock.withLock { on } }
  func set(_ value: Bool) { lock.withLock { on = value } }
}

/// The Firestore reader a signed-in person reads with, and the one a support session reads with: the SDK's reader is bound to
/// the staff member's own sign-in, so while a support session is on every read and write goes through the customer's token
/// instead, and the rules treat the staff member exactly as they treat the customer.
public final class SwitchingFirestoreReader: FirestoreReader, @unchecked Sendable {
  private let normal: FirestoreReader
  private let impersonated: FirestoreReader
  private let flag: ImpersonationFlag

  public init(normal: FirestoreReader, impersonated: FirestoreReader, flag: ImpersonationFlag) {
    self.normal = normal
    self.impersonated = impersonated
    self.flag = flag
  }

  private var active: FirestoreReader { flag.isOn ? impersonated : normal }

  @MainActor
  public func listen(
    _ query: FirestoreQuery,
    _ onChange: @escaping @MainActor (Result<[FirestoreDocument], Error>) -> Void
  ) -> FirestoreListening {
    active.listen(query, onChange)
  }

  @MainActor
  public func listenDocument(
    _ path: [String],
    _ onChange: @escaping @MainActor (Result<FirestoreDocument?, Error>) -> Void
  ) -> FirestoreListening {
    active.listenDocument(path, onChange)
  }

  public func setDocument(_ path: [String], _ fields: [String: Any], merge: Bool) async throws {
    try await active.setDocument(path, fields, merge: merge)
  }

  public func deleteDocument(_ path: [String]) async throws {
    try await active.deleteDocument(path)
  }

  public func updateDocument(_ path: [String], _ fields: [String: Any]) async throws {
    try await active.updateDocument(path, fields)
  }

  public func count(_ query: FirestoreQuery) async throws -> Int? {
    try await active.count(query)
  }

  public func sum(_ query: FirestoreQuery, field: String) async throws -> Double? {
    try await active.sum(query, field: field)
  }
}

extension TokenClaims {
  /// The staff account that opened this session as someone else (`impersonatedBy`); nil for an ordinary session.
  public var impersonatedBy: String? { values["impersonatedBy"]?.stringValue }
  public var impersonatedByEmail: String? { values["impersonatedByEmail"]?.stringValue }
}
