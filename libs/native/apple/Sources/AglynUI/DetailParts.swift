// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import SwiftUI

/// The head of a detail pane: the item's picture (or a symbol tile), its
/// name and a status chip, above the pane's grouped sections. The same head
/// on every detail pane, so a product, a contact and a form read alike.
public struct AglynDetailHeader<Accessory: View>: View {
  let title: String
  let subtitle: String?
  let imageURL: URL?
  let systemImage: String
  let status: (text: String, tone: AglynTone)?
  let accessory: Accessory

  public init(
    _ title: String, subtitle: String? = nil, imageURL: URL? = nil, systemImage: String,
    status: (text: String, tone: AglynTone)? = nil, @ViewBuilder accessory: () -> Accessory = { EmptyView() }
  ) {
    self.title = title
    self.subtitle = subtitle
    self.imageURL = imageURL
    self.systemImage = systemImage
    self.status = status
    self.accessory = accessory()
  }

  /// The picture or symbol tile's side.
  public static var tileSize: CGFloat { 56 }

  public var body: some View {
    HStack(alignment: .center, spacing: AglynSpace.two) {
      AglynDetailTile(imageURL: imageURL, systemImage: systemImage)
      VStack(alignment: .leading, spacing: AglynSpace.half) {
        Text(title).font(AglynFont.title2.weight(.semibold)).lineLimit(2)
          .accessibilityAddTraits(.isHeader)
          .textSelection(.enabled)
        HStack(spacing: AglynSpace.one) {
          if let status { StatusChip(status.text, tone: status.tone) }
          if let subtitle, !subtitle.isEmpty {
            Text(subtitle).font(AglynFont.subheadline).foregroundStyle(.secondary).lineLimit(1)
          }
        }
      }
      Spacer(minLength: 0)
      accessory
    }
    .padding(.vertical, AglynSpace.half)
    .accessibilityElement(children: .contain)
    .accessibilityIdentifier("detail-header")
  }
}

/// A detail pane's picture: the image at its URL, or a tinted symbol while
/// there is none (or while it loads).
public struct AglynDetailTile: View {
  let imageURL: URL?
  let systemImage: String
  let size: CGFloat

  public init(imageURL: URL?, systemImage: String, size: CGFloat = 56) {
    self.imageURL = imageURL
    self.systemImage = systemImage
    self.size = size
  }

  private var shape: RoundedRectangle { RoundedRectangle(cornerRadius: AglynRadius.tile, style: .continuous) }

  public var body: some View {
    Group {
      if let imageURL {
        AsyncImage(url: imageURL) { phase in
          if let picture = phase.image {
            picture.resizable().scaledToFill()
          } else {
            symbol
          }
        }
      } else {
        symbol
      }
    }
    .frame(width: size, height: size)
    .clipShape(shape)
    .overlay(shape.strokeBorder(AglynColor.divider))
    .accessibilityHidden(true)
  }

  private var symbol: some View {
    ZStack {
      AglynColor.tint.opacity(0.12)
      Image(systemName: systemImage).font(.system(size: size * 0.42, weight: .medium)).foregroundStyle(AglynColor.tint)
    }
  }
}

extension AglynRadius {
  /// A picture tile, a field, an iPad row: the 10-point rounding.
  public static let tile: CGFloat = 10
}

/// A screen a plan or add-on unlocks, shown to someone without it: what it
/// does and the one way to get it, in the info tone. Never the failure
/// symbol, since nothing went wrong.
public struct AglynUpsellState: View {
  let title: String
  let message: String
  let systemImage: String
  let actionTitle: String?
  let action: (() -> Void)?

  public init(
    _ title: String, message: String, systemImage: String = "sparkles", actionTitle: String? = nil,
    action: (() -> Void)? = nil
  ) {
    self.title = title
    self.message = message
    self.systemImage = systemImage
    self.actionTitle = actionTitle
    self.action = action
  }

  public var body: some View {
    ContentUnavailableView {
      Label {
        Text(title)
      } icon: {
        Image(systemName: systemImage).foregroundStyle(AglynColor.info)
      }
    } description: {
      Text(message)
    } actions: {
      if let actionTitle, let action {
        Button(actionTitle, action: action)
          .buttonStyle(.aglynProminent)
          .accessibilityIdentifier("upsell-action")
      }
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity)
    .accessibilityIdentifier("upsell-state")
  }
}

/// A toolbar's overflow: every action past the two or three used most, in
/// one labeled "More" menu with a tooltip.
public struct AglynMoreMenu<Content: View>: View {
  let content: Content

  public init(@ViewBuilder content: () -> Content) {
    self.content = content()
  }

  public var body: some View {
    Menu {
      content
    } label: {
      Label("More", systemImage: "ellipsis.circle")
    }
    .help("More actions")
    .accessibilityIdentifier("more-actions")
  }
}

extension View {
  /// A list column's content: its pinned header (chips, filters) at the top,
  /// its rows or empty state taking the rest of the height.
  public func aglynListColumn() -> some View {
    frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
  }
}

/// The kit's text field look (sign-in, sign-up, first run): 44 points tall on
/// iPhone and iPad, 32 on the Mac, rounded 10, on the paper fill with a
/// hairline in the divider color.
public struct AglynFieldStyle: TextFieldStyle {
  public init() {}

  /// A field's height on this platform.
  public static var height: CGFloat {
    #if os(macOS)
      32
    #else
      44
    #endif
  }

  public func _body(configuration: TextField<Self._Label>) -> some View {
    configuration
      .textFieldStyle(.plain)
      .padding(.horizontal, AglynSpace.oneAndHalf)
      .frame(minHeight: Self.height)
      .background(AglynColor.paper, in: RoundedRectangle(cornerRadius: AglynRadius.tile, style: .continuous))
      .overlay(RoundedRectangle(cornerRadius: AglynRadius.tile, style: .continuous).strokeBorder(AglynColor.divider))
  }
}

extension TextFieldStyle where Self == AglynFieldStyle {
  /// The kit's field look: see `AglynFieldStyle`.
  public static var aglyn: AglynFieldStyle { AglynFieldStyle() }
}

/// A primary action's height on this platform: 50 points on iPhone and iPad, 36 on the Mac.
public enum AglynPrimaryButtonMetrics {
  public static var height: CGFloat {
    #if os(macOS)
      36
    #else
      50
    #endif
  }
}
