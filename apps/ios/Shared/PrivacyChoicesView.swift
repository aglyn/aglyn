// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import AglynCore
import AglynUI
import SwiftUI

/// "Your Privacy Choices" (Console chrome row 3; the owner's decision of 2026-11-19): the console's panel of the same
/// title, as one switch for this app's analytics, kept on this device and applied the moment it moves
/// (`PrivacyChoices`). Every word is the contracts' (`privacy-choices.ts`), so the title stays the regulated one.
struct PrivacyChoicesView: View {
  @Environment(\.dismiss) private var dismiss
  @State private var analytics = PrivacyChoices.analyticsAllowed()

  /// The menu row's symbol: the console draws a settings mark beside these words.
  static let systemImage = "hand.raised"

  var body: some View {
    let words = ContractValues.shared
    NavigationStack {
      AglynGroupedForm {
        Section {
          Text("\(words.nativePrivacyChoicesIntro) \(words.nativePrivacyChoicesStrictlyNecessary)")
            .font(AglynFont.subheadline)
            .foregroundStyle(.secondary)
        }
        Section {
          Toggle(isOn: Binding(get: { analytics }, set: { allowed in
            analytics = allowed
            PrivacyChoices.setAnalytics(allowed)
          })) {
            VStack(alignment: .leading, spacing: 2) {
              Text(words.nativePrivacyChoicesAnalyticsLabel)
              Text(words.nativePrivacyChoicesAnalyticsDetail)
                .font(AglynFont.caption)
                .foregroundStyle(.secondary)
            }
          }
          .accessibilityIdentifier("privacy-choices-analytics")
        }
      }
      .navigationTitle(words.consentOptOutTitle)
      #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
      #endif
      .toolbar {
        ToolbarItem(placement: .confirmationAction) {
          Button("Done") { dismiss() }
            .accessibilityIdentifier("privacy-choices-done")
        }
      }
    }
    #if os(macOS)
      .frame(minWidth: 420, minHeight: 260)
    #endif
  }
}
