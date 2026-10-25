// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import SwiftUI

#if os(macOS)
  import AppKit
#endif

/// A content screen's grouped form that fills its column (Zach, 2026-10-19: every screen fills its column, its section
/// labels and cards on the column's content edges).
///
/// A phone keeps the platform's grouped `Form`. The Mac's grouped `Form` cannot fill a column: it caps its cards at 684
/// points and centers them at any width, and when its rows are forced wider it keeps its separators at the cap and
/// ignores row separators and backgrounds (measured off screen). So the Mac draws the same sections itself: each
/// section's label on E, its rows in one card from E to width − E with a hairline between rows, and its footer under
/// the card. Every color, rounding and type comes from the theme's tokens (`aglynCardSurface`, `AglynColor`,
/// `AglynFont`), so a re-skin of the tokens re-skins the forms.
///
/// **Plain** (`plain`, or `aglynFormPlain` / a list+detail's detail column in the environment): a list screen or a
/// detail column, as Figma draws them (Mac Sites 13:3, Orders 13:483). No card and no grey ground: the sections stand
/// on the content surface, each row runs the column's full width with its content on E and width − E, a hairline
/// runs exactly E…width − E between rows, and a row's hover and selection fill the row edge to edge.
/// ("I don't like the space here", "why is there even a padding, and why is there grey?"). True settings forms keep
/// their cards on the page ground. The Mac and iPad (iOS 18) draw it; iOS 17 keeps the grouped form.
///
/// The rows are the form's own views. Inside it a `Toggle` puts its switch on the trailing edge and a `LabeledContent`
/// its value there, as a form row does; a spec field reads `aglynPlainForm` to label itself the same way.
public struct AglynGroupedForm<Content: View>: View {
  @Environment(\.aglynWideChrome) private var wide
  @Environment(\.aglynFormPlain) private var plainAround
  @Environment(\.aglynDetailColumn) private var detailColumn
  let plain: Bool?
  let content: Content

  public init(plain: Bool? = nil, @ViewBuilder content: () -> Content) {
    self.plain = plain
    self.content = content()
  }

  private var isPlain: Bool { plain ?? (plainAround || detailColumn) }

  public var body: some View {
    #if os(macOS)
      if wide, #available(macOS 15, *) {
        AglynSectionedForm(content: content, plain: isPlain)
      } else {
        Form { content }.formStyle(.grouped).aglynFormBackground()
      }
    #else
      if wide, isPlain, #available(iOS 18, *) {
        AglynSectionedForm(content: content, plain: true)
      } else {
        // iPad: the cards on the content edges; a phone: the platform's grouped form.
        Form { content }.formStyle(.grouped).aglynFormBackground()
      }
    #endif
  }
}

/// The form's measures: a row's padding inside its card and its least height, the gap between sections, and in a plain
/// form the section title's spacing (Figma Orders 13:483: 20 above a 17-point semibold title, 10 under it).
public enum AglynFormMetrics {
  public static let rowPadding = EdgeInsets(top: 10, leading: 16, bottom: 10, trailing: 16)
  public static let rowMinHeight: CGFloat = 44
  public static let sectionGap: CGFloat = 20
  public static let labelGap: CGFloat = 8
  public static let plainTitleTop: CGFloat = 20
  public static let plainTitleBottom: CGFloat = 10
  public static let plainTitleSize: CGFloat = 17
}

extension EnvironmentValues {
  /// Inside the Mac's own grouped form (`AglynGroupedForm`), where a field labels itself as a form row.
  @Entry public var aglynPlainForm: Bool = false
  /// The grouped forms inside are plain: a list screen's or a detail column's sections on the surface (`AglynGroupedForm`).
  @Entry public var aglynFormPlain: Bool = false
  /// Inside a list+detail's detail column (`AglynListDetailColumns`): its forms are plain.
  @Entry public var aglynDetailColumn: Bool = false
  /// Inside a list+detail's list column (`AglynListDetailColumns`): its ground is the content surface.
  @Entry public var aglynListColumn: Bool = false
  /// Inside a plain form's row (`AglynGroupedForm`): how far a row's hover or selection fill reaches past its content to
  /// fill the row edge to edge. Nil elsewhere, where a row button draws its own rounded fill.
  @Entry public var aglynRowBleed: EdgeInsets? = nil
}

@available(macOS 15, iOS 18, *)
extension ContainerValues {
  /// A form row that stands on the ground rather than in its section's card.
  @Entry var aglynFormBare: Bool = false
  /// A plain form's row that is the one selected (`aglynRowSelected`).
  @Entry var aglynFormRowSelected: Bool = false
}

extension View {
  /// A form row that stands on the ground rather than in its section's card (a notice): edge to edge with no row
  /// background in a `Form`, outside the card in the Mac's own grouped form.
  @ViewBuilder
  public func aglynFormBare() -> some View {
    let row = listRowInsets(EdgeInsets()).listRowBackground(Color.clear)
    if #available(macOS 15, iOS 18, *) {
      row.containerValue(\.aglynFormBare, true)
    } else {
      row
    }
  }

  /// The row that is picked in a list beside its detail: the selection fill, edge to edge in a plain form, the row
  /// background in a `List`.
  @ViewBuilder
  public func aglynRowSelected(_ selected: Bool) -> some View {
    let row = listRowBackground(selected ? AglynColor.selectedFill : nil)
    if #available(macOS 15, iOS 18, *) {
      row.containerValue(\.aglynFormRowSelected, selected)
    } else {
      row
    }
  }
}

/// What a legacy, always-visible scroll bar takes from a scroll view's width on the Mac (System Settings › Appearance ›
/// Show scroll bars › Always, or a mouse): the content keeps E on both sides of the COLUMN, so its trailing inset is E
/// less the bar, and the bar sits against the column's far edge, outside the content. Overlay scroll
/// bars take nothing.
public enum AglynScroller {
  public static var trailingWidth: CGFloat {
    #if os(macOS)
      NSScroller.preferredScrollerStyle == .legacy
        ? NSScroller.scrollerWidth(for: .regular, scrollerStyle: .legacy) : 0
    #else
      0
    #endif
  }
}

@available(macOS 15, iOS 18, *)
private struct AglynSectionedForm<Content: View>: View {
  let content: Content
  let plain: Bool
  /// Read again when the person switches the scroll bar style (the bar's width changes the trailing inset).
  @State private var scroller = AglynScroller.trailingWidth

  private var edge: CGFloat { AglynContentInsets.horizontal }
  private var trailing: CGFloat { max(0, edge - scroller) }

  var body: some View {
    ScrollView {
      Group(sections: content) { sections in
        VStack(alignment: .leading, spacing: plain ? 0 : AglynFormMetrics.sectionGap) {
          ForEach(sections.indices, id: \.self) { index in
            if plain { plainSection(sections[index], first: index == sections.startIndex) } else { cardSection(sections[index]) }
          }
        }
      }
      .padding(.leading, plain ? 0 : edge)
      .padding(.trailing, plain ? 0 : trailing)
      .padding(.vertical, plain ? 0 : AglynFormMetrics.sectionGap)
      .padding(.bottom, plain ? AglynFormMetrics.sectionGap : 0)
      .frame(maxWidth: .infinity, alignment: .leading)
    }
    .background(plain ? AglynColor.paper : AglynColor.page)
    .toggleStyle(AglynFormToggleStyle())
    .labeledContentStyle(AglynFormRowStyle())
    .environment(\.aglynPlainForm, true)
    #if os(macOS)
      .onReceive(NotificationCenter.default.publisher(for: NSScroller.preferredScrollerStyleDidChangeNotification)) { _ in
        scroller = AglynScroller.trailingWidth
      }
    #endif
  }

  private func cardSection(_ section: SectionConfiguration) -> some View {
    VStack(alignment: .leading, spacing: AglynFormMetrics.labelGap) {
      if !section.header.isEmpty {
        section.header
          .font(AglynFont.strongSubheadline)
          .foregroundStyle(AglynColor.secondaryText)
          .accessibilityAddTraits(.isHeader)
      }
      // A bare row (a notice) stands on the ground; the rest share one card.
      ForEach(section.content.filter { $0.containerValues.aglynFormBare }) { $0 }
      let carded = section.content.filter { !$0.containerValues.aglynFormBare }
      if !carded.isEmpty {
        AglynFormSectionCard(rows: carded)
      }
      if !section.footer.isEmpty {
        section.footer
          .font(AglynFont.caption)
          .foregroundStyle(AglynColor.secondaryText)
          .fixedSize(horizontal: false, vertical: true)
      }
    }
    .frame(maxWidth: .infinity, alignment: .leading)
  }

  /// A plain section: its title on E (Figma 13:483), its rows edge to edge with their content on E and width − E, a
  /// hairline exactly E…width − E between rows, a bare row (a notice) on the content edges too.
  private func plainSection(_ section: SectionConfiguration, first: Bool) -> some View {
    let rows = section.content
    let vertical = AglynFormMetrics.rowPadding.top
    return VStack(alignment: .leading, spacing: 0) {
      if !section.header.isEmpty {
        section.header
          .font(.system(size: AglynFormMetrics.plainTitleSize, weight: .semibold))
          .foregroundStyle(AglynColor.textPrimary)
          .textCase(nil)
          .accessibilityAddTraits(.isHeader)
          .padding(.top, AglynFormMetrics.plainTitleTop)
          .padding(.bottom, AglynFormMetrics.plainTitleBottom)
          .padding(.leading, edge)
          .padding(.trailing, trailing)
      } else if !first {
        // An untitled section after another: the gap a title would open.
        Color.clear.frame(height: AglynFormMetrics.sectionGap)
      }
      ForEach(rows.indices, id: \.self) { index in
        let row = rows[index]
        let bare = row.containerValues.aglynFormBare
        let selected = row.containerValues.aglynFormRowSelected
        let after = index + 1 < rows.endIndex ? rows[index + 1] : nil
        row
          .padding(.vertical, bare ? AglynFormMetrics.labelGap / 2 : vertical)
          .padding(.leading, edge)
          .padding(.trailing, trailing)
          .frame(maxWidth: .infinity, minHeight: bare ? 0 : AglynFormMetrics.rowMinHeight, alignment: .leading)
          .background { if selected { AglynColor.selectedFill } }
          .environment(\.aglynRowBleed, EdgeInsets(top: -vertical, leading: -edge, bottom: -vertical, trailing: -trailing))
          .overlay(alignment: .bottom) {
            // Between two rows of the section, never under a notice or the last row.
            if !bare, let after, !after.containerValues.aglynFormBare {
              AglynHairline().padding(.leading, edge).padding(.trailing, trailing)
            }
          }
      }
      if !section.footer.isEmpty {
        section.footer
          .font(AglynFont.caption)
          .foregroundStyle(AglynColor.secondaryText)
          .fixedSize(horizontal: false, vertical: true)
          .padding(.top, AglynFormMetrics.labelGap)
          .padding(.leading, edge)
          .padding(.trailing, trailing)
      }
    }
    .frame(maxWidth: .infinity, alignment: .leading)
  }
}

/// One section's rows in one card, a hairline between rows.
@available(macOS 15, iOS 18, *)
private struct AglynFormSectionCard: View {
  let rows: [Subview]

  var body: some View {
    VStack(spacing: 0) {
      ForEach(rows) { row in
        row
          .padding(AglynFormMetrics.rowPadding)
          .frame(maxWidth: .infinity, minHeight: AglynFormMetrics.rowMinHeight, alignment: .leading)
          .overlay(alignment: .top) {
            if row.id != rows.first?.id { AglynHairline() }
          }
      }
    }
    .aglynCardSurface()
  }
}

/// A switch as a form row draws it: its label on the leading edge, the switch on the trailing one.
public struct AglynFormToggleStyle: ToggleStyle {
  public init() {}

  public func makeBody(configuration: Configuration) -> some View {
    HStack(alignment: .center, spacing: 12) {
      configuration.label
      Spacer(minLength: 8)
      Toggle("", isOn: configuration.$isOn)
        .toggleStyle(.switch)
        .tint(AglynColor.primary)
        .labelsHidden()
    }
  }
}

/// A labeled value as a form row draws it: the label on the leading edge, the value on the trailing one.
public struct AglynFormRowStyle: LabeledContentStyle {
  public init() {}

  public func makeBody(configuration: Configuration) -> some View {
    HStack(alignment: .firstTextBaseline, spacing: 12) {
      configuration.label
      Spacer(minLength: 8)
      configuration.content
        .foregroundStyle(AglynColor.secondaryText)
        .multilineTextAlignment(.trailing)
        .fixedSize(horizontal: false, vertical: true)
    }
  }
}

/// `Form { … }.formStyle(.aglynGrouped)`: a content screen's grouped form that fills its column (`AglynGroupedForm`).
public struct AglynGroupedFormStyle: FormStyle {
  public init() {}

  public func makeBody(configuration: Configuration) -> some View {
    AglynGroupedForm { configuration.content }
  }
}

extension FormStyle where Self == AglynGroupedFormStyle {
  /// A content screen's grouped form that fills its column: the platform's grouped form on a phone and iPad, the
  /// Mac's own sections on the Mac (`AglynGroupedForm`).
  public static var aglynGrouped: AglynGroupedFormStyle { AglynGroupedFormStyle() }
}
