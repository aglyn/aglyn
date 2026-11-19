// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynCore
import AglynPluginHost
import AglynUI
import SwiftUI

/// The one-time product-updates ask for an account that never answered (the console's `PlatformMarketingConsentPrompt`,
/// AGL-3185): shown on the Sites list when `/api/auth/marketing-consent` says it is due. Yes, No thanks, or the close (asked
/// again later); nothing once answered.
struct ProductUpdatesAsk: View {
  let context: NativePluginContext
  @State private var due = false
  @State private var busy: String?
  @State private var toast: AglynToast?

  private var brand: String { AglynConfig.defaultBrandName }

  var body: some View {
    // A stack, not a Group: a Group with nothing in it has no view to run `.task` on, so the status was never read.
    VStack(spacing: 0) {
      if due {
        VStack(alignment: .leading, spacing: AglynSpace.one) {
          HStack(alignment: .top) {
            Text("Want product updates from \(brand)?").font(AglynFont.headline)
            Spacer(minLength: AglynSpace.one)
            Button { answer("dismissed") } label: { Image(systemName: "xmark") }
              .buttonStyle(.borderless)
              .disabled(busy != nil)
              .accessibilityLabel("Not now")
              .accessibilityIdentifier("product-updates-not-now")
          }
          Text(MarketingConsent.text(brand: brand)).font(AglynFont.subheadline)
          HStack(spacing: AglynSpace.one) {
            Button(busy == "granted" ? "Saving…" : "Yes, send them") { answer("granted") }
              .buttonStyle(.aglynProminent)
              .disabled(busy != nil)
              .accessibilityIdentifier("product-updates-yes")
            Button(busy == "declined" ? "Saving…" : "No thanks") { answer("declined") }
              .buttonStyle(.borderless)
              .disabled(busy != nil)
              .accessibilityIdentifier("product-updates-no")
          }
        }
        .padding(AglynSpace.oneAndHalf)
        .background(AglynTone.info.color.opacity(0.12), in: RoundedRectangle(cornerRadius: AglynRadius.control, style: .continuous))
        .padding(.horizontal, AglynContentInsets.horizontal)
        .padding(.bottom, AglynSpace.one)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("product-updates-ask")
      }
    }
    .aglynToast($toast)
    .task(id: context.uid) {
      let status: JSONValue? = (try? await context.api.request("/api/auth/marketing-consent")) ?? nil
      due = status?["promptDue"]?.boolValue == true
    }
  }

  private func answer(_ decision: String) {
    busy = decision
    Task {
      let saved = (try? await context.api.request(
        "/api/auth/marketing-consent", method: .post,
        body: .object([
          "decision": .string(decision), "source": "console-prompt", "textVersion": .string(MarketingConsent.textVersion),
        ]))) != nil
      busy = nil
      guard saved else {
        toast = AglynToast("Your choice could not be saved. Please try again.", tone: .warning)
        return
      }
      due = false
      if decision == "granted" { toast = AglynToast("You will hear about product updates from \(brand).", tone: .success) }
      if decision == "declined" { toast = AglynToast("Noted — no product updates.", tone: .info) }
    }
  }
}
