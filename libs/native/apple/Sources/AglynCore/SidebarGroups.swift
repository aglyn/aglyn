// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import Foundation

/// Which sidebar groups are open, as the person left them (AGL-3996): a group they open stays open and one they fold
/// stays folded, across places and launches. Opening a place never folds another group; it only opens its own group
/// when that one is folded, so the row in use is never hidden. No accordion.
///
/// Each group is keyed by its scope and id (`site.sell`, `workspace.more`; a key per site is fine too). A group is
/// open at rest when `openAtRest` (Starred) and folded at rest otherwise (Website, Sell, Customers, More); the person's
/// choice, once made, wins either way. The console keeps no such state, so it is the device's own.
public struct AglynSidebarGroups: Equatable, Sendable {
  /// Keys the person opened.
  public private(set) var opened: Set<String>
  /// Keys the person folded.
  public private(set) var folded: Set<String>

  public init(opened: Set<String> = [], folded: Set<String> = []) {
    self.opened = opened
    self.folded = folded.subtracting(opened)
  }

  /// Whether the group under `key` is open.
  public func isOpen(_ key: String, openAtRest: Bool = false) -> Bool {
    if opened.contains(key) { return true }
    if folded.contains(key) { return false }
    return openAtRest
  }

  /// The person folds an open group or opens a folded one.
  public mutating func toggle(_ key: String, openAtRest: Bool = false) {
    set(key, open: !isOpen(key, openAtRest: openAtRest))
  }

  /// Opens or folds the group under `key`, remembered.
  public mutating func set(_ key: String, open: Bool) {
    if open {
      folded.remove(key)
      opened.insert(key)
    } else {
      opened.remove(key)
      folded.insert(key)
    }
  }

  /// A place in the group under `key` was opened: the group opens if it is folded, and nothing else changes.
  public mutating func reveal(_ key: String, openAtRest: Bool = false) {
    if !isOpen(key, openAtRest: openAtRest) { set(key, open: true) }
  }

  // MARK: Stored on the device

  /// The stored form: each opened key, and each folded key with `.folded` after it (the form the earlier builds kept
  /// for Starred, so a Starred group someone folded stays folded).
  public var stored: [String] { opened.sorted() + folded.sorted().map { $0 + Self.foldedSuffix } }

  public init(stored: [String]) {
    var opened: Set<String> = []
    var folded: Set<String> = []
    for entry in stored {
      if entry.hasSuffix(Self.foldedSuffix) {
        folded.insert(String(entry.dropLast(Self.foldedSuffix.count)))
      } else {
        opened.insert(entry)
      }
    }
    self.init(opened: opened, folded: folded)
  }

  static let foldedSuffix = ".folded"
}
