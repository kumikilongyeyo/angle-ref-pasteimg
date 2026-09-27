// Content-script side of the AngleRef driver: a promise-per-call RPC over window.postMessage to
// src/angleref/angleref-driver.js, which runs in the page's own JS world.
(function (ARP) {
  'use strict';
  let seq = 0;
  const waiting = new Map();

  window.addEventListener('message', (ev) => {
    if (ev.source !== window || ev.data?.__arps !== 'res') return;
    const w = waiting.get(ev.data.id);
    if (!w) return;
    waiting.delete(ev.data.id);
    clearTimeout(w.timer);
    ev.data.ok ? w.resolve(ev.data.result) : w.reject(new Error(ev.data.error));
  });

  function call(cmd, args, timeoutMs = 8000) {
    const id = `arps-${Date.now().toString(36)}-${++seq}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        waiting.delete(id);
        reject(new Error('AngleRef did not answer (page still loading?)'));
      }, timeoutMs);
      waiting.set(id, { resolve, reject, timer });
      window.postMessage({ __arps: 'req', id, cmd, args }, location.origin);
    });
  }

  /** wait until AngleRef's skeleton is reachable and ready */
  async function waitReady(timeoutMs = 20000) {
    const t0 = Date.now();
    let last = null;
    while (Date.now() - t0 < timeoutMs) {
      try {
        last = await call('probeRuntime', null, 2000);
        if (last.ready) return last;
      } catch {}
      await new Promise((r) => setTimeout(r, 300));
    }
    return last;
  }

  ARP.angleref = {
    call,
    waitReady,
    probe: () => call('probeRuntime'),
    read: () => call('readCurrentPose'),
    apply: (a) => call('applyPose', a),
    restore: (snap) => call('restore', snap),
    search: () => call('requestSearchRefresh'),
    selfTest: () => call('selfTest', null, 15000),
  };
})((globalThis.ARP = globalThis.ARP || {}));
