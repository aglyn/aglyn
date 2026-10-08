// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import Foundation
import Observation

/// A live Firestore query as a screen holds one: the rows (nil until the
/// first answer), whether the last answer failed, and whether the rows came
/// from the device's cache rather than the server.
@MainActor
@Observable
public final class LiveQuery {
  public private(set) var docs: [FirestoreDocument]?
  public private(set) var failed = false
  /// The answer on screen is the cache's, unconfirmed by the server.
  public private(set) var fromCache = false
  @ObservationIgnored private var listener: FirestoreListening?
  @ObservationIgnored public private(set) var query: FirestoreQuery?

  public init() {}

  /// Starts (or restarts) the listener; a nil query clears the rows.
  public func start(_ reader: FirestoreReader, _ query: FirestoreQuery?) {
    listener?.remove()
    listener = nil
    self.query = query
    guard let query else {
      docs = nil
      return
    }
    failed = false
    listener = reader.listen(query) { [weak self] result in
      guard let self else { return }
      switch result {
      case .success(let docs):
        self.docs = docs
        self.failed = false
        self.fromCache = docs.contains(where: \.fromCache)
      case .failure:
        self.failed = true
        if self.docs == nil { self.docs = [] }
      }
    }
  }

  public func stop() {
    listener?.remove()
    listener = nil
  }
}

/// A live Firestore document: nil until it is read, and `loaded` once the
/// first answer (even "missing") arrived.
@MainActor
@Observable
public final class LiveDoc {
  public private(set) var doc: FirestoreDocument?
  public private(set) var loaded = false
  public private(set) var failed = false
  @ObservationIgnored private var listener: FirestoreListening?

  public init() {}

  public func start(_ reader: FirestoreReader, _ path: [String]) {
    listener?.remove()
    listener = reader.listenDocument(path) { [weak self] result in
      guard let self else { return }
      switch result {
      case .success(let doc):
        self.doc = doc
        self.failed = false
      case .failure:
        self.failed = true
      }
      self.loaded = true
    }
  }

  public func stop() {
    listener?.remove()
    listener = nil
  }
}

/// Why an editor must not write a document seeded from an unconfirmed or
/// unread snapshot, in the console's words (`writeGuardedBySeed`), or nil
/// when the seed is safe to write over. `subject` names it: "workflow".
public func seedWriteRefusal(subject: String, unreadable: Bool, fromCache: Bool) -> String? {
  if fromCache {
    return "We could not confirm your \(subject) with the server, so what is on screen may be out of date — "
      + "saving now could overwrite newer values. Check your connection and reload."
  }
  if unreadable {
    return "Your \(subject) could not be loaded, so there is nothing safe to save — saving now would "
      + "overwrite the stored copy with blanks. Reload and try again."
  }
  return nil
}
