import { executionAdapter, type ExecutionAdapter } from '~/services/execution-adapter.server'
import { localExecutionAdapter } from '~/services/local-execution-adapter.server'
import type { ExecutionMode } from '~/services/executor-protocol'
import { qaosConfig } from '../../qaos.config'

function normalizeExecutionMode(value: string): ExecutionMode | null {
  if (value === 'single' || value === 'server') return 'single'
  if (value === 'local' || value === 'hybrid') return 'hybrid'
  return null
}

export function resolveExecutionMode(): ExecutionMode {
  const mode = normalizeExecutionMode(qaosConfig.deploymentMode)
  if (mode) return mode
  return 'single'
}

export function getExecutionAdapter(): ExecutionAdapter {
  const mode = resolveExecutionMode()

  if (mode === 'hybrid') {
    return localExecutionAdapter
  }

  return executionAdapter
}
