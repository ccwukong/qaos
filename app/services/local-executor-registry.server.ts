let connected = false
let lastSeenAt: number | null = null

export function markLocalExecutorConnected() {
  connected = true
  lastSeenAt = Date.now()
}

export function markLocalExecutorDisconnected() {
  connected = false
}

export function touchLocalExecutorHeartbeat() {
  connected = true
  lastSeenAt = Date.now()
}

export function getLocalExecutorStatus() {
  return {
    connected,
    lastSeenAt,
  }
}

export function resetLocalExecutorStatus() {
  connected = false
  lastSeenAt = null
}
