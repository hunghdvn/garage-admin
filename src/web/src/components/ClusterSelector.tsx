import { Select, SelectItem } from 'h2d-glass-ui'
import { useQueryClient } from '@tanstack/react-query'
import { useCluster } from '../cluster/ClusterContext'
import { setSelectedClusterId } from '../api/client'

export function ClusterSelector() {
  const { clusters, selectedId, setSelectedId } = useCluster()
  const qc = useQueryClient()
  if (clusters.length === 0) return null
  return (
    <Select
      size="sm"
      value={selectedId != null ? String(selectedId) : null}
      onValueChange={(v) => {
        if (v) {
          const id = Number(v)
          setSelectedClusterId(id)
          setSelectedId(id)
          qc.invalidateQueries()
        }
      }}
      placeholder="Cluster"
    >
      {clusters.map((c) => (
        <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
      ))}
    </Select>
  )
}
