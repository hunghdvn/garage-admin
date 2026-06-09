import { AppShell as MantineAppShell, Burger, Group, NavLink, Title } from '@mantine/core'
import { useDisclosure } from '@mantine/hooks'
import { IconDashboard, IconSettings, IconLogout, IconBucket, IconKey, IconServer } from '@tabler/icons-react'
import { Link, useLocation } from 'react-router-dom'
import { type ReactNode } from 'react'
import { useAuth } from '../auth/AuthContext'
import { ThemeSwitcher } from './ThemeSwitcher'
import { ClusterSelector } from './ClusterSelector'

export function AppShell({ children }: { children: ReactNode }) {
  const [opened, { toggle }] = useDisclosure()
  const { user, logout } = useAuth()
  const loc = useLocation()

  return (
    <MantineAppShell
      header={{ height: 56 }}
      navbar={{ width: 240, breakpoint: 'sm', collapsed: { mobile: !opened } }}
      padding="md"
    >
      <MantineAppShell.Header>
        <Group h="100%" px="md" justify="space-between">
          <Group>
            <Burger opened={opened} onClick={toggle} hiddenFrom="sm" size="sm" />
            <Title order={4}>Garage Admin</Title>
          </Group>
          <Group>
            <ClusterSelector />
            <ThemeSwitcher />
            <NavLink label={`${user?.username} (${user?.role})`} leftSection={<IconLogout size={16} />} onClick={logout} w="auto" />
          </Group>
        </Group>
      </MantineAppShell.Header>
      <MantineAppShell.Navbar p="md">
        <NavLink component={Link} to="/" label="Dashboard" active={loc.pathname === '/'} leftSection={<IconDashboard size={18} />} />
        <NavLink component={Link} to="/buckets" label="Buckets" active={loc.pathname.startsWith('/buckets')} leftSection={<IconBucket size={18} />} />
        <NavLink component={Link} to="/keys" label="Access Keys" active={loc.pathname.startsWith('/keys')} leftSection={<IconKey size={18} />} />
        <NavLink component={Link} to="/cluster" label="Cluster" active={loc.pathname.startsWith('/cluster')} leftSection={<IconServer size={18} />} />
        <NavLink component={Link} to="/settings" label="Settings" active={loc.pathname === '/settings'} leftSection={<IconSettings size={18} />} />
      </MantineAppShell.Navbar>
      <MantineAppShell.Main>{children}</MantineAppShell.Main>
    </MantineAppShell>
  )
}
