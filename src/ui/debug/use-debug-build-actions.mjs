import { statusKind } from '../settings/tool-status.mjs'
import { pickJournal, runningOf, runningSource } from '../common/ui-format.mjs'
import { agentNote, formatResult } from './keil/format-result.mjs'
import { parseBuildErrors } from './keil/keil-build-errors.mjs'

/**
 * Build, picker, log and agent-copy actions for Debug view.
 * Owns busy/error/build output state separately from flash and workspace hooks.
 *
 * @param {any} React
 * @param {(key: string) => string} t
 * @param {(path: string, body?: any, timeout?: number) => Promise<any>} post
 * @param {string} cwd
 * @param {string} sessionId
 * @param {{
 *   health: any,
 *   workspace: any,
 *   workspaceRef: { current: any },
 *   journal: any,
 *   setJournal: (v: any) => void,
 *   setKeil: (patch: any) => void,
 *   persist: (next?: any) => Promise<any>,
 *   openProject?: (opts?: any) => void,
 * }} ctx
 */
export function useDebugBuildActions(React, t, post, cwd, sessionId, ctx) {
  const { health, workspace, workspaceRef, journal, setJournal, setKeil, persist, openProject } = ctx

  const [targets, setTargets] = React.useState([])
  const [busy, setBusy] = React.useState('')
  const [error, setError] = React.useState('')
  const [buildOut, setBuildOut] = React.useState('')
  const [logView, setLogView] = React.useState({ open: false, text: '', filter: 'all', search: '', busy: false })
  const [lastResult, setLastResult] = React.useState(null)
  const [copied, setCopied] = React.useState(false)
  const [picker, setPicker] = React.useState(null)

  function run(name, path, payload, timeoutMs) {
    if (!cwd) {
      setError(t('needWorkspace'))
      return Promise.resolve()
    }
    setBusy(name)
    setError('')
    return post(path, Object.assign({ cwd }, payload || {}), timeoutMs)
      .then((data) => {
        if (data && data.ok === false) setError(data.error || t('fail'))
        return data
      })
      .catch((err) => {
        setError(String(err?.message || t('fail')))
        return null
      })
      .finally(() => setBusy(''))
  }

  function openPicker(path) {
    if (!cwd) {
      setError(t('needWorkspace'))
      return
    }
    setBusy('picker')
    setError('')
    post('/dsh-corn-bench/fs/list', { cwd, path: path || cwd })
      .then((data) => {
        setPicker(data)
      })
      .catch((err) => {
        setError(String(err?.message || t('fail')))
      })
      .finally(() => setBusy(''))
  }

  function loadTargets(project) {
    if (!project) return
    run('targets', '/dsh-corn-bench/keil/targets', { project }).then((data) => {
      if (!data) return
      const list = data.result?.details?.targets || []
      setTargets(list)
      const saved = workspaceRef.current.keil?.target || ''
      if (list.length && !saved) {
        const name = list[0].name
        setKeil({ target: name })
        persist({ ...workspaceRef.current, keil: { ...workspaceRef.current.keil, project, target: name } })
      }
    })
  }

  // A saved project needs its targets on every mount (reload, reopened session,
  // switching sub-views); they used to load only right after choosing it, which
  // left the Target select empty while the saved target was shown above it.
  const savedProject = (workspace && workspace.keil && workspace.keil.project) || ''
  const targetsFor = React.useRef('')
  React.useEffect(() => {
    if (!cwd || !savedProject || targetsFor.current === savedProject) return
    targetsFor.current = savedProject
    loadTargets(savedProject)
  }, [cwd, savedProject])

  function chooseProject(path) {
    targetsFor.current = path
    setPicker(null)
    setKeil({ project: path, target: '' })
    persist({ ...workspace, keil: { ...workspace.keil, project: path, target: '' } }).then(() => {
      loadTargets(path)
      if (typeof openProject === 'function') openProject()
    })
  }

  function build() {
    persist()
      .then(() =>
        run(
          'build',
          '/dsh-corn-bench/keil/build',
          {
            project: workspace.keil.project,
            target: workspace.keil.target,
            artifact: workspace.keil.artifact,
            source: 'user',
            sessionId,
          },
          620000,
        ),
      )
      .then((data) => {
        if (!data) return
        setLastResult(data.result)
        setBuildOut(formatResult(data.result))
        setCopied(false)
        if (data.ok === false && typeof openProject === 'function') openProject()
        return post('/dsh-corn-bench/state', { cwd })
      })
      .then((data) => {
        if (!data) return
        setJournal(pickJournal(data))
      })
  }

  const buildErrors = parseBuildErrors(buildOut)

  function jumpToError(err) {
    if (!cwd || !err) return
    if (typeof openProject === 'function') openProject({ file: err.file, line: err.line })
  }

  function openFullLog() {
    if (!lastResult || !cwd) return
    setLogView((prev) => ({ ...prev, open: true, busy: true, text: '' }))
    const logFile = (lastResult?.details && (lastResult.details.log_file || lastResult.details.logFile)) || ''
    post('/dsh-corn-bench/keil/log', { cwd, logFile })
      .then((data) => {
        setLogView((prev) => ({
          ...prev,
          busy: false,
          text: data?.text || '',
          error: data && data.ok === false ? data.error : '',
        }))
      })
      .catch((err) =>
        setLogView((prev) => ({ ...prev, busy: false, text: '', error: String(err?.message || '读取失败') })),
      )
  }

  function copyForAgent() {
    const text = agentNote(cwd, workspace, lastResult)
    if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard
        .writeText(text)
        .then(() => setCopied(true))
        .catch(() => setCopied(false))
    }
  }

  const pythonReady = statusKind(health.python) === 'ready'
  const uv4Ready = statusKind(health.uv4) === 'ready'
  const buildRunning = runningOf(journal, 'build')
  const buildBusy = !!busy || buildRunning
  const buildLabel =
    busy === 'build'
      ? t('building')
      : buildRunning && runningSource(journal, 'build') === 'agent'
        ? t('agentBuilding')
        : buildRunning
          ? t('building')
          : t('build')
  const buildBlock = !cwd
    ? ''
    : !pythonReady || !uv4Ready
      ? t('needBindingsBuild')
      : !workspace.keil.project
        ? t('needProject')
        : ''

  return {
    targets,
    busy,
    error,
    buildOut,
    logView,
    setLogView,
    lastResult,
    copied,
    picker,
    setPicker,
    openPicker,
    chooseProject,
    build,
    openFullLog,
    copyForAgent,
    jumpToError,
    buildErrors,
    buildBusy,
    buildLabel,
    buildBlock,
    pythonReady,
    uv4Ready,
  }
}
