// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynCore
import AglynUI
import SwiftUI

/// What a signed-in person who is not staff sees while the platform is locked (the console's `PlatformLockdownGate`):
/// the lock's title and message, when it is expected back, who to ask, and Sign out.
struct LockdownGateView: View {
  let notice: PlatformLockdownNotice
  let signOut: () -> Void

  var body: some View {
    VStack(spacing: AglynSpace.two) {
      Text(notice.title).font(AglynFont.title2).multilineTextAlignment(.center)
      Text(notice.message).font(AglynFont.body).foregroundStyle(AglynColor.secondaryText)
        .multilineTextAlignment(.center)
      if let until = notice.until {
        Text(until).font(AglynFont.subheadline).foregroundStyle(AglynColor.secondaryText)
      }
      if let contact = notice.contact, let mail = URL(string: "mailto:\(contact)") {
        HStack(spacing: 4) {
          Text("Questions?")
          Link(contact, destination: mail)
        }
        .font(AglynFont.subheadline)
        .foregroundStyle(AglynColor.secondaryText)
      }
      Button("Sign out", action: signOut)
        .buttonStyle(.bordered)
        .accessibilityIdentifier("lockdown-sign-out")
    }
    .frame(maxWidth: 480)
    .padding(.horizontal, AglynSpace.three)
    .frame(maxWidth: .infinity, maxHeight: .infinity)
    .background(AglynColor.page)
    .accessibilityIdentifier("lockdown-gate")
  }
}
