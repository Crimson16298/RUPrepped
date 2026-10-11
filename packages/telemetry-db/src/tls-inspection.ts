import { connect as connectTcp, type Socket } from 'node:net';
import { checkServerIdentity, connect as connectTls, type DetailedPeerCertificate, type TLSSocket } from 'node:tls';
import { databasePoolConfigFromEnvironment } from './database-config.js';

const timeoutMs = 10_000;
const postgresSslRequest = Buffer.from([0x00, 0x00, 0x00, 0x08, 0x04, 0xd2, 0x16, 0x2f]);

type CertificateView = Pick<DetailedPeerCertificate, 'subject' | 'issuer' | 'valid_from' | 'valid_to' | 'fingerprint256'> & {
  issuerCertificate?: CertificateView;
};

export type TlsCertificateSummary = {
  subject: { organization?: string; commonName?: string };
  issuer: { organization?: string; commonName?: string };
  validFrom: string;
  validTo: string;
  selfSigned: boolean;
};

export type TlsInspectionReport = {
  authorizationError: string | null;
  hostnameVerificationError: string | null;
  chain: TlsCertificateSummary[];
};

type CertificateName = { O?: string | string[]; CN?: string | string[] };

function name(value: CertificateName | undefined): { organization?: string; commonName?: string } {
  const first = (field: string | string[] | undefined): string | undefined => Array.isArray(field) ? field[0] : field;
  const organization = first(value?.O);
  const commonName = first(value?.CN);
  return { ...(organization ? { organization } : {}), ...(commonName ? { commonName } : {}) };
}

export function summarizePeerCertificateChain(certificate: CertificateView): TlsCertificateSummary[] {
  const chain: TlsCertificateSummary[] = [];
  const seen = new Set<string>();
  let current: CertificateView | undefined = certificate;
  while (current?.fingerprint256 && !seen.has(current.fingerprint256)) {
    seen.add(current.fingerprint256);
    const issuer: CertificateView | undefined = current.issuerCertificate;
    chain.push({
      subject: name(current.subject),
      issuer: name(current.issuer),
      validFrom: current.valid_from,
      validTo: current.valid_to,
      selfSigned: issuer === current || (!!issuer?.fingerprint256 && issuer.fingerprint256 === current.fingerprint256),
    });
    current = issuer;
  }
  return chain;
}

function waitForTcpConnection(socket: Socket): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.once('connect', resolve);
    socket.once('error', reject);
    socket.setTimeout(timeoutMs, () => reject(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' })));
  });
}

function negotiatePostgresTls(socket: Socket): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.once('error', reject);
    socket.once('data', (response: Buffer) => {
      if (response.subarray(0, 1).toString('ascii') === 'S') resolve();
      else reject(Object.assign(new Error('PostgreSQL SSL is not supported'), { code: 'POSTGRESQL_SSL_NOT_SUPPORTED' }));
    });
    socket.write(postgresSslRequest);
  });
}

function waitForSecureConnect(socket: TLSSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.once('secureConnect', resolve);
    socket.once('error', reject);
    socket.setTimeout(timeoutMs, () => reject(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' })));
  });
}

export async function inspectPostgresTls(): Promise<TlsInspectionReport> {
  const { host, port } = databasePoolConfigFromEnvironment();
  const tcp = connectTcp({ host, port });
  let tlsSocket: TLSSocket | undefined;
  try {
    await waitForTcpConnection(tcp);
    await negotiatePostgresTls(tcp);
    // Deliberately isolated to this inspector: it permits the handshake to
    // complete so an untrusted chain can be examined. No pg pool uses this.
    tlsSocket = connectTls({ socket: tcp, servername: host, rejectUnauthorized: false });
    await waitForSecureConnect(tlsSocket);
    const certificate = tlsSocket.getPeerCertificate(true) as CertificateView;
    if (!certificate?.fingerprint256) throw Object.assign(new Error('peer certificate unavailable'), { code: 'PEER_CERTIFICATE_UNAVAILABLE' });
    const hostnameError = checkServerIdentity(host, certificate as DetailedPeerCertificate);
    const errorCode = (error: Error | string | null | undefined): string | null => {
      if (!error) return null;
      if (typeof error === 'string') return error;
      return (error as NodeJS.ErrnoException).code ?? error.name;
    };
    return {
      authorizationError: errorCode(tlsSocket.authorizationError),
      hostnameVerificationError: errorCode(hostnameError),
      chain: summarizePeerCertificateChain(certificate),
    };
  } finally {
    tlsSocket?.destroy();
    if (!tlsSocket) tcp.destroy();
  }
}

export function tlsInspectionErrorCategory(error: unknown): string {
  const code = (error as { code?: string } | undefined)?.code;
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return 'dns_resolution_failed';
  if (code === 'ETIMEDOUT' || code === 'ECONNREFUSED') return 'connection_failed';
  if (code === 'POSTGRESQL_SSL_NOT_SUPPORTED') return 'postgresql_ssl_not_supported';
  return 'tls_inspection_failed';
}
