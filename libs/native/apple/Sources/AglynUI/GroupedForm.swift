// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import SwiftUI

/// A content screen's grouped form that fills its column (Zach, 2026-10-19: every screen fills its column, its section
/// labels and cards on the column's content edges).
///
/// A phone and iPad keep the platform's grouped `Form`, its cards on the content edges. The Mac's grouped `Form` cannot
/// do that: it caps its cards at 684 points and centers them at any width, and when its rows are forced wider it keeps
/// its separators at the cap and ignores row separators and backgrounds (measured off screen). So the Mac draws the same
/// sections itself: each section's label on E, its rows in one card from E to width − E with a hairline between rows,
/// and its footer under the card. Every color, rounding and type comes from the theme's tokens (`aglynCardSurface`,
/// `AglynColor`, `AglynFont`), so a re-skin of the tokens re-skins the forms.
///
/// The rows are the form's own views. Inside it a `Toggle` puts its switch on the trailing edge and a `LabeledContent`
/// its value there, as a form row does; a spec field reads `aglynPlainForm` to label itself the same way.
public struct AglynGroupedForm<Content: View>: View {
  @Environment(\.aglynWideChrome) private var wide
  let content: Content

  public init(@ViewBuilder content: () -> Content) { self.content = content() }

  public var body: some View {
    #if os(macOS)
      if wide, #available(macOS 15, *) {
        AglynSectionedForm(content: content)
      } else {
        Form { content }.formStyle(.grouped).aglynListBackground()
      }
    #else
      if wide {
        // iPad: the cards on the content edges.
        Form { content }
          .formStyle(.grouped)
          .aglynListBackground()
          .contentMargins(.horizontal, AglynContentInsets.horizontal, for: .scrollContent)
      } else {
        Form { content }.formStyle(.grouped).aglynListBackground()
      }
    #endif
  }
}

/// The form's measures on the Mac: a row's padding inside its card and its least height, the gap between sections.
public enum AglynFormMetrics {
  public static let rowPadding = EdgeInsets(top: 10, leading: 16, bottom: 10, trailing: 16)
  public static let rowMinHeight: CGFloat = 44
  public static let sectionGap: CGFloat = 20
  public static let labelGap: CGFloat = 8
}

extension EnvironmentValues {
  /// Inside the Mac's own grouped form (`AglynGroupedForm`), where a field labels itself as a form row.
  @Entry public var aglynPlainForm: Bool = false
}

@available(macOS 15, iOS 18, *)
extension ContainerValues {
  /// A form row that stands on the ground rather than in its section's card.
  @Entry var aglynFormBare: Bool = false
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
}

#if os(macOS)
  @available(macOS 15, *)
  private struct AglynSectionedForm<Content: View>: View {
    let content: Content

    var body: some View {
      ScrollView {
        VStack(alignment: .leading, spacing: AglynFormMetrics.sectionGap) {
          ForEach(sections: content) { section in
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
        }
        .padding(.horizontal, AglynContentInsets.horizontal)
        .padding(.vertical, AglynFormMetrics.sectionGap)
        .frame(maxWidth: .infinity, alignment: .leading)
      }
      .background(AglynColor.page)
      .toggleStyle(AglynFormToggleStyle())
      .labeledContentStyle(AglynFormRowStyle())
      .environment(\.aglynPlainForm, true)
    }
  }

  /// One section's rows in one card, a hairline between rows.
  @available(macOS 15, *)
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
#endif

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
