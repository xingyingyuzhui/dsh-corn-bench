export type AssertionType =
  | 'debug.expression'
  | 'modbus.point'
  | 'no.exception'
  | 'no.alarm'
  | 'range'
  | 'changed'
  | 'stable-for-duration'

export type AssertionOperator = '==' | '!=' | '>' | '>=' | '<' | '<=' | 'in' | 'matches'

export interface AssertionSpec {
  id?: string
  type: AssertionType
  expr?: string
  expression?: string
  pointId?: string
  source?: {
    type?: string
    pointId?: string
    expr?: string
    expression?: string
  }
  op?: AssertionOperator
  operator?: AssertionOperator
  value?: any
  expected?: any
  min?: number
  max?: number
  durationMs?: number
  sampleIntervalMs?: number
  tolerance?: number
  maxAgeMs?: number
  description?: string
}

export interface ScenarioSpec {
  id?: string
  name: string
  description?: string
  timeoutMs?: number
  assertions: AssertionSpec[]
  targetSpec?: Record<string, any>
  setup?: {
    signals?: any[]
    modbusWrites?: Array<{ pointId: string; value: any }>
    delayMs?: number
  }
}

/** `unverifiable` means no trustworthy data to compare; it always has `pass: false` and a `reason`. */
export type AssertionOutcome = 'pass' | 'fail' | 'unverifiable'

export interface AssertionResult {
  id: string
  type: AssertionType
  pass: boolean
  outcome: AssertionOutcome
  reason?: string
  actual: any
  expected: any
  op?: string
  message: string
  timestamp: number
}

export type VerifyStatus = 'pass' | 'fail' | 'error' | 'timeout' | 'cancelled'

export interface VerifyResult {
  verificationRunId?: string
  scenarioId: string
  scenarioName: string
  status: VerifyStatus
  passedCount: number
  /** totalCount - passedCount; includes unverifiable assertions. */
  failedCount: number
  /** Subset of failedCount that could not be judged. */
  unverifiableCount: number
  totalCount: number
  /** Set to VERIFY_UNVERIFIABLE when an otherwise normal run had unverifiable assertions. */
  errorCode?: string
  durationMs: number
  assertions: AssertionResult[]
  evidence: Array<Record<string, any>>
  summary: string
  timestamp: number
  artifact?: {
    path?: string
    sha256?: string
    sizeBytes?: number
  }
  artifactPath?: string
  artifactSha256?: string
  debug?: {
    debugSessionId?: string
    backend?: string
    firmwareHash?: string
    targetIdentity?: string
  }
  backend?: string
  debugSessionId?: string
  firmwareHash?: string
  targetIdentity?: string
  snapshots?: any[]
  startedAt?: number
  finishedAt?: number
  startAt?: number
  endAt?: number
  telemetrySamples?: Array<{ pointId?: string; expr?: string; timestamp: number; value: any }>
}
