import type { CornBenchResult } from './modbus'
import type { WorkspaceConfig, WorkspaceRuntime } from './workspace'

export type ConnectionRpcFailure = {
  code: string
  message: string
  details: object
}

export type ConnectionRpcResult<T = unknown> = { ok: true; value: T } | { ok: false; error: ConnectionRpcFailure }

export type ConnectionRpcLike = {
  rpc?: {
    call?: (
      channel: string,
      endpoint: string,
      payload: unknown,
      signal?: AbortSignal,
    ) => Promise<ConnectionRpcResult<unknown>>
    handle?: (
      channel: string,
      handler: (endpoint: string, payload: unknown, signal: AbortSignal) => Promise<ConnectionRpcResult<unknown>>,
    ) => (() => Promise<void>) | Promise<() => Promise<void>>
  }
}

export type CornRpcTransport = 'connection-rpc' | 'in-process' | 'http' | 'unavailable'

export type HttpRequestLike = {
  method?: string
  headers?: Record<string, string | string[] | undefined>
  url?: string
}

export type HttpStateResponse = CornBenchResult<{
  workspace?: {
    modbus?: WorkspaceConfig['modbus'] & WorkspaceRuntime['modbus']
    focus?: unknown
  }
  journal?: unknown
  health?: unknown
  pendingWrites?: unknown[]
}>

export type HostBridgeDescriptor = {
  origin: string
  inProcess: boolean
  available?: boolean
  transport?: CornRpcTransport
  roundtripMs?: number
  errorCode?: string
  error?: string
}

export type HostPingData = {
  service: 'dsh-corn-bench' | string
  version: string
  transport: CornRpcTransport
  pid: number
  timestamp: string
  /** ESM singleton id of corn-host-client.mjs on the Host side (B2). */
  clientInstanceId?: string
  hostFiber?: string
}

export type PostCommitWarning = {
  code: 'CONNECTION_RELEASE_FAILED' | 'EVENT_NOTIFY_FAILED' | string
  message: string
  connectionIds?: string[]
}

export type ConfigMutationErrorCode = 'CONFIG_DRIFT' | 'CONFIG_VERSION_REQUIRED' | 'CONFIG_INVALID'

export type WorkspaceRepositoryMutator = (
  current: unknown,
) =>
  | { ok: true; workspace: unknown }
  | { ok: false; errorCode?: string; error?: string }
  | Promise<{ ok: true; workspace: unknown } | { ok: false; errorCode?: string; error?: string }>

export type OpenOcdProbeResponse = {
  ok: true
  ready: boolean
  bound: boolean
  exists: boolean
  errorCode?: string
  reason?: string
  versionLine?: string
}

export type HttpApiPaths = '/dsh-corn-bench/command' | string

export type CornRpcEndpoint =
  | 'state'
  | 'bindings/save'
  | 'workspace/save'
  | 'project/file'
  | 'keil/map'
  | 'keil/build'
  | 'modbus/read'
  | 'modbus/write'
  | 'modbus/write/approve'
  | 'command'
  | string
