// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import Foundation

/// Turns a camera's stream of barcode reads into scans (Android's `CameraScanFilter`). A camera reads the same barcode
/// again and again while it stays in view, so a code counts once and counts again only after it has been out of view
/// for `repeatAfter` (the cashier scanning a second of the same item). Codes outside the length a product barcode or
/// SKU can have are noise.
public struct CameraScanFilter: Sendable {
  public let repeatAfter: TimeInterval
  public let minLength: Int
  public let maxLength: Int
  private var lastCode: String?
  private var lastSeen: TimeInterval = 0

  public init(repeatAfter: TimeInterval = 1.5, minLength: Int = 4, maxLength: Int = 64) {
    self.repeatAfter = repeatAfter
    self.minLength = minLength
    self.maxLength = maxLength
  }

  /// The code to act on, or nil when `raw` is noise or the same barcode still in view.
  public mutating func accept(_ raw: String?, at time: TimeInterval) -> String? {
    guard let code = raw?.trimmingCharacters(in: .whitespacesAndNewlines),
      (minLength...maxLength).contains(code.count),
      !code.unicodeScalars.contains(where: { CharacterSet.controlCharacters.contains($0) })
    else { return nil }
    let repeated = code == lastCode && time - lastSeen < repeatAfter
    lastCode = code
    lastSeen = time
    return repeated ? nil : code
  }

  public mutating func reset() { lastCode = nil }
}

extension HIDScanDetector {
  /// Feeds what a text field gained since it last changed (a scanner types into the focused field, one or several
  /// characters per change). Anything but text added at the end is a person editing, and starts the detector over.
  public mutating func feedEdit(from old: String, to new: String, at time: TimeInterval) {
    guard new.count > old.count, new.hasPrefix(old) else {
      self = HIDScanDetector(maxGap: maxGap, minLength: minLength)
      return
    }
    for character in new.dropFirst(old.count) { _ = feed(character, at: time) }
  }
}
