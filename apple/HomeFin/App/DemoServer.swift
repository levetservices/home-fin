#if DEBUG
import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// `-demo`: the app runs against a made-up server inside itself (the catalogue, artwork and clip
/// in DemoContent/), so it can be shown and screenshotted with no real server. Debug builds only.
///
/// `-demoScreen welcome | profiles | home | series | detail | player | search | mine | profilesSheet | settings | downloads`
/// opens straight onto that screen.
enum DemoMode {
    static let host = "demo.homefin.app"
    static let server = URL(string: "https://\(host)")!

    static var isOn: Bool { ProcessInfo.processInfo.arguments.contains("-demo") }

    static var screen: String {
        let args = ProcessInfo.processInfo.arguments
        guard let index = args.firstIndex(of: "-demoScreen"), index + 1 < args.count else { return "home" }
        return args[index + 1]
    }

    /// The title the detail and player screens open.
    static let featuredId = "s00" + String(repeating: "a", count: 29)

    static var clip: URL? { DemoServer.shared.directory?.appendingPathComponent("clip.mp4") }

    static func start() {
        _ = URLProtocol.registerClass(DemoURLProtocol.self)
    }
}

/// Serves the demo through URLSession (AsyncImage and HomeFinKit both use the shared session).
final class DemoURLProtocol: URLProtocol {
    override class func canInit(with request: URLRequest) -> Bool {
        request.url?.host == DemoMode.host
    }

    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        let (status, type, body) = DemoServer.shared.respond(to: request)
        let response = HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: "HTTP/1.1",
                                       headerFields: ["Content-Type": type, "Content-Length": String(body.count)])!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: body)
        client?.urlProtocolDidFinishLoading(self)
    }

    override func stopLoading() {}
}

/// A tiny Jellyfin + Home Fin accounts service answering from DemoContent/.
final class DemoServer: @unchecked Sendable {
    static var shared = DemoServer(directory: Bundle.main.url(forResource: "DemoContent", withExtension: nil))

    let directory: URL?
    private var items: [[String: Any]] = []
    private var household: [String: Any] = [:]
    private let lock = NSLock()

    init(directory: URL?) {
        self.directory = directory
        guard let directory else { return }
        if let data = try? Data(contentsOf: directory.appendingPathComponent("catalog.json")),
           let list = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]] {
            items = list
        }
        if let data = try? Data(contentsOf: directory.appendingPathComponent("household.json")),
           let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
            household = object
        }
    }

    // MARK: routing

    func respond(to request: URLRequest) -> (Int, String, Data) {
        guard let url = request.url else { return (400, "text/plain", Data()) }
        let parts = url.path.split(separator: "/").map(String.init)
        var query: [String: String] = [:]
        for item in URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? [] {
            query[item.name.lowercased()] = item.value ?? ""
        }
        let method = request.httpMethod ?? "GET"
        return lock.withLock { route(method, parts, query) }
    }

    private func route(_ method: String, _ p: [String], _ q: [String: String]) -> (Int, String, Data) {
        if p.first == "homefin-api" { return accounts(method, Array(p.dropFirst())) }
        switch (method, p.count) {
        case (_, 4) where p[0] == "Items" && p[2] == "Images",
             (_, 5) where p[0] == "Items" && p[2] == "Images":
            return image(id: p[1], type: p[3])
        case ("GET", 3) where p == ["System", "Info", "Public"]:
            return json(["ServerName": household["serverName"] ?? "Home Fin", "Version": "10.11.11", "Id": "demo"])
        case ("POST", 2) where p == ["Users", "AuthenticateByName"]:
            return json(auth)
        case ("GET", 2) where p == ["Users", "Me"]:
            return json(user)
        case ("GET", 2) where p == ["UserItems", "Resume"]:
            let resumable = items.filter { ["Movie", "Episode"].contains(type($0)) && position($0) > 0 }
            return list(sortByPlayed(resumable))
        case ("GET", 2) where p == ["Shows", "NextUp"]:
            if let series = q["seriesid"] { return list(nextEpisode(series).map { [$0] } ?? []) }
            return list([])
        case ("GET", 2) where p == ["Items", "Latest"]:
            let latest = items.filter { ["Movie", "Series"].contains(type($0)) }.sorted { str($0, "DateCreated") > str($1, "DateCreated") }
            return json(Array(latest.prefix(Int(q["limit"] ?? "") ?? 20)))
        case ("GET", 1) where p[0] == "Items":
            return list(query(q))
        case ("GET", 1) where p[0] == "UserViews":
            return list([])
        case ("GET", 1) where p[0] == "Genres":
            let types = Set((q["includeitemtypes"] ?? "Movie,Series").split(separator: ",").map(String.init))
            let names = Set(items.filter { types.contains(type($0)) }.flatMap { ($0["Genres"] as? [String]) ?? [] })
            return list(names.sorted().map { ["Name": $0, "Id": $0] })
        case ("GET", 2) where p[0] == "Items":
            guard let item = find(p[1]) else { return (404, "text/plain", Data("Not found".utf8)) }
            return json(item)
        case ("GET", 3) where p[0] == "Items" && p[2] == "Similar":
            let genres = Set((find(p[1])?["Genres"] as? [String]) ?? [])
            let similar = items.filter { ["Movie", "Series"].contains(type($0)) && id($0) != p[1] && !genres.isDisjoint(with: ($0["Genres"] as? [String]) ?? []) }
            return list(Array(similar.prefix(Int(q["limit"] ?? "") ?? 12)))
        case ("GET", 3) where p[0] == "Shows" && p[2] == "Seasons":
            return list(items.filter { type($0) == "Season" && str($0, "SeriesId") == p[1] })
        case ("GET", 3) where p[0] == "Shows" && p[2] == "Episodes":
            return list(episodes(series: p[1], season: q["seasonid"]))
        case ("POST", 3) where p[0] == "Items" && p[2] == "PlaybackInfo":
            let source = ((find(p[1])?["MediaSources"] as? [[String: Any]])?.first) ?? [:]
            var playable = source
            playable["SupportsDirectPlay"] = true
            return json(["MediaSources": [playable], "PlaySessionId": "demo-session"])
        case ("POST", 2) where p[0] == "UserFavoriteItems", ("DELETE", 2) where p[0] == "UserFavoriteItems":
            update(p[1]) { $0["IsFavorite"] = method == "POST" }
            return json(["IsFavorite": method == "POST"])
        case ("POST", 3) where p[0] == "UserItems" && p[2] == "Rating", ("DELETE", 3) where p[0] == "UserItems" && p[2] == "Rating":
            update(p[1]) { data in
                if method == "POST" { data["Likes"] = q["likes"] == "true" } else { data["Likes"] = NSNull() }
            }
            return json([:])
        default:
            // Progress reports, Quick Connect, played / unplayed …: accepted and forgotten.
            return method == "GET" ? (404, "text/plain", Data("Not found".utf8)) : (204, "application/json", Data())
        }
    }

    private func accounts(_ method: String, _ p: [String]) -> (Int, String, Data) {
        let account = household["account"] ?? [:]
        let profiles = household["profiles"] ?? []
        switch (method, p.joined(separator: "/")) {
        case ("GET", "config"):
            return json(["enabled": true, "serverName": household["serverName"] ?? "Home Fin", "allowInvites": true])
        case ("POST", "auth/login"), ("GET", "me"):
            return json(["account": account, "profiles": profiles])
        case ("GET", "avatars"):
            return json(["avatars": household["avatars"] ?? []])
        case ("GET", "trending"):
            return json(household["trending"] ?? [:])
        case ("GET", "requests/config"):
            return json(["enabled": true, "movies": true, "tv": true, "policy": "approve", "isAdmin": true])
        case ("GET", "requests"):
            return json(["mine": [], "household": []])
        case ("GET", "admin/requests"):
            return json(["pending": [], "failed": [], "recent": []])
        case ("GET", "requests/search"):
            return json(["results": []])
        case ("POST", let path) where path.hasPrefix("profiles/") && path.hasSuffix("/session"):
            return json(["authentication": auth])
        default:
            return json(["ok": true])
        }
    }

    // MARK: data

    private var user: [String: Any] {
        ["Id": "demo-hayden", "Name": "Hayden", "Policy": ["IsAdministrator": true]]
    }

    private var auth: [String: Any] {
        ["AccessToken": "demo-token", "ServerId": "demo", "User": user]
    }

    private func type(_ item: [String: Any]) -> String { str(item, "Type") }
    private func id(_ item: [String: Any]) -> String { str(item, "Id") }
    private func str(_ item: [String: Any], _ key: String) -> String { item[key] as? String ?? "" }
    private func userData(_ item: [String: Any]) -> [String: Any] { item["UserData"] as? [String: Any] ?? [:] }
    private func position(_ item: [String: Any]) -> Int { (userData(item)["PlaybackPositionTicks"] as? NSNumber)?.intValue ?? 0 }
    private func lastPlayed(_ item: [String: Any]) -> String { userData(item)["LastPlayedDate"] as? String ?? "" }

    private func find(_ itemId: String) -> [String: Any]? {
        items.first { id($0) == itemId }
    }

    private func update(_ itemId: String, _ change: (inout [String: Any]) -> Void) {
        guard let index = items.firstIndex(where: { id($0) == itemId }) else { return }
        var data = userData(items[index])
        change(&data)
        items[index]["UserData"] = data
    }

    private func sortByPlayed(_ list: [[String: Any]]) -> [[String: Any]] {
        list.sorted { lastPlayed($0) > lastPlayed($1) }
    }

    private func episodes(series: String, season: String?) -> [[String: Any]] {
        items.filter { type($0) == "Episode" && str($0, "SeriesId") == series && (season == nil || str($0, "SeasonId") == season) }
            .sorted { (($0["ParentIndexNumber"] as? Int ?? 0), ($0["IndexNumber"] as? Int ?? 0)) < (($1["ParentIndexNumber"] as? Int ?? 0), ($1["IndexNumber"] as? Int ?? 0)) }
    }

    /// The episode to watch next: the one in progress, else the first unwatched.
    private func nextEpisode(_ series: String) -> [String: Any]? {
        let list = episodes(series: series, season: nil)
        return list.first { position($0) > 0 } ?? list.first { (userData($0)["Played"] as? Bool) != true }
    }

    /// `/Items` with the filters the app uses.
    private func query(_ q: [String: String]) -> [[String: Any]] {
        var result = items
        if let ids = q["ids"] {
            let wanted = ids.split(separator: ",").map(String.init)
            return wanted.compactMap(find)
        }
        if let types = q["includeitemtypes"] {
            let allowed = Set(types.split(separator: ",").map(String.init))
            result = result.filter { allowed.contains(type($0)) }
        }
        if let parent = q["parentid"] { result = result.filter { str($0, "SeriesId") == parent } }
        if let genres = q["genres"] { result = result.filter { (($0["Genres"] as? [String]) ?? []).contains(genres) } }
        if let term = q["searchterm"]?.lowercased(), !term.isEmpty {
            result = result.filter { str($0, "Name").lowercased().contains(term) || (($0["Genres"] as? [String]) ?? []).contains { $0.lowercased().contains(term) } }
        }
        for filter in (q["filters"] ?? "").split(separator: ",") {
            switch filter {
            case "IsFavorite": result = result.filter { userData($0)["IsFavorite"] as? Bool == true }
            case "Likes": result = result.filter { userData($0)["Likes"] as? Bool == true }
            case "IsPlayed": result = result.filter { userData($0)["Played"] as? Bool == true || position($0) > 0 }
            case "IsUnplayed": result = result.filter { userData($0)["Played"] as? Bool != true }
            default: break
            }
        }
        switch q["sortby"]?.split(separator: ",").first.map(String.init) {
        case "DatePlayed": result = sortByPlayed(result)
        case "CommunityRating": result.sort { ($0["CommunityRating"] as? Double ?? 0) > ($1["CommunityRating"] as? Double ?? 0) }
        case "DateCreated": result.sort { str($0, "DateCreated") > str($1, "DateCreated") }
        case "ParentIndexNumber":
            result.sort { (($0["ParentIndexNumber"] as? Int ?? 0), ($0["IndexNumber"] as? Int ?? 0)) < (($1["ParentIndexNumber"] as? Int ?? 0), ($1["IndexNumber"] as? Int ?? 0)) }
        case "Random":
            // Stable "random" so screenshots repeat.
            result.sort { id($0).reversed().lexicographicallyPrecedes(id($1).reversed()) }
        default: break
        }
        if let limit = Int(q["limit"] ?? "") { result = Array(result.prefix(limit)) }
        return result
    }

    private func image(id itemId: String, type kind: String) -> (Int, String, Data) {
        guard let directory else { return (404, "text/plain", Data()) }
        for ext in ["jpg", "png"] {
            let url = directory.appendingPathComponent("img/\(itemId)-\(kind).\(ext)")
            if let data = try? Data(contentsOf: url) { return (200, ext == "png" ? "image/png" : "image/jpeg", data) }
        }
        return (404, "text/plain", Data())
    }

    // MARK: encoding

    private func json(_ object: Any) -> (Int, String, Data) {
        let data = (try? JSONSerialization.data(withJSONObject: object)) ?? Data("{}".utf8)
        return (200, "application/json", data)
    }

    private func list(_ list: [[String: Any]]) -> (Int, String, Data) {
        json(["Items": list, "TotalRecordCount": list.count])
    }
}
#endif
