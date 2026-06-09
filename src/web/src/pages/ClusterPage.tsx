import { Stack, Tabs, Title } from '@mantine/core'
import { ClusterOverview } from '../components/ClusterOverview'
import { ClusterLayout } from '../components/ClusterLayout'

export function ClusterPage() {
  return (
    <Stack>
      <Title order={3}>Cluster</Title>
      <Tabs defaultValue="overview">
        <Tabs.List>
          <Tabs.Tab value="overview">Overview</Tabs.Tab>
          <Tabs.Tab value="layout">Layout</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="overview" pt="md"><ClusterOverview /></Tabs.Panel>
        <Tabs.Panel value="layout" pt="md"><ClusterLayout /></Tabs.Panel>
      </Tabs>
    </Stack>
  )
}
