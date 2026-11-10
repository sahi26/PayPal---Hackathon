export interface NotificationActionTarget {
  url: string;
  openScopeChangeProjectId: number | null;
}

export interface NotificationActionMetadata {
  project_id?: number;
  action_data?: {
    project_id?: number;
    open_scope_change?: boolean;
  } | null;
}

export function parseNotificationAction(
  actionUrl: string,
  userRoleType?: string,
  notification?: NotificationActionMetadata | null
): NotificationActionTarget;

export class ScopeChangeOpenStore {
  requestOpen(projectId: number): void;
  consumePending(projectId: number): boolean;
  clear(): void;
}
