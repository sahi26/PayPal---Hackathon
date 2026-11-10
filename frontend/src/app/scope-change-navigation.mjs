export function parseNotificationAction(actionUrl, userRoleType, notification) {
  if (typeof actionUrl !== 'string' || !actionUrl.trim()) {
    return { url: '', openScopeChangeProjectId: null };
  }

  const trimmed = actionUrl.trim();
  const [withoutHash, hash = ''] = trimmed.split('#', 2);
  const [path, query = ''] = withoutHash.split('?', 2);
  const params = new URLSearchParams(query);

  const hadScopeChangeParam = params.get('scope_change') === '1';
  params.delete('scope_change');

  const role = typeof userRoleType === 'string' ? userRoleType.toLowerCase() : '';
  if (role && path.startsWith('/project/')) {
    const resolvedRole = role === 'seller' || role === 'maker' ? 'seller' : 'buyer';
    params.set('role', resolvedRole);
  }

  const fulfillmentMatch = /^\/project\/(\d+)\/fulfillment(?:\/|$)/.exec(path);
  const projectIdFromRoute = fulfillmentMatch ? Number(fulfillmentMatch[1]) : 0;
  const projectIdFromNotif = Number(notification?.action_data?.project_id ?? notification?.project_id ?? 0);
  const targetProjectId = projectIdFromRoute > 0 ? projectIdFromRoute : projectIdFromNotif;

  const wantsOpenScopeChange =
    hadScopeChangeParam || notification?.action_data?.open_scope_change === true;

  const queryString = params.toString();
  const cleanUrl = `${path}${queryString ? `?${queryString}` : ''}${hash ? `#${hash}` : ''}`;

  return {
    url: cleanUrl,
    openScopeChangeProjectId: wantsOpenScopeChange && targetProjectId > 0 ? targetProjectId : null
  };
}

export class ScopeChangeOpenStore {
  constructor() {
    this.pendingProjectId = null;
  }

  requestOpen(projectId) {
    const numericId = Number(projectId);
    if (Number.isInteger(numericId) && numericId > 0) {
      this.pendingProjectId = numericId;
    }
  }

  consumePending(projectId) {
    const numericId = Number(projectId);
    if (
      this.pendingProjectId !== null &&
      Number.isInteger(numericId) &&
      numericId > 0 &&
      this.pendingProjectId === numericId
    ) {
      this.pendingProjectId = null;
      return true;
    }
    return false;
  }

  clear() {
    this.pendingProjectId = null;
  }
}
