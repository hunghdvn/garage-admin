import { Text } from '@mantine/core'
import { modals } from '@mantine/modals'
import i18n from '../i18n'

// confirmDelete opens a confirmation modal before running a destructive action.
export function confirmDelete(name: string, onConfirm: () => void) {
  const t = i18n.t.bind(i18n)
  modals.openConfirmModal({
    title: t('common.confirmDeleteTitle'),
    children: <span>{t('common.confirmDeleteBody', { name })}</span>,
    labels: { confirm: t('common.delete'), cancel: t('common.cancel') },
    confirmProps: { color: 'red' },
    onConfirm,
  })
}
