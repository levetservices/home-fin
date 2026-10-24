import HomeFinKit
import SwiftUI

/// Phones get Netflix's mobile layout (posters, a tall billboard); iPad and Mac the TV/desktop one.
private struct CompactLayoutKey: EnvironmentKey {
    static let defaultValue = true
}

extension EnvironmentValues {
    var isCompactLayout: Bool {
        get { self[CompactLayoutKey.self] }
        set { self[CompactLayoutKey.self] = newValue }
    }
}

/// The signed-in app: Home, Search, Requests and My Home Fin.
struct MainView: View {
    @Environment(AppModel.self) private var model
    @State private var requests: RequestsConfig?
    @State private var tab = Tab.home

    enum Tab: Hashable { case home, search, requests, mine }

    var body: some View {
        GeometryReader { proxy in
            TabView(selection: $tab) {
                HomeView()
                    .tabItem { Label("Home", systemImage: "house.fill") }
                    .tag(Tab.home)
                SearchView(requests: requests)
                    .tabItem { Label("Search", systemImage: "magnifyingglass") }
                    .tag(Tab.search)
                if requests?.enabled == true || requests?.isAdmin == true {
                    RequestsView(config: requests)
                        .tabItem { Label("Requests", systemImage: "plus.rectangle.on.rectangle") }
                        .tag(Tab.requests)
                }
                MyHomeFinView()
                    .tabItem { Label("My Home Fin", systemImage: "person.crop.square") }
                    .tag(Tab.mine)
            }
            .environment(\.isCompactLayout, proxy.size.width < 700)
        }
        .task(id: model.session?.token) {
            requests = try? await model.accounts?.requestsConfig()
        }
    }
}
