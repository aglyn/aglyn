// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import Foundation

/// POS peripherals (docs/mobile/native-architecture.md §10): receipt
/// printers over ESC/POS, the cash drawer kicked through the printer, and
/// HID barcode scanners read as keyboard input.
public enum AglynHardware {
  /// `ESC p m t1 t2`: pulse the drawer kick connector (pin 2, 50 ms on, 500 ms off).
  public static let cashDrawerKick: [UInt8] = [0x1B, 0x70, 0x00, 0x19, 0xFA]
}

/// Tells a burst of keystrokes from a scanner apart from typing: a scanner
/// sends a whole code faster than a person can, then Return.
public struct HIDScanDetector: Sendable {
  /// The longest gap between two scanner keystrokes.
  public var maxGap: TimeInterval = 0.05
  /// The shortest code a scan can be.
  public var minLength = 4
  private var buffer = ""
  private var last: TimeInterval?

  public init(maxGap: TimeInterval = 0.05, minLength: Int = 4) {
    self.maxGap = maxGap
    self.minLength = minLength
  }

  /// Feeds one keystroke; returns a code when Return ends a fast burst.
  public mutating func feed(_ character: Character, at time: TimeInterval) -> String? {
    defer { last = time }
    if let last, time - last > maxGap { buffer = "" }
    if character == "\r" || character == "\n" {
      let code = buffer
      buffer = ""
      return code.count >= minLength ? code : nil
    }
    buffer.append(character)
    return nil
  }
}
