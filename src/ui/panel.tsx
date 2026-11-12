import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { useRozeniteDevToolsClient } from '@rozenite/plugin-bridge';
import { PLUGIN_ID, type NativeNetworkEventMap, type RecordingStateEvent } from '../shared/events';
import {
  clearRequests,
  createInitialState,
  filterRequests,
  onJsRequestSent,
  onNativeRequestCompleted,
  onNativeRequestFailed,
  onNativeRequestStarted,
  onNativeResponseReceived,
  settleOrigins,
  type NetworkRequest,
  type OriginFilter,
  type StoreState,
} from './store';
import {
  formatBytes,
  formatDuration,
  formatTime,
  originLabel,
  prettyPrintBody,
  requestHost,
  requestName,
  shortMimeType,
  sortHeaders,
  statusLabel,
  statusTone,
  toCurl,
  transportLabel,
} from './format';

import './styles.css';

type Action =
  | { type: 'native-request-started'; payload: NativeNetworkEventMap['native-request-started'] }
  | { type: 'native-response-received'; payload: NativeNetworkEventMap['native-response-received'] }
  | { type: 'native-request-completed'; payload: NativeNetworkEventMap['native-request-completed'] }
  | { type: 'native-request-failed'; payload: NativeNetworkEventMap['native-request-failed'] }
  | { type: 'js-request-sent'; payload: NativeNetworkEventMap['js-request-sent'] }
  | { type: 'settle'; now: number }
  | { type: 'clear' };

const reducer = (state: StoreState, action: Action): StoreState => {
  switch (action.type) {
    case 'native-request-started':
      return onNativeRequestStarted(state, action.payload);
    case 'native-response-received':
      return onNativeResponseReceived(state, action.payload);
    case 'native-request-completed':
      return onNativeRequestCompleted(state, action.payload);
    case 'native-request-failed':
      return onNativeRequestFailed(state, action.payload);
    case 'js-request-sent':
      return onJsRequestSent(state, action.payload);
    case 'settle':
      return settleOrigins(state, action.now);
    case 'clear':
      return clearRequests(state);
  }
};

const copyText = async (text: string) => {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // Clipboard is unavailable in some embedded contexts; nothing to do.
  }
};

export default function NativeNetworkPanel() {
  const client = useRozeniteDevToolsClient<NativeNetworkEventMap>({ pluginId: PLUGIN_ID });
  const [state, dispatch] = useReducer(reducer, undefined, createInitialState);
  const [recording, setRecording] = useState<RecordingStateEvent | null>(null);
  const [query, setQuery] = useState('');
  const [originFilter, setOriginFilter] = useState<OriginFilter>('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [preserveLog, setPreserveLog] = useState(true);
  const listRef = useRef<HTMLDivElement | null>(null);
  const stickToBottom = useRef(true);

  useEffect(() => {
    if (!client) return;

    const subscriptions = [
      client.onMessage('native-request-started', (payload) =>
        dispatch({ type: 'native-request-started', payload }),
      ),
      client.onMessage('native-response-received', (payload) =>
        dispatch({ type: 'native-response-received', payload }),
      ),
      client.onMessage('native-request-completed', (payload) =>
        dispatch({ type: 'native-request-completed', payload }),
      ),
      client.onMessage('native-request-failed', (payload) =>
        dispatch({ type: 'native-request-failed', payload }),
      ),
      client.onMessage('js-request-sent', (payload) =>
        dispatch({ type: 'js-request-sent', payload }),
      ),
      client.onMessage('recording-state', (payload) => {
        setRecording(payload);
        // An app reload drops the device-side queue; start over unless the
        // user asked to keep the log.
        if (!preserveLog && !payload.isRecording) dispatch({ type: 'clear' });
      }),
    ];

    client.send('enable', {});

    return () => subscriptions.forEach((subscription) => subscription.remove());
    // preserveLog is read through the latest closure on each message.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client]);

  useEffect(() => {
    const timer = setInterval(() => dispatch({ type: 'settle', now: Date.now() }), 1000);
    return () => clearInterval(timer);
  }, []);

  const visible = useMemo(
    () => filterRequests(state.requests, query, originFilter),
    [state.requests, query, originFilter],
  );

  const selected = useMemo(
    () => (selectedId ? state.requests.find((request) => request.id === selectedId) ?? null : null),
    [state.requests, selectedId],
  );

  useEffect(() => {
    const list = listRef.current;
    if (!list || !stickToBottom.current) return;
    list.scrollTop = list.scrollHeight;
  }, [visible.length]);

  const onListScroll = useCallback(() => {
    const list = listRef.current;
    if (!list) return;
    stickToBottom.current = list.scrollHeight - list.scrollTop - list.clientHeight < 24;
  }, []);

  const toggleRecording = () => {
    if (!client) return;
    client.send(recording?.isRecording ? 'disable' : 'enable', {});
  };

  const counts = useMemo(() => {
    let js = 0;
    let native = 0;
    for (const request of state.requests) {
      if (request.origin === 'js') js += 1;
      else native += 1;
    }
    return { js, native };
  }, [state.requests]);

  if (!client) {
    return (
      <div className="nn-root">
        <div className="nn-empty">
          <h3>Connecting to React Native…</h3>
          <p>Open the app with the Rozenite middleware running.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="nn-root">
      <div className="nn-toolbar">
        <button
          type="button"
          className={`nn-button${recording?.isRecording ? ' is-recording is-active' : ''}`}
          onClick={toggleRecording}
          title={recording?.isRecording ? 'Stop recording' : 'Start recording'}
        >
          {recording?.isRecording ? 'Recording' : 'Record'}
        </button>
        <button type="button" className="nn-button" onClick={() => dispatch({ type: 'clear' })}>
          Clear
        </button>
        <input
          className="nn-input"
          placeholder="Filter by URL, method, status or type"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <div className="nn-chips" role="tablist">
          {(
            [
              ['all', 'All'],
              ['js', `JS (${counts.js})`],
              ['native', `Native (${counts.native})`],
              ['failed', 'Errors'],
            ] as Array<[OriginFilter, string]>
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              className={`nn-chip${originFilter === value ? ' is-active' : ''}`}
              onClick={() => setOriginFilter(value)}
            >
              {label}
            </button>
          ))}
        </div>
        <label className="nn-status-line">
          <input
            type="checkbox"
            checked={preserveLog}
            onChange={(event) => setPreserveLog(event.target.checked)}
          />{' '}
          Preserve log
        </label>
        <span className="nn-spacer" />
        <span className="nn-status-line">
          {visible.length} / {state.requests.length} requests
          {recording ? ` · ${recording.platform}` : ''}
        </span>
      </div>

      {recording && !recording.nativeModuleAvailable ? (
        <div className="nn-banner is-warning">
          Native module not linked: only JavaScript requests are being announced. Rebuild the app
          after installing <code>rozenite-native-network-plugin</code> (run{' '}
          <code>pod install</code> on iOS) so the OkHttp / NSURLSession hooks are included.
        </div>
      ) : null}

      <div className="nn-body">
        <div
          ref={listRef}
          className={`nn-list${selected ? ' has-detail' : ''}`}
          onScroll={onListScroll}
        >
          {visible.length === 0 ? (
            <div className="nn-empty">
              <h3>No requests yet</h3>
              <p>
                Every request the native networking stack sees will appear here, including
                the ones that never went through JavaScript.
              </p>
            </div>
          ) : (
            <table className="nn-table">
              <thead>
                <tr>
                  <th className="nn-col-name">Name</th>
                  <th className="nn-col-method">Method</th>
                  <th className="nn-col-status">Status</th>
                  <th className="nn-col-origin">Origin</th>
                  <th className="nn-col-type">Type</th>
                  <th className="nn-col-size">Size</th>
                  <th className="nn-col-time">Time</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((request) => (
                  <RequestRow
                    key={request.id}
                    request={request}
                    selected={request.id === selectedId}
                    onSelect={() => setSelectedId(request.id === selectedId ? null : request.id)}
                  />
                ))}
              </tbody>
            </table>
          )}
        </div>

        {selected ? <RequestDetail request={selected} onClose={() => setSelectedId(null)} /> : null}
      </div>
    </div>
  );
}

type RequestRowProps = {
  request: NetworkRequest;
  selected: boolean;
  onSelect: () => void;
};

function RequestRow({ request, selected, onSelect }: RequestRowProps) {
  const tone = statusTone(request);
  return (
    <tr
      className={`${selected ? 'is-selected' : ''} ${tone === 'error' ? 'is-error' : ''}`}
      onClick={onSelect}
    >
      <td className="nn-col-name" title={request.url}>
        {requestName(request.url)}
        <span className="nn-host">{requestHost(request.url)}</span>
      </td>
      <td className="nn-col-method">{request.method}</td>
      <td className={`nn-col-status nn-status is-${tone}`}>{statusLabel(request)}</td>
      <td className="nn-col-origin">
        <span className={`nn-badge is-${request.origin}`} title={transportLabel(request)}>
          {originLabel(request)}
        </span>
      </td>
      <td className="nn-col-type" title={request.mimeType}>
        {shortMimeType(request.mimeType)}
      </td>
      <td className="nn-col-size">{formatBytes(request.size)}</td>
      <td className="nn-col-time">{formatDuration(request)}</td>
    </tr>
  );
}

type DetailTab = 'headers' | 'request' | 'response' | 'timing';

type RequestDetailProps = {
  request: NetworkRequest;
  onClose: () => void;
};

function RequestDetail({ request, onClose }: RequestDetailProps) {
  const [tab, setTab] = useState<DetailTab>('headers');

  return (
    <div className="nn-detail">
      <div className="nn-detail-header">
        <span className="nn-url" title={request.url}>
          {request.method} {request.url}
        </span>
        <button type="button" className="nn-button" onClick={() => copyText(toCurl(request))}>
          Copy as cURL
        </button>
        <button type="button" className="nn-button" onClick={() => copyText(request.url)}>
          Copy URL
        </button>
        <button type="button" className="nn-button" onClick={onClose} title="Close">
          ×
        </button>
      </div>
      <div className="nn-tabs" role="tablist">
        {(
          [
            ['headers', 'Headers'],
            ['request', 'Request'],
            ['response', 'Response'],
            ['timing', 'Timing'],
          ] as Array<[DetailTab, string]>
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            role="tab"
            className={`nn-tab${tab === value ? ' is-active' : ''}`}
            onClick={() => setTab(value)}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="nn-detail-body">
        {tab === 'headers' ? <HeadersTab request={request} /> : null}
        {tab === 'request' ? <RequestBodyTab request={request} /> : null}
        {tab === 'response' ? <ResponseBodyTab request={request} /> : null}
        {tab === 'timing' ? <TimingTab request={request} /> : null}
      </div>
    </div>
  );
}

function KeyValueList({ entries }: { entries: Array<[string, string]> }) {
  if (entries.length === 0) return <div className="nn-note">none</div>;
  return (
    <div className="nn-kv">
      {entries.map(([key, value]) => (
        <KeyValue key={key} name={key} value={value} />
      ))}
    </div>
  );
}

function KeyValue({ name, value }: { name: string; value: string }) {
  return (
    <>
      <span className="nn-key">{name}</span>
      <span>{value}</span>
    </>
  );
}

function HeadersTab({ request }: { request: NetworkRequest }) {
  const general: Array<[string, string]> = [
    ['Request URL', request.url],
    ['Request Method', request.method],
    ['Status', request.httpStatus !== undefined ? `${request.httpStatus} ${request.statusText ?? ''}`.trim() : statusLabel(request)],
    ['Origin', originLabel(request)],
    ['Transport', `${transportLabel(request)} · ${request.platform}`],
  ];
  if (request.finalUrl && request.finalUrl !== request.url) general.push(['Final URL', request.finalUrl]);
  if (request.protocol) general.push(['Protocol', request.protocol]);
  if (request.fromCache) general.push(['From cache', 'yes']);
  if (request.error) general.push(['Error', request.error]);

  return (
    <>
      <div className="nn-section">
        <h4>General</h4>
        <KeyValueList entries={general} />
      </div>
      <div className="nn-section">
        <h4>Response headers</h4>
        <KeyValueList entries={sortHeaders(request.responseHeaders)} />
      </div>
      <div className="nn-section">
        <h4>Request headers</h4>
        <KeyValueList entries={sortHeaders(request.requestHeaders)} />
      </div>
    </>
  );
}

function RequestBodyTab({ request }: { request: NetworkRequest }) {
  const body = request.requestBody;
  const contentType =
    request.requestHeaders['content-type'] ?? request.requestHeaders['Content-Type'];

  if (!body) return <div className="nn-note">No request body.</div>;
  if (body.kind === 'stream') {
    return <div className="nn-note">Streamed request body (not captured).</div>;
  }
  if (body.kind === 'binary') {
    return (
      <div className="nn-note">
        Binary request body, {formatBytes(body.size)}
        {body.contentType ? ` (${body.contentType})` : ''}.
      </div>
    );
  }
  return (
    <>
      {body.truncated ? (
        <div className="nn-note">Showing the first {formatBytes(body.value.length)} of {formatBytes(body.size)}.</div>
      ) : null}
      <pre className="nn-pre">{prettyPrintBody(body.value, contentType)}</pre>
    </>
  );
}

function ResponseBodyTab({ request }: { request: NetworkRequest }) {
  const body = request.responseBody;

  if (request.status === 'pending') return <div className="nn-note">Waiting for the response to finish…</div>;
  if (request.status === 'failed') return <div className="nn-note">Request failed: {request.error}</div>;
  if (!body) return <div className="nn-note">Empty body, or body not captured.</div>;
  if (body.kind === 'too-large') {
    return <div className="nn-note">Body not captured: {formatBytes(body.size)} exceeds the capture limit.</div>;
  }
  if (body.kind === 'base64') {
    const isImage = (request.mimeType ?? '').startsWith('image/');
    return (
      <>
        <div className="nn-note">
          Binary body, {formatBytes(body.size)}
          {body.truncated ? ' (truncated)' : ''}.
        </div>
        {isImage && !body.truncated ? (
          <img
            className="nn-image-preview"
            alt="response preview"
            src={`data:${request.mimeType};base64,${body.value}`}
          />
        ) : null}
      </>
    );
  }
  return (
    <>
      {body.truncated ? (
        <div className="nn-note">Showing the first {formatBytes(body.value.length)} of {formatBytes(body.size)}.</div>
      ) : null}
      <pre className="nn-pre">{prettyPrintBody(body.value, request.mimeType)}</pre>
    </>
  );
}

function TimingTab({ request }: { request: NetworkRequest }) {
  const end = request.completedAt ?? Date.now();
  const total = Math.max(1, end - request.startedAt);
  const wait = request.responseAt ? request.responseAt - request.startedAt : total;
  const download = request.responseAt ? end - request.responseAt : 0;

  return (
    <>
      <div className="nn-timing-bar" title={`${total} ms`}>
        <span className="is-wait" style={{ left: 0, width: `${(wait / total) * 100}%` }} />
        <span
          className="is-download"
          style={{ left: `${(wait / total) * 100}%`, width: `${(download / total) * 100}%` }}
        />
      </div>
      <div className="nn-kv">
        <KeyValue name="Started" value={formatTime(request.startedAt)} />
        <KeyValue name="Waiting (TTFB)" value={`${Math.round(wait)} ms`} />
        <KeyValue name="Content download" value={request.responseAt ? `${Math.round(download)} ms` : '—'} />
        <KeyValue name="Total" value={formatDuration(request)} />
        <KeyValue name="Transferred" value={formatBytes(request.size)} />
      </div>
    </>
  );
}
