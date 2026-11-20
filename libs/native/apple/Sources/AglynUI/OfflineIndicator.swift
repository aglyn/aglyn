// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import SwiftUI

#if os(iOS)
  import UIKit
#endif

/// The connection indicator in the title bar (the console's `OfflineIndicator`, AGL-1056): nothing at all while online, and an
/// "Offline" warning pill while the device has no network. Its arrival is read out, as the console's live region is.
public struct AglynOfflineIndicator: View {
  let online: Bool
  let detail: String

  public init(online: Bool, detail: String) {
    self.online = online
    self.detail = detail
  }

  public var body: some View {
    Group {
      if !online {
        HStack(spacing: 4) {
          Image(systemName: "wifi.slash").font(.system(size: 11, weight: .semibold)).accessibilityHidden(true)
          Text("Offline").font(AglynFont.caption.weight(.semibold))
        }
        .foregroundStyle(AglynTone.warning.color)
        .padding(.horizontal, 8)
        .padding(.vertical, 3)
        .overlay(Capsule().strokeBorder(AglynTone.warning.color.opacity(0.6)))
        .fixedSize()
        .help(detail)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Offline")
        .accessibilityHint(detail)
        .accessibilityIdentifier("offline-indicator")
      }
    }
    .onChange(of: online) { _, now in
      #if os(iOS)
        if !now { UIAccessibility.post(notification: .announcement, argument: "Offline. \(detail)") }
      #endif
    }
  }
}
