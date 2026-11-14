'use strict';

const path = require('node:path');
const { app } = require('electron');

/**
 * 开发/验收钩子：--shot 截图 + 各种 UI 自动化探针。
 * 抽出来是为了让 main.cjs 保持可读（单文件 ≤400 行）。
 * 仅在这些环境变量/参数存在时才装上，正常启动零开销。
 */
function installDevHooks(win, log) {
  const SHOT = process.argv.includes('--shot');

  if (SHOT) {
    win.webContents.once('did-finish-load', () => {
      setTimeout(async () => {
        try {
          if (process.env.YIZI_CLICKTEST) {
            const c = await win.webContents.executeJavaScript(
              '(() => { const t = document.querySelector(".thumb"); if (!t) return "no-thumb"; t.dispatchEvent(new MouseEvent("click", { bubbles: true })); return "clicked"; })()'
            );
            log(`[click] ${c}`);
            await new Promise((r) => setTimeout(r, 500));
          }
          if (process.env.YIZI_30COLS) {
            await win.webContents.executeJavaScript(`(async () => {
              const c = document.querySelector(".canvas");
              for (let i = 0; i < 26; i++) c.dispatchEvent(new WheelEvent("wheel", { deltaY: 120, ctrlKey: true, bubbles: true, cancelable: true }));
              return true;
            })()`);
            await new Promise((r) => setTimeout(r, 2500));
            log('[30cols] sent');
          }
          if (process.env.YIZI_BARINFO) {
            const r = await win.webContents.executeJavaScript(`(() => {
              const bar = document.querySelector(".actionbar");
              const items = [...bar.children].map((el) => { const r = el.getBoundingClientRect(); return (el.className||el.tagName) + "@" + Math.round(r.left) + ",w" + Math.round(r.width) + ":" + el.textContent.trim().slice(0,12); });
              return { clientW: bar.clientWidth, scrollW: bar.scrollWidth, hearts: document.querySelectorAll(".actionbar .hearts .heart-dot").length, fullText: bar.textContent.trim().slice(0, 80), items };
            })()`);
            log(`[barinfo] ${JSON.stringify(r)}`);
          }
          if (process.env.YIZI_SELTEST) {
            const r = await win.webContents.executeJavaScript(
              `(async () => {
                 const wait = (ms) => new Promise((r) => setTimeout(r, ms));
                 const bar0 = document.querySelector(".actionbar") ? document.querySelector(".actionbar").className : "none";
                 const thumb = [...document.querySelectorAll(".thumb")].find((t) => t.querySelector(".occlude-mask:not(.revealed)"));
                 if (!thumb) return { error: "no masked thumb" };
                 const overlay = thumb.querySelector(".occlude-mask");
                 overlay.dispatchEvent(new MouseEvent("click", { bubbles: true }));
                 await wait(400);
                 const revealed = !!overlay.querySelector(".occlude-mask.revealed") || !!thumb.querySelector(".occlude-mask.revealed");
                 const overlay2 = thumb.querySelector(".occlude-mask.revealed") || thumb.querySelector(".occlude-mask");
                 overlay2.dispatchEvent(new MouseEvent("click", { bubbles: true }));
                 await wait(400);
                 const remasked = !thumb.querySelector(".occlude-mask.revealed");
                 const noMaskText = ![...document.querySelectorAll(".ab-btn")].some((b) => b.textContent.includes("删除"));
                 const noPanelText = !document.querySelector(".tb-label:not(.sr-only)");
                 return { bar0, revealed, remasked, noMaskText, noPanelText };
               })()`
            );
            log(`[seltest] ${JSON.stringify(r)}`);
          }
          if (process.env.YIZI_UITEST) {
            const r = await win.webContents.executeJavaScript(
              `(async () => {
                 const wait = (ms) => new Promise((r) => setTimeout(r, ms));
                 const first = () => document.querySelector(".thumb");
                 const btn = () => [...document.querySelectorAll(".ab-btn")].find((b) => ["标废","取消废"].includes(b.textContent.trim()));
                 const state = () => ({
                   label: btn() ? btn().textContent.trim() : "none",
                   rejectBadge: !!first().querySelector(".badge.reject"),
                   ageBadge: (first().querySelector(".badge.age") || {}).textContent || "",
                 });
                 first().dispatchEvent(new MouseEvent("click", { bubbles: true }));
                 await wait(500);
                 const s1 = state();
                 btn().click(); await wait(900); const s2 = state();
                 btn().click(); await wait(900); const s3 = state();
                 window.dispatchEvent(new KeyboardEvent("keydown", { key: "3", altKey: true, bubbles: true }));
                 await wait(900); const s4 = state();
                 window.dispatchEvent(new KeyboardEvent("keydown", { key: "5", altKey: true, bubbles: true }));
                 await wait(900); const s5 = state();
                 return { s1, s2, s3, s4, s5 };
               })()`
            );
            log(`[uitest] ${JSON.stringify(r)}`);
          }
          if (process.env.YIZI_ERRTEST) {
            await win.webContents.executeJavaScript("setTimeout(() => { throw new Error('注入的渲染层错误'); }, 0)");
            await new Promise((r) => setTimeout(r, 600));
            log('[errtest] injected');
          }
          if (process.env.YIZI_ORDERTEST) {
            const r = await win.webContents.executeJavaScript(`
              (async () => {
                const ids = () => [...document.querySelectorAll('.thumb')].map((el) => el.dataset.thumbId).join(',');
                const before = ids();
                const first = document.querySelector('.thumb');
                first.dispatchEvent(new MouseEvent('click', { bubbles: true }));
                await new Promise((r) => setTimeout(r, 200));
                const rejectBtn = [...document.querySelectorAll('.ab-btn')].find((b) => b.textContent.trim() === '标废');
                if (rejectBtn) rejectBtn.click();
                await new Promise((r) => setTimeout(r, 700));
                return { changed: before !== ids(), beforeHead: before.split(',').slice(0, 5), afterHead: ids().split(',').slice(0, 5) };
              })()
            `);
            log(`[order] changed=${r.changed} head_before=${r.beforeHead.join('|')} head_after=${r.afterHead.join('|')}`);
          }
          if (process.env.YIZI_STATS) {
            const s = await win.webContents.executeJavaScript(
              `(async () => {
                 const st = await window.yizi.thumb['cache-stats']();
                 const imgs = document.querySelectorAll('.thumb-box img').length;
                 const cards = document.querySelectorAll('.thumb').length;
                 const spinners = document.querySelectorAll('.thumb-placeholder .spin').length;
                 return { stats: st.data, cards, imgs, spinners };
               })()`
            );
            log(`[stats] ${JSON.stringify(s)}`);
          }
          if (process.env.YIZI_WHEELTEST) {
            const r = await win.webContents.executeJavaScript(`
              (() => {
                const before = JSON.parse(JSON.stringify(window.__yiziDebug));
                const canvas = document.querySelector('.canvas');
                canvas.dispatchEvent(new WheelEvent('wheel', { deltaY: 120, ctrlKey: true, bubbles: true, cancelable: true }));
                canvas.dispatchEvent(new WheelEvent('wheel', { deltaY: 120, ctrlKey: true, bubbles: true, cancelable: true }));
                return new Promise((res) => setTimeout(() => res({ before: before.columns, after: window.__yiziDebug.columns }), 300));
              })()
            `);
            log(`[wheel] columns ${r.before} -> ${r.after}`);
          }
          const dbg = await win.webContents.executeJavaScript('JSON.stringify(window.__yiziDebug || null)');
          log(`[shot] debug ${dbg}`);
          const image = await win.webContents.capturePage();
          const out = path.join(app.getPath('userData'), 'shot.png');
          require('node:fs').writeFileSync(out, image.toPNG());
          log(`[shot] saved ${out}`);
        } catch (error) {
          log(`[shot] failed ${error.message}`);
        }
        app.exit(0);
      }, 6000);
    });
  }
}

module.exports = { installDevHooks };
