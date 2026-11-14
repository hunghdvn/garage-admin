import { useState } from 'react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from 'h2d-glass-ui'
import { ClusterOverview } from '../components/ClusterOverview'
import { ClusterLayout } from '../components/ClusterLayout'
import { useTranslation } from 'react-i18next'

export function ClusterPage() {
  const { t } = useTranslation()
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <h3>{t('nav.cluster')}</h3>
      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">{t('cluster.overview')}</TabsTrigger>
          <TabsTrigger value="layout">{t('cluster.layout')}</TabsTrigger>
        </TabsList>
        <TabsContent value="overview"><ClusterOverview /></TabsContent>
        <TabsContent value="layout"><ClusterLayout /></TabsContent>
      </Tabs>
    </div>
  )
}
