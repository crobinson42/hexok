import { promises as dns, type LookupAddress } from 'node:dns';
import { request as httpRequest, type IncomingMessage } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { BlockList, isIP, type LookupFunction } from 'node:net';
import { fail, ok, type Result } from 'hexok';

/** What one send returned. `status` is absent when no response arrived. */
export interface WebhookResult {
  readonly status?: number;
  readonly error?:
    | 'http'
    | 'timeout'
    | 'dns'
    | 'tls'
    | 'connection'
    | 'blocked'
    | 'cancelled';
  readonly durationMs: number;
  /** The first 20 KB of the response body. */
  readonly responseBody: string;
}

/** Every address a hostname resolves to. */
export type WebhookResolver = (
  hostname: string,
) => Promise<readonly LookupAddress[]>;

/** Why {@link checkUrl} refused a URL. */
export type UnsafeUrlReason = 'invalid' | 'scheme' | 'blocked' | 'unresolved';

export interface HttpOptions {
  /** Refuses `http:` URLs. */
  readonly httpsOnly: boolean;
  /** Skips the address check, for local development and tests. */
  readonly allowPrivate: boolean;
  /** One deadline over DNS, connect, TLS, and the response body. */
  readonly timeoutMs: number;
  readonly resolve: WebhookResolver;
}

export interface SendRequest {
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
  /** Aborts the send, such as on `stop()`. The result is `cancelled`. */
  readonly signal: AbortSignal;
}

const RESPONSE_CAP_BYTES = 20 * 1024;

/** The operating system resolver, `/etc/hosts` included. */
export const systemResolver: WebhookResolver = (hostname) =>
  dns.lookup(hostname, { all: true, verbatim: true });

/** Addresses that are not on the public internet. IPv4 rules also match IPv4-mapped IPv6 addresses such as `::ffff:10.0.0.1`. */
const blocked = new BlockList();
for (const [network, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const) {
  blocked.addSubnet(network, prefix, 'ipv4');
}
for (const [network, prefix] of [
  ['::', 128],
  ['::1', 128],
  ['64:ff9b::', 96],
  ['100::', 64],
  ['2001:db8::', 32],
  ['2002::', 16],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
] as const) {
  blocked.addSubnet(network, prefix, 'ipv6');
}

function isBlocked(address: string): boolean {
  return blocked.check(address, isIP(address) === 6 ? 'ipv6' : 'ipv4');
}

/** The URL's host without IPv6 brackets. */
function hostOf(url: URL): string {
  return url.hostname.startsWith('[')
    ? url.hostname.slice(1, -1)
    : url.hostname;
}

/** Parses the URL and checks its scheme, and its address when the host is an IP literal. A hostname is checked when it resolves. */
function target(
  url: string,
  options: HttpOptions,
): Result<URL, UnsafeUrlReason> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return fail('invalid');
  }
  const schemes = options.httpsOnly ? ['https:'] : ['https:', 'http:'];
  if (!schemes.includes(parsed.protocol)) return fail('scheme');
  const host = hostOf(parsed);
  if (!options.allowPrivate && isIP(host) !== 0 && isBlocked(host)) {
    return fail('blocked');
  }
  return ok(parsed);
}

/** Runs the check {@link send} runs, for an endpoint form: the scheme, then every address the host resolves to. */
export async function checkUrl(
  url: string,
  options: HttpOptions,
): Promise<Result<URL, UnsafeUrlReason>> {
  const checked = target(url, options);
  if (!checked.ok) return checked;
  const host = hostOf(checked.value);
  if (isIP(host) !== 0) return checked;
  let addresses: readonly LookupAddress[];
  try {
    addresses = await options.resolve(host);
  } catch {
    return fail('unresolved');
  }
  if (addresses.length === 0) return fail('unresolved');
  if (!options.allowPrivate && addresses.some((a) => isBlocked(a.address))) {
    return fail('blocked');
  }
  return checked;
}

function codeOf(error: unknown): string {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return '';
  }
  return typeof error.code === 'string' ? error.code : '';
}

const DNS_CODES = new Set(['ENOTFOUND', 'EAI_AGAIN', 'EAI_FAIL', 'ENODATA']);
const TLS_CODE =
  /^(ERR_TLS_|ERR_SSL_|CERT_|UNABLE_TO_|DEPTH_ZERO_|SELF_SIGNED_|EPROTO$)/;

/**
 * POSTs the body once. It follows no redirect and keeps the first 20 KB of the response.
 * The socket's `lookup` checks every resolved address, so the connection goes only to an address that passed, and DNS rebinding cannot slip past.
 * It never rejects. Each failure is an `error` on the result.
 */
export async function send(
  request: SendRequest,
  options: HttpOptions,
): Promise<WebhookResult> {
  const started = performance.now();
  const elapsed = () => Math.round(performance.now() - started);
  const checked = target(request.url, options);
  if (!checked.ok) {
    return { error: 'blocked', durationMs: elapsed(), responseBody: '' };
  }
  const url = checked.value;
  const deadline = AbortSignal.timeout(options.timeoutMs);
  let refused = false;
  const lookup: LookupFunction = (hostname, lookupOptions, callback) => {
    options.resolve(hostname).then(
      (addresses) => {
        const first = addresses[0];
        if (first === undefined) {
          const error = Object.assign(
            new Error(`webhooks: ${hostname} has no address`),
            { code: 'ENOTFOUND' },
          );
          callback(error, []);
        } else if (
          !options.allowPrivate &&
          addresses.some((a) => isBlocked(a.address))
        ) {
          refused = true;
          callback(new Error('webhooks: blocked address'), []);
        } else if (lookupOptions.all) {
          callback(null, [...addresses]);
        } else {
          callback(null, first.address, first.family);
        }
      },
      (error: unknown) =>
        callback(
          error instanceof Error ? error : new Error('webhooks: lookup failed'),
          [],
        ),
    );
  };
  const errorOf = (error: unknown): NonNullable<WebhookResult['error']> => {
    if (refused) return 'blocked';
    if (deadline.aborted) return 'timeout';
    if (request.signal.aborted) return 'cancelled';
    const code = codeOf(error);
    if (DNS_CODES.has(code)) return 'dns';
    if (TLS_CODE.test(code)) return 'tls';
    return 'connection';
  };
  return new Promise((resolve) => {
    let status: number | undefined;
    const chunks: Buffer[] = [];
    let bytes = 0;
    let settled = false;
    const finish = (error: WebhookResult['error']) => {
      if (settled) return;
      settled = true;
      const responseBody = Buffer.concat(chunks)
        .subarray(0, RESPONSE_CAP_BYTES)
        .toString('utf8');
      const base = { durationMs: elapsed(), responseBody };
      const withStatus = status === undefined ? base : { ...base, status };
      resolve(error === undefined ? withStatus : { ...withStatus, error });
    };
    const onResponse = (response: IncomingMessage) => {
      status = response.statusCode;
      const outcome =
        status !== undefined && status >= 200 && status < 300
          ? undefined
          : 'http';
      response.on('data', (chunk: Buffer) => {
        chunks.push(chunk);
        bytes += chunk.length;
        if (bytes < RESPONSE_CAP_BYTES) return;
        // The rest of a large body is not read.
        finish(outcome);
        response.destroy();
      });
      response.on('end', () => finish(outcome));
      response.on('error', (error) => finish(errorOf(error)));
      response.on('close', () => {
        if (!response.complete) finish(errorOf(undefined));
      });
    };
    const open = url.protocol === 'https:' ? httpsRequest : httpRequest;
    const outgoing = open(
      url,
      {
        method: 'POST',
        headers: {
          ...request.headers,
          'content-type': 'application/json',
          'content-length': String(Buffer.byteLength(request.body)),
        },
        // A pooled socket would skip the address check for this request.
        agent: false,
        lookup,
        signal: AbortSignal.any([deadline, request.signal]),
      },
      onResponse,
    );
    outgoing.on('error', (error) => finish(errorOf(error)));
    outgoing.end(request.body);
  });
}
