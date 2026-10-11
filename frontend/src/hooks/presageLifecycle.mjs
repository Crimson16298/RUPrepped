/** Create a per-effect unguessable owner token; never persist or place it in a URL. */
export function createPresageOwnerToken(cryptoApi = globalThis.crypto) {
  if (!cryptoApi?.getRandomValues) return null;
  const bytes = new Uint8Array(32);
  cryptoApi.getRandomValues(bytes);
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
}

function safeErrorClass(error) {
  const name = error instanceof Error ? error.name : "unknown";
  return ["Error", "TypeError", "RangeError"].includes(name) ? name : "unknown";
}

/** Deduplicates overlapping stop calls while allowing a failed request to be retried. */
export function createPresageOwnerStopper(client, sessionId, ownerToken, onFailure = () => {}) {
  let request = null;
  let stopped = false;
  return {
    get stopped() { return stopped; },
    stop() {
      if (stopped) return Promise.resolve(true);
      if (request) return request;
      request = Promise.resolve().then(() => client.stop(sessionId, ownerToken)).then(() => {
        stopped = true;
        return true;
      }).catch((error) => {
        onFailure({ operation: "stop", errorClass: safeErrorClass(error) });
        return false;
      }).finally(() => { request = null; });
      return request;
    },
  };
}

/** Gives React unmount and browser pagehide one idempotent owner teardown path. */
export function registerPresagePageLifecycle(target, onTeardown) {
  let active = true;
  const teardown = (reason) => {
    if (!active) return;
    active = false;
    onTeardown(reason);
  };
  const onPageHide = () => teardown("pagehide");
  target.addEventListener("pagehide", onPageHide);
  return () => {
    target.removeEventListener("pagehide", onPageHide);
    teardown("unmount");
  };
}

/** Sends a fresh owner heartbeat immediately after a background tab becomes visible. */
export function registerPresageVisibilityHeartbeat(target, heartbeat) {
  const onVisibilityChange = () => {
    if (target.visibilityState === "visible") heartbeat();
  };
  target.addEventListener("visibilitychange", onVisibilityChange);
  return () => target.removeEventListener("visibilitychange", onVisibilityChange);
}
