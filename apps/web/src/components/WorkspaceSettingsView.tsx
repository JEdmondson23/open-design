import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  Workspace,
  WorkspaceActivity,
  WorkspaceInviteWithStatus,
  WorkspaceMembership,
  ResourceShare,
  Routine,
} from '@open-design/contracts';
import type { Project } from '../types';
import { patchProjectResult } from '../state/projects';
import {
  createWorkspaceResult,
  deleteWorkspaceInviteResult,
  deleteWorkspaceResult,
  leaveWorkspaceResult,
  listWorkspaceInvitesResult,
  listWorkspaceActivityResult,
  listWorkspaceMembersResult,
  listWorkspaceSharesResult,
  listWorkspaceRoutinesResult,
  removeWorkspaceMemberResult,
  revokeWorkspaceShareResult,
  transferWorkspaceOwnerResult,
  updateWorkspaceNameResult,
  updateWorkspaceMemberRoleResult,
  type WorkspaceOperationResult,
} from '../state/workspaces';
import { useT } from '../i18n';
import { Icon } from './Icon';

type TFn = ReturnType<typeof useT>;

function isWorkspaceManagerRole(role: Workspace['currentUserRole']) {
  return role === 'owner' || role === 'admin';
}

interface Props {
  workspaces: Workspace[];
  currentWorkspaceId: string;
  currentUserId: string | null;
  projects: Project[];
  onWorkspaceChange: (workspaceId: string) => Promise<void> | void;
  onWorkspaceCreated: (workspace: Workspace) => Promise<void> | void;
  onWorkspaceRemoved: (workspaceId: string) => Promise<void> | void;
  onWorkspaceUpdated: (workspace: Workspace) => Promise<void> | void;
  onProjectsChanged: () => Promise<void> | void;
  onCreateWorkspaceInvite: (
    workspaceId: string,
    options?: { role?: 'admin' | 'member'; expiresInDays?: number },
  ) => Promise<WorkspaceOperationResult<WorkspaceInviteWithStatus>>;
}

function roleLabel(role: WorkspaceMembership['role'], t: TFn) {
  if (role === 'owner') return t('workspaceSettings.roleOwner');
  if (role === 'admin') return t('workspaceSettings.roleAdmin');
  return t('workspaceSettings.roleMember');
}

function accessLabel(role: WorkspaceMembership['role'] | undefined, t: TFn) {
  return role ? roleLabel(role, t) : t('workspaceSettings.loadingAccess');
}

function capabilitySummary(role: WorkspaceMembership['role'] | undefined, isTeamWorkspace: boolean, t: TFn) {
  if (!isTeamWorkspace) return t('workspaceSettings.capabilityPersonal');
  if (role === 'owner') return t('workspaceSettings.capabilityOwner');
  if (role === 'admin') return t('workspaceSettings.capabilityAdmin');
  if (role === 'member') return t('workspaceSettings.capabilityMember');
  return t('workspaceSettings.capabilityNoAccess');
}

function managerOnlyHint(canManage: boolean, t: TFn) {
  return canManage ? null : <p className="workspace-settings__hint">{t('workspaceSettings.adminOwnerRequired')}</p>;
}

function ownerOnlyHint(isOwner: boolean, t: TFn) {
  return isOwner ? null : <p className="workspace-settings__hint">{t('workspaceSettings.ownerRequired')}</p>;
}

function viewerLinksHint(canManage: boolean, t: TFn) {
  return canManage
    ? null
    : <p className="workspace-settings__hint">{t('workspaceSettings.viewerLinksManagerRequired')}</p>;
}

function activityLabel(activity: WorkspaceActivity, t: TFn) {
  const metadata = activity.metadata ?? {};
  const target = activity.targetId ? ` ${activity.targetId}` : '';
  const cleanup = activityCleanupLabel(metadata, t);
  if (activity.action === 'workspace.created') return t('workspaceSettings.activityWorkspaceCreated');
  if (activity.action === 'workspace.renamed') return t('workspaceSettings.activityWorkspaceRenamed', { name: String(metadata.to ?? t('workspaceSettings.newNameFallback')) });
  if (activity.action === 'member.left') return `${t('workspaceSettings.activityMemberLeft')}${cleanup}`;
  if (activity.action === 'member.removed') return `${t('workspaceSettings.activityMemberRemoved')}${target}${cleanup}`;
  if (activity.action === 'member.role_updated') return `${t('workspaceSettings.activityRoleUpdated', { role: String(metadata.to ?? 'member') })}${cleanup}`;
  if (activity.action === 'owner.transferred') return t('workspaceSettings.activityOwnerTransferred', { user: String(metadata.ownerUserId ?? activity.targetId ?? t('workspaceSettings.memberFallback')) });
  if (activity.action === 'invite.created') return t('workspaceSettings.activityInviteCreated', { role: String(metadata.role ?? 'member') });
  if (activity.action === 'invite.revoked') {
    const role = metadata.role ? `${String(metadata.role)} ` : '';
    return t('workspaceSettings.activityInviteRevoked', { role });
  }
  if (activity.action === 'invite.accepted') return t('workspaceSettings.activityInviteAccepted', { role: String(metadata.role ?? 'member') });
  if (activity.action === 'project.created') {
    const projectName = String(metadata.projectName ?? activity.targetId ?? t('workspaceSettings.projectFallback'));
    return metadata.source
      ? t('workspaceSettings.activityProjectCreatedFrom', { project: projectName, source: String(metadata.source) })
      : t('workspaceSettings.activityProjectCreated', { project: projectName });
  }
  if (activity.action === 'project.deleted') {
    const projectName = String(metadata.projectName ?? activity.targetId ?? t('workspaceSettings.projectFallback'));
    return t('workspaceSettings.activityProjectDeleted', { project: projectName });
  }
  if (activity.action === 'project.imported') {
    const projectName = String(metadata.projectName ?? activity.targetId ?? t('workspaceSettings.projectFallback'));
    return metadata.source
      ? t('workspaceSettings.activityProjectImportedFrom', { project: projectName, source: String(metadata.source) })
      : t('workspaceSettings.activityProjectImported', { project: projectName });
  }
  if (activity.action === 'project.moved') {
    const projectName = String(metadata.projectName ?? t('workspaceSettings.projectFallback'));
    const movedDeploymentCount = Number(metadata.movedDeploymentCount);
    const movedShareCount = Number(metadata.movedShareCount);
    const movedResources = [];
    if (Number.isFinite(movedDeploymentCount) && movedDeploymentCount > 0) {
      movedResources.push(countLabel(movedDeploymentCount, t('workspaceSettings.deploymentSingular'), t('workspaceSettings.deploymentPlural')));
    }
    if (Number.isFinite(movedShareCount) && movedShareCount > 0) {
      movedResources.push(countLabel(movedShareCount, t('workspaceSettings.viewerLinkSingular'), t('workspaceSettings.viewerLinkPlural')));
    }
    return movedResources.length > 0
      ? t('workspaceSettings.activityProjectMovedWith', { project: projectName, resources: movedResources.join(', ') })
      : t('workspaceSettings.activityProjectMoved', { project: projectName });
  }
  if (activity.action === 'project.owner_transferred') {
    const projectName = String(metadata.projectName ?? activity.targetId ?? t('workspaceSettings.projectFallback'));
    return t('workspaceSettings.activityProjectOwnerTransferred', { project: projectName, user: String(metadata.toUserId ?? t('workspaceSettings.memberFallback')) });
  }
  if (activity.action === 'routine.created') return t('workspaceSettings.activityRoutineCreated', { routine: String(metadata.routineName ?? activity.targetId ?? '') }).trim();
  if (activity.action === 'routine.updated') return t('workspaceSettings.activityRoutineUpdated', { routine: String(metadata.routineName ?? activity.targetId ?? '') }).trim();
  if (activity.action === 'routine.deleted') return t('workspaceSettings.activityRoutineDeleted', { routine: String(metadata.routineName ?? activity.targetId ?? '') }).trim();
  if (activity.action === 'routine.owner_transferred') return t('workspaceSettings.activityRoutineOwnerTransferred', { routine: String(metadata.routineName ?? activity.targetId ?? ''), user: String(metadata.toUserId ?? t('workspaceSettings.memberFallback')) }).trim();
  if (activity.action === 'routine.run_requested') return t('workspaceSettings.activityRoutineRun', { routine: String(metadata.routineName ?? activity.targetId ?? '') }).trim();
  if (activity.action === 'share.created') {
    return t('workspaceSettings.activityShareCreated', { project: String(metadata.projectName ?? metadata.projectId ?? t('workspaceSettings.projectFallback')) });
  }
  if (activity.action === 'share.revoked') {
    if (metadata.reason === 'project_deleted') {
      return t('workspaceSettings.activityShareRevokedProjectDeleted', { project: String(metadata.projectName ?? metadata.projectId ?? t('workspaceSettings.projectFallback')) });
    }
    if (metadata.reason === 'artifact_deleted') {
      return t('workspaceSettings.activityShareRevokedArtifactDeleted', { artifact: String(metadata.artifactId ?? t('workspaceSettings.artifactFallback')) });
    }
    return t('workspaceSettings.activityShareRevoked', { project: String(metadata.projectName ?? metadata.projectId ?? t('workspaceSettings.projectFallback')) });
  }
  return activity.action;
}

function activityCleanupLabel(metadata: Record<string, unknown>, t: TFn) {
  const revokedInviteCount = Number(metadata.revokedInviteCount);
  const revokedShareCount = Number(metadata.revokedShareCount);
  const ownedRoutineCount = Number(metadata.ownedRoutineCount);
  const ownedProjectCount = Number(metadata.ownedProjectCount);
  const transferredRoutineCount = Number(metadata.transferredRoutineCount);
  const transferredProjectCount = Number(metadata.transferredProjectCount);
  const transferToUserId = typeof metadata.transferToUserId === 'string' ? metadata.transferToUserId : '';
  const parts = [];
  const revokedParts = [];
  const transferredParts = [];
  if (Number.isFinite(revokedInviteCount) && revokedInviteCount > 0) {
    revokedParts.push(countLabel(revokedInviteCount, t('workspaceSettings.inviteSingular'), t('workspaceSettings.invitePlural')));
  }
  if (Number.isFinite(revokedShareCount) && revokedShareCount > 0) {
    revokedParts.push(countLabel(revokedShareCount, t('workspaceSettings.viewerLinkSingular'), t('workspaceSettings.viewerLinkPlural')));
  }
  if (revokedParts.length > 0) {
    parts.push(t('workspaceSettings.cleanupRevoked', { items: revokedParts.join(', ') }));
  }
  if (Number.isFinite(transferredProjectCount) && transferredProjectCount > 0) {
    transferredParts.push(countLabel(transferredProjectCount, t('workspaceSettings.projectSingular'), t('workspaceSettings.projectPlural')));
  }
  if (Number.isFinite(transferredRoutineCount) && transferredRoutineCount > 0) {
    transferredParts.push(countLabel(transferredRoutineCount, t('workspaceSettings.routineSingular'), t('workspaceSettings.routinePlural')));
  }
  if (transferredParts.length > 0) {
    parts.push(transferToUserId
      ? t('workspaceSettings.cleanupTransferredTo', { items: transferredParts.join(', '), user: transferToUserId })
      : t('workspaceSettings.cleanupTransferred', { items: transferredParts.join(', ') }));
  }
  if (transferredParts.length === 0 && Number.isFinite(ownedRoutineCount) && ownedRoutineCount > 0) {
    parts.push(t('workspaceSettings.cleanupStillOwned', { items: countLabel(ownedRoutineCount, t('workspaceSettings.routineSingular'), t('workspaceSettings.routinePlural')) }));
  }
  if (transferredParts.length === 0 && Number.isFinite(ownedProjectCount) && ownedProjectCount > 0) {
    parts.push(t('workspaceSettings.cleanupStillOwned', { items: countLabel(ownedProjectCount, t('workspaceSettings.projectSingular'), t('workspaceSettings.projectPlural')) }));
  }
  return parts.length > 0 ? ` (${parts.join(', ')})` : '';
}

function activityTimeLabel(createdAt: number) {
  if (!Number.isFinite(createdAt)) return '';
  return new Date(createdAt).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function activityActorLabel(activity: WorkspaceActivity, currentUserId: string | null, t: TFn) {
  return activity.actorUserId === currentUserId ? t('workspaceSettings.you') : activity.actorUserId;
}

function inviteMetaLabel(invite: WorkspaceInviteWithStatus, t: TFn) {
  const parts = [`${invite.role} · ${invite.status}`];
  parts.push(t('workspaceSettings.createdBy', { user: invite.createdByUserId }));
  parts.push(t('workspaceSettings.createdAt', { time: activityTimeLabel(invite.createdAt) }));
  if (invite.expiresAt != null && invite.status !== 'revoked') {
    parts.push(t('workspaceSettings.expiresAt', { time: activityTimeLabel(invite.expiresAt) }));
  }
  if (invite.revokedAt != null) {
    parts.push(t('workspaceSettings.revokedAt', { time: activityTimeLabel(invite.revokedAt) }));
  }
  if (invite.acceptedByUserId) {
    parts.push(t('workspaceSettings.acceptedBy', { user: invite.acceptedByUserId }));
  }
  return parts.filter(Boolean).join(' · ');
}

function shareMetaLabel(share: ResourceShare, t: TFn) {
  const parts = [`${share.projectName ?? share.projectId} · ${t('workspaceSettings.viewerRole')}`];
  if (share.artifactId) {
    parts.push(share.artifactId);
  }
  parts.push(t('workspaceSettings.createdBy', { user: share.createdByUserId }));
  parts.push(t('workspaceSettings.createdAt', { time: activityTimeLabel(share.createdAt) }));
  if (share.revokedAt != null) {
    parts.push(t('workspaceSettings.revokedAt', { time: activityTimeLabel(share.revokedAt) }));
  }
  return parts.filter(Boolean).join(' · ');
}

function inviteTitle(invite: WorkspaceInviteWithStatus, t: TFn) {
  if (invite.status === 'pending') return invite.inviteUrl ?? t('workspaceSettings.inviteLink');
  if (invite.status === 'accepted') return t('workspaceSettings.inviteAccepted');
  if (invite.status === 'revoked') return t('workspaceSettings.inviteRevoked');
  if (invite.status === 'expired') return t('workspaceSettings.inviteExpired');
  return t('workspaceSettings.inviteLink');
}

function memberTitle(member: WorkspaceMembership, currentUserId: string | null, t: TFn) {
  return member.userId === currentUserId ? t('workspaceSettings.you') : member.userId;
}

function memberSubtitle(member: WorkspaceMembership, currentUserId: string | null, t: TFn) {
  const parts = [member.userId === currentUserId ? member.userId : roleLabel(member.role, t)];
  const ownedProjectCount = Number(member.ownedProjectCount);
  const ownedRoutineCount = Number(member.ownedRoutineCount);
  const assetParts = [];
  if (Number.isFinite(ownedProjectCount) && ownedProjectCount > 0) {
    assetParts.push(countLabel(ownedProjectCount, t('workspaceSettings.projectSingular'), t('workspaceSettings.projectPlural')));
  }
  if (Number.isFinite(ownedRoutineCount) && ownedRoutineCount > 0) {
    assetParts.push(countLabel(ownedRoutineCount, t('workspaceSettings.routineSingular'), t('workspaceSettings.routinePlural')));
  }
  if (assetParts.length > 0) {
    parts.push(t('workspaceSettings.ownsAssets', { items: assetParts.join(', ') }));
  }
  if (member.joinedAt) {
    parts.push(t('workspaceSettings.joinedAt', { time: activityTimeLabel(member.joinedAt) }));
  }
  return parts.join(' · ');
}

function memberInitial(member: WorkspaceMembership, currentUserId: string | null) {
  if (member.userId === currentUserId) return 'Y';
  return (member.userId.trim()[0] ?? '?').toUpperCase();
}

function countLabel(count: number, singular: string, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function joinImpactParts(parts: string[], t: TFn) {
  if (parts.length === 0) return '';
  if (parts.length === 1) return parts[0] ?? '';
  return t('workspaceSettings.joinList', { head: parts.slice(0, -1).join(', '), tail: parts[parts.length - 1] ?? '' });
}

function leaveWorkspaceImpactLabel(member: WorkspaceMembership | undefined, ownerUserId: string | undefined, t: TFn) {
  const ownedProjectCount = Number(member?.ownedProjectCount);
  const ownedRoutineCount = Number(member?.ownedRoutineCount);
  const parts = [];
  if (Number.isFinite(ownedProjectCount) && ownedProjectCount > 0) {
    parts.push(countLabel(ownedProjectCount, t('workspaceSettings.projectSingular'), t('workspaceSettings.projectPlural')));
  }
  if (Number.isFinite(ownedRoutineCount) && ownedRoutineCount > 0) {
    parts.push(countLabel(ownedRoutineCount, t('workspaceSettings.routineSingular'), t('workspaceSettings.routinePlural')));
  }
  if (parts.length === 0) return t('workspaceSettings.leaveImpactNoAssets');
  return ownerUserId
    ? t('workspaceSettings.leaveImpactWithRecipient', { items: joinImpactParts(parts, t), user: ownerUserId })
    : t('workspaceSettings.leaveImpact', { items: joinImpactParts(parts, t) });
}

function removeMemberImpactLabel(member: WorkspaceMembership, transferToUserId: string, t: TFn) {
  const ownedProjectCount = Number(member.ownedProjectCount);
  const ownedRoutineCount = Number(member.ownedRoutineCount);
  const parts = [];
  if (Number.isFinite(ownedProjectCount) && ownedProjectCount > 0) {
    parts.push(countLabel(ownedProjectCount, t('workspaceSettings.projectSingular'), t('workspaceSettings.projectPlural')));
  }
  if (Number.isFinite(ownedRoutineCount) && ownedRoutineCount > 0) {
    parts.push(countLabel(ownedRoutineCount, t('workspaceSettings.routineSingular'), t('workspaceSettings.routinePlural')));
  }
  if (parts.length === 0) return t('workspaceSettings.removeMemberImpactNoAssets');
  return t('workspaceSettings.removeMemberImpact', { items: joinImpactParts(parts, t), user: transferToUserId });
}

function memberRoleChangeImpactLabel(member: WorkspaceMembership, role: 'admin' | 'member', t: TFn) {
  if (role === 'admin') {
    return t('workspaceSettings.roleChangeToAdminImpact', { user: member.userId });
  }
  return t('workspaceSettings.roleChangeToMemberImpact', { user: member.userId });
}

function adminInviteImpactLabel(workspaceName: string, expiresInDays: number, t: TFn) {
  return Number.isFinite(expiresInDays) && expiresInDays > 0
    ? t('workspaceSettings.adminInviteImpactWithExpiry', { workspace: workspaceName, days: expiresInDays })
    : t('workspaceSettings.adminInviteImpact', { workspace: workspaceName });
}

function transferWorkspaceOwnerImpactLabel(workspaceName: string, ownerUserId: string, t: TFn) {
  return t('workspaceSettings.transferWorkspaceOwnerImpact', { user: ownerUserId, workspace: workspaceName });
}

function moveProjectImpactLabel(projectName: string, targetWorkspaceName: string, t: TFn) {
  return t('workspaceSettings.moveProjectImpact', { project: projectName, workspace: targetWorkspaceName });
}

function transferProjectOwnerImpactLabel(projectName: string, ownerUserId: string, t: TFn) {
  return t('workspaceSettings.transferProjectOwnerImpact', { project: projectName, user: ownerUserId });
}

function revokeInviteImpactLabel(invite: WorkspaceInviteWithStatus, t: TFn) {
  return t('workspaceSettings.revokeInviteImpact', { role: invite.role });
}

function revokeViewerLinkImpactLabel(share: ResourceShare, t: TFn) {
  const target = share.projectName ?? share.projectId;
  return share.artifactId
    ? t('workspaceSettings.revokeViewerLinkImpactWithArtifact', { target, artifact: share.artifactId })
    : t('workspaceSettings.revokeViewerLinkImpact', { target });
}

function deleteWorkspaceImpactLabel(input: { memberCount: number; pendingInviteCount: number; shareCount: number }, t: TFn) {
  const parts = [];
  if (input.memberCount > 0) parts.push(countLabel(input.memberCount, t('workspaceSettings.memberRecordSingular'), t('workspaceSettings.memberRecordPlural')));
  if (input.pendingInviteCount > 0) parts.push(countLabel(input.pendingInviteCount, t('workspaceSettings.pendingInviteSingular'), t('workspaceSettings.pendingInvitePlural')));
  if (input.shareCount > 0) parts.push(countLabel(input.shareCount, t('workspaceSettings.viewerLinkSingular'), t('workspaceSettings.viewerLinkPlural')));
  parts.push(t('workspaceSettings.activityHistory'));
  return t('workspaceSettings.deleteWorkspaceImpact', { items: joinImpactParts(parts, t) });
}

async function copyText(text: string): Promise<boolean> {
  if (!text) return false;
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function WorkspaceSettingsView({
  workspaces,
  currentWorkspaceId,
  currentUserId,
  projects,
  onWorkspaceChange,
  onWorkspaceCreated,
  onWorkspaceRemoved,
  onWorkspaceUpdated,
  onProjectsChanged,
  onCreateWorkspaceInvite,
}: Props) {
  const t = useT();
  const [members, setMembers] = useState<WorkspaceMembership[]>([]);
  const [invites, setInvites] = useState<WorkspaceInviteWithStatus[]>([]);
  const [shares, setShares] = useState<ResourceShare[]>([]);
  const [routines, setRoutines] = useState<Routine[]>([]);
  const [activities, setActivities] = useState<WorkspaceActivity[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [newWorkspaceName, setNewWorkspaceName] = useState('');
  const [creatingWorkspace, setCreatingWorkspace] = useState(false);
  const [workspaceName, setWorkspaceName] = useState('');
  const [renamingWorkspaceId, setRenamingWorkspaceId] = useState<string | null>(null);
  const [leavingWorkspaceId, setLeavingWorkspaceId] = useState<string | null>(null);
  const [deletingWorkspaceId, setDeletingWorkspaceId] = useState<string | null>(null);
  const [inviteRole, setInviteRole] = useState<'member' | 'admin'>('member');
  const [inviteExpiresInDays, setInviteExpiresInDays] = useState(7);
  const [creatingInviteWorkspaceId, setCreatingInviteWorkspaceId] = useState<string | null>(null);
  const [showInviteHistory, setShowInviteHistory] = useState(false);
  const [ownerTargetUserId, setOwnerTargetUserId] = useState('');
  const [transferringOwnerWorkspaceId, setTransferringOwnerWorkspaceId] = useState<string | null>(null);
  const [updatingMemberIds, setUpdatingMemberIds] = useState<Set<string>>(() => new Set());
  const [removingMemberIds, setRemovingMemberIds] = useState<Set<string>>(() => new Set());
  const [memberAssetTransferTargets, setMemberAssetTransferTargets] = useState<Record<string, string>>({});
  const [revokingInviteIds, setRevokingInviteIds] = useState<Set<string>>(() => new Set());
  const [revokingShareIds, setRevokingShareIds] = useState<Set<string>>(() => new Set());
  const [projectMoveTargets, setProjectMoveTargets] = useState<Record<string, string>>({});
  const [movingProjectIds, setMovingProjectIds] = useState<Set<string>>(() => new Set());
  const [projectOwnerTargets, setProjectOwnerTargets] = useState<Record<string, string>>({});
  const [transferringProjectOwnerIds, setTransferringProjectOwnerIds] = useState<Set<string>>(() => new Set());
  const currentWorkspaceIdRef = useRef(currentWorkspaceId);
  currentWorkspaceIdRef.current = currentWorkspaceId;
  const refreshSerialRef = useRef(0);
  const renamingWorkspace = renamingWorkspaceId === currentWorkspaceId;
  const leavingWorkspace = leavingWorkspaceId === currentWorkspaceId;
  const deletingWorkspace = deletingWorkspaceId === currentWorkspaceId;
  const creatingInvite = creatingInviteWorkspaceId === currentWorkspaceId;
  const transferringOwner = transferringOwnerWorkspaceId === currentWorkspaceId;
  const currentWorkspace = useMemo(
    () => workspaces.find((workspace) => workspace.id === currentWorkspaceId) ?? workspaces[0] ?? null,
    [currentWorkspaceId, workspaces],
  );
  const currentMembership = members.find((member) => member.userId === currentUserId);
  const currentWorkspaceRole = currentWorkspace?.currentUserRole ?? currentMembership?.role;
  const canManage = currentWorkspaceRole === 'owner' || currentWorkspaceRole === 'admin';
  const isOwner = currentWorkspaceRole === 'owner';
  const isTeamWorkspace = currentWorkspace?.kind === 'team';
  const pendingInviteCount = invites.filter((invite) => invite.status === 'pending').length;
  const inactiveInviteCount = invites.length - pendingInviteCount;
  const visibleInvites = showInviteHistory ? invites : invites.filter((invite) => invite.status === 'pending');
  const ownerMember = members.find((member) => member.role === 'owner');
  const transferableMembers = members.filter((member) => member.role !== 'owner');
  const canDeleteWorkspace = Boolean(isTeamWorkspace && isOwner && projects.length === 0 && routines.length === 0);
  const deleteWorkspaceImpact = deleteWorkspaceImpactLabel({
    memberCount: members.length,
    pendingInviteCount,
    shareCount: shares.length,
  }, t);
  const statusItems = [
    { label: t('workspaceSettings.statusMembers'), value: String(members.length) },
    { label: t('workspaceSettings.statusProjects'), value: String(projects.length) },
    { label: t('workspaceSettings.statusAutomations'), value: String(routines.length) },
    { label: t('workspaceSettings.statusPendingInvites'), value: String(pendingInviteCount) },
    { label: t('workspaceSettings.statusViewerLinks'), value: String(shares.length) },
  ];

  const refreshWorkspaceDetails = useCallback(async (workspaceId = currentWorkspaceId) => {
    if (workspaceId !== currentWorkspaceIdRef.current) return;
    const refreshSerial = refreshSerialRef.current + 1;
    refreshSerialRef.current = refreshSerial;
    setLoading(true);
    setLoadError(null);
    setMembers([]);
    setInvites([]);
    setShares([]);
    setRoutines([]);
    setActivities([]);
    const [membersResult, activitiesResult, routinesResult] = await Promise.all([
      listWorkspaceMembersResult(workspaceId),
      listWorkspaceActivityResult(workspaceId),
      listWorkspaceRoutinesResult(workspaceId),
    ]);
    if (workspaceId !== currentWorkspaceIdRef.current || refreshSerial !== refreshSerialRef.current) return;
    const detailError = [membersResult, activitiesResult, routinesResult].find((result) => !result.ok);
    if (detailError && !detailError.ok) {
      setLoadError(t('workspaceSettings.detailsLoadError', { error: detailError.error }));
      setLoading(false);
      return;
    }
    if (!membersResult.ok || !activitiesResult.ok || !routinesResult.ok) return;
    const nextMembers = membersResult.value;
    const nextActivities = activitiesResult.value;
    const nextRoutines = routinesResult.value;
    const workspace = workspaces.find((item) => item.id === workspaceId);
    const nextCurrentMembership = nextMembers.find((member) => member.userId === currentUserId);
    const nextCurrentRole = workspace?.currentUserRole ?? nextCurrentMembership?.role;
    const nextCanManage = isWorkspaceManagerRole(nextCurrentRole);
    let nextInvites: WorkspaceInviteWithStatus[] = [];
    let nextShares: ResourceShare[] = [];
    if (nextCanManage) {
      const sharesResult = await listWorkspaceSharesResult(workspaceId);
      if (workspaceId !== currentWorkspaceIdRef.current || refreshSerial !== refreshSerialRef.current) return;
      if (!sharesResult.ok) {
        setLoadError(t('workspaceSettings.viewerLinksLoadError', { error: sharesResult.error }));
        setLoading(false);
        return;
      }
      nextShares = sharesResult.value;
    }
    if (workspace?.kind === 'team' && nextCanManage) {
      const invitesResult = await listWorkspaceInvitesResult(workspaceId);
      if (workspaceId !== currentWorkspaceIdRef.current || refreshSerial !== refreshSerialRef.current) return;
      if (!invitesResult.ok) {
        setLoadError(t('workspaceSettings.invitesLoadError', { error: invitesResult.error }));
        setLoading(false);
        return;
      }
      nextInvites = invitesResult.value;
    }
    if (workspaceId !== currentWorkspaceIdRef.current || refreshSerial !== refreshSerialRef.current) return;
    setMembers(nextMembers);
    setInvites(nextInvites);
    setShares(nextShares);
    setRoutines(nextRoutines);
    setActivities(nextActivities);
    setLoading(false);
  }, [currentUserId, currentWorkspaceId, t, workspaces]);

  useEffect(() => {
    if (!currentWorkspaceId) return;
    void refreshWorkspaceDetails(currentWorkspaceId);
  }, [currentWorkspaceId, refreshWorkspaceDetails]);

  useEffect(() => {
    setNotice(null);
    setShowInviteHistory(false);
    setMemberAssetTransferTargets({});
    setProjectMoveTargets({});
    setProjectOwnerTargets({});
    setRevokingInviteIds(new Set());
    setRevokingShareIds(new Set());
    setUpdatingMemberIds(new Set());
    setRemovingMemberIds(new Set());
    setMovingProjectIds(new Set());
    setTransferringProjectOwnerIds(new Set());
  }, [currentWorkspaceId]);

  useEffect(() => {
    setWorkspaceName(currentWorkspace?.name ?? '');
  }, [currentWorkspace?.id, currentWorkspace?.name]);

  useEffect(() => {
    const firstTransferable = members.find((member) => member.role !== 'owner')?.userId ?? '';
    setOwnerTargetUserId(firstTransferable);
  }, [members]);

  async function handleCreateWorkspace() {
    if (creatingWorkspace) return;
    const name = newWorkspaceName.trim();
    if (!name) return;
    setCreatingWorkspace(true);
    try {
      const result = await createWorkspaceResult(name);
      if (!result.ok) {
        setNotice(result.error);
        return;
      }
      setNewWorkspaceName('');
      await onWorkspaceCreated(result.value);
      setNotice(t('workspaceSettings.workspaceCreatedNotice', { name: result.value.name }));
      await refreshWorkspaceDetails(result.value.id);
    } finally {
      setCreatingWorkspace(false);
    }
  }

  async function handleRenameWorkspace() {
    if (!currentWorkspace || renamingWorkspace) return;
    const name = workspaceName.trim();
    if (!name || name === currentWorkspace.name) return;
    const workspaceId = currentWorkspace.id;
    setRenamingWorkspaceId(workspaceId);
    try {
      const result = await updateWorkspaceNameResult(workspaceId, name);
      if (!result.ok) {
        if (currentWorkspaceIdRef.current === workspaceId) {
          setNotice(result.error);
        }
        return;
      }
      await onWorkspaceUpdated(result.value);
      if (currentWorkspaceIdRef.current !== workspaceId) return;
      setNotice(t('workspaceSettings.workspaceRenamedNotice'));
      await refreshWorkspaceDetails(result.value.id);
    } finally {
      setRenamingWorkspaceId((current) => (current === workspaceId ? null : current));
    }
  }

  async function handleLeaveWorkspace() {
    if (!currentWorkspace || leavingWorkspace) return;
    const workspace = currentWorkspace;
    const workspaceId = workspace.id;
    const impact = leaveWorkspaceImpactLabel(currentMembership, ownerMember?.userId, t);
    if (!window.confirm(t('workspaceSettings.leaveConfirm', { name: workspace.name, impact }))) {
      return;
    }
    setLeavingWorkspaceId(workspaceId);
    try {
      const result = await leaveWorkspaceResult(workspaceId);
      if (!result.ok) {
        if (currentWorkspaceIdRef.current === workspaceId) {
          setNotice(result.error);
        }
        return;
      }
      await onWorkspaceRemoved(workspaceId);
      if (currentWorkspaceIdRef.current === workspaceId) {
        setNotice(t('workspaceSettings.leftNotice', { name: workspace.name }));
      }
    } finally {
      setLeavingWorkspaceId((current) => (current === workspaceId ? null : current));
    }
  }

  async function handleDeleteWorkspace() {
    if (!currentWorkspace || deletingWorkspace) return;
    const workspace = currentWorkspace;
    const workspaceId = workspace.id;
    if (!window.confirm(t('workspaceSettings.deleteConfirm', { name: workspace.name, impact: deleteWorkspaceImpact }))) {
      return;
    }
    setDeletingWorkspaceId(workspaceId);
    try {
      const result = await deleteWorkspaceResult(workspaceId);
      if (!result.ok) {
        if (currentWorkspaceIdRef.current === workspaceId) {
          setNotice(result.error);
        }
        return;
      }
      await onWorkspaceRemoved(workspaceId);
      if (currentWorkspaceIdRef.current === workspaceId) {
        setNotice(t('workspaceSettings.deletedNotice', { name: workspace.name }));
      }
    } finally {
      setDeletingWorkspaceId((current) => (current === workspaceId ? null : current));
    }
  }

  async function handleInvite() {
    if (!currentWorkspace || creatingInvite) return;
    if (!isTeamWorkspace) {
      setNotice(t('workspaceNav.inviteTeamRequired'));
      return;
    }
    const workspaceId = currentWorkspace.id;
    if (inviteRole === 'admin' && !window.confirm(t('workspaceSettings.adminInviteConfirm', { impact: adminInviteImpactLabel(currentWorkspace.name, inviteExpiresInDays, t) }))) {
      return;
    }
    setCreatingInviteWorkspaceId(workspaceId);
    try {
      const result = await onCreateWorkspaceInvite(workspaceId, {
        role: inviteRole,
        expiresInDays: inviteExpiresInDays,
      });
      if (!result.ok) {
        if (currentWorkspaceIdRef.current === workspaceId) {
          setNotice(result.error);
        }
        return;
      }
      if (currentWorkspaceIdRef.current !== workspaceId) return;
      const invite = result.value;
      if (!invite.inviteUrl) {
        setNotice(t('workspaceSettings.inviteCreateFailed'));
        return;
      }
      const copied = await copyText(invite.inviteUrl);
      setNotice(copied ? t('workspaceSettings.inviteCopied') : invite.inviteUrl);
      await refreshWorkspaceDetails(workspaceId);
    } finally {
      setCreatingInviteWorkspaceId((current) => (current === workspaceId ? null : current));
    }
  }

  async function handleRoleChange(member: WorkspaceMembership, role: 'admin' | 'member') {
    if (updatingMemberIds.has(member.userId)) return;
    if (role === member.role) return;
    const workspaceId = member.workspaceId;
    if (!window.confirm(t('workspaceSettings.roleChangeConfirm', { user: member.userId, role: roleLabel(role, t), impact: memberRoleChangeImpactLabel(member, role, t) }))) {
      return;
    }
    setUpdatingMemberIds((current) => new Set(current).add(member.userId));
    try {
      const result = await updateWorkspaceMemberRoleResult(workspaceId, member.userId, role);
      if (currentWorkspaceIdRef.current !== workspaceId) return;
      if (!result.ok) {
        setNotice(result.error);
        return;
      }
      setMembers((current) => current.map((item) => (
        item.userId === member.userId ? result.value : item
      )));
      await refreshWorkspaceDetails(workspaceId);
    } finally {
      if (currentWorkspaceIdRef.current === workspaceId) {
        setUpdatingMemberIds((current) => {
          const next = new Set(current);
          next.delete(member.userId);
          return next;
        });
      }
    }
  }

  async function handleTransferOwner() {
    if (!currentWorkspace || !ownerTargetUserId || transferringOwner) return;
    if (!window.confirm(t('workspaceSettings.transferOwnershipConfirm', { impact: transferWorkspaceOwnerImpactLabel(currentWorkspace.name, ownerTargetUserId, t) }))) {
      return;
    }
    const workspace = currentWorkspace;
    const workspaceId = workspace.id;
    setTransferringOwnerWorkspaceId(workspaceId);
    try {
      const result = await transferWorkspaceOwnerResult(workspaceId, ownerTargetUserId);
      if (!result.ok) {
        if (currentWorkspaceIdRef.current === workspaceId) {
          setNotice(result.error);
        }
        return;
      }
      if (result.value.previousOwner.userId === currentUserId) {
        await onWorkspaceUpdated({
          ...workspace,
          currentUserRole: result.value.previousOwner.role,
        });
      } else if (result.value.owner.userId === currentUserId) {
        await onWorkspaceUpdated({
          ...workspace,
          currentUserRole: result.value.owner.role,
        });
      }
      if (currentWorkspaceIdRef.current !== workspaceId) return;
      setMembers((current) => current.map((member) => {
        if (member.userId === result.value.previousOwner.userId) return result.value.previousOwner;
        if (member.userId === result.value.owner.userId) return result.value.owner;
        return member;
      }));
      setNotice(t('workspaceSettings.ownershipTransferredNotice'));
      await refreshWorkspaceDetails(workspaceId);
    } finally {
      setTransferringOwnerWorkspaceId((current) => (current === workspaceId ? null : current));
    }
  }

  async function handleRemoveMember(member: WorkspaceMembership) {
    if (removingMemberIds.has(member.userId)) return;
    const workspaceId = member.workspaceId;
    const transferToUserId = memberAssetTransferTargets[member.userId]
      ?? members.find((item) => item.userId !== member.userId && item.userId === currentUserId)?.userId
      ?? members.find((item) => item.userId !== member.userId && item.role === 'owner')?.userId
      ?? members.find((item) => item.userId !== member.userId)?.userId
      ?? '';
    if (!transferToUserId) {
      setNotice(t('workspaceSettings.chooseTransferTargetNotice'));
      return;
    }
    const workspaceName = currentWorkspace?.name ?? t('workspaceSettings.thisWorkspace');
    if (!window.confirm(t('workspaceSettings.removeMemberConfirm', { user: member.userId, workspace: workspaceName, impact: removeMemberImpactLabel(member, transferToUserId, t) }))) {
      return;
    }
    setRemovingMemberIds((current) => new Set(current).add(member.userId));
    try {
      const result = await removeWorkspaceMemberResult(workspaceId, member.userId, { transferToUserId });
      if (currentWorkspaceIdRef.current !== workspaceId) return;
      if (!result.ok) {
        setNotice(result.error);
        return;
      }
      setMembers((current) => current.filter((item) => item.userId !== member.userId));
      await refreshWorkspaceDetails(workspaceId);
    } finally {
      if (currentWorkspaceIdRef.current === workspaceId) {
        setRemovingMemberIds((current) => {
          const next = new Set(current);
          next.delete(member.userId);
          return next;
        });
      }
    }
  }

  async function handleRevokeInvite(invite: WorkspaceInviteWithStatus) {
    if (revokingInviteIds.has(invite.id)) return;
    if (!window.confirm(t('workspaceSettings.revokeInviteConfirm', { impact: revokeInviteImpactLabel(invite, t) }))) {
      return;
    }
    setRevokingInviteIds((current) => new Set(current).add(invite.id));
    try {
      const result = await deleteWorkspaceInviteResult(invite.workspaceId, invite.id);
      if (currentWorkspaceIdRef.current !== invite.workspaceId) return;
      if (!result.ok) {
        setNotice(result.error);
        return;
      }
      setInvites((current) => current.filter((item) => item.id !== invite.id));
      await refreshWorkspaceDetails(invite.workspaceId);
    } finally {
      setRevokingInviteIds((current) => {
        const next = new Set(current);
        next.delete(invite.id);
        return next;
      });
    }
  }

  async function handleCopyInvite(invite: WorkspaceInviteWithStatus) {
    if (invite.status !== 'pending') {
      setNotice(t('workspaceSettings.onlyPendingInviteCopy'));
      return;
    }
    const workspaceId = currentWorkspaceId;
    const link = invite.inviteUrl ?? '';
    const copied = await copyText(link);
    if (currentWorkspaceIdRef.current !== workspaceId) return;
    setNotice(copied ? t('workspaceSettings.inviteCopied') : link || t('workspaceSettings.noInviteLink'));
  }

  async function handleRevokeShare(share: ResourceShare) {
    if (revokingShareIds.has(share.id)) return;
    const workspaceId = currentWorkspaceId;
    if (!window.confirm(t('workspaceSettings.revokeViewerLinkConfirm', { impact: revokeViewerLinkImpactLabel(share, t) }))) {
      return;
    }
    setRevokingShareIds((current) => new Set(current).add(share.id));
    try {
      const result = await revokeWorkspaceShareResult(workspaceId, share.id);
      if (currentWorkspaceIdRef.current !== workspaceId) return;
      if (!result.ok) {
        setNotice(result.error);
        return;
      }
      setShares((current) => current.filter((item) => item.id !== share.id));
      setNotice(t('workspaceSettings.viewerLinkRevokedNotice'));
      await refreshWorkspaceDetails(workspaceId);
    } finally {
      setRevokingShareIds((current) => {
        const next = new Set(current);
        next.delete(share.id);
        return next;
      });
    }
  }

  async function handleCopyShare(share: ResourceShare) {
    const workspaceId = currentWorkspaceId;
    const link = share.shareUrl ?? '';
    const copied = await copyText(link);
    if (currentWorkspaceIdRef.current !== workspaceId) return;
    setNotice(copied ? t('workspaceSettings.viewerLinkCopied') : link || t('workspaceSettings.noViewerLink'));
  }

  async function handleMoveProject(project: Project) {
    if (movingProjectIds.has(project.id)) return;
    const workspaceId = currentWorkspaceId;
    const targetWorkspaceId = projectMoveTargets[project.id] ?? '';
    if (!targetWorkspaceId || targetWorkspaceId === project.workspaceId) return;
    const targetWorkspaceName = workspaces.find((workspace) => workspace.id === targetWorkspaceId)?.name ?? targetWorkspaceId;
    if (!window.confirm(t('workspaceSettings.moveProjectConfirm', { project: project.name, impact: moveProjectImpactLabel(project.name, targetWorkspaceName, t) }))) {
      return;
    }
    setMovingProjectIds((current) => new Set(current).add(project.id));
    try {
      const result = await patchProjectResult(project.id, { workspaceId: targetWorkspaceId });
      if (!result.ok) {
        if (currentWorkspaceIdRef.current === workspaceId) {
          setNotice(result.error);
        }
        return;
      }
      await onProjectsChanged();
      if (currentWorkspaceIdRef.current !== workspaceId) return;
      setProjectMoveTargets((current) => {
        const next = { ...current };
        delete next[project.id];
        return next;
      });
      setNotice(t('workspaceSettings.projectMovedNotice', { project: project.name }));
      await refreshWorkspaceDetails(workspaceId);
    } finally {
      if (currentWorkspaceIdRef.current === workspaceId) {
        setMovingProjectIds((current) => {
          const next = new Set(current);
          next.delete(project.id);
          return next;
        });
      }
    }
  }

  async function handleTransferProjectOwner(project: Project) {
    if (transferringProjectOwnerIds.has(project.id)) return;
    const workspaceId = currentWorkspaceId;
    const ownedByUserId = projectOwnerTargets[project.id] ?? '';
    if (!ownedByUserId || ownedByUserId === project.ownedByUserId) return;
    if (!window.confirm(t('workspaceSettings.transferProjectOwnerConfirm', { project: project.name, impact: transferProjectOwnerImpactLabel(project.name, ownedByUserId, t) }))) {
      return;
    }
    setTransferringProjectOwnerIds((current) => new Set(current).add(project.id));
    try {
      const result = await patchProjectResult(project.id, { ownedByUserId });
      if (!result.ok) {
        if (currentWorkspaceIdRef.current === workspaceId) {
          setNotice(result.error);
        }
        return;
      }
      await onProjectsChanged();
      if (currentWorkspaceIdRef.current !== workspaceId) return;
      setProjectOwnerTargets((current) => {
        const next = { ...current };
        delete next[project.id];
        return next;
      });
      setNotice(t('workspaceSettings.projectOwnerTransferredNotice', { project: project.name }));
      await refreshWorkspaceDetails(workspaceId);
    } finally {
      if (currentWorkspaceIdRef.current === workspaceId) {
        setTransferringProjectOwnerIds((current) => {
          const next = new Set(current);
          next.delete(project.id);
          return next;
        });
      }
    }
  }

  async function handleWorkspaceSelect(workspaceId: string) {
    if (workspaceId === currentWorkspaceId) return;
    setNotice(null);
    try {
      await onWorkspaceChange(workspaceId);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : t('workspaceNav.switchFailed'));
    }
  }

  return (
    <div className="workspace-settings">
      <header className="workspace-settings__header">
        <div>
          <p className="workspace-settings__eyebrow">{t('workspaceNav.title')}</p>
          <h1>{currentWorkspace?.name ?? t('workspaceNav.title')}</h1>
        </div>
        <select
          className="workspace-settings__select"
          value={currentWorkspaceId}
          onChange={(event) => void handleWorkspaceSelect(event.target.value)}
        >
          {workspaces.map((workspace) => (
            <option key={workspace.id} value={workspace.id}>{workspace.name}</option>
          ))}
        </select>
      </header>

      <section className="workspace-settings__summary" aria-label={t('workspaceSettings.accessAria')}>
        <span className="workspace-settings__pill">{accessLabel(currentWorkspaceRole, t)}</span>
        <p>{capabilitySummary(currentWorkspaceRole, Boolean(isTeamWorkspace), t)}</p>
      </section>

      {loadError ? (
        <section className="workspace-settings__load-error" aria-label={t('workspaceSettings.loadStatusAria')}>
          <div>
            <strong>{t('workspaceSettings.detailsUnavailable')}</strong>
            <p>{loadError}</p>
          </div>
          <button type="button" onClick={() => void refreshWorkspaceDetails(currentWorkspaceId)}>
            <Icon name="refresh" size={13} />
            {t('workspaceSettings.retry')}
          </button>
        </section>
      ) : null}

      <section className="workspace-settings__status" aria-label={t('workspaceSettings.statusAria')}>
        {statusItems.map((item) => (
          <div className="workspace-settings__status-item" key={item.label}>
            <strong>{item.value}</strong>
            <span>{item.label}</span>
          </div>
        ))}
        <div className="workspace-settings__status-item workspace-settings__status-item--wide">
          <strong>{ownerMember?.userId ?? t('workspaceSettings.noOwnerLoaded')}</strong>
          <span>{t('workspaceSettings.roleOwner')}</span>
        </div>
      </section>

      <section className="workspace-settings__section">
        <div>
          <h2>{t('workspaceSettings.detailsTitle')}</h2>
          <p>
            {isTeamWorkspace
              ? t('workspaceSettings.detailsTeamBody')
              : t('workspaceSettings.detailsPersonalBody')}
          </p>
          {!isTeamWorkspace ? (
            <p className="workspace-settings__hint">{t('workspaceSettings.personalNameFixed')}</p>
          ) : managerOnlyHint(canManage, t)}
        </div>
        <div className="workspace-settings__inline-form">
          <input
            value={workspaceName}
            onChange={(event) => setWorkspaceName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void handleRenameWorkspace();
            }}
            placeholder={t('workspaceSettings.workspaceNamePlaceholder')}
            disabled={!canManage || !isTeamWorkspace}
          />
          <button
            type="button"
            onClick={() => void handleRenameWorkspace()}
            disabled={!canManage || !isTeamWorkspace || renamingWorkspace || workspaceName.trim() === currentWorkspace?.name}
          >
            <Icon name="check" size={13} />
            {renamingWorkspace ? t('workspaceSettings.saving') : t('common.save')}
          </button>
        </div>
      </section>

      <section className="workspace-settings__section">
        <div>
          <h2>{t('workspaceSettings.createTitle')}</h2>
          <p>{t('workspaceSettings.createBody')}</p>
        </div>
        <div className="workspace-settings__inline-form">
          <input
            value={newWorkspaceName}
            onChange={(event) => setNewWorkspaceName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void handleCreateWorkspace();
            }}
            placeholder={t('workspaceSettings.workspaceNamePlaceholder')}
          />
          <button
            type="button"
            onClick={() => void handleCreateWorkspace()}
            disabled={creatingWorkspace || !newWorkspaceName.trim()}
          >
            <Icon name="plus" size={13} />
            {creatingWorkspace ? t('workspaceSettings.creating') : t('common.create')}
          </button>
        </div>
      </section>

      <section className="workspace-settings__section">
        <div className="workspace-settings__section-head">
          <div>
            <h2>{t('workspaceSettings.membersTitle')}</h2>
            <p>{t('workspaceSettings.membersBody')}</p>
            {!isTeamWorkspace ? (
              <p className="workspace-settings__hint">{t('workspaceNav.inviteTeamRequired')}</p>
            ) : managerOnlyHint(canManage, t)}
          </div>
        </div>
        {loading ? (
          <div className="workspace-settings__empty">{t('workspaceSettings.loadingMembers')}</div>
        ) : (
          <div className="workspace-settings__list">
            {members.map((member) => (
              <div className="workspace-settings__row" key={member.userId}>
                <div className="workspace-settings__member">
                  <span className="workspace-settings__avatar" aria-hidden="true">
                    {memberInitial(member, currentUserId)}
                  </span>
                  <div className="workspace-settings__identity">
                    <strong>{memberTitle(member, currentUserId, t)}</strong>
                    <span>{memberSubtitle(member, currentUserId, t)}</span>
                  </div>
                </div>
                {member.role === 'owner' ? (
                  <div className="workspace-settings__actions">
                    <span className="workspace-settings__pill">{t('workspaceSettings.roleOwner')}</span>
                    <span className="workspace-settings__action-note">{t('workspaceSettings.ownerRoleLocked')}</span>
                  </div>
                ) : (
                  <div className="workspace-settings__actions">
                    {(() => {
                      const updating = updatingMemberIds.has(member.userId);
                      const removing = removingMemberIds.has(member.userId);
                      const busy = updating || removing;
                      const assetTransferMembers = members.filter((item) => item.userId !== member.userId);
                      const assetTransferTarget = memberAssetTransferTargets[member.userId]
                        ?? assetTransferMembers.find((item) => item.userId === currentUserId)?.userId
                        ?? assetTransferMembers.find((item) => item.role === 'owner')?.userId
                        ?? assetTransferMembers[0]?.userId
                        ?? '';
                      return (
                        <>
                    <select
                      value={member.role}
                      disabled={!canManage || member.userId === currentUserId || busy}
                      onChange={(event) => void handleRoleChange(member, event.target.value as 'admin' | 'member')}
                    >
                      <option value="member">{t('workspaceSettings.roleMember')}</option>
                      <option value="admin">{t('workspaceSettings.roleAdmin')}</option>
                    </select>
                    <select
                      aria-label={t('workspaceSettings.transferAssetsAria', { member: memberTitle(member, currentUserId, t) })}
                      value={assetTransferTarget}
                      disabled={!canManage || member.userId === currentUserId || busy || assetTransferMembers.length === 0}
                      onChange={(event) => setMemberAssetTransferTargets((current) => ({
                        ...current,
                        [member.userId]: event.target.value,
                      }))}
                    >
                      {assetTransferMembers.map((targetMember) => (
                        <option key={targetMember.userId} value={targetMember.userId}>
                          {t('workspaceSettings.assetsToMember', { member: memberTitle(targetMember, currentUserId, t) })}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      disabled={!canManage || member.userId === currentUserId || busy || !assetTransferTarget}
                      onClick={() => void handleRemoveMember(member)}
                    >
                      <Icon name="trash" size={13} />
                      {removing ? t('workspaceSettings.removing') : t('workspaceSettings.remove')}
                    </button>
                        </>
                      );
                    })()}
                    {member.userId === currentUserId ? (
                      <span className="workspace-settings__action-note">{t('workspaceSettings.askAdminChangeAccess')}</span>
                    ) : null}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="workspace-settings__section">
        <div className="workspace-settings__section-head">
          <div>
            <h2>{t('workspaceSettings.ownershipTitle')}</h2>
            <p>{t('workspaceSettings.ownershipBody')}</p>
            {!isTeamWorkspace ? (
              <p className="workspace-settings__hint">{t('workspaceSettings.personalOwnershipLocked')}</p>
            ) : !isOwner ? (
              ownerOnlyHint(isOwner, t)
            ) : transferableMembers.length === 0 ? (
              <p className="workspace-settings__hint">{t('workspaceSettings.inviteBeforeTransferOwner')}</p>
            ) : null}
          </div>
          <div className="workspace-settings__actions">
            <select
              value={ownerTargetUserId}
              disabled={!isTeamWorkspace || !isOwner || transferableMembers.length === 0 || transferringOwner}
              onChange={(event) => setOwnerTargetUserId(event.target.value)}
            >
              {transferableMembers.map((member) => (
                <option key={member.userId} value={member.userId}>
                  {member.userId}
                </option>
              ))}
            </select>
            <button
              type="button"
              disabled={!isTeamWorkspace || !isOwner || !ownerTargetUserId || transferringOwner}
              onClick={() => void handleTransferOwner()}
            >
              <Icon name="refresh" size={13} />
              {transferringOwner ? t('workspaceSettings.transferring') : t('workspaceSettings.transferOwner')}
            </button>
          </div>
        </div>
      </section>

      <section className="workspace-settings__section">
        <div className="workspace-settings__section-head">
          <div>
            <h2>{t('workspaceSettings.invitesTitle')}</h2>
            <p>{t('workspaceSettings.invitesBody')}</p>
            {!isTeamWorkspace ? (
              <p className="workspace-settings__hint">{t('workspaceSettings.personalNoInvites')}</p>
            ) : managerOnlyHint(canManage, t)}
          </div>
          <div className="workspace-settings__actions">
            <select
              aria-label={t('workspaceSettings.inviteRoleAria')}
              value={inviteRole}
              disabled={!canManage || !isTeamWorkspace}
              onChange={(event) => setInviteRole(event.target.value as 'member' | 'admin')}
            >
              <option value="member">{t('workspaceSettings.roleMember')}</option>
              <option value="admin">{t('workspaceSettings.roleAdmin')}</option>
            </select>
            <select
              aria-label={t('workspaceSettings.inviteExpiryAria')}
              value={inviteExpiresInDays}
              disabled={!canManage || !isTeamWorkspace}
              onChange={(event) => setInviteExpiresInDays(Number(event.target.value))}
            >
              <option value={1}>{t('workspaceSettings.dayOption', { days: 1 })}</option>
              <option value={7}>{t('workspaceSettings.daysOption', { days: 7 })}</option>
              <option value={14}>{t('workspaceSettings.daysOption', { days: 14 })}</option>
              <option value={30}>{t('workspaceSettings.daysOption', { days: 30 })}</option>
            </select>
            <button
              type="button"
              disabled={!canManage || !isTeamWorkspace || creatingInvite}
              onClick={() => void handleInvite()}
            >
              <Icon name="link" size={13} />
              {creatingInvite ? t('workspaceSettings.creatingInvite') : t('workspaceSettings.createInvite')}
            </button>
            <button
              type="button"
              disabled={!canManage || !isTeamWorkspace || inactiveInviteCount === 0}
              onClick={() => setShowInviteHistory((value) => !value)}
            >
              <Icon name="history" size={13} />
              {showInviteHistory ? t('workspaceSettings.hideHistory') : t('workspaceSettings.showHistory', { count: inactiveInviteCount })}
            </button>
          </div>
        </div>
        <div className="workspace-settings__list">
          {!isTeamWorkspace ? (
            <div className="workspace-settings__empty">{t('workspaceSettings.personalNoInvites')}</div>
          ) : !canManage ? (
            <div className="workspace-settings__empty">{t('workspaceSettings.invitesManagerOnly')}</div>
          ) : invites.length === 0 ? (
            <div className="workspace-settings__empty">{t('workspaceSettings.noInvites')}</div>
          ) : visibleInvites.length === 0 ? (
            <div className="workspace-settings__empty">{t('workspaceSettings.noActiveInvites')}</div>
          ) : visibleInvites.map((invite) => {
            const revoking = revokingInviteIds.has(invite.id);
            return (
              <div className="workspace-settings__row" key={invite.id}>
                <div>
                  <strong>{inviteTitle(invite, t)}</strong>
                  <span>{inviteMetaLabel(invite, t)}</span>
                </div>
                <div className="workspace-settings__actions">
                  <button
                    type="button"
                    disabled={invite.status !== 'pending' || !invite.inviteUrl || revoking}
                    onClick={() => void handleCopyInvite(invite)}
                  >
                    <Icon name="copy" size={13} />
                    {t('workspaceSettings.copy')}
                  </button>
                  <button
                    type="button"
                    disabled={!canManage || invite.status !== 'pending' || revoking}
                    onClick={() => void handleRevokeInvite(invite)}
                  >
                    <Icon name="trash" size={13} />
                    {revoking ? t('workspaceSettings.revoking') : t('workspaceSettings.revoke')}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section className="workspace-settings__section">
        <div className="workspace-settings__section-head">
          <div>
            <h2>{t('workspaceSettings.viewerLinksTitle')}</h2>
            <p>{t('workspaceSettings.viewerLinksBody')}</p>
            {viewerLinksHint(canManage, t)}
          </div>
        </div>
        <div className="workspace-settings__list">
          {!canManage ? (
            <div className="workspace-settings__empty">{t('workspaceSettings.viewerLinksManagerOnly')}</div>
          ) : shares.length === 0 ? (
            <div className="workspace-settings__empty">{t('workspaceSettings.noViewerLinks')}</div>
          ) : shares.map((share) => {
            const revoking = revokingShareIds.has(share.id);
            return (
              <div className="workspace-settings__row" key={share.id}>
                <div>
                  <strong>{share.shareUrl}</strong>
                  <span>{shareMetaLabel(share, t)}</span>
                </div>
                <div className="workspace-settings__actions">
                  <button
                    type="button"
                    disabled={!share.shareUrl || revoking}
                    onClick={() => void handleCopyShare(share)}
                  >
                    <Icon name="copy" size={13} />
                    {t('workspaceSettings.copy')}
                  </button>
                  <button
                    type="button"
                    disabled={!canManage || revoking}
                    onClick={() => void handleRevokeShare(share)}
                  >
                    <Icon name="trash" size={13} />
                    {revoking ? t('workspaceSettings.revoking') : t('workspaceSettings.revoke')}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section className="workspace-settings__section">
        <div className="workspace-settings__section-head">
          <div>
            <h2>{t('workspaceSettings.projectsTitle')}</h2>
            <p>{t('workspaceSettings.projectsBody')}</p>
            {managerOnlyHint(canManage, t)}
          </div>
        </div>
        <div className="workspace-settings__list">
          {projects.length === 0 ? (
            <div className="workspace-settings__empty">{t('workspaceSettings.noProjects')}</div>
          ) : projects.map((project) => {
            const targetWorkspaceId = projectMoveTargets[project.id] ?? '';
            const moving = movingProjectIds.has(project.id);
            const transferringOwner = transferringProjectOwnerIds.has(project.id);
            const projectOwnerMembers = members.filter((member) => member.workspaceId === project.workspaceId);
            const effectiveProjectOwnerUserId =
              project.ownedByUserId ?? project.createdByUserId ?? projectOwnerMembers[0]?.userId ?? '';
            const ownerTargetUserId = projectOwnerTargets[project.id] ?? effectiveProjectOwnerUserId;
            const movableWorkspaces = workspaces.filter((workspace) => (
              workspace.id !== project.workspaceId && isWorkspaceManagerRole(workspace.currentUserRole)
            ));
            return (
              <div className="workspace-settings__row" key={project.id}>
                <div className="workspace-settings__identity">
                  <strong>{project.name}</strong>
                  <span>
                    {project.id}
                    {project.ownedByUserId ? ` · ${t('workspaceSettings.ownedBy', { user: project.ownedByUserId })}` : ''}
                    {project.createdByUserId && project.createdByUserId !== project.ownedByUserId
                      ? ` · ${t('workspaceSettings.createdBy', { user: project.createdByUserId })}`
                      : ''}
                  </span>
                </div>
                <div className="workspace-settings__actions">
                  <select
                    aria-label={t('workspaceSettings.transferProjectOwnerAria', { project: project.name })}
                    value={ownerTargetUserId}
                    disabled={!canManage || transferringOwner || projectOwnerMembers.length === 0}
                    onChange={(event) => setProjectOwnerTargets((current) => ({
                      ...current,
                      [project.id]: event.target.value,
                    }))}
                  >
                    {projectOwnerMembers.map((member) => (
                      <option key={member.userId} value={member.userId}>
                        {t('workspaceSettings.ownerOption', { member: memberTitle(member, currentUserId, t) })}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    disabled={!canManage || !ownerTargetUserId || ownerTargetUserId === effectiveProjectOwnerUserId || transferringOwner}
                    onClick={() => void handleTransferProjectOwner(project)}
                  >
                    <Icon name="edit" size={13} />
                    {transferringOwner ? t('workspaceSettings.transferring') : t('workspaceSettings.transfer')}
                  </button>
                  <select
                    aria-label={t('workspaceSettings.moveProjectAria', { project: project.name })}
                    value={targetWorkspaceId}
                    disabled={!canManage || movableWorkspaces.length === 0 || moving}
                    onChange={(event) => setProjectMoveTargets((current) => ({
                      ...current,
                      [project.id]: event.target.value,
                    }))}
                  >
                    <option value="">{t('workspaceSettings.moveToPlaceholder')}</option>
                    {movableWorkspaces.map((workspace) => (
                      <option key={workspace.id} value={workspace.id}>
                        {workspace.name}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    disabled={!canManage || !targetWorkspaceId || moving}
                    onClick={() => void handleMoveProject(project)}
                  >
                    <Icon name="arrow-left" size={13} />
                    {moving ? t('workspaceSettings.moving') : t('workspaceSettings.move')}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section className="workspace-settings__section workspace-settings__section--danger">
        <div className="workspace-settings__section-head">
          <div>
            <h2>{t('workspaceSettings.lifecycleTitle')}</h2>
            <p>{t('workspaceSettings.lifecycleBody')}</p>
            {!isTeamWorkspace ? (
              <p className="workspace-settings__hint">{t('workspaceSettings.personalCannotLeaveDelete')}</p>
            ) : isOwner ? (
              <>
                <p className="workspace-settings__hint">{t('workspaceSettings.transferBeforeLeaving')}</p>
                {projects.length > 0 ? (
                  <p className="workspace-settings__hint">{t('workspaceSettings.moveProjectsBeforeDelete')}</p>
                ) : null}
                {routines.length > 0 ? (
                  <p className="workspace-settings__hint">{t('workspaceSettings.deleteAutomationsBeforeDelete')}</p>
                ) : null}
                {projects.length === 0 && routines.length === 0 ? (
                  <p className="workspace-settings__hint">{deleteWorkspaceImpact}</p>
                ) : null}
              </>
            ) : null}
          </div>
          <div className="workspace-settings__actions">
            <button
              type="button"
              disabled={!isTeamWorkspace || !currentMembership || isOwner || leavingWorkspace || deletingWorkspace}
              onClick={() => void handleLeaveWorkspace()}
            >
              <Icon name="arrow-left" size={13} />
              {leavingWorkspace ? t('workspaceSettings.leaving') : t('workspaceSettings.leave')}
            </button>
            <button
              type="button"
              disabled={!canDeleteWorkspace || leavingWorkspace || deletingWorkspace}
              onClick={() => void handleDeleteWorkspace()}
            >
              <Icon name="trash" size={13} />
              {deletingWorkspace ? t('workspaceSettings.deleting') : t('common.delete')}
            </button>
          </div>
        </div>
      </section>

      <section className="workspace-settings__section">
        <div className="workspace-settings__section-head">
          <div>
            <h2>{t('workspaceSettings.activityTitle')}</h2>
            <p>{t('workspaceSettings.activityBody')}</p>
          </div>
        </div>
        <div className="workspace-settings__list">
          {activities.length === 0 ? (
            <div className="workspace-settings__empty">{t('workspaceSettings.noActivity')}</div>
          ) : activities.map((activity) => (
            <div className="workspace-settings__row workspace-settings__row--activity" key={activity.id}>
              <div className="workspace-settings__identity">
                <strong>{activityLabel(activity, t)}</strong>
                <span>{activityActorLabel(activity, currentUserId, t)}</span>
              </div>
              <span className="workspace-settings__time">{activityTimeLabel(activity.createdAt)}</span>
            </div>
          ))}
        </div>
      </section>
      {notice ? <div className="workspace-settings__notice">{notice}</div> : null}
    </div>
  );
}
