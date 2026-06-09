import { Select } from '@mantine/core'
import { useQueryClient } from '@tanstack/react-query'
import { useCluster } from '../cluster/ClusterContext'

export function ClusterSelector() {
  const { clusters, selectedId, setSelectedId } = useCluster()
  const qc = useQueryClient()
  if (clusters.length === 0) return null
  return (
    <Select
      size="xs"
      w={180}
      data={clusters.map((c) => ({ value: String(c.id), label: c.name }))}
      value={selectedId != null ? String(selectedId) : null}
      onChange={(v) => {
        if (v) {
          setSelectedId(Number(v))
          // Refetch cluster-scoped data for the newly selected cluster.
          qc.invalidateQueries()
        }
      }}
      allowDeselect={false}
    />
  )
}
