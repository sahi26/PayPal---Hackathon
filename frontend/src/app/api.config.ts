import { resolveApiBaseUrl } from './runtime-config.mjs';

declare global {
  var __PROOFLENS_CONFIG__: { apiBaseUrl?: string } | undefined;
  var _PROOFLENS_CONFIG_: { apiBaseUrl?: string } | undefined;
  var __PROOFFLOW_CONFIG__: { apiBaseUrl?: string } | undefined;
  var _PROOFFLOW_CONFIG_: { apiBaseUrl?: string } | undefined;
}

export function getApiBaseUrl(): string {
  const location = typeof window !== 'undefined' ? window.location : undefined;
  const globalObj = globalThis as any;
  const configured =
    globalObj?.__PROOFLENS_CONFIG__?.apiBaseUrl ||
    globalObj?._PROOFLENS_CONFIG_?.apiBaseUrl ||
    globalObj?.__PROOFFLOW_CONFIG__?.apiBaseUrl ||
    globalObj?._PROOFFLOW_CONFIG_?.apiBaseUrl ||
    (location && location.hostname && location.hostname.endsWith('vercel.app')
      ? 'https://paypal-hackathon-backend.onrender.com'
      : undefined);
  return resolveApiBaseUrl(location, configured);
}

export const API_BASE_URL = getApiBaseUrl();
