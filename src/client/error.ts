/**
 * Error classification and user-facing toast messages.
 *
 * Maps HTTP status codes and network errors to i18n-aware toasts.
 * For 402 errors, includes a deep link to the billing page.
 */

import * as vscode from 'vscode'
import { t } from '../i18n'
import { billingUrl } from '../runtime/endpoint'
import * as logger from '../logger'

/**
 * Show an error toast appropriate for the given HTTP status or
 * network error.
 */
export function showErrorToast(statusOrMessage: number | string): void {
  if (typeof statusOrMessage === 'number') {
    switch (statusOrMessage) {
      case 401:
      case 403:
        vscode.window.showErrorMessage(t('error.401'))
        break
      case 402: {
        const url = billingUrl()
        vscode.window
          .showErrorMessage(t('error.402'), t('error.topUp'))
          .then((action) => {
            if (action === t('error.topUp')) {
              void vscode.env.openExternal(vscode.Uri.parse(url))
            }
          })
        break
      }
      case 429:
        vscode.window.showWarningMessage(t('error.429'))
        break
      default:
        if (statusOrMessage >= 500) {
          vscode.window.showErrorMessage(t('error.5xx'))
        } else {
          vscode.window.showErrorMessage(
            `MiniMax API error (${statusOrMessage}).`
          )
        }
        break
    }
  } else {
    // Network / connection error
    vscode.window.showErrorMessage(t('error.network'))
  }

  logger.error(`Error: ${String(statusOrMessage)}`)
}
