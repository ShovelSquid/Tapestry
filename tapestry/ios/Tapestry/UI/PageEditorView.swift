import SwiftUI

// Page text editing. The desktop edits in place with a caret; on a phone the
// keyboard would cover the page, so text opens in a sheet styled as the page
// card — edits apply live, and the page updates behind the sheet as you type.
struct PageEditorView: View {
    @EnvironmentObject var workspace: Workspace
    @Environment(\.dismiss) var dismiss
    @FocusState var focus: PageEditTarget.Field?
    let target: PageEditTarget

    var body: some View {
        NavigationStack {
            if let page = workspace.world.page(id: target.pageId) {
                editor(for: page)
            } else {
                Color.clear.onAppear { dismiss() }
            }
        }
        .presentationDetents([.medium, .large])
        .presentationBackground(Color(Theme.card))
        .presentationDragIndicator(.visible)
    }

    private func editor(for page: Page) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 12) {
                Circle()
                    .fill(Color(Theme.accent(page.kind)).opacity(210.0 / 255))
                    .frame(width: 8, height: 8)
                TextField("Title", text: binding(\.title))
                    .font(.system(size: 17, weight: .bold))
                    .foregroundStyle(Color(Theme.title))
                    .focused($focus, equals: .title)
                    .submitLabel(.next)
                    .onSubmit { if page.kind != .settings { focus = .body } }
            }
            .padding(.horizontal, 20)
            .frame(height: 52)

            Rectangle()
                .fill(Color(Theme.divider))
                .frame(height: 1)
                .padding(.horizontal, 12)

            if page.kind == .settings {
                Text("Settings is an ordinary page — its controls live on the page itself.")
                    .font(.system(size: 15))
                    .foregroundStyle(Color(Theme.body))
                    .padding(20)
                Spacer()
            } else {
                TextEditor(text: binding(\.body))
                    .font(.system(size: 16))
                    .lineSpacing(16 * 0.45 * 0.5)
                    .foregroundStyle(Color(Theme.body))
                    .scrollContentBackground(.hidden)
                    .focused($focus, equals: .body)
                    .padding(.horizontal, 15)
                    .padding(.top, 6)
            }
        }
        .background(Color(Theme.card))
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarLeading) {
                Menu {
                    if page.kind != .settings {
                        Picker("Kind", selection: binding(\.kind)) {
                            ForEach(PageKind.allCases.filter { $0 != .settings }) { kind in
                                Text(kind.label).tag(kind)
                            }
                        }
                    }
                    Button(page.minimized ? "Restore" : "Minimize",
                           systemImage: page.minimized ? "plus.square" : "minus.square") {
                        workspace.world.updatePage(id: page.id) { $0.minimized.toggle() }
                    }
                    Button("Delete Page", systemImage: "trash", role: .destructive) {
                        workspace.deletePage(page.id)
                        dismiss()
                    }
                } label: {
                    Text(page.kind.label)
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(Color(Theme.accent(page.kind)))
                }
            }
            ToolbarItem(placement: .topBarTrailing) {
                Button("Done") { dismiss() }
                    .fontWeight(.semibold)
            }
        }
        .onAppear { focus = target.field }
    }

    // Reads and writes straight through to the world, so the canvas behind
    // the sheet redraws on every keystroke.
    private func binding<Value>(_ keyPath: WritableKeyPath<Page, Value>) -> Binding<Value> {
        let id = target.pageId
        let fallback = workspace.world.page(id: id)![keyPath: keyPath]
        return Binding(
            get: { workspace.world.page(id: id)?[keyPath: keyPath] ?? fallback },
            set: { value in workspace.world.updatePage(id: id) { $0[keyPath: keyPath] = value } })
    }
}
