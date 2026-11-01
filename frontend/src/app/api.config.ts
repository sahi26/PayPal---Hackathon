// Central API Configuration
export function getApiBaseUrl(): string {
  if (typeof window !== 'undefined') {
    if (window.location.hostname === '127.0.0.1') {
      return 'http://127.0.0.1:8000';
    }
  }
  return 'http://localhost:8000';
}

export const API_BASE_URL = getApiBaseUrl();
