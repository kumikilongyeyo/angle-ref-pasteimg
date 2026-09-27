// MV3 service worker: owns the offscreen scanner document and relays scans to it; the toolbar
// button shows / hides the dock.

let creating = null;

async function ensureOffscreen() {
  if (await chrome.offscreen.hasDocument()) return;
  creating ??= chrome.offscreen
    .createDocument({
      url: 'offscreen.html',
      reasons: [chrome.offscreen.Reason.WORKERS, chrome.offscreen.Reason.BLOBS],
      justification: 'Runs the MediaPipe pose model locally on the picture the user pasted.',
    })
    .catch((e) => {
      if (!String(e).includes('single offscreen')) throw e; // raced with another create: fine
    })
    .finally(() => (creating = null));
  await creating;
}

/** the offscreen script may not have registered its listener yet right after creation */
async function toOffscreen(msg, tries = 20) {
  for (let i = 0; ; i++) {
    try {
      const r = await chrome.runtime.sendMessage({ ...msg, target: 'arps-offscreen' });
      if (r !== undefined) return r;
    } catch (e) {
      if (i >= tries) throw e;
    }
    if (i >= tries) throw new Error('scanner did not answer');
    await new Promise((r) => setTimeout(r, 100));
  }
}

chrome.runtime.onMessage.addListener((m, _sender, sendResponse) => {
  if (m?.target) return false; // meant for the offscreen document
  if (m?.type === 'arps-warm' || m?.type === 'arps-scan') {
    ensureOffscreen()
      .then(() => toOffscreen(m.type === 'arps-warm' ? { type: 'warm' } : { type: 'scan', image: m.image }))
      .then(sendResponse, (e) => sendResponse({ ok: false, error: String(e?.message ?? e) }));
    return true;
  }
  return false;
});

chrome.action.onClicked.addListener((tab) => {
  if (tab.id) chrome.tabs.sendMessage(tab.id, { type: 'arps-toggle' }).catch(() => {});
});
