// End-to-end smoke test with Playwright + the pre-installed Chromium.
// Requires backend (8000) and frontend (5173) running: scripts/dev.sh start
import { chromium } from "playwright";

const URL = process.env.E2E_URL ?? "http://localhost:5173/";
const exe = process.env.CHROMIUM_PATH ?? process.env.PLAYWRIGHT_CHROMIUM ?? undefined;
const results = [];
const check = (name, ok, info = "") => {
  results.push({ name, ok, info });
  console.log(`${ok ? "✓" : "✗"} ${name}${info ? " — " + info : ""}`);
};

const browser = await chromium.launch({
  executablePath: exe,
  headless: process.env.E2E_HEADFUL !== "1",
  args: ["--autoplay-policy=no-user-gesture-required", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--enable-webgl", ...(process.env.E2E_ARGS ? process.env.E2E_ARGS.split(" ") : [])],
});
try {
  for (const viewport of [{ name: "desktop", width: 1280, height: 800 }, { name: "iphone", width: 390, height: 844, isMobile: true, hasTouch: true }]) {
    const ctx = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height }, isMobile: !!viewport.isMobile, hasTouch: !!viewport.hasTouch, deviceScaleFactor: viewport.isMobile ? 3 : 1 });
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
    await page.goto(URL, { waitUntil: "networkidle" });
    check(`[${viewport.name}] page loads`, (await page.title()).includes("Gura"));

    // Live2D model ready?
    await page.waitForFunction(() => document.querySelector('[data-testid="stage"]')?.getAttribute("data-live2d-state") === "ready", null, { timeout: 30000 }).catch(() => {});
    const l2dState = await page.getAttribute('[data-testid="stage"]', "data-live2d-state");
    const stageMsg = l2dState === "ready" ? "" : await page.textContent(".stage-message").catch(() => "");
    check(`[${viewport.name}] Live2D model state = ready`, l2dState === "ready", String(l2dState) + " " + (stageMsg ?? "").slice(0, 200));

    const caps = await page.evaluate(() => {
      const c = window.__gura?.controller?.capabilities;
      return c ? { name: c.name, params: c.parameters.length, expressions: c.expressions, motions: Object.fromEntries(Object.entries(c.motionGroups).map(([k, v]) => [k, v.length])), lipSync: c.lipSyncIds, eyeBlink: c.eyeBlinkIds } : null;
    });
    check(`[${viewport.name}] capability scan`, !!caps && caps.params > 0, JSON.stringify(caps));

    // Model actually renders pixels? Render the model display object to a texture and count opaque pixels.
    await page.waitForTimeout(800);
    const pixels = await page.evaluate(() => {
      const ctl = window.__gura?.controller; const model = ctl?.["model"]; const app = ctl?.["app"];
      if (!model || !app) return { error: "no model/app" };
      // Extract only the visible screen area (the model's own bounds can exceed GPU texture limits on hi-DPI).
      const frame = new window.PIXI.Rectangle(0, 0, app.screen.width, app.screen.height);
      const px = app.renderer.extract.pixels(app.stage, frame);
      let opaque = 0;
      for (let i = 3; i < px.length; i += 4) if (px[i] > 10) opaque++;
      return { pixels: px.length / 4, opaqueRatio: +(opaque / (px.length / 4)).toFixed(3) };
    });
    check(`[${viewport.name}] model draws pixels`, (pixels.opaqueRatio ?? 0) > 0.02, JSON.stringify(pixels));

    if (viewport.name === "desktop") {
      // Parameters set by expressions/blink/our hook are applied for rendering and then restored by the
      // framework (saveParameters/loadParameters), so we log them at render time (right before
      // coreModel.update()) — every rendered frame, independent of JS timer throttling in headless mode.
      await page.evaluate(() => {
        const im = window.__gura.controller["model"].internalModel; const core = im.coreModel; const raw = core.getModel();
        const ids = ["ParamEyeLOpen", "ParamMouthOpenY", "ParamBrowLY", "ParamMouthForm"].map((id) => [id, raw.parameters.ids.indexOf(id)]);
        window.__log = [];
        const orig = core.update.bind(core);
        core.update = () => { const f = { t: performance.now() }; for (const [id, i] of ids) f[id] = +raw.parameters.values[i].toFixed(3); window.__log.push(f); orig(); };
        window.__frames = (sinceMs) => window.__log.filter((f) => f.t >= sinceMs);
        // Disable idle motions so expression / lip-sync measurements are not disturbed by motion curves.
        im.motionManager.groups.idle = "__none__";
        im.motionManager.stopAllMotions();
      });

      // Blink: ParamEyeLOpen should drop. Headless swiftshader runs at only a few fps, so shorten the blink
      // interval and lengthen the blink phases to make sure rendered frames catch a closed eye.
      const blink = await page.evaluate(async () => {
        const eb = window.__gura.controller["model"].internalModel.eyeBlink;
        eb?.setBlinkingInterval?.(0.6); eb?.setBlinkingSettings?.(0.25, 0.3, 0.25);
        if (eb) eb._nextBlinkingTime = 0; // the currently scheduled blink used the default (up to 8 s) interval
        const t0 = performance.now();
        await new Promise((r) => setTimeout(r, 5000));
        const eyes = window.__frames(t0).map((f) => f.ParamEyeLOpen);
        return { frames: eyes.length, min: Math.min(...eyes), max: Math.max(...eyes) };
      });
      check("auto blink (ParamEyeLOpen closes at least once in 5s)", blink.frames > 5 && blink.min < 0.5 && blink.max > 0.8, JSON.stringify(blink));
      await page.evaluate(() => { const eb = window.__gura.controller["model"].internalModel.eyeBlink; eb?.setBlinkingInterval?.(4); eb?.setBlinkingSettings?.(0.1, 0.05, 0.15); });

      // Emotion → expression (preset mapping F03 = angry) + motion request
      const emo = await page.evaluate(async () => {
        const g = window.__gura; const im = g.controller["model"].internalModel;
        const plan = g.controller.capabilities && new (await import("/src/emotion/EmotionMapper.ts")).EmotionMapper(g.controller.capabilities).plan("angry", 0.9, "pout");
        const motionStarted = plan?.motion ? await g.controller.playMotion(plan.motion.group, plan.motion.index, true) : false;
        im.motionManager.stopAllMotions();
        g.applyEmotion("angry", 0.9, undefined, undefined, 0);
        await new Promise((r) => setTimeout(r, 2500));
        const f = window.__log[window.__log.length - 1];
        return { brow: f.ParamBrowLY, mouthForm: f.ParamMouthForm, plan: { expression: plan?.expression, motion: plan?.motion, source: plan?.source }, motionStarted };
      });
      check("emotion 'angry' → expression F03 (brows down, frown) + TapBody motion", emo.brow < -0.5 && emo.mouthForm < -0.3 && emo.plan.expression === "F03" && emo.motionStarted === true, JSON.stringify(emo));
      const emo2 = await page.evaluate(async () => {
        const g = window.__gura; const im = g.controller["model"].internalModel;
        g.applyEmotion("surprised", 0.9, undefined, undefined, 0);
        im.motionManager.stopAllMotions();
        await new Promise((r) => setTimeout(r, 2500));
        const f = window.__log[window.__log.length - 1];
        return { brow: f.ParamBrowLY };
      });
      // (eye-open is overwritten by the blink controller while no motion plays, so only brows are checked here)
      check("emotion 'surprised' → expression F06 (brows up)", emo2.brow > 0.4, JSON.stringify(emo2));
      const emo3 = await page.evaluate(async () => {
        const g = window.__gura;
        // Parameter-override fallback path (used for models without expressions)
        await g.controller.setExpression(null);
        await new Promise((r) => setTimeout(r, 1500)); // previous expression fades out
        g.controller.setOverrides({ ParamBrowLY: -1, ParamMouthForm: -1, ParamNope: 5 }, 0.9);
        await new Promise((r) => setTimeout(r, 1500));
        const f = window.__log[window.__log.length - 1];
        g.controller.clearOverrides();
        return { brow: f.ParamBrowLY, mouthForm: f.ParamMouthForm };
      });
      check("parameter-override fallback blends standard params (unknown param ignored)", emo3.brow < -0.6 && emo3.mouthForm < -0.5, JSON.stringify(emo3));

      // Lip sync from real audio: 1.2 s clip (tone for 0.7 s, then silence) played through AudioPlayer.
      const lip = await page.evaluate(async () => {
        const g = window.__gura;
        await g.audioPlayer.unlock();
        const sr = 24000, n = sr * 1.2;
        const off = new OfflineAudioContext(1, n, sr);
        const osc = off.createOscillator(); osc.frequency.value = 220;
        const gain = off.createGain(); gain.gain.setValueAtTime(0, 0); gain.gain.linearRampToValueAtTime(0.8, 0.05); gain.gain.setValueAtTime(0.8, 0.65); gain.gain.linearRampToValueAtTime(0, 0.7);
        osc.connect(gain).connect(off.destination); osc.start(); osc.stop(1.2);
        const buf = await off.startRendering();
        const data = buf.getChannelData(0); const wav = new ArrayBuffer(44 + data.length * 2); const v = new DataView(wav);
        const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
        str(0, "RIFF"); v.setUint32(4, 36 + data.length * 2, true); str(8, "WAVE"); str(12, "fmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, sr, true); v.setUint32(28, sr * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); str(36, "data"); v.setUint32(40, data.length * 2, true);
        for (let i = 0; i < data.length; i++) v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, data[i])) * 32767, true);
        g.controller.setMouthEnabled(true);
        const t0 = performance.now();
        await g.audioPlayer.play(wav);
        const tEnd = performance.now();
        g.controller.setMouthEnabled(false);
        await new Promise((r) => setTimeout(r, 600));
        // play() includes decode latency, so judge by shape: the mouth must open at some point during playback
        // and be (nearly) closed in the last 250 ms of the clip (which is silent) and after stop.
        const frames = window.__frames(t0).filter((f) => f.t <= tEnd);
        const loud = frames.map((f) => f.ParamMouthOpenY);
        const quiet = frames.filter((f) => tEnd - f.t < 250).map((f) => f.ParamMouthOpenY);
        const after = window.__log[window.__log.length - 1].ParamMouthOpenY;
        return { frames: frames.length, loudMax: Math.max(...loud), quietMax: quiet.length ? Math.max(...quiet) : null, after, playMs: Math.round(tEnd - t0), ctxState: g.audioPlayer["ctx"]?.state };
      });
      check("lip sync: mouth opens with audio, closes in silence and after stop", lip.loudMax > 0.3 && (lip.quietMax === null || lip.quietMax < 0.25) && lip.after < 0.05, JSON.stringify(lip));

      // Restore idle motions for the rest of the run.
      await page.evaluate(() => { window.__gura.controller["model"].internalModel.motionManager.groups.idle = "Idle"; });

      // Chat round trip through backend (mock LLM)
      await page.fill('[data-testid="input"]', "hello gura");
      await page.click('[data-testid="send"]');
      await page.waitForSelector('[data-testid="msg-assistant"] .emotion-tag', { timeout: 20000 });
      const assistant = await page.textContent('[data-testid="msg-assistant"] .bubble-text');
      const tag = await page.textContent('[data-testid="msg-assistant"] .emotion-tag');
      check("chat reply rendered with emotion tag", !!assistant && !!tag, `${assistant?.slice(0, 50)} | ${tag}`);
      const sysErr = await page.$$eval(".msg.system", (els) => els.map((e) => e.textContent));
      check("TTS failure surfaces as a clear message (edge-tts has no internet here)", sysErr.length === 0 || sysErr.some((t) => /Voice unavailable|語音/.test(t)), JSON.stringify(sysErr));
      const status = await page.textContent('[data-testid="status"]');
      check("status returns to idle after turn", /Idle|待機/.test(status), status);

      // Language toggle → zh reply
      await page.click('[data-testid="lang-zh"]');
      await page.fill('[data-testid="input"]', "你好");
      await page.press('[data-testid="input"]', "Enter");
      await page.waitForFunction(() => document.querySelectorAll('[data-testid="msg-assistant"] .emotion-tag').length >= 2, null, { timeout: 20000 });
      const zhReply = await page.$$eval('[data-testid="msg-assistant"] .bubble-text', (els) => els[els.length - 1].textContent);
      check("zh reply", /[一-鿿]/.test(zhReply), zhReply);

      // Settings panel + fullscreen
      await page.click('[data-testid="open-settings"]');
      await page.waitForSelector('[data-testid="settings"]');
      check("settings panel opens", true);
      await page.click('[data-testid="emo-happy"]');
      await page.keyboard.press("Escape");
      await page.click(".drawer-backdrop");
      await page.click('[data-testid="fullscreen"]');
      const fs = await page.$eval('[data-testid="app"]', (e) => e.classList.contains("fullscreen"));
      check("fullscreen mode", fs);
      await page.screenshot({ path: "tests/screenshot-desktop.png" });
    } else {
      await page.screenshot({ path: "tests/screenshot-iphone.png" });
      const micVisible = await page.isVisible('[data-testid="mic"]');
      const inputVisible = await page.isVisible('[data-testid="input"]');
      check("[iphone] mic + input visible", micVisible && inputVisible);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
      check("[iphone] no horizontal overflow", !overflow);
    }
    const realErrors = errors.filter((e) => !/favicon|net::ERR_|Failed to load resource|TTS|tts/i.test(e));
    check(`[${viewport.name}] no page errors`, realErrors.length === 0, realErrors.slice(0, 3).join(" | "));
    await ctx.close();
  }
} finally {
  await browser.close();
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
