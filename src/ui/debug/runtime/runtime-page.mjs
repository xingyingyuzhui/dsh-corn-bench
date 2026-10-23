// @ts-check

import { postWithAbort } from '../../common/latest-request-gate.mjs'
import { pageSessionId, sessionCwd } from '../../common/session-scope.mjs'
import { createPanel } from '../../components/primitives.mjs'
import { createSourceEditor } from '../../components/source-editor.mjs'
import { languageForPath } from '../project/project-tree-model.mjs'
import { createBreakpointPanel } from './breakpoint-panel.mjs'
import { createDebugApprovalCard } from './debug-approval-card.mjs'
import { createDebugTimelinePanel } from './debug-timeline-panel.mjs'
import { createDebugToolbar } from './debug-toolbar.mjs'
import { createStackPanel } from './stack-panel.mjs'
import { useDebugEvents } from './use-debug-events.mjs'
import { createVariablesPanel } from './variables-panel.mjs'


/**
 * Creates the Browser Runtime Debug UI page.
 * Parity with Phase 7 Section 11.2 - 11.10.
 *
 * @param {any} React
 * @param {(key: string) => string} t
 * @param {(path: string, body?: any, timeout?: number) => Promise<any>} post
 */
export function createRuntimePage(React, t, post) {
  const el = React.createElement
  const SourceEditor = createSourceEditor(React)
  const Panel = createPanel(React)
  const DebugToolbar = createDebugToolbar(React, t)
  const DebugApprovalCard = createDebugApprovalCard(React, t)
  const StackPanel = createStackPanel(React, t)
  const VariablesPanel = createVariablesPanel(React, t)
  const BreakpointPanel = createBreakpointPanel(React, t)
  const DebugTimelinePanel = createDebugTimelinePanel(React, t)

  return function RuntimePage(props) {
    const cwd = sessionCwd(props)
    const sessionId = pageSessionId(props)

    const debug = useDebugEvents(React, post, { cwd, sessionId })
    const { actions } = debug

    // Only the real DebugRuntime session is shown. Without one the page is idle
    // with empty panels; it used to render a fabricated paused session (stack,
    // breakpoints, variables and events of a TemperatureDemo sensor.c).
    const sessionData = debug.session || null
    const effectiveStatus = debug.session ? debug.status : 'idle'
    const idle = !debug.session && !debug.pendingControl

    const [sourcePreview, setSourcePreview] = React.useState(() => ({
      rel: '',
      text: '',
      jumpLine: 0,
      loading: false,
      error: null,
    }))

    const fileAbortRef = React.useRef(null)

    // Load file content for source editor preview
    const loadSource = React.useCallback(
      async (filePath, line = 0) => {
        if (!filePath) return
        if (!cwd) return
        if (fileAbortRef.current) {
          fileAbortRef.current.abort()
        }
        const ac = new AbortController()
        fileAbortRef.current = ac

        setSourcePreview((prev) => ({
          ...prev,
          rel: filePath,
          jumpLine: line,
          loading: true,
          error: null,
        }))

        try {
          const res = await postWithAbort(post, '/dsh-vision-bench/project/file', { cwd, path: filePath }, ac.signal)
          if (ac.signal.aborted) return
          if (res?.ok) {
            setSourcePreview({
              rel: res.rel || filePath,
              text: res.text || '',
              jumpLine: line,
              loading: false,
              error: null,
            })
          } else {
            setSourcePreview((prev) => ({
              ...prev,
              loading: false,
              error: res?.error || '无法读取源文件',
            }))
          }
        } catch (err) {
          if (ac.signal.aborted) return
          setSourcePreview((prev) => ({
            ...prev,
            loading: false,
            error: err instanceof Error ? err.message : String(err),
          }))
        }
      },
      [cwd, post],
    )

    React.useEffect(() => {
      const loc = sessionData?.location
      if (loc && loc.file) {
        loadSource(loc.file, loc.line || 0)
      }
    }, [sessionData?.location?.file, sessionData?.location?.line, loadSource])

    // Clean up file fetch on unmount
    React.useEffect(() => {
      return () => {
        if (fileAbortRef.current) fileAbortRef.current.abort()
      }
    }, [])

    const handleSelectFrame = (level, frame) => {
      actions.selectFrame(level)
      if (frame?.file) {
        loadSource(frame.file, frame.line || 0)
      }
    }

    const list = (v) => (Array.isArray(v) ? v : [])
    const rawBp = sessionData?.breakpoints
    const breakpoints = Array.isArray(rawBp) ? rawBp : rawBp ? Object.values(rawBp) : []
    const watchpoints = sessionData?.watchpoints || []
    const locals = list(debug.variables?.locals)
    const watches = list(debug.watches)
    const watchValues = list(debug.watchValues)
    const events = list(debug.events)
    const targetLabel = sessionData?.targetKey || sessionData?.target || ''
    const backendRaw = sessionData?.backend || sessionData?.backendKind || 'gdb-openocd'
    const selectedFrame = sessionData?.stack?.[debug.selectedFrame] || sessionData?.stack?.[0] || null
    const viewingFile = (sourcePreview.rel || sessionData?.location?.file || '').split(/[\\/]/).pop()
    const viewingFn = selectedFrame?.function || sessionData?.location?.function || ''
    const pcFile = sessionData?.location?.file ? String(sessionData.location.file).split(/[\\/]/).pop() : ''
    const sameFile = Boolean(pcFile && viewingFile && pcFile === viewingFile)
    const execLine = sameFile ? Number(sessionData?.location?.line) || 0 : 0
    const fileBreakpoints = breakpoints
      .filter((bp) => bp && bp.enabled !== false && String(bp.file || '').split(/[\\/]/).pop() === viewingFile)
      .map((bp) => Number(bp.line) || 0)
      .filter((n) => n > 0)

    return el(
      'div',
      { className: 'dvb-debug-runtime', 'data-debug-status': effectiveStatus },
      el(DebugToolbar, {
        status: effectiveStatus,
        pendingControl: debug.pendingControl,
        backend: backendRaw,
        target: targetLabel,
        location: sessionData?.location || null,
        loading: debug.loading,
        onStart: () => actions.startDebug(),
        onStop: () => actions.stopDebug(),
        onRun: () => actions.run(),
        onPause: () => actions.pause(),
        onStep: (type) => actions.step(type),
        onReset: () => actions.reset(),
        onRefresh: () => actions.refresh(),
      }),

      // 2. Pending Approvals Card (if any)
      debug.pendingApprovals.length > 0
        ? el(DebugApprovalCard, {
            tickets: debug.pendingApprovals,
            onApprove: (id) => actions.approve(id),
            onReject: (id) => actions.reject(id),
          })
        : null,

      // Global Error callout if any
      debug.error
        ? el(
            'div',
            {
              className: 'dvb-callout',
              style: {
                borderColor: 'var(--dsw-alias-label-danger, #c62828)',
                color: 'var(--dsw-alias-label-danger, #c62828)',
                fontSize: '11px',
              },
            },
            `⚠️ ${debug.error}`,
          )
        : null,

      // 3. Idle: one explanation instead of six empty panels. Breakpoints and
      // watches need a live session, so their panels would only fail here.
      idle
        ? el(
            'div',
            { className: 'dvb-debug-idle' },
            el('div', { className: 'dvb-debug-idle-title' }, '调试未启动'),
            el(
              'p',
              { className: 'dvb-debug-idle-text' },
              '点击上方「启动调试」连接目标板。启动后这里显示调用栈、断点、当前代码行、变量和寄存器；断点和监视需在调试启动后添加。',
            ),
            el(
              'ul',
              { className: 'dvb-debug-idle-list' },
              el('li', null, '先在「工作台」编译出固件'),
              el('li', null, '在 设置 → Vision 中配置 OpenOCD 和 GDB 路径'),
            ),
          )
        : null,

      // 4. Main Grid (Split 35% left / 65% right)
      idle ? null : el(
        'div',
        { className: 'dvb-debug-grid' },
        // Left Column: Call Stack + Breakpoints/Watchpoints
        el(
          'div',
          { className: 'dvb-debug-col-left' },
          el(StackPanel, {
            stack: sessionData?.stack || [],
            selectedFrame: debug.selectedFrame,
            onSelectFrame: handleSelectFrame,
          }),
          el(BreakpointPanel, {
            breakpoints,
            watchpoints,
            onAddBreakpoint: (bp) => actions.addBreakpoint(bp),
            onRemoveBreakpoint: (id) => actions.removeBreakpoint(id),
            onAddWatchpoint: (wp) => actions.addWatchpoint(wp),
            onRemoveWatchpoint: (id) => actions.removeWatchpoint(id),
            error: debug.error,
          }),
        ),

        // Right Column: Source Editor Preview + Variables/Watches/Registers
        el(
          'div',
          { className: 'dvb-debug-col-right' },
          // Source preview panel
          el(
            Panel,
            { style: { flex: 1.2 } },
            el(
              Panel.Head,
              null,
              el('span', null, `${viewingFile}${viewingFn ? ` · ${viewingFn}()` : ''}`),
              el(
                'div',
                { style: { display: 'flex', alignItems: 'center', gap: '8px' } },
                sourcePreview.loading && el('span', { className: 'dvb-hint' }, '加载中…'),
                el('span', { className: 'dvb-chip dvb-debug-readonly-chip' }, '只读'),
              ),
            ),
            el(
              Panel.Body,
              { className: 'dvb-debug-source-body', style: { padding: 0 } },
              sourcePreview.error
                ? el(
                    'div',
                    { className: 'dvb-hint', style: { padding: '16px', textAlign: 'center' } },
                    sourcePreview.error,
                  )
                : sourcePreview.rel
                  ? el(SourceEditor, {
                      text: sourcePreview.text,
                      rel: sourcePreview.rel,
                      jumpLine: sourcePreview.jumpLine || execLine || 0,
                      execLine,
                      breakpoints: fileBreakpoints,
                      debugGutters: true,
                      language: languageForPath(sourcePreview.rel),
                      ariaLabel: t('sourcePreview'),
                    })
                  : el(
                      'div',
                      { className: 'dvb-hint', style: { padding: '24px', textAlign: 'center' } },
                      '调试器暂停或选择调用栈帧时，将在此处高亮显示当前执行代码行。',
                    ),
            ),
          ),

          // Variables & Watches panel
          el(
            'div',
            { style: { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' } },
            el(VariablesPanel, {
              locals,
              watches,
              watchValues,
              registers: debug.variables.registers || [],
              onAddWatch: (expr) => actions.addWatch(expr),
              onRemoveWatch: (expr) => actions.removeWatch(expr),
              onRefresh: () => actions.refresh(),
            }),
          ),
        ),
      ),

      // 5. Debug Timeline panel (bottom); kept while idle only if it has history
      idle && events.length === 0 ? null : el(DebugTimelinePanel, {
        events,
      }),
    )
  }
}
