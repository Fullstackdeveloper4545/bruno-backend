function buildAuthHeader(apiKey) {
  const raw = String(apiKey || '').trim();
  if (!raw) return null;
  if (/^bearer\s+/i.test(raw)) return raw;
  if (raw.includes(':')) {
    return `Basic ${Buffer.from(raw).toString('base64')}`;
  }
  return `Bearer ${raw}`;
}

function createExternalClient(baseUrl, apiKey) {
  const normalizedBaseUrl = String(baseUrl || '').trim().replace(/\/+$/, '');
  const authHeader = buildAuthHeader(apiKey);

  const request = async (method, path, body) => {
    if (!normalizedBaseUrl) {
      throw new Error('Integration base URL is not configured');
    }

    const safePath = String(path || '').trim();
    const targetUrl = /^https?:\/\//i.test(safePath)
      ? safePath
      : `${normalizedBaseUrl}${safePath.startsWith('/') ? safePath : `/${safePath}`}`;

    const response = await fetch(targetUrl, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(authHeader ? { Authorization: authHeader } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`External API ${method} ${path} failed: ${response.status} ${text}`);
    }

    return response.json();
  };

  return {
    get: (path) => request('GET', path),
    post: (path, body) => request('POST', path, body),
  };
}

module.exports = { createExternalClient };
