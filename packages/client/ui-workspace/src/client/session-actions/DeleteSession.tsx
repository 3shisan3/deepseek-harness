/** Session delete hover button, session-header action, and its confirmation. */
import { useState } from 'react'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import {
  Button, IconTrashOutlineRegular, Modal, Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {
  DeleteSessionInjected, SessionDeleteConfirmProps, SessionDeleteConfirmRequest,
  SessionRowActionProps,
} from '../contract/slots.ts'
import css from '../rows/Rows.module.css'
import browserCss from '../rows/WorkspaceBrowser.module.css'
import headerCss from './DeleteSession.module.css'

type LocaleSeat = PropsLocale<'workspace'>['t']

type RowActionProps = SessionRowActionProps<DeleteSessionInjected>

/**
 * Hover button (order 300), also visible on archived rows: destroying a Session
 * out of the archived list is the common path. Absent while the Session's
 * access snapshot excludes deletion.
 * @param props - owner share, the access Hook, and the delete share.
 * @returns the button, or null when the caller may not delete this Session.
 */
export function DeleteSessionRowButton({ sessionId, useSessionAccess, requestSessionDelete, t }: RowActionProps) {
  const allowed = useSessionAccess(sessionId, 'workspace/deleteSession')
  if (!allowed) return null
  return (
    <Tooltip label={t('actions.delete')} side="bottom" align="end" delayMs={500} portal>
      <button
        type="button"
        className={css.iconButton}
        aria-label={t('menu.deleteSession')}
        onClick={() => { requestSessionDelete(sessionId) }}
      >
        <IconTrashOutlineRegular size={14} />
      </button>
    </Tooltip>
  )
}

/** Full props for the Session-header delete action. */
export type DeleteSessionHeaderActionProps =
  PropsRuntime<'conversation.session.header.actions'>
  & PropsLocale<'workspace'>
  & InjectFace<DeleteSessionInjected>

/**
 * Session-header action: asks for the same confirmation as the row, and is
 * absent while the Session's access snapshot excludes deletion.
 * @param props - session identity, the access Hook, the delete share, and the locale seat.
 * @returns the button, or null when the caller may not delete this Session.
 */
export function DeleteSessionHeaderAction({ sessionId, useSessionAccess, requestSessionDelete, t }: DeleteSessionHeaderActionProps) {
  const allowed = useSessionAccess(sessionId, 'workspace/deleteSession')
  if (!allowed) return null
  return (
    <Tooltip label={t('actions.delete')} side="bottom" delayMs={500} portal>
      <button
        type="button"
        className={headerCss.headerAction}
        aria-label={t('menu.deleteSession')}
        onClick={() => { requestSessionDelete(sessionId) }}
      >
        <IconTrashOutlineRegular size={14} />
      </button>
    </Tooltip>
  )
}

/**
 * The `shell.overlay` entry: nothing while no confirmation is pending,
 * otherwise one dialog per request (keyed by the Session). Confirming asks the
 * Host to destroy the Session; cancelling leaves it untouched.
 * @param props - the request hook, its settlement, the destructive hop, and the locale seat.
 * @returns the open dialog, or null.
 */
export function SessionDeleteConfirmDialog({
  useDeleteRequest, settleSessionDelete, deleteSession, t,
}: SessionDeleteConfirmProps) {
  const request = useDeleteRequest(pending => pending)
  if (request === null) return null
  return (
    <DeleteConfirmForm
      key={request.sessionId}
      request={request}
      deleteSession={deleteSession}
      onSettle={settleSessionDelete}
      t={t}
    />
  )
}

/** One request's dialog: in-flight and error state die with it. */
function DeleteConfirmForm({ request, deleteSession, onSettle, t }: {
  request: SessionDeleteConfirmRequest
  deleteSession: SessionDeleteConfirmProps['deleteSession']
  onSettle: () => void
  t: LocaleSeat
}) {
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const close = () => {
    if (deleting) return
    onSettle()
  }
  const confirm = () => {
    setDeleting(true)
    setError(null)
    deleteSession(request.sessionId).then(() => {
      setDeleting(false)
      onSettle()
    }).catch((reason: unknown) => {
      setDeleting(false)
      setError(reason instanceof Error ? reason.message : String(reason))
    })
  }
  return (
    <Modal
      open
      onClose={close}
      closeLabel={t('close')}
      title={t('delete.confirm.title')}
      description={t('delete.confirm.desc', { title: request.displayTitle })}
      footer={(
        <>
          <Button variant="outline" disabled={deleting} onClick={close}>{t('cancel')}</Button>
          <Button
            variant="outline"
            className={browserCss.deleteAction}
            disabled={deleting}
            onClick={confirm}
          >
            {t('delete.confirm.action')}
          </Button>
        </>
      )}
    >
      {deleting && <div className={browserCss.deleteStatus} role="status">{t('delete.confirm.pending')}</div>}
      {error !== null && <div className={browserCss.renameError} role="alert">{error}</div>}
    </Modal>
  )
}
