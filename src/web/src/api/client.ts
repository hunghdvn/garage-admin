import axios from 'axios'

export const api = axios.create({
  baseURL: '/api',
  withCredentials: true,
})

export interface User {
  id: number
  username: string
  role: 'admin' | 'readonly'
}

export interface Cluster {
  id: number
  name: string
  admin_endpoint: string
  s3_endpoint: string
  s3_region: string
  s3_access_key: string
  is_default: boolean
  admin_key_set: boolean
  s3_secret_set: boolean
}

export interface ClusterHealth {
  status: string
  knownNodes: number
  connectedNodes: number
  storageNodes: number
  storageNodesUp: number
  partitions: number
  partitionsQuorum: number
  partitionsAllOk: number
}

export interface BucketListItem {
  id: string
  created: string
  globalAliases: string[]
  localAliases?: unknown[]
  // Present only when the cluster supports ListBucketsInfo (Garage >= v2.5).
  objects?: number
  bytes?: number
  keys?: BucketKeyPerm[]
  quotas?: Quotas
}

export interface Permissions {
  read: boolean
  write: boolean
  owner: boolean
}

export interface BucketKeyPerm {
  accessKeyId: string
  name: string
  permissions: Permissions
  bucketLocalAliases: string[]
}

export interface Quotas {
  maxSize: number | null
  maxObjects: number | null
}

export interface BucketInfo {
  id: string
  created: string
  globalAliases: string[]
  websiteAccess: boolean
  websiteConfig: { indexDocument: string; errorDocument: string } | null
  keys: BucketKeyPerm[]
  objects: number
  bytes: number
  unfinishedUploads: number
  unfinishedMultipartUploads: number
  quotas: Quotas
  corsRules?: unknown
}

export interface KeyListItem {
  id: string
  name: string
  created: string
  expiration: string | null
  expired: boolean
  // Present only when the cluster supports ListKeysInfo (Garage >= v2.5).
  permissions?: { createBucket: boolean }
  buckets?: KeyBucketPerm[]
}

export interface KeyBucketPerm {
  id: string
  globalAliases: string[]
  localAliases: string[]
  permissions: Permissions
}

export interface KeyInfo {
  accessKeyId: string
  secretAccessKey?: string
  created: string
  name: string
  expiration: string | null
  expired: boolean
  permissions: { createBucket: boolean }
  buckets: KeyBucketPerm[]
}

// Selected cluster id (set by ClusterContext); appended to every /api request.
let selectedClusterId: number | null = null
export function setSelectedClusterId(id: number | null) {
  selectedClusterId = id
}

api.interceptors.request.use((config) => {
  if (selectedClusterId != null) {
    config.params = { ...(config.params || {}), cluster: selectedClusterId }
  }
  return config
})

export interface ClusterNode {
  id: string
  hostname: string
  addr: string
  isUp: boolean
  draining: boolean
  lastSeenSecsAgo: number | null
  garageVersion: string
  role: { zone: string; capacity: number | null; tags: string[] } | null
  dataPartition: { available: number; total: number } | null
  metadataPartition: { available: number; total: number } | null
  resyncQueueLen?: number | null // Garage >= v2.5
}

export interface ClusterStatus {
  layoutVersion: number
  nodes: ClusterNode[]
}

export interface ClusterStatistics {
  freeform: string
  dataAvail: number
  metadataAvail: number
  incompleteAvailInfo: boolean
  bucketCount: number
  totalObjectCount: number
  totalObjectBytes: number
}

export interface LayoutRole {
  id: string
  zone: string
  tags: string[]
  capacity: number | null
  storedPartitions: number
  usableCapacity: number | null
}

export interface StagedRoleChange {
  id: string
  remove: boolean
  zone: string
  capacity: number | null
  tags: string[]
}

export interface ClusterLayoutData {
  version: number
  roles: LayoutRole[]
  parameters: unknown
  partitionSize: number
  stagedRoleChanges: StagedRoleChange[]
  stagedParameters: unknown
}

export interface LayoutVersionInfo {
  version: number
  status: string
  storageNodes: number
  gatewayNodes: number
}

export interface LayoutHistory {
  currentVersion: number
  minAck: number
  versions: LayoutVersionInfo[]
}

// ComputationStat returned by layout preview/apply (Garage >= v2.4).
export interface LayoutNodeStat {
  id: string
  tags: string[]
  storedPartitions: number
  newPartitions: number
  totalCapacity: number
  usableCapacity: number
}

export interface LayoutZoneStat {
  name: string
  nodes: LayoutNodeStat[]
  totalReplicatedPartitions: number
  uniquePartitions: number
  totalCapacity: number
  usableCapacity: number
}

export interface LayoutStatistics {
  replicationFactor: number
  effectiveZoneRedundancy: number
  partitionSize: number
  previousPartitionSize: number | null
  lowPartitionSize: boolean
  usableCapacity: number
  totalCapacity: number
  effectiveCapacity: number
  lowUsableCapacity: boolean
  totalMovedPartitions: number | null
  zones: LayoutZoneStat[]
}

export interface LayoutPreview {
  message: string[]
  newLayout?: unknown // preview
  layout?: unknown // apply
  statistics?: LayoutStatistics | null
}

export interface AdminToken {
  id: string | null
  created: string | null
  name: string
  expiration: string | null
  expired: boolean
  scope: string[]
  secretToken?: string
}

export interface MultiNode<T> {
  success: Record<string, T>
  error: Record<string, string>
}

export interface ConnectionParameters {
  region: string
  s3Endpoint?: string | null
  s3UsePathStyle?: boolean | null
  k2vEndpoint?: string | null
}

export interface NodeInfoData {
  nodeId: string
  hostname: string
  garageVersion: string
  garageFeatures: string[]
  rustVersion: string
  dbEngine: string
  // Garage >= v2.4
  addr?: string | null
  isUp?: boolean
  draining?: boolean
  role?: { zone: string; capacity: number | null; tags: string[] } | null
  dataPartition?: { available: number; total: number } | null
  metadataPartition?: { available: number; total: number } | null
  // Garage >= v2.5
  connectionParameters?: ConnectionParameters | null
}

export interface Worker {
  id: number
  name: string
  state: string
  errors: number
  consecutiveErrors: number
  lastError: unknown
  tranquility: number | null
  progress: string | null
  queueLength: number
  persistentErrors: unknown
  freeform: string[]
}

// firstNode returns the value for the chosen node id, or the first success entry.
export function firstNode<T>(resp: MultiNode<T> | undefined, nodeId?: string): T | undefined {
  if (!resp) return undefined
  if (nodeId && resp.success[nodeId]) return resp.success[nodeId]
  const keys = Object.keys(resp.success || {})
  return keys.length ? resp.success[keys[0]] : undefined
}

export interface FileEntry {
  key: string
  name: string
  is_dir: boolean
  size: number
  last_modified: string
}

export interface AdminUser {
  id: number
  username: string
  role: 'admin' | 'readonly'
  created_at: string
}
