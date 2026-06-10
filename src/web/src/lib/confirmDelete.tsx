import { Text } from '@mantine/core'
import { modals } from '@mantine/modals'

// confirmDelete opens a confirmation modal before running a destructive action.
export function confirmDelete(name: string, onConfirm: () => void) {
  modals.openConfirmModal({
    title: 'Xác nhận xóa',
    children: <Text size="sm">Xóa <b>{name}</b>? Hành động này không thể hoàn tác.</Text>,
    labels: { confirm: 'Xóa', cancel: 'Hủy' },
    confirmProps: { color: 'red' },
    onConfirm,
  })
}
