import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// The Home Fin accounts service (`/homefin-api` on the same address as Jellyfin): email sign-in,
/// profiles, the household Top 10 and requests. Signed in by a cookie kept in the session's cookie store.
public struct AccountsClient: Sendable {
    public let server: URL
    /// The viewer's Jellyfin token, sent so the service knows which profile (or Jellyfin admin) is asking.
    public let jellyfinToken: String?
    let http: HTTP

    public init(server: URL, jellyfinToken: String? = nil, session: URLSession = .shared) {
        self.server = server
        self.jellyfinToken = jellyfinToken
        self.http = HTTP(session: session)
    }

    public func with(jellyfinToken: String?) -> AccountsClient {
        AccountsClient(server: server, jellyfinToken: jellyfinToken, session: http.session)
    }

    func request(_ path: String, query: [String: String?] = [:], method: String = "GET", json: Any? = nil) throws -> URLRequest {
        var request = URLRequest(url: HTTP.url(server, "/homefin-api" + path, query))
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if let jellyfinToken { request.setValue(jellyfinToken, forHTTPHeaderField: "X-Jellyfin-Token") }
        if method != "GET" {
            // The service only takes JSON writes (its CSRF guard), even with an empty body.
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try JSONSerialization.data(withJSONObject: json ?? [String: String]())
        }
        return request
    }

    func call<T: Decodable>(_ path: String, query: [String: String?] = [:], method: String = "GET", json: Any? = nil) async throws -> T {
        try await http.decode(T.self, request(path, query: query, method: method, json: json))
    }

    // MARK: sign-in and profiles

    /// `enabled: false` (or an error) means this server has no accounts service: use Jellyfin sign-in.
    public func config() async throws -> HomeFinConfig {
        try await call("/config")
    }

    public func login(email: String, password: String) async throws -> HomeFinMe {
        try await call("/auth/login", method: "POST", json: ["email": email, "password": password])
    }

    public func logout() async {
        let _: [String: Bool]? = try? await call("/auth/logout", method: "POST")
    }

    public func me() async throws -> HomeFinMe {
        try await call("/me")
    }

    public func avatars() async throws -> [AvatarPreset] {
        struct Body: Decodable { var avatars: [AvatarPreset] }
        let body: Body = try await call("/avatars")
        return body.avatars
    }

    /// Sign a profile in on this device: returns the Jellyfin session to use. Locked profiles need their PIN.
    public func profileSession(profileId: Int, device: DeviceIdentity, pin: String? = nil) async throws -> AuthenticationResult {
        struct Body: Decodable { var authentication: AuthenticationResult }
        var json: [String: Any] = ["device": device.jsonBody]
        if let pin { json["pin"] = pin }
        let body: Body = try await call("/profiles/\(profileId)/session", method: "POST", json: json)
        return body.authentication
    }

    /// The household's most watched titles this week (ids of series and films).
    public func trending() async throws -> Trending {
        try await call("/trending")
    }

    // MARK: requests

    public func requestsConfig() async throws -> RequestsConfig {
        try await call("/requests/config")
    }

    public func searchRequests(_ term: String) async throws -> [MediaResult] {
        struct Body: Decodable { var results: [MediaResult] }
        let body: Body = try await call("/requests/search", query: ["q": term])
        return body.results
    }

    public func requests() async throws -> RequestLists {
        try await call("/requests")
    }

    public func request(type: String, id: Int, seasons: [Int]? = nil) async throws -> MediaRequest {
        struct Body: Decodable { var request: MediaRequest }
        var json: [String: Any] = ["type": type, "id": id]
        if let seasons, !seasons.isEmpty { json["seasons"] = seasons }
        let body: Body = try await call("/requests", method: "POST", json: json)
        return body.request
    }

    public func cancelRequest(_ id: Int) async throws {
        let _: [String: Bool] = try await call("/requests/\(id)", method: "DELETE")
    }

    public func requestQueue() async throws -> RequestQueue {
        try await call("/admin/requests")
    }

    public func approveRequest(_ id: Int) async throws {
        struct Body: Decodable { var request: MediaRequest }
        let _: Body = try await call("/admin/requests/\(id)/approve", method: "POST")
    }

    public func declineRequest(_ id: Int, reason: String? = nil) async throws {
        struct Body: Decodable { var request: MediaRequest }
        var json: [String: Any] = [:]
        if let reason, !reason.isEmpty { json["reason"] = reason }
        let _: Body = try await call("/admin/requests/\(id)/decline", method: "POST", json: json)
    }
}
