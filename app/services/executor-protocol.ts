export type ExecutionMode = 'single' | 'hybrid'

export interface ExecutorCapabilities {
  supportsHeadful: boolean
  supportsScreenshots: boolean
  supportsHumanTakeover: boolean
  platform?: string
  browser?: string
}

export interface ExecutorHelloMessage {
  type: 'executor.hello'
  executorId: string
  version: string
  capabilities: ExecutorCapabilities
}

export interface RunAssignMessage {
  type: 'run.assign'
  runId: string
  sessionId: string
  mode: ExecutionMode
  targetUrl?: string
}

export interface RunNextActionMessage {
  type: 'run.next_action'
  runId: string
  stepId: string
  action: string
  args: Record<string, unknown>
  timeoutMs?: number
}

export interface RunActionResultMessage {
  type: 'run.action_result'
  runId: string
  stepId: string
  ok: boolean
  latencyMs?: number
  error?: string
}

export interface RunObservationMessage {
  type: 'run.observation'
  runId: string
  screenshotRef?: string
  domSnapshot?: string
  consoleErrors?: string[]
}

export interface RunNeedsHumanMessage {
  type: 'run.needs_human'
  runId: string
  reason: string
  hint?: string
}

export interface RunHumanResumedMessage {
  type: 'run.human_resumed'
  runId: string
}

export interface RunStopMessage {
  type: 'run.stop'
  runId: string
  reason?: string
}

export interface RunFinalizeMessage {
  type: 'run.finalize'
  runId: string
  status: 'completed' | 'failed' | 'stopped'
  summary?: string
}

export type ExecutorProtocolMessage =
  | ExecutorHelloMessage
  | RunAssignMessage
  | RunNextActionMessage
  | RunActionResultMessage
  | RunObservationMessage
  | RunNeedsHumanMessage
  | RunHumanResumedMessage
  | RunStopMessage
  | RunFinalizeMessage
