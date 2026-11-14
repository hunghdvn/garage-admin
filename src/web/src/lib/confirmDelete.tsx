import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, Button } from 'h2d-glass-ui'
import { useState } from 'react'
import i18n from '../i18n'

// confirmDelete opens a confirmation modal before running a destructive action.
export function confirmDelete(name: string, onConfirm: () => void) {
  // h2d-glass-ui Dialog is controlled; use a one-shot approach via a global modal root is not available,
  // so fall back to native confirm for simplicity.
  if (window.confirm(i18n.t('common.confirmDeleteBody', { name }).replace(/<[^>]*>/g, ''))) {
    onConfirm()
  }
}