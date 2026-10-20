export type NodeId = string
export type EdgeId = string

export type EdgeRule =
  | { kind: 'pathPrefix'; value: string }
  | { kind: 'eventType'; value: string }

export interface GraphNode {
  id: NodeId
  type: string
  position: { x: number; y: number }
  config: Record<string, unknown>
}

export interface GraphEdge {
  id: EdgeId
  source: NodeId
  target: NodeId
  rule?: EdgeRule
  /** Relative weight for a weighted load balancer (≥ 0; missing = 1). */
  weight?: number
}

export interface Graph {
  nodes: GraphNode[]
  edges: GraphEdge[]
}

export type MessageKind = 'request' | 'message' | 'event' | 'response'

export interface Message {
  id: string
  kind: MessageKind
  meta: { path?: string; eventType?: string; clientId?: string; clientIp?: string; clientName?: string; [k: string]: unknown }
  /** Path travelled so far; responses walk it in reverse. */
  trail: NodeId[]
  /** simTime at creation. */
  createdAt: number
  status?: 'ok' | 'error'
  /** 200, 202, 401, 429, 503, ... */
  code?: number
  /** Copy/derivative (e.g. a queued message derived from a request). */
  parentId?: string
  /** Hops travelled by its ancestors (parent.depth + parent.trail.length); loop detection counts it. */
  depth?: number
  /** Retry count in Queue. */
  attempt?: number
  /** On a response: id of the message it answers. */
  replyTo?: string
}

export interface NodeStats {
  inFlight: number
  queued: number
  ok: number
  errors: number
}

export interface MetricsSnapshot {
  throughput: number
  p50: number
  p95: number
  errorRate: number
}
