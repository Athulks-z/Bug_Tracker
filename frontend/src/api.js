const BASE = process.env.REACT_APP_API_URL || '/api';

const getToken = () => localStorage.getItem('bt_token');

const buildQuery = (params = {}) => {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') return;
    if (Array.isArray(value)) {
      value.forEach(v => search.append(key, v));
    } else {
      search.append(key, value);
    }
  });
  const query = search.toString();
  return query ? `?${query}` : '';
};

const req = async (method, path, body, params, responseType = 'json') => {
  const query = buildQuery(params);
  const res = await fetch(`${BASE}${path}${query}`, {
    method,
    headers: {
      ...(responseType === 'json' ? { 'Content-Type': 'application/json' } : {}),
      ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {})
    },
    ...(body ? { body: JSON.stringify(body) } : {})
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({ message: 'Request failed' }));
    throw new Error(data.message || 'Request failed');
  }

  if (responseType === 'blob') return res.blob();
  return res.json();
};

export default {
  get: (p, params) => req('GET', p, undefined, params),
  post: (p, b) => req('POST', p, b),
  put: (p, b) => req('PUT', p, b),
  delete: (p) => req('DELETE', p),
  download: (p, params) => req('GET', p, undefined, params, 'blob')
};
