// `rozenite.config.ts` is evaluated by the dev host without `require`, so
// only type-only imports are allowed here. The sample traffic the dev host
// replays therefore lives inline instead of in `src/`.
import type { RozeniteConfig } from '@rozenite/vite-plugin';
import type { NativeNetworkEventMap } from './src/shared/events';

type DevMessage = {
  [K in keyof NativeNetworkEventMap]: {
    type: K;
    payload: NativeNetworkEventMap[K];
    /** Milliseconds to wait before sending this message. */
    delay: number;
  };
}[keyof NativeNetworkEventMap];

/**
 * A realistic mix of traffic: a fetch from JS, an image the native image
 * loader fetched, an analytics beacon from a native SDK, an XHR that failed.
 */
const createDevFixtures = (): DevMessage[] => {
  const now = Date.now();

  return [
    {
      type: 'js-request-sent',
      delay: 50,
      payload: {
        jsId: 'js-1',
        url: 'https://api.shop.dev/v2/products?page=1',
        method: 'GET',
        timestamp: now,
        api: 'fetch',
      },
    },
    {
      type: 'native-request-started',
      delay: 10,
      payload: {
        requestId: 'n-1',
        url: 'https://api.shop.dev/v2/products?page=1',
        method: 'GET',
        headers: { accept: 'application/json', 'user-agent': 'ShopApp/1.0 CFNetwork' },
        body: null,
        timestamp: now + 5,
        platform: 'ios',
        transport: 'nsurlsession',
        client: 'url-protocol',
      },
    },
    {
      type: 'native-request-started',
      delay: 60,
      payload: {
        requestId: 'n-2',
        url: 'https://cdn.shop.dev/images/trail-runner.png',
        method: 'GET',
        headers: { accept: 'image/*' },
        body: null,
        timestamp: now + 70,
        platform: 'ios',
        transport: 'nsurlsession',
        client: 'url-protocol',
      },
    },
    {
      type: 'native-request-started',
      delay: 40,
      payload: {
        requestId: 'n-3',
        url: 'https://analytics.vendor.io/v1/batch',
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-sdk-version': '7.4.1' },
        body: {
          kind: 'text',
          value: JSON.stringify({ events: [{ name: 'app_open', ts: now }] }),
          truncated: false,
          size: 48,
        },
        timestamp: now + 110,
        platform: 'ios',
        transport: 'nsurlsession',
        client: 'url-protocol',
      },
    },
    {
      type: 'native-response-received',
      delay: 120,
      payload: {
        requestId: 'n-1',
        status: 200,
        statusText: 'OK',
        headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
        mimeType: 'application/json',
        timestamp: now + 230,
        protocol: 'h2',
      },
    },
    {
      type: 'native-request-completed',
      delay: 30,
      payload: {
        requestId: 'n-1',
        timestamp: now + 260,
        size: 311,
        body: {
          kind: 'text',
          value: JSON.stringify({
            items: [{ id: 'sku_1001', name: 'Trail Runner 2', price: 149 }],
            page: 1,
          }),
          truncated: false,
          size: 311,
        },
      },
    },
    {
      type: 'native-response-received',
      delay: 50,
      payload: {
        requestId: 'n-3',
        status: 204,
        statusText: 'No Content',
        headers: {},
        mimeType: '',
        timestamp: now + 310,
      },
    },
    {
      type: 'native-request-completed',
      delay: 5,
      payload: { requestId: 'n-3', timestamp: now + 315, size: 0, body: null },
    },
    {
      type: 'native-response-received',
      delay: 200,
      payload: {
        requestId: 'n-2',
        status: 200,
        statusText: 'OK',
        headers: { 'content-type': 'image/png', 'content-length': '48211' },
        mimeType: 'image/png',
        timestamp: now + 520,
        protocol: 'h2',
      },
    },
    {
      type: 'native-request-completed',
      delay: 150,
      payload: {
        requestId: 'n-2',
        timestamp: now + 670,
        size: 48211,
        body: { kind: 'too-large', size: 48211 },
      },
    },
    {
      type: 'js-request-sent',
      delay: 300,
      payload: {
        jsId: 'js-2',
        url: 'https://api.shop.dev/v2/cart',
        method: 'POST',
        timestamp: now + 970,
        api: 'xhr',
      },
    },
    {
      type: 'native-request-started',
      delay: 10,
      payload: {
        requestId: 'n-4',
        url: 'https://api.shop.dev/v2/cart',
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: { kind: 'text', value: '{"sku":"sku_1001","qty":1}', truncated: false, size: 26 },
        timestamp: now + 975,
        platform: 'ios',
        transport: 'nsurlsession',
        client: 'url-protocol',
      },
    },
    {
      type: 'native-request-failed',
      delay: 400,
      payload: {
        requestId: 'n-4',
        timestamp: now + 1375,
        error: 'The network connection was lost.',
        canceled: false,
      },
    },
  ];
};

export default {
  panels: [
    {
      name: 'Native Network',
      source: './src/ui/panel.tsx',
    },
  ],
  // The device side talks to a native module (OkHttp / NSURLSession hooks),
  // so only React Native proper is supported. On react-native-web and Lynx
  // the hook is a no-op.
  integrations: ['react-native'],
  dev: {
    presets: [
      {
        name: 'Recording state: recording',
        type: 'recording-state',
        payload: { isRecording: true, platform: 'ios', nativeModuleAvailable: true },
      },
      {
        name: 'Recording state: native module missing',
        type: 'recording-state',
        payload: { isRecording: false, platform: 'android', nativeModuleAvailable: false },
      },
    ],
    flows: [
      {
        name: 'Populate with sample traffic',
        autoRun: true,
        run: async ({ send, waitForMessage }) => {
          await waitForMessage({ type: 'enable', direction: 'out' }, { timeoutMs: 10000 });
          send('recording-state', {
            isRecording: true,
            platform: 'ios',
            nativeModuleAvailable: true,
          });

          const fixtures = createDevFixtures();
          for (const message of fixtures) {
            await new Promise((resolve) => setTimeout(resolve, message.delay));
            send(message.type, message.payload);
          }

          return { message: `Sent ${fixtures.length} sample events.` };
        },
      },
    ],
  },
} satisfies RozeniteConfig;
