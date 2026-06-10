import { AppShell as MantineAppShell, Burger, Button, Group, Menu, NavLink, Title } from '@mantine/core'
import { useDisclosure } from '@mantine/hooks'
import { IconDashboard, IconSettings, IconLogout, IconBucket, IconKey, IconServer, IconLockAccess, IconTool, IconFiles, IconUserCircle, IconUsers } from '@tabler/icons-react'
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
            <Menu position="bottom-end" withArrow>
              <Menu.Target>
                <Button variant="subtle" leftSection={<IconUserCircle size={18} />}>{user?.username} ({user?.role})</Button>
              </Menu.Target>
              <Menu.Dropdown>
                <Menu.Item component={Link} to="/profile">Đổi mật khẩu</Menu.Item>
                <Menu.Item color="red" leftSection={<IconLogout size={16} />} onClick={logout}>Đăng xuất</Menu.Item>
              </Menu.Dropdown>
            </Menu>
          </Group>
        </Group>
      </MantineAppShell.Header>
      <MantineAppShell.Navbar p="md">
        <NavLink component={Link} to="/" label="Dashboard" active={loc.pathname === '/'} leftSection={<IconDashboard size={18} />} />
        <NavLink component={Link} to="/buckets" label="Buckets" active={loc.pathname.startsWith('/buckets')} leftSection={<IconBucket size={18} />} />
        <NavLink component={Link} to="/files" label="Files" active={loc.pathname.startsWith('/files')} leftSection={<IconFiles size={18} />} />
        <NavLink component={Link} to="/keys" label="Access Keys" active={loc.pathname.startsWith('/keys')} leftSection={<IconKey size={18} />} />
        <NavLink component={Link} to="/cluster" label="Cluster" active={loc.pathname.startsWith('/cluster')} leftSection={<IconServer size={18} />} />
        <NavLink component={Link} to="/admin-tokens" label="Admin Tokens" active={loc.pathname.startsWith('/admin-tokens')} leftSection={<IconLockAccess size={18} />} />
        <NavLink component={Link} to="/nodes" label="Node Maintenance" active={loc.pathname.startsWith('/nodes')} leftSection={<IconTool size={18} />} />
        <NavLink component={Link} to="/settings" label="Settings" active={loc.pathname === '/settings'} leftSection={<IconSettings size={18} />} />
        {user?.role === 'admin' && (
          <NavLink component={Link} to="/users" label="Users" active={loc.pathname.startsWith('/users')} leftSection={<IconUsers size={18} />} />
        )}
      </MantineAppShell.Navbar>
      <MantineAppShell.Main>{children}</MantineAppShell.Main>
    </MantineAppShell>
  )
}
