// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import SwiftUI

/// The theme intents a status can take.
public enum AglynTone: Sendable {
  case neutral, info, success, warning, error

  public var color: Color {
    switch self {
    case .neutral: .secondary
    case .info: AglynColor.info
    case .success: AglynColor.success
    case .warning: AglynColor.warning
    case .error: AglynColor.error
    }
  }
}

/// A small capsule naming a status ("On", "Paid", "Draft").
public struct StatusChip: View {
  let text: String
  let tone: AglynTone

  public init(_ text: String, tone: AglynTone = .neutral) {
    self.text = text
    self.tone = tone
  }

  public var body: some View {
    Text(text)
      .font(AglynFont.caption.weight(.semibold))
      .padding(.horizontal, 8)
      .padding(.vertical, 3)
      .foregroundStyle(tone.color)
      .background(tone.color.opacity(0.14), in: Capsule())
      .accessibilityLabel(text)
  }
}

/// A list row: an SF Symbol, a title, an optional subtitle, and a trailing accessory.
public struct AglynRow<Trailing: View>: View {
  let title: String
  let subtitle: String?
  let systemImage: String?
  let tint: Color?
  let trailing: Trailing

  public init(
    _ title: String, subtitle: String? = nil, systemImage: String? = nil, tint: Color? = nil,
    @ViewBuilder trailing: () -> Trailing = { EmptyView() }
  ) {
    self.title = title
    self.subtitle = subtitle
    self.systemImage = systemImage
    self.tint = tint
    self.trailing = trailing()
  }

  public var body: some View {
    HStack(spacing: 12) {
      if let systemImage {
        Image(systemName: systemImage)
          .foregroundStyle(tint ?? AglynColor.tint)
          .frame(width: 28)
          .accessibilityHidden(true)
      }
      VStack(alignment: .leading, spacing: 2) {
        Text(title).font(AglynFont.body).lineLimit(2)
        if let subtitle, !subtitle.isEmpty {
          Text(subtitle).font(AglynFont.subheadline).foregroundStyle(.secondary).lineLimit(2)
        }
      }
      Spacer(minLength: 8)
      trailing
    }
    .contentShape(Rectangle())
  }
}

/// An empty or failed state: the platform's own `ContentUnavailableView`.
public struct AglynEmptyState<Actions: View>: View {
  let title: String
  let systemImage: String
  let message: String?
  let actions: Actions

  public init(
    _ title: String, systemImage: String, message: String? = nil,
    @ViewBuilder actions: () -> Actions = { EmptyView() }
  ) {
    self.title = title
    self.systemImage = systemImage
    self.message = message
    self.actions = actions()
  }

  public var body: some View {
    ContentUnavailableView {
      Label(title, systemImage: systemImage)
    } description: {
      if let message { Text(message) }
    } actions: {
      actions
    }
  }
}

/// Placeholder rows while a list loads, drawn with the system's redaction.
public struct SkeletonRows: View {
  let count: Int

  public init(count: Int = 3) { self.count = count }

  public var body: some View {
    ForEach(0..<count, id: \.self) { _ in
      AglynRow("Loading a row of text", subtitle: "Loading the second line", systemImage: "circle")
    }
    .redacted(reason: .placeholder)
    .accessibilityLabel("Loading")
  }
}

/// A titled card, for dashboard widgets.
public struct AglynCard<Content: View, Accessory: View>: View {
  let title: String
  let systemImage: String?
  let content: Content
  let accessory: Accessory

  public init(
    _ title: String, systemImage: String? = nil, @ViewBuilder content: () -> Content,
    @ViewBuilder accessory: () -> Accessory = { EmptyView() }
  ) {
    self.title = title
    self.systemImage = systemImage
    self.content = content()
    self.accessory = accessory()
  }

  public var body: some View {
    VStack(alignment: .leading, spacing: 10) {
      HStack {
        if let systemImage {
          Label {
            Text(title)
          } icon: {
            Image(systemName: systemImage).foregroundStyle(AglynColor.tint)
          }
          .font(AglynFont.headline)
        } else {
          Text(title).font(AglynFont.headline)
        }
        Spacer()
        accessory
      }
      content
    }
    .frame(maxWidth: .infinity, alignment: .leading)
    .padding(16)
    .background(AglynColor.paper, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
    .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(AglynColor.divider))
  }
}

/// A grid tile for a quick action.
public struct QuickActionTile: View {
  let title: String
  let systemImage: String

  public init(_ title: String, systemImage: String) {
    self.title = title
    self.systemImage = systemImage
  }

  public var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      Image(systemName: systemImage).font(.title3).foregroundStyle(AglynColor.tint)
      Text(title).font(AglynFont.strongSubheadline).foregroundStyle(.primary).lineLimit(2)
    }
    .frame(maxWidth: .infinity, minHeight: 64, alignment: .topLeading)
    .padding(12)
    .background(AglynColor.paper, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
    .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(AglynColor.divider))
  }
}
