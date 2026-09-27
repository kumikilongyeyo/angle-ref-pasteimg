// The dock: one compact panel on the right edge, collapsible to a tab. View only — content.js
// owns the state and calls render().
//
// Styled with AngleRef's own CSS custom properties (they inherit into the shadow root), so it
// follows the site's light / dark / grey skins without knowing about them.
(function (ARP) {
  'use strict';

  const CSS = `
:host { all: initial; }
* { box-sizing: border-box; }
.dock {
  --ar-ink: var(--ink, #141414);
  --ar-card: var(--card, #fff);
  --ar-paper: var(--paper, #fbf8f1);
  --ar-cta: #F2604A;
  --ar-cta-ink: #141414;
  --ar-sec: var(--accent-pitch, #DED2F5);
  --ar-sure: #37B37E;
  --ar-unsure: #E8A917;
  --ar-weak: #9A9A9A;
  position: fixed; right: 16px; bottom: 16px; z-index: 2147483000;
  width: 300px; max-height: calc(100vh - 32px); overflow: auto;
  font: 13px/1.35 "Helvetica Neue", Helvetica, Arial, sans-serif; color: var(--ar-ink);
  background: var(--ar-card); border: 2px solid var(--ar-ink); box-shadow: 5px 5px 0 var(--ar-ink);
  padding: 10px 12px 12px;
}
.dock[hidden] { display: none; }
.head { display: flex; align-items: center; gap: 8px; margin: 0 0 8px; }
.title { font: 900 13px/1 "Archivo Black", "Arial Black", sans-serif; letter-spacing: .06em; flex: 1; cursor: grab; user-select: none; padding: 4px 0; }
.dragging .title { cursor: grabbing; }
.icon-btn { border: 0; background: none; color: inherit; cursor: pointer; padding: 4px; font-size: 16px; line-height: 1; border-radius: 3px; }
.icon-btn:hover { background: color-mix(in srgb, var(--ar-ink) 10%, transparent); }
.drop {
  position: relative; display: grid; place-items: center; text-align: center; gap: 6px;
  min-height: 132px; padding: 12px; border: 2px dashed color-mix(in srgb, var(--ar-ink) 45%, transparent);
  background: var(--ar-paper); cursor: pointer; user-select: none;
}
.drop.over { border-color: var(--ar-ink); background: color-mix(in srgb, var(--ar-cta) 14%, var(--ar-paper)); }
.drop.has-img { padding: 0; border-style: solid; cursor: default; min-height: 0; }
.drop canvas { display: block; max-width: 100%; }
.hint { font-size: 12px; opacity: .8; }
.hint b { font-weight: 700; opacity: 1; }
.link { background: none; border: 0; padding: 0; color: inherit; font: inherit; text-decoration: underline; cursor: pointer; }
.status { margin: 8px 0 2px; min-height: 18px; font-size: 12.5px; display: flex; gap: 6px; align-items: baseline; }
.status .dot { width: 8px; height: 8px; border-radius: 50%; flex: none; transform: translateY(-1px); background: var(--ar-weak); }
.status.ok .dot { background: var(--ar-sure); }
.status.warn .dot { background: var(--ar-unsure); }
.status.busy .dot { background: var(--ar-ink); animation: pulse 1s infinite ease-in-out; }
.status.err { color: #C0392B; }
.status.err .dot { background: #C0392B; }
@keyframes pulse { 50% { opacity: .25; } }
.detail { font-size: 11.5px; opacity: .75; margin: 0 0 8px; min-height: 0; }
.detail:empty { display: none; }
.ctas { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 8px; }
.btn {
  font: 900 11.5px/1 "Archivo Black", "Arial Black", sans-serif; letter-spacing: .04em; text-transform: uppercase;
  color: var(--ar-cta-ink); border: 2px solid var(--ar-ink); box-shadow: 3px 3px 0 var(--ar-ink);
  padding: 10px 6px; cursor: pointer; background: var(--ar-sec);
}
.btn.primary { background: var(--ar-cta); }
.btn:active:not(:disabled) { transform: translate(2px, 2px); box-shadow: 1px 1px 0 var(--ar-ink); }
.btn:disabled { opacity: .45; cursor: not-allowed; box-shadow: none; }
.row { display: flex; flex-wrap: wrap; gap: 4px 12px; margin-top: 10px; align-items: center; font-size: 12px; }
.row .link:disabled { opacity: .4; cursor: not-allowed; text-decoration: none; }
.row .link[aria-pressed="true"] { font-weight: 700; text-decoration-thickness: 2px; }
.spacer { flex: 1; }
.auto { display: flex; align-items: center; gap: 5px; cursor: pointer; font-size: 11.5px; opacity: .85; margin-top: 8px; }
.auto input { margin: 0; accent-color: var(--ar-ink); }
.legend { display: flex; gap: 10px; font-size: 11px; opacity: .75; margin-top: 6px; }
.legend i { display: inline-block; width: 10px; height: 3px; margin-right: 4px; vertical-align: middle; }
.tab {
  position: fixed; right: 0; bottom: 120px; z-index: 2147483000; writing-mode: vertical-rl;
  font: 900 11px/1 "Archivo Black", "Arial Black", sans-serif; letter-spacing: .08em;
  background: var(--card, #fff); color: var(--ink, #141414); border: 2px solid var(--ink, #141414); border-right: 0;
  padding: 12px 7px; cursor: pointer; box-shadow: -3px 3px 0 var(--ink, #141414);
}
.tab[hidden] { display: none; }
input[type=file] { display: none; }
@media (max-width: 720px) { .dock { right: 8px !important; left: 8px !important; width: auto; top: auto !important; bottom: 8px !important; max-height: 60vh; } }
`;

  const BONE_LINES = [
    ['leftShoulder', 'rightShoulder', 'trunk'], ['leftHip', 'rightHip', 'trunk'], ['leftShoulder', 'leftHip', 'trunk'], ['rightShoulder', 'rightHip', 'trunk'],
    ['neckMid', 'nose', 'head'],
    ['leftShoulder', 'leftElbow', 'leftUpperArm'], ['leftElbow', 'leftWrist', 'leftLowerArm'], ['leftWrist', 'leftIndex', 'leftHand'],
    ['rightShoulder', 'rightElbow', 'rightUpperArm'], ['rightElbow', 'rightWrist', 'rightLowerArm'], ['rightWrist', 'rightIndex', 'rightHand'],
    ['leftHip', 'leftKnee', 'leftThigh'], ['leftKnee', 'leftAnkle', 'leftCalf'], ['leftAnkle', 'leftFootIndex', 'leftFoot'],
    ['rightHip', 'rightKnee', 'rightThigh'], ['rightKnee', 'rightAnkle', 'rightCalf'], ['rightAnkle', 'rightFootIndex', 'rightFoot'],
  ];

  class DockUI {
    constructor({ shadowMode = 'closed', on }) {
      this.on = on;
      this.host = document.createElement('div');
      this.host.id = 'angleref-pose-scanner-host';
      const root = this.host.attachShadow({ mode: shadowMode });
      this.root = root;
      root.innerHTML = `<style>${CSS}</style>
<div class="tab" part="tab" role="button" tabindex="0" hidden>POSE SCANNER</div>
<section class="dock" aria-label="Pose scanner">
  <div class="head"><span class="title" title="Drag to move">POSE SCANNER</span>
    <button class="icon-btn collapse" title="Collapse" aria-label="Collapse the pose scanner">–</button></div>
  <div class="drop" tabindex="0" role="button" aria-label="Paste, drop or upload a pose reference">
    <div class="empty"><div class="hint"><b>Paste</b> (⌘/Ctrl+V), <b>drop</b> or <button class="link upload" type="button">upload</button><br>a pose reference</div></div>
    <canvas class="preview" hidden></canvas>
  </div>
  <input type="file" accept="image/*">
  <div class="status" role="status"><span class="dot"></span><span class="txt">Waiting for a picture</span></div>
  <div class="detail"></div>
  <div class="ctas">
    <button class="btn primary apply" disabled>Apply pose</button>
    <button class="btn camera" disabled>Pose + camera</button>
  </div>
  <div class="row">
    <button class="link mirror" type="button" aria-pressed="false" disabled title="Use the pose as if the picture were flipped left-right">Mirror</button>
    <button class="link turn" type="button" aria-pressed="false" disabled title="The person faces away from the camera, but was read as facing it (or the other way round)">Turn around</button>
    <span class="spacer"></span>
    <button class="link reset" type="button" disabled title="Put the skeleton back the way it was before applying">Reset</button>
    <button class="link clear" type="button" disabled>Clear</button>
  </div>
  <label class="auto"><input type="checkbox" class="autosearch"> Search AngleRef after applying</label>
</section>`;
      const $ = (s) => root.querySelector(s);
      this.el = {
        dock: $('.dock'), tab: $('.tab'), drop: $('.drop'), empty: $('.empty'), canvas: $('.preview'), file: $('input[type=file]'),
        status: $('.status'), txt: $('.status .txt'), detail: $('.detail'),
        apply: $('.apply'), camera: $('.camera'), mirror: $('.mirror'), turn: $('.turn'), reset: $('.reset'), clear: $('.clear'),
        auto: $('.autosearch'), collapse: $('.collapse'), upload: $('.upload'), title: $('.title'),
      };
      this.wire();
      document.documentElement.appendChild(this.host);
    }

    wire() {
      const e = this.el, on = this.on;
      e.collapse.addEventListener('click', () => on.collapse(true));
      e.tab.addEventListener('click', () => on.collapse(false));
      e.tab.addEventListener('keydown', (ev) => (ev.key === 'Enter' || ev.key === ' ') && on.collapse(false));
      e.upload.addEventListener('click', (ev) => (ev.stopPropagation(), e.file.click()));
      e.drop.addEventListener('click', () => !this.hasImage && e.file.click());
      e.drop.addEventListener('keydown', (ev) => (ev.key === 'Enter' || ev.key === ' ') && !this.hasImage && e.file.click());
      e.file.addEventListener('change', () => {
        const f = e.file.files?.[0];
        e.file.value = '';
        if (f) on.image(f);
      });
      e.drop.addEventListener('dragover', (ev) => (ev.preventDefault(), e.drop.classList.add('over')));
      e.drop.addEventListener('dragleave', () => e.drop.classList.remove('over'));
      e.drop.addEventListener('drop', (ev) => {
        ev.preventDefault();
        e.drop.classList.remove('over');
        on.drop(ev.dataTransfer);
      });
      e.apply.addEventListener('click', () => on.apply(false));
      e.camera.addEventListener('click', () => on.apply(true));
      e.mirror.addEventListener('click', () => on.toggle('mirror'));
      e.turn.addEventListener('click', () => on.toggle('turn'));
      e.reset.addEventListener('click', () => on.reset());
      e.clear.addEventListener('click', () => on.clear());
      e.auto.addEventListener('change', () => on.autosearch(e.auto.checked));
      // drag by the title; the position is kept (as right/bottom offsets) across visits
      e.title.addEventListener('pointerdown', (ev) => {
        if (ev.button !== 0) return;
        ev.preventDefault();
        const r = e.dock.getBoundingClientRect();
        const dx = ev.clientX - r.left, dy = ev.clientY - r.top;
        e.dock.classList.add('dragging');
        e.title.setPointerCapture(ev.pointerId);
        const move = (m) => {
          const x = Math.min(Math.max(0, m.clientX - dx), innerWidth - r.width);
          const y = Math.min(Math.max(0, m.clientY - dy), innerHeight - 60);
          this.setOffset({ right: innerWidth - x - r.width, bottom: Math.max(0, innerHeight - y - r.height) });
        };
        const up = () => {
          e.dock.classList.remove('dragging');
          e.title.removeEventListener('pointermove', move);
          on.moved?.(this.offset);
        };
        e.title.addEventListener('pointermove', move);
        e.title.addEventListener('lostpointercapture', up, { once: true });
      });
    }

    setOffset(o) {
      if (!o) return;
      this.offset = { right: Math.max(0, Math.round(o.right)), bottom: Math.max(0, Math.round(o.bottom)) };
      this.el.dock.style.right = `${this.offset.right}px`;
      this.el.dock.style.bottom = `${this.offset.bottom}px`;
    }

    setVisible(v) {
      this.host.style.display = v ? '' : 'none';
    }

    setCollapsed(c) {
      this.el.dock.hidden = c;
      this.el.tab.hidden = !c;
    }

    /** @param {{kind: 'idle'|'busy'|'ok'|'warn'|'err', text: string, detail?: string}} s */
    setStatus(s) {
      this.el.status.className = `status ${s.kind}`;
      this.el.txt.textContent = s.text;
      this.el.detail.textContent = s.detail ?? '';
    }

    setControls({ canApply, busy, mirror, turn, canReset, hasImage, autosearch }) {
      const e = this.el;
      e.apply.disabled = e.camera.disabled = !canApply || busy;
      e.mirror.disabled = e.turn.disabled = !canApply || busy;
      e.mirror.setAttribute('aria-pressed', String(!!mirror));
      e.turn.setAttribute('aria-pressed', String(!!turn));
      e.reset.disabled = !canReset || busy;
      e.clear.disabled = !hasImage || busy;
      e.auto.checked = !!autosearch;
    }

    /**
     * @param {HTMLImageElement | ImageBitmap | null} img
     * @param {{img: Record<string, number[]>, aspect: number} | null} scan normalized scan (for the overlay)
     * @param {Record<string, {tier: string}> | null} bones solver bone report
     */
    drawPreview(img, scan, bones, torsoTier) {
      const e = this.el;
      this.hasImage = !!img;
      e.empty.hidden = !!img;
      e.canvas.hidden = !img;
      e.drop.classList.toggle('has-img', !!img);
      if (!img) return;
      const maxW = e.drop.clientWidth || 272, maxH = 260;
      const k = Math.min(maxW / img.width, maxH / img.height);
      const w = Math.round(img.width * k), h = Math.round(img.height * k);
      const dpr = window.devicePixelRatio || 1;
      e.canvas.width = w * dpr;
      e.canvas.height = h * dpr;
      e.canvas.style.width = `${w}px`;
      e.canvas.style.height = `${h}px`;
      const g = e.canvas.getContext('2d');
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.drawImage(img, 0, 0, w, h);
      if (!scan) return;
      const css = getComputedStyle(e.dock);
      // weak = hidden but guessed (yellow, dashed); outside = not in the picture, left alone (grey, dashed)
      const col = { sure: css.getPropertyValue('--ar-sure'), unsure: css.getPropertyValue('--ar-unsure'), weak: css.getPropertyValue('--ar-unsure'), outside: css.getPropertyValue('--ar-weak') };
      // scan.img is aspect-corrected with +y up and height 1: back to canvas pixels
      const px = (p) => [(p[0] / scan.aspect + 0.5) * w, (0.5 - p[1]) * h];
      g.lineCap = 'round';
      for (const [a, b, bone] of BONE_LINES) {
        const t = bone === 'trunk' ? torsoTier : bones?.[bone]?.tier ?? 'outside';
        const [x1, y1] = px(scan.img[a]), [x2, y2] = px(scan.img[b]);
        g.strokeStyle = 'rgba(0,0,0,.55)';
        g.lineWidth = 5;
        g.setLineDash(t === 'weak' || t === 'outside' ? [3, 4] : []);
        g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke();
        g.strokeStyle = col[t] || col.outside;
        g.lineWidth = 2.5;
        g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke();
      }
      g.setLineDash([]);
    }
  }

  ARP.DockUI = DockUI;
})((globalThis.ARP = globalThis.ARP || {}));
