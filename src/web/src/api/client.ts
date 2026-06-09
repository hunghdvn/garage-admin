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
  storageNodesOk: number
  partitions: number
  partitionsQuorum: number
  partitionsAllOk: number
}
