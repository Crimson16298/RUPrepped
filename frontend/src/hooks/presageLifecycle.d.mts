export function createPresageOwnerToken(cryptoApi?: Crypto): string | null;
export function createPresageOwnerStopper(
  client: { stop(sessionId: string, ownerToken: string): Promise<unknown> },
  sessionId: string,
  ownerToken: string,
  onFailure?: (failure: { operation: "stop"; errorClass: "Error" | "TypeError" | "RangeError" | "unknown" }) => void,
): { readonly stopped: boolean; stop(): Promise<boolean> };
export function registerPresagePageLifecycle(
  target: Pick<Window, "addEventListener" | "removeEventListener">,
  onTeardown: (reason: "pagehide" | "unmount") => void,
): () => void;
export function registerPresageVisibilityHeartbeat(
  target: Pick<Document, "addEventListener" | "removeEventListener" | "visibilityState">,
  heartbeat: () => void,
): () => void;
