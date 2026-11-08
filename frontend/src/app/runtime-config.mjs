export function resolveApiBaseUrl(location, configuredBaseUrl) {
  const configured = typeof configuredBaseUrl === 'string' ? configuredBaseUrl.trim() : '';

  if (configured && location) {
    try {
      const parsed = new URL(configured, location.origin);
      if (
        (parsed.protocol === 'http:' || parsed.protocol === 'https:') &&
        !parsed.username &&
        !parsed.password &&
        !(location.protocol === 'https:' && parsed.protocol !== 'https:')
      ) {
        return parsed.href.replace(/\/+$/, '');
      }
    } catch {
      // Fall through to the environment-specific default.
    }
  }

  if (!location) {
    return 'http://127.0.0.1:8000';
  }

  if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') {
    return 'http://127.0.0.1:8000';
  }

  return location.origin.replace(/\/+$/, '');
}

export function getStoredAccessToken(serializedUser) {
  if (typeof serializedUser !== 'string') {
    return null;
  }

  try {
    const user = JSON.parse(serializedUser);
    return typeof user?.access_token === 'string' && user.access_token.trim()
      ? user.access_token.trim()
      : null;
  } catch {
    return null;
  }
}

export function shouldAttachAuthToken(requestUrl, apiBaseUrl) {
  try {
    const apiBase = new URL(apiBaseUrl);
    const request = new URL(requestUrl, apiBase);
    const apiPath = apiBase.pathname.replace(/\/+$/, '');
    const isWithinApiBase = !apiPath || request.pathname === apiPath || request.pathname.startsWith(`${apiPath}/`);
    const isPublicAuthCall = /\/api\/auth\/(?:login|register|verify-email|resend-verification|paypal-config|paypal-login)(?:\/|$)/i.test(request.pathname);

    return (
      (apiBase.protocol === 'http:' || apiBase.protocol === 'https:') &&
      request.origin === apiBase.origin &&
      isWithinApiBase &&
      !isPublicAuthCall
    );
  } catch {
    return false;
  }
}
