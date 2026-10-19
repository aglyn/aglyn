// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import SwiftUI

// The console's upgrade surfaces, drawn the native way (AGL-3966; Figma Notice/Upgrade 121:18654, Promo/Add-on card
// 121:18655). The words are always the console's: a screen hands in the sentence its console twin shows.

/// What an upgrade notice offers: the plans, or the add-ons (a feature sold only as an add-on).
public enum AglynUpgradeKind: Sendable {
  case plan
  case addOn

  /// The action's label, the console's ("View plans", "View add-ons").
  public var actionTitle: String { self == .plan ? "View plans" : "View add-ons" }

  var systemImage: String { self == .plan ? "lock" : "ticket" }
}

/// A feature the plan leaves out, where the feature would be (Figma Notice/Upgrade; the console's blocked plugin page):
/// a lock (or a ticket for an add-on), the console's sentence naming the plan that includes it, and View plans (or View
/// add-ons). The screen stays reachable so the way to buy the feature is where people look for it.
public struct AglynUpgradeNotice: View {
  let message: String
  let kind: AglynUpgradeKind
  let action: (() -> Void)?

  public init(_ message: String, kind: AglynUpgradeKind = .plan, action: (() -> Void)?) {
    self.message = message
    self.kind = kind
    self.action = action
  }

  public var body: some View {
    ViewThatFits(in: .horizontal) {
      HStack(spacing: 12) {
        icon
        text
        Spacer(minLength: 0)
        button
      }
      // A narrow screen puts the action under the sentence, as the console's Alert wraps on a phone.
      VStack(alignment: .leading, spacing: 10) {
        HStack(alignment: .top, spacing: 12) {
          icon
          text
        }
        button.padding(.leading, 32)
      }
    }
    .padding(.vertical, 12)
    .padding(.leading, 16)
    .padding(.trailing, 12)
    .frame(maxWidth: .infinity, alignment: .leading)
    .background(
      RoundedRectangle(cornerRadius: AglynShellMetrics.controlRadius + 2, style: .continuous)
        .fill(AglynColor.intent({ $0.info }, \.main).opacity(0.08))
    )
    .accessibilityElement(children: .contain)
    .accessibilityIdentifier("upgrade-notice")
  }

  private var icon: some View {
    Image(systemName: kind.systemImage)
      .font(.system(size: 16))
      .frame(width: 20, height: 20)
      .foregroundStyle(AglynColor.secondaryText)
      .accessibilityHidden(true)
  }

  private var text: some View {
    Text(message)
      .font(.system(size: AglynShellMetrics.rowText))
      .foregroundStyle(AglynColor.textPrimary)
      .fixedSize(horizontal: false, vertical: true)
  }

  @ViewBuilder
  private var button: some View {
    if let action {
      Button(kind.actionTitle, action: action)
        .buttonStyle(AglynHeaderButtonStyle())
        .fixedSize()
        .accessibilityIdentifier("upgrade-notice-action")
    }
  }
}

/// An add-on's offer where the console shows one (Figma Promo/Add-on card; the console's AiUpsellDialog): an icon tile,
/// the title, what it does, where it comes from (the console's offer sentence), then Not now and the add action. A
/// member who cannot buy it reads the "ask an owner or admin" sentence and only Close.
public struct AglynAddOnPromoCard: View {
  let title: String
  let systemImage: String
  let does: String
  let offer: String
  let dismissTitle: String
  let actionTitle: String?
  let dismiss: () -> Void
  let action: () -> Void

  public init(
    _ title: String, systemImage: String = "sparkles", does: String, offer: String, dismissTitle: String,
    actionTitle: String?, dismiss: @escaping () -> Void, action: @escaping () -> Void
  ) {
    self.title = title
    self.systemImage = systemImage
    self.does = does
    self.offer = offer
    self.dismissTitle = dismissTitle
    self.actionTitle = actionTitle
    self.dismiss = dismiss
    self.action = action
  }

  public var body: some View {
    VStack(alignment: .leading, spacing: 12) {
      HStack(spacing: 10) {
        Image(systemName: systemImage)
          .font(.system(size: 16))
          .foregroundStyle(AglynColor.accentIcon)
          .frame(width: 34, height: 34)
          .background(RoundedRectangle(cornerRadius: 8, style: .continuous).fill(AglynColor.accentSoft))
          .accessibilityHidden(true)
        Text(title)
          .font(.system(size: 15, weight: .semibold))
          .foregroundStyle(AglynColor.textPrimary)
          .accessibilityAddTraits(.isHeader)
      }
      Text(does)
        .font(.system(size: 13))
        .foregroundStyle(AglynColor.textPrimary)
        .fixedSize(horizontal: false, vertical: true)
      Text(offer)
        .font(.system(size: 12))
        .foregroundStyle(AglynColor.secondaryText)
        .fixedSize(horizontal: false, vertical: true)
      HStack(spacing: 8) {
        Spacer(minLength: 0)
        Button(dismissTitle, action: dismiss)
          .buttonStyle(.plain)
          .font(.system(size: 13, weight: .semibold))
          .padding(.horizontal, 10)
          .frame(height: 28)
          .accessibilityIdentifier("addon-promo-dismiss")
        if let actionTitle {
          Button(action: action) {
            Text(actionTitle)
              .font(.system(size: 13, weight: .semibold))
              .foregroundStyle(AglynColor.primaryContrast)
              .padding(.horizontal, 10)
              .frame(height: 28)
              .background(RoundedRectangle(cornerRadius: AglynShellMetrics.controlRadius, style: .continuous).fill(AglynColor.primary))
              .contentShape(Rectangle())
          }
          .buttonStyle(.plain)
          .accessibilityIdentifier("addon-promo-add")
        }
      }
    }
    .padding(16)
    .frame(maxWidth: 360, alignment: .leading)
    .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(AglynColor.paper))
    .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(AglynColor.divider))
    .accessibilityElement(children: .contain)
    .accessibilityIdentifier("addon-promo")
  }
}

extension AglynUpgradeNotice {
  /// The notice standing in for a whole screen the plan leaves out: at the top of the content, at its margins.
  public func asScreen() -> some View {
    VStack(alignment: .leading, spacing: 0) {
      self
      Spacer(minLength: 0)
    }
    .padding(.horizontal, AglynContentInsets.horizontal)
    .padding(.top, 8)
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
  }
}
