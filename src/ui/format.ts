import type { NetworkRequest } from './store';

export const formatBytes = (bytes: number | undefined | null): string => {
  if (bytes === undefined || bytes === null || Number.isNaN(bytes)) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
};

export const formatDuration = (request: NetworkRequest): string => {
  if (request.completedAt === undefined) return request.status === 'pending' ? '…' : '—';
  const ms = request.completedAt - request.startedAt;
  if (ms < 1000) return `${Math.max(0, Math.round(ms))} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
};

export const formatTime = (timestamp: number): string => {
  const date = new Date(timestamp);
  const pad = (value: number, length = 2) => String(value).padStart(length, '0');
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}`;
};

export const requestName = (url: string): string => {
  try {
    const parsed = new URL(url);
    const segments = parsed.pathname.split('/').filter(Boolean);
    const last = segments[segments.length - 1] ?? parsed.host;
    return `${last}${parsed.search}` || parsed.host;
  } catch {
    return url;
  }
};

export const requestHost = (url: string): string => {
  try {
    return new URL(url).host;
  } catch {
    return '';
  }
};

export const shortMimeType = (mimeType: string | undefined): string => {
  if (!mimeType) return '—';
  const base = mimeType.split(';')[0]?.trim() ?? mimeType;
  const [type, subtype] = base.split('/');
  if (!subtype) return base;
  if (subtype.includes('json')) return 'json';
  if (subtype === 'javascript' || subtype === 'x-javascript') return 'js';
  if (type === 'image') return subtype;
  if (type === 'text') return subtype === 'plain' ? 'text' : subtype;
  if (subtype === 'octet-stream') return 'binary';
  if (subtype === 'x-www-form-urlencoded') return 'form';
  return subtype.replace(/^x-/, '');
};

export const statusTone = (request: NetworkRequest): 'ok' | 'redirect' | 'error' | 'pending' => {
  if (request.status === 'failed') return 'error';
  if (request.status === 'pending' && request.httpStatus === undefined) return 'pending';
  const status = request.httpStatus ?? 0;
  if (status >= 400) return 'error';
  if (status >= 300) return 'redirect';
  return 'ok';
};

export const statusLabel = (request: NetworkRequest): string => {
  if (request.status === 'failed') return request.canceled ? 'canceled' : 'failed';
  if (request.httpStatus === undefined) return 'pending';
  return String(request.httpStatus);
};

export const originLabel = (request: NetworkRequest): string => {
  if (request.origin === 'js') return request.jsApi === 'fetch' ? 'JS · fetch' : 'JS · XHR';
  if (request.origin === 'native') return 'Native';
  return 'Native?';
};

export const transportLabel = (request: NetworkRequest): string => {
  if (request.transport === 'okhttp') {
    return request.client === 'custom-client' ? 'OkHttp (custom client)' : 'OkHttp (RN client)';
  }
  return 'NSURLSession';
};

const shellQuote = (value: string): string => `'${value.replace(/'/g, `'\\''`)}'`;

export const toCurl = (request: NetworkRequest): string => {
  const parts = ['curl', '-X', request.method, shellQuote(request.url)];
  for (const [name, value] of Object.entries(request.requestHeaders)) {
    parts.push('-H', shellQuote(`${name}: ${value}`));
  }
  if (request.requestBody?.kind === 'text') {
    parts.push('--data-raw', shellQuote(request.requestBody.value));
  }
  return parts.join(' ');
};

export const prettyPrintBody = (value: string, mimeType: string | undefined): string => {
  if (mimeType && mimeType.includes('json')) {
    try {
      return JSON.stringify(JSON.parse(value), null, 2);
    } catch {
      return value;
    }
  }
  return value;
};

export const sortHeaders = (headers: Record<string, string> | undefined): Array<[string, string]> =>
  Object.entries(headers ?? {}).sort(([a], [b]) => a.localeCompare(b));
