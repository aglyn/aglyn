// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import SwiftUI

/// What a store build says where it leaves a buying control out (the owner's decision of 2026-11-19). The shell sets it
/// once from AglynCore's `StoreBilling` (`AppModel.storeBilling`); every screen reads it, so a view in this kit, which
/// knows nothing of the build, can ask whether to draw a control that takes or starts a payment to Aglyn.
public struct AglynStoreBilling: Equatable, Sendable {
  /// Whether this build may take or start a payment to Aglyn.
  public var buying: Bool
  /// The workspace's billing page on the console, where the store allows a link (the United States storefront); nil
  /// everywhere else, and the line says `note` instead.
  public var link: URL?
  public var linkLabel: String
  public var note: String

  public init(buying: Bool, link: URL?, linkLabel: String, note: String) {
    self.buying = buying
    self.link = link
    self.linkLabel = linkLabel
    self.note = note
  }

  /// Before the shell has said: a store build's answer, so nothing that charges is drawn by mistake.
  public static let unset = AglynStoreBilling(buying: false, link: nil, linkLabel: "", note: "")
}

extension EnvironmentValues {
  @Entry public var aglynStoreBilling = AglynStoreBilling.unset
}

/// The one quiet line a store build shows in place of the buying controls it leaves out, once per screen: "Manage
/// billing on the web", opening the workspace's billing page in the device's browser (never the in-app browser), where
/// a link is allowed; otherwise the plain sentence, which names no address and no other place to buy. Draws nothing in
/// a build that may buy.
public struct AglynStoreBillingLine: View {
  @Environment(\.aglynStoreBilling) private var billing

  public init() {}

  public var body: some View {
    if !billing.buying {
      if let link = billing.link, !billing.linkLabel.isEmpty {
        Button {
          AglynSystemBrowser.open(link)
        } label: {
          Label(billing.linkLabel, systemImage: "arrow.up.right.square")
        }
        .buttonStyle(.borderless)
        .font(.system(size: AglynShellMetrics.rowText))
        .accessibilityIdentifier("store-billing-link")
      } else if !billing.note.isEmpty {
        Text(billing.note)
          .font(.system(size: AglynShellMetrics.rowText))
          .foregroundStyle(AglynColor.secondaryText)
          .fixedSize(horizontal: false, vertical: true)
          .accessibilityIdentifier("store-billing-note")
      }
    }
  }
}
