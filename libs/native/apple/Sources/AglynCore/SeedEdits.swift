// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import Foundation

// A SAVE IS NEVER PRESSED ON THE CACHE'S COPY, AND NEVER REFUSED FOR IT (AGL-4047): the console's `isSeedChecking`,
// `seedCheckingText` and `rebaseSeedEdits`. A form seeded from a read only the device cache has answered holds its Save,
// with the reason beside it, until the server's copy is in; and when a newer copy arrives, what the person changed keeps
// their value while everything they left alone follows the new copy. The Kotlin kit's SeedEdits.kt.

/// What a held Save says beside it, for the guard's subject ("site settings", "entry").
public func seedCheckingText(_ subject: String) -> String { "Checking your \(subject) with the server…" }

/// One value over a seed that moved from `previous` to `next`: kept when the person changed it, else the new seed.
public func rebased<T: Equatable>(_ current: T, previous: T?, next: T) -> T {
  guard let previous else { return next }
  return current == previous ? next : current
}

/// A form's values over a seed that moved from `previous` to `next`, key by key (`rebaseSeedEdits`): a key the person
/// changed (or cleared) keeps what they made it, every other key follows the new seed.
public func rebased<V: Equatable>(_ current: [String: V], previous: [String: V], next: [String: V]) -> [String: V] {
  var out: [String: V] = [:]
  for key in Set(next.keys).union(current.keys).union(previous.keys) {
    let edited = current[key] != previous[key]
    if let value = edited ? current[key] : next[key] { out[key] = value }
  }
  return out
}

/// A draft laid over a stored copy that moved from `previous` to `next`, field by field: `rebased(draft, previous:, next:)
/// { $0.field(\.name); $0.field(\.price) }`. Every field the person changed keeps its value; every other one follows `next`.
public struct Rebaser<T> {
  public private(set) var out: T
  let draft: T
  let previous: T

  public init(_ draft: T, previous: T, next: T) {
    self.draft = draft
    self.previous = previous
    out = next
  }

  public mutating func field<V: Equatable>(_ path: WritableKeyPath<T, V>) {
    out[keyPath: path] = rebased(draft[keyPath: path], previous: previous[keyPath: path], next: out[keyPath: path])
  }
}

public func rebased<T>(_ draft: T, previous: T, next: T, fields: (inout Rebaser<T>) -> Void) -> T {
  var rebaser = Rebaser(draft, previous: previous, next: next)
  fields(&rebaser)
  return rebaser.out
}
