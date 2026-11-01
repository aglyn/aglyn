// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import SwiftUI

/// One choice in an `AglynOptionCardGrid`: a picture of it, its title, and a line under that.
public struct AglynOptionCardItem: Identifiable, Equatable, Sendable {
  public let id: String
  public let title: String
  public let description: String
  public let imageURL: URL?
  /// What the picture shows, for a reader who cannot see it.
  public let imageAlt: String

  public init(id: String, title: String, description: String, imageURL: URL?, imageAlt: String) {
    self.id = id
    self.title = title
    self.description = description
    self.imageURL = imageURL
    self.imageAlt = imageAlt
  }
}

/// The sizes of a grid of option cards (Figma Option card), the console's `OptionCardGrid` on the Apple platforms.
public enum AglynOptionCardMetrics {
  /// The narrowest a card is drawn: as many as fit take the width, two on a phone.
  public static let minimumWidth: CGFloat = 150
  /// Between two cards, across and down.
  public static let gap: CGFloat = AglynSpace.oneAndHalf
  // The Mac's own sizes (Figma Density=Compact): 13 and 11 point words, a smaller check.
  #if os(macOS)
    static let check: CGFloat = 20
    static let textInset = EdgeInsets(top: 8, leading: 10, bottom: 10, trailing: 10)
    static var title: Font { AglynFont.body.weight(.semibold) }
    static var line: Font { AglynFont.subheadline }
  #else
    static let check: CGFloat = 24
    static let textInset = EdgeInsets(top: 10, leading: 12, bottom: 12, trailing: 12)
    static var title: Font { AglynFont.strongSubheadline }
    static var line: Font { AglynFont.caption }
  #endif
}

/// A grid of cards to pick one from: a radio group drawn as cards, each with a picture, a title and a line under it.
/// Nothing is picked until a card is. The picked card is outlined 2 points in the primary color and carries a check.
/// The console's `OptionCardGrid`; the Kotlin kit's `OptionCardList`.
public struct AglynOptionCardGrid: View {
  let label: String
  let options: [AglynOptionCardItem]
  @Binding var selection: String?

  public init(label: String, options: [AglynOptionCardItem], selection: Binding<String?>) {
    self.label = label
    self.options = options
    self._selection = selection
  }

  public var body: some View {
    LazyVGrid(
      columns: [GridItem(.adaptive(minimum: AglynOptionCardMetrics.minimumWidth), spacing: AglynOptionCardMetrics.gap, alignment: .top)],
      spacing: AglynOptionCardMetrics.gap
    ) {
      ForEach(options) { option in
        AglynOptionCard(option: option, selected: option.id == selection) { selection = option.id }
          .accessibilityIdentifier("option-card-\(option.id)")
      }
    }
    .accessibilityElement(children: .contain)
    .accessibilityLabel(label)
    .sensoryFeedback(.selection, trigger: selection)
  }
}

/// One card of an `AglynOptionCardGrid`. Its plain button keeps a tap to itself: a form row with several default
/// buttons in it runs them all.
struct AglynOptionCard: View {
  let option: AglynOptionCardItem
  let selected: Bool
  let action: () -> Void

  var body: some View {
    let shape = RoundedRectangle(cornerRadius: AglynRadius.card, style: .continuous)
    Button(action: action) {
      VStack(alignment: .leading, spacing: 0) {
        // The picture is square, whatever it loads as, so the grid never shifts while it loads.
        Color.clear
          .aspectRatio(1, contentMode: .fit)
          .overlay { AglynRemoteImage(option.imageURL, systemImage: "photo") }
          .clipped()
          .overlay(alignment: .bottom) { Rectangle().fill(AglynColor.divider).frame(height: 1) }
        VStack(alignment: .leading, spacing: 2) {
          Text(option.title).font(AglynOptionCardMetrics.title).foregroundStyle(AglynColor.textPrimary)
          Text(option.description).font(AglynOptionCardMetrics.line).foregroundStyle(AglynColor.secondaryText)
        }
        .multilineTextAlignment(.leading)
        .fixedSize(horizontal: false, vertical: true)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(AglynOptionCardMetrics.textInset)
      }
      // Every card in a row is as tall as the tallest: its words differ in length.
      .frame(maxHeight: .infinity, alignment: .top)
      .background(AglynColor.paper)
      .clipShape(shape)
      .overlay {
        shape.strokeBorder(selected ? AglynColor.primary : AglynColor.borderStrong, lineWidth: selected ? 2 : 1)
      }
      .overlay(alignment: .topTrailing) {
        if selected {
          Image(systemName: "checkmark.circle.fill")
            .font(.system(size: AglynOptionCardMetrics.check))
            .foregroundStyle(AglynColor.primary)
            .background(Circle().fill(AglynColor.paper))
            .padding(AglynSpace.one)
            .accessibilityHidden(true)
        }
      }
      .contentShape(shape)
    }
    .buttonStyle(.plain)
    .accessibilityLabel("\(option.title): \(option.description)")
    .accessibilityHint(option.imageAlt)
    .accessibilityAddTraits(selected ? .isSelected : [])
  }
}
