function createExternalClient(baseUrl, apiKey) {
  const request = async (method, path, body) => {
    if (!baseUrl) {
      throw new Error('Integration base URL is not configured');
    }

    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
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
