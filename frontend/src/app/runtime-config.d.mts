export interface RuntimeLocation {
  protocol: string;
  hostname: string;
  origin: string;
}

export function resolveApiBaseUrl(
  location: RuntimeLocation | undefined,
  configuredBaseUrl?: string
): string;

export function getStoredAccessToken(serializedUser: string | null): string | null;

export function shouldAttachAuthToken(requestUrl: string, apiBaseUrl: string): boolean;
