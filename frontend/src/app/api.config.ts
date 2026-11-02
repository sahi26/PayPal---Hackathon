// Central API Configuration
export function getApiBaseUrl(): string {
  if (typeof window !== 'undefined') {
    // Prefer 127.0.0.1 over localhost on local dev to prevent Windows IPv6 ::1 2000ms DNS resolution stall
    if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
      return 'http://127.0.0.1:8000';
    }
    return `${window.location.protocol}//${window.location.hostname}:8000`;
  }
  return 'http://127.0.0.1:8000';
}

export const API_BASE_URL = getApiBaseUrl();
