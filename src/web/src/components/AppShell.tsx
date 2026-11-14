import { Link, useLocation } from 'react-router'
import { type ReactNode } from 'react'
import { useAuth } from '../auth/AuthContext'
import { useTranslation } from 'react-i18next'
import { AppShell as GlassAppShell, AppShellHeader, AppShellSidebar, AppShellMain } from 'h2d-glass-ui'
import { Nav, NavItem, NavSection } from 'h2d-glass-ui'
import { UserMenu, MenuItem, ThemeSwitch } from 'h2d-glass-ui'
import { ClusterSelector } from './ClusterSelector'
import { IconDashboard, IconBucket, IconFiles, IconKey, IconServer, IconLockAccess, IconTool, IconSettings, IconUsers } from '@tabler/icons-react'

export function AppShell({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth()
  const { t } = useTranslation()
  const loc = useLocation()

  return (
    <GlassAppShell brand={<span>Garage Admin</span>} breakpoint="md">
      <AppShellHeader sidebarTrigger>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
          <ThemeSwitch />
          <ClusterSelector />
          <UserMenu name={user?.username ?? ''} description={user?.role} showName>
            <MenuItem asChild><Link to="/profile">{t('appshell.changePassword')}</Link></MenuItem>
            <MenuItem variant="danger" onSelect={() => logout()}>{t('appshell.logout')}</MenuItem>
          </UserMenu>
        </div>
      </AppShellHeader>
      <AppShellSidebar>
        <Nav>
          <NavSection>
            <NavItem asChild icon={<IconDashboard size={18} />} active={loc.pathname === '/'}><Link to="/">{t('nav.dashboard')}</Link></NavItem>
            <NavItem asChild icon={<IconBucket size={18} />} active={loc.pathname.startsWith('/buckets')}><Link to="/buckets">{t('nav.buckets')}</Link></NavItem>
            <NavItem asChild icon={<IconFiles size={18} />} active={loc.pathname.startsWith('/files')}><Link to="/files">{t('nav.files')}</Link></NavItem>
            <NavItem asChild icon={<IconKey size={18} />} active={loc.pathname.startsWith('/keys')}><Link to="/keys">{t('nav.accessKeys')}</Link></NavItem>
            <NavItem asChild icon={<IconServer size={18} />} active={loc.pathname.startsWith('/cluster')}><Link to="/cluster">{t('nav.cluster')}</Link></NavItem>
            <NavItem asChild icon={<IconLockAccess size={18} />} active={loc.pathname.startsWith('/admin-tokens')}><Link to="/admin-tokens">{t('nav.adminTokens')}</Link></NavItem>
            <NavItem asChild icon={<IconTool size={18} />} active={loc.pathname.startsWith('/nodes')}><Link to="/nodes">{t('nav.nodeMaintenance')}</Link></NavItem>
            <NavItem asChild icon={<IconSettings size={18} />} active={loc.pathname === '/settings'}><Link to="/settings">{t('nav.settings')}</Link></NavItem>
            {user?.role === 'admin' && (
              <NavItem asChild icon={<IconUsers size={18} />} active={loc.pathname.startsWith('/users')}><Link to="/users">{t('nav.users')}</Link></NavItem>
            )}
          </NavSection>

        </Nav>
      </AppShellSidebar>
      <AppShellMain>{children}</AppShellMain>
    </GlassAppShell>
  )
}