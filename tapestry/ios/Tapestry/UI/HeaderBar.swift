import SwiftUI

// File / Edit / View menus and the document title, top-left; tools top-right
// when there is room. Mirrors drawHeader in app/main.cpp.
struct HeaderBar: View {
    @EnvironmentObject var workspace: Workspace
    let compact: Bool
    let onRename: () -> Void

    var body: some View {
        HStack(spacing: 2) {
            Menu {
                Button("New", systemImage: "doc.badge.plus") { workspace.newDocument() }
                Button("Open…", systemImage: "folder") { workspace.isImporting = true }
                Button("Save", systemImage: "square.and.arrow.down") { workspace.save() }
                Button("Share…", systemImage: "square.and.arrow.up") { workspace.share() }
            } label: {
                MenuLabel(text: "File", width: 46)
            }

            Menu {
                Button("New Note", systemImage: "note.text.badge.plus") { workspace.createNoteInView() }
                Button("Remove Last Stroke", systemImage: "arrow.uturn.backward") { workspace.removeLastStroke() }
                    .disabled(workspace.world.strokes.isEmpty)
                Button("Clear Ink", systemImage: "trash", role: .destructive) { workspace.clearInk() }
                    .disabled(workspace.world.strokes.isEmpty)
            } label: {
                MenuLabel(text: "Edit", width: 46)
            }

            Menu {
                Button("Reset View", systemImage: "arrow.counterclockwise") { workspace.resetView() }
                Button("Frame All", systemImage: "rectangle.dashed") { workspace.frameAll() }
                Button("Settings", systemImage: "slider.horizontal.3") { workspace.revealSettings() }
            } label: {
                MenuLabel(text: "View", width: 52)
            }

            Button(action: onRename) {
                Text(workspace.title)
                    .font(.system(size: 15, weight: .bold))
                    .foregroundStyle(Theme.headerTitle)
                    .lineLimit(1)
                    .truncationMode(.tail)
                    .padding(.horizontal, 8)
                    .frame(height: 28)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .padding(.leading, 10)

            Spacer(minLength: 8)

            if !compact {
                ToolPalette(buttonSize: 32)
            }
        }
        .padding(.horizontal, 12)
        .frame(height: ChromeMetrics.headerHeight)
        .background {
            Theme.header
                .overlay(alignment: .bottom) {
                    Theme.headerRule.frame(height: 1)
                }
                .ignoresSafeArea(edges: .top)
        }
    }
}

private struct MenuLabel: View {
    let text: String
    let width: CGFloat

    var body: some View {
        Text(text)
            .font(.system(size: 13))
            .foregroundStyle(Theme.menuLabel)
            .frame(width: width, height: 28)
            .contentShape(Rectangle())
    }
}
