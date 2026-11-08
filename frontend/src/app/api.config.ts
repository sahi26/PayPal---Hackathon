import { resolveApiBaseUrl } from './runtime-config.mjs';

declare global {
  var __PROOFFLOW_CONFIG__: { apiBaseUrl?: string } | undefined;
}

export function getApiBaseUrl(): string {
  const location = typeof window !== 'undefined' ? window.location : undefined;
  // Set globalThis.__PROOFFLOW_CONFIG__.apiBaseUrl before app startup to override the production API origin.
  return resolveApiBaseUrl(location, globalThis.__PROOFFLOW_CONFIG__?.apiBaseUrl);
}

export const API_BASE_URL = getApiBaseUrl();
