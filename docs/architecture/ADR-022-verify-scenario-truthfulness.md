# ADR-022: Verify scenario truthfulness and hard timeout

## Status

Accepted (0.29.0). Documents `src/application/verify/*` behavior shipped with the verify productization work.

## Context

Scenario verification must never report PASS when telemetry is missing, alarms are active, debug sessions are absent for `no.exception`, or evaluation overruns the wall clock. Soft timeouts and swallowed errors create false confidence for Agent and UI.

## Decision

1. Verify runs are Host-owned application services with a hard `timeoutMs` abort (`verify-timeout`); overrun yields `status: timeout`, not a partial pass.
2. Assertions that require live sources (`no.alarm`, `no.exception`, point/telemetry age) **fail closed** when the source is missing, stale beyond `maxAgeMs`, or reports active alarms.
3. Cancellation maps to `status: cancelled`; it is distinct from timeout and from assertion failure.
4. Sampling / assertion evaluation / orchestration are separate modules; the public `createVerifyService` facade stays the single entry for RPC/command handlers.
5. Evidence attached to a run must reflect actual samples and assertion outcomes—no synthetic “green” evidence on failure paths.

### Outcome contract (019)

- Each assertion carries `outcome: pass | fail | unverifiable`. `unverifiable` always has `pass: false`, a `reason` (`DATA_MISSING`, `STALE_VALUE`, `BAD_QUALITY`, `INVALID_SAMPLE`, `INSUFFICIENT_SAMPLES`, `TARGET_UNAVAILABLE`, `AMBIGUOUS_OWNER`, `READ_FAILED`, `BASELINE_MISSING`, `NO_ALARM_SOURCE`, `NO_DEBUG_SESSION`) and `actual: null`. Data availability is checked before any comparison; `0` and `false` are valid values, `null`/`NaN`/`Infinity`, stale or bad-quality samples and records without their own timestamp are not.
- The top-level `status` enum is unchanged. Cancellation and timeout keep precedence. An unexpected internal fault is `error`. A normal run with any unverifiable assertion is `error` with `errorCode: VERIFY_UNVERIFIABLE`; otherwise a failed valid comparison is `fail`, else `pass`.
- `failedCount = totalCount - passedCount`; `unverifiableCount` is the subset that could not be judged. The summary lists comparison failures and unverifiable items separately.
- `stable-for-duration` never shortens its window. `durationMs` (default 1000) must be a finite positive number no larger than the effective timeout (caller override first), otherwise the request is rejected before a run is registered: `ok:false, errorCode: INVALID_FIELD, details: { field: 'durationMs', reason: 'INVALID_VALUE', durationMs, timeoutMs }`. If earlier steps leave less than the window, the run times out. One unusable sample makes the window unverifiable.
- Entry points differ on `ok`: the `verify/run` RPC returns `ok: true` whenever a result came back (pass is `result.status === 'pass'`); the Agent `corn_debug verify` envelope keeps `ok = (status === 'pass')` and adds `failedCount`, `unverifiableCount` and `errorCode` when present, with every assertion's `outcome`/`reason` in `verifyResult`.

## Consequences

- Agent and UI can treat verify status as trustworthy for automation gates.
- Tests under `test/verify/` encode truthfulness; regressions that invent pass on empty telemetry are release blockers.
