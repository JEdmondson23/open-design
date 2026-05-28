import { useEffect, useState } from 'react';
import type { AcceptWorkspaceInviteResponse } from '@open-design/contracts';
import { acceptWorkspaceInviteResult } from '../state/workspaces';
import { useT } from '../i18n';
import { Icon } from './Icon';

type InviteState =
  | { status: 'joining' }
  | { status: 'joined'; workspaceName: string }
  | { status: 'already-joined'; workspaceName: string }
  | { status: 'error'; title: string; message: string; actionLabel: string; actionHref: string };

function inviteErrorState(error: string, t: ReturnType<typeof useT>): InviteState {
  const normalized = error.toLowerCase();
  if (normalized.includes('revoked')) {
    return {
      status: 'error',
      title: t('workspaceInvite.revokedTitle'),
      message: t('workspaceInvite.revokedMessage'),
      actionLabel: t('workspaceInvite.returnAction'),
      actionHref: '/',
    };
  }
  if (normalized.includes('expired')) {
    return {
      status: 'error',
      title: t('workspaceInvite.expiredTitle'),
      message: t('workspaceInvite.expiredMessage'),
      actionLabel: t('workspaceInvite.returnAction'),
      actionHref: '/',
    };
  }
  if (normalized.includes('already used') || normalized.includes('already accepted')) {
    return {
      status: 'error',
      title: t('workspaceInvite.usedTitle'),
      message: t('workspaceInvite.usedMessage'),
      actionLabel: t('workspaceInvite.openWorkspaceAction'),
      actionHref: '/workspace',
    };
  }
  return {
    status: 'error',
    title: t('workspaceInvite.notFoundTitle'),
    message: error,
    actionLabel: t('workspaceInvite.returnAction'),
    actionHref: '/',
  };
}

export function WorkspaceInviteView({
  token,
  onAccepted,
}: {
  token: string;
  onAccepted: (result: AcceptWorkspaceInviteResponse) => Promise<void>;
}) {
  const t = useT();
  const [state, setState] = useState<InviteState>({ status: 'joining' });

  useEffect(() => {
    let cancelled = false;
    setState({ status: 'joining' });
    void acceptWorkspaceInviteResult(token).then(async (result) => {
      if (cancelled) return;
      if (!result.ok) {
        setState(inviteErrorState(result.error, t));
        return;
      }
      try {
        await onAccepted(result.value);
      } catch {
        if (cancelled) return;
        setState({
          status: 'error',
          title: t('workspaceInvite.joinedSwitchFailedTitle'),
          message: t('workspaceInvite.joinedSwitchFailedMessage'),
          actionLabel: t('workspaceInvite.openWorkspaceAction'),
          actionHref: '/workspace',
        });
        return;
      }
      if (cancelled) return;
      setState({
        status: result.value.acceptedInvite === false ? 'already-joined' : 'joined',
        workspaceName: result.value.workspace.name,
      });
    });
    return () => {
      cancelled = true;
    };
  }, [onAccepted, token]);

  return (
    <main className="workspace-invite-view">
      <section className="workspace-invite-card">
        <a className="workspace-invite-brand" href="/" aria-label={t('app.brand')}>
          <Icon name="orbit" size={18} />
          <span>{t('app.brand')}</span>
        </a>
        {state.status === 'joining' ? (
          <>
            <strong>{t('workspaceInvite.joiningTitle')}</strong>
            <span>{t('workspaceInvite.joiningMessage')}</span>
          </>
        ) : state.status === 'joined' ? (
          <>
            <strong>{t('workspaceInvite.joinedTitle', { name: state.workspaceName })}</strong>
            <span>{t('workspaceInvite.joinedMessage')}</span>
            <a className="workspace-invite-action" href="/workspace">{t('workspaceInvite.openWorkspaceAction')}</a>
          </>
        ) : state.status === 'already-joined' ? (
          <>
            <strong>{t('workspaceInvite.alreadyJoinedTitle', { name: state.workspaceName })}</strong>
            <span>{t('workspaceInvite.alreadyJoinedMessage')}</span>
            <a className="workspace-invite-action" href="/workspace">{t('workspaceInvite.openWorkspaceAction')}</a>
          </>
        ) : (
          <>
            <strong>{state.title}</strong>
            <span>{state.message}</span>
            <a className="workspace-invite-action" href={state.actionHref}>{state.actionLabel}</a>
          </>
        )}
      </section>
    </main>
  );
}
