import { AppProvider } from '@renderer/state/AppProvider'
import { MainWindow } from '@renderer/windows/MainWindow'
import { TerminalWindow } from '@renderer/windows/TerminalWindow'

/**
 * Entry component. The same bundle serves both window kinds:
 * - main windows render the repo grid / tabbed terminal UI
 * - terminal windows (windows mode) are booted with ?sessionId=&windowId=
 *   and attach to a single pre-spawned PTY session
 */
export default function App(): React.ReactElement {
  const params = new URLSearchParams(window.location.search)
  const sessionId = params.get('sessionId')
  const windowId = params.get('windowId')

  return (
    <AppProvider>
      {sessionId && windowId ? (
        <TerminalWindow sessionId={sessionId} windowId={windowId} />
      ) : (
        <MainWindow />
      )}
    </AppProvider>
  )
}
