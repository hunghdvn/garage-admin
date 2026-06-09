import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api, setSelectedClusterId, type Cluster } from '../api/client'

interface ClusterState {
  clusters: Cluster[]
  selectedId: number | null
  setSelectedId: (id: number) => void
}

const ClusterContext = createContext<ClusterState>(null as unknown as ClusterState)
const STORAGE_KEY = 'ga_cluster'

export function ClusterProvider({ children }: { children: ReactNode }) {
  const { data: clusters } = useQuery({
    queryKey: ['clusters'],
    queryFn: async () => (await api.get<Cluster[]>('/clusters')).data,
  })
  const [selectedId, setSelected] = useState<number | null>(() => {
    const v = localStorage.getItem(STORAGE_KEY)
    return v ? Number(v) : null
  })

  // Default to the cluster flagged default (or first) once loaded.
  useEffect(() => {
    if (selectedId == null && clusters && clusters.length > 0) {
      const def = clusters.find((c) => c.is_default) ?? clusters[0]
      setSelected(def.id)
    }
  }, [clusters, selectedId])

  useEffect(() => {
    setSelectedClusterId(selectedId)
    if (selectedId != null) localStorage.setItem(STORAGE_KEY, String(selectedId))
  }, [selectedId])

  function setSelectedId(id: number) {
    setSelected(id)
  }

  return (
    <ClusterContext.Provider value={{ clusters: clusters ?? [], selectedId, setSelectedId }}>
      {children}
    </ClusterContext.Provider>
  )
}

export function useCluster() {
  return useContext(ClusterContext)
}
