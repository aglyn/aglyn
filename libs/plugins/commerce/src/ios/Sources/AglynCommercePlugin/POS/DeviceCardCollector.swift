// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynHardware
import Foundation

/// This device's own card reader, when it has one: the Stripe Terminal SDK
/// on iPhone and iPad (Tap to Pay on iPhone and Bluetooth readers), nothing
/// on the Mac, whose register takes cards on smart readers only.
@MainActor
enum DeviceCardCollector {
  static func make() -> CardCollector? {
    #if os(iOS)
      return StripeTerminalCollector.shared
    #else
      return nil
    #endif
  }

  static func title(_ kind: CardCollectorKind) -> String {
    switch kind {
    case .tapToPay: "Tap to Pay on iPhone"
    case .bluetooth: "Bluetooth reader"
    case .simulated: "Simulated reader"
    }
  }

  static func detail(_ kind: CardCollectorKind) -> String {
    switch kind {
    case .tapToPay: "Customers tap their card or phone on this device."
    case .bluetooth: "A Stripe M2 or WisePad 3 paired with this device."
    case .simulated: "Test payments with no card, for training."
    }
  }
}
