import { Group, SegmentedControl, useMantineColorScheme, ActionIcon } from '@mantine/core'
import { IconSun, IconMoon } from '@tabler/icons-react'
import { themeNames, loadThemeName, saveThemeName } from '../theme/themes'

export function ThemeSwitcher() {
  const { colorScheme, toggleColorScheme } = useMantineColorScheme()

  function changeTheme(name: string) {
    saveThemeName(name)
    window.location.reload() // re-create MantineProvider with the new preset
  }

  return (
    <Group gap="xs">
      <SegmentedControl size="xs" data={themeNames} value={loadThemeName()} onChange={changeTheme} />
      <ActionIcon variant="default" onClick={toggleColorScheme} aria-label="toggle color scheme">
        {colorScheme === 'dark' ? <IconSun size={16} /> : <IconMoon size={16} />}
      </ActionIcon>
    </Group>
  )
}
