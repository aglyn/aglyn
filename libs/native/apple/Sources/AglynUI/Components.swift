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
  @Environment(\.aglynRowSelected) private var rowSelected
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
      // On a selected row: the paper with a 1-point ring in the secondary text, so the chip stands off the selection's
      // wash (4.9:1 light, 5.4:1 dark; Figma 11:343).
      .background(rowSelected ? AnyShapeStyle(AglynColor.paper) : AnyShapeStyle(tone.color.opacity(0.14)), in: Capsule())
      .overlay { if rowSelected { Capsule().strokeBorder(AglynColor.secondaryText, lineWidth: 1) } }
      .accessibilityLabel(text)
  }
}

/// A list row: an SF Symbol, a title, an optional subtitle, and a trailing accessory.
public struct AglynRow<Trailing: View>: View {
  @Environment(\.dynamicTypeSize) private var typeSize
  let title: String
  let subtitle: String?
  let systemImage: String?
  let tint: Color?
  let imageURL: URL?
  let darkImageURL: URL?
  let trailing: Trailing

  /// With `imageURL` (a workspace's logo, a site's favicon) the picture takes the symbol's place, and the symbol shows
  /// while there is none.
  public init(
    _ title: String, subtitle: String? = nil, systemImage: String? = nil, tint: Color? = nil, imageURL: URL? = nil,
    darkImageURL: URL? = nil, @ViewBuilder trailing: () -> Trailing = { EmptyView() }
  ) {
    self.title = title
    self.subtitle = subtitle
    self.systemImage = systemImage
    self.tint = tint
    self.imageURL = imageURL
    self.darkImageURL = darkImageURL
    self.trailing = trailing()
  }

  public var body: some View {
    HStack(spacing: 12) {
      if let systemImage, !typeSize.isAccessibilitySize {
        AglynBrandPicture(imageURL, darkURL: darkImageURL, size: 28, cornerRadius: AglynRadius.control) {
          // On the row's leading edge, so the icon starts on the column's content edge as a picture does.
          Image(systemName: systemImage)
            .foregroundStyle(tint ?? AglynColor.tint)
            .frame(width: 28, alignment: .leading)
        }
        .accessibilityHidden(true)
      }
      VStack(alignment: .leading, spacing: 2) {
        // One line, cut at the end, at every width (Figma list rows).
        Text(title).font(AglynFont.body).lineLimit(typeSize.isAccessibilitySize ? nil : 1).truncationMode(.tail)
        if let subtitle, !subtitle.isEmpty {
          Text(subtitle).font(AglynFont.subheadline).foregroundStyle(.secondary)
            .lineLimit(typeSize.isAccessibilitySize ? nil : 2)
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
    // Fill the space it is given and center in it, so an empty list never floats mid-column with its filters.
    .frame(maxWidth: .infinity, maxHeight: .infinity)
  }
}

/// A whole area's one loading state: a large spinner and its line, centred in the space it is given, on the content
/// ground (the in-app Besigner shows it from the push until the editor has drawn, AGL-4002).
public struct AglynLoadingState<Actions: View>: View {
  let message: String
  let detail: String?
  let actions: Actions

  /// `detail` and `actions` say more when the wait runs long (the Besigner's "taking longer than usual" and Try again).
  public init(_ message: String, detail: String? = nil, @ViewBuilder actions: () -> Actions = { EmptyView() }) {
    self.message = message
    self.detail = detail
    self.actions = actions()
  }

  public var body: some View {
    VStack(spacing: AglynSpace.of(1.5)) {
      ProgressView().controlSize(.large)
      VStack(spacing: AglynSpace.half) {
        Text(message).font(AglynFont.body).foregroundStyle(AglynColor.secondaryText)
        if let detail {
          Text(detail).font(AglynFont.caption).foregroundStyle(AglynColor.secondaryText)
        }
      }
      .multilineTextAlignment(.center)
      .accessibilityElement(children: .combine)
      actions
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity)
    .background(AglynColor.paper)
  }
}

/// What a detail column shows while nothing in its list is picked: quiet
/// secondary text, the way Mail says "No Message Selected" (never a full-size
/// empty state with a big symbol).
public struct AglynSelectionPlaceholder: View {
  let title: String
  let systemImage: String?

  public init(_ title: String, systemImage: String? = nil) {
    self.title = title
    self.systemImage = systemImage
  }

  public var body: some View {
    VStack(spacing: AglynSpace.one) {
      if let systemImage {
        Image(systemName: systemImage).font(.system(size: 22, weight: .regular)).foregroundStyle(.tertiary)
          .accessibilityHidden(true)
      }
      Text(title).font(AglynFont.title3).foregroundStyle(.secondary)
    }
    .multilineTextAlignment(.center)
    .padding(AglynSpace.three)
    .frame(maxWidth: .infinity, maxHeight: .infinity)
    .background(AglynColor.paper)
    .accessibilityElement(children: .combine)
    .accessibilityIdentifier("selection-placeholder")
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
    .aglynCardSurface()
  }
}
