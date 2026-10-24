# ADR-012: Browser / Desktop UI uses authenticated Connection Fetch (RPC Web-compat)

## Status

Accepted (0.29.0 native Web/Desktop migration). Supersedes the 0.26.x “RPC-only browser” framing for **product** UI transport. Web may still mount legacy RPC as a thin compat layer.

## Context

DSH authenticates first-party UI through the Cordis `connection` service. On `0.1.6-alpha.1`:

- `connection.fetch.register({ path, methods, requestBody, fetch })` is shared by Web `/api` and Desktop Host (`dsh-app://app/api/...`).
- `connection.rpc.handle(channel, handler)` still installs via the caller’s `webServer` in current Harness source, so a Host that injects only `connection` **cannot** use RPC on Desktop.

Corn therefore cannot require `webServer` at the Host fiber top level if Desktop must load the plugin.

## Decision

1. **Product UI transport** is one exact Fetch route: `POST /api/corn-bench/dispatch` with body `{ endpoint, payload }`. Endpoint names stay the existing RPC whitelist (`src/shared/corn-rpc-contract.mjs`).
2. Host top-level `inject = ['connection']`. Register Fetch in `corn-fetch-route.mjs`; business dispatch stays on `createCornRpcRouter`.
3. Keep UI pages on `post(path, payload, timeoutOrOptions)`; Client uses `createCornFetchPost` (HTTP path → endpoint map unchanged).
4. **Web-only compat** (`corn-web-compat.mjs`), mounted only when optional `webServer` inject succeeds:
   - Legacy `rpc.handle('/corn-bench', …)` for older Web clients during the 0.29.x / 0.30.x window.
   - Loopback Agent HTTP bridge `POST /dsh-corn-bench/command` (capability + loopback). Desktop does not load this bridge.
5. Agent tools prefer in-process `registerCornHost()`; never guess `127.0.0.1:3080`. Missing Host → `HOST_UNAVAILABLE`.
6. If `ctx.connection.fetch.register` is missing, Host fails closed. No browser HTTP fallback for UI.

## Consequences

- Same UI build works on Web and Desktop without Corn listen ports.
- Desktop product install still requires registry `name@version`; local `link:`/`tgz` are dev/probe only.
- Scheme B (Desktop `rpc.handle` without `webServer`) remains rejected until upstream changes; Fetch stays the shared carrier.
- Unauthenticated browser sessions are still blocked by Harness Connection auth before Corn sees the request.

## Endpoint map

Browser paths such as `/dsh-corn-bench/state` map to logical endpoints such as `state`, then ride Fetch dispatch (or Web RPC compat). Authoritative list: `src/shared/corn-rpc-contract.mjs` (`CORN_FETCH_DISPATCH_PATH`, `CORN_HTTP_TO_RPC`, `CORN_RPC_CHANNEL`).

## Security tests

- Capability / Origin on Web Agent HTTP bridge.
- Fetch cancel forwards `request.signal` into `debug/events/wait`.
- Host dispose clears Fetch registration and Host handle; late Promise disposers still run.
- Client fail-closed when Connection Fetch is unavailable.
