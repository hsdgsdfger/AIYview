import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './styles.css';

/* 渲染层异常转发到主进程日志（<userData>/logs/app.log），
   白屏/点了没反应时能查到具体报错，而不是只有一句「打不开」 */
function report(level, message, extra) {
  try {
    window.yizi.invoke('log:renderer', { level, message: String(message).slice(0, 1200), extra });
  } catch {
    /* 日志通道不可用时忽略 */
  }
}

window.addEventListener('error', (e) => {
  report('error', e.message + ' @ ' + e.filename + ':' + e.lineno + ':' + e.colno);
});
window.addEventListener('unhandledrejection', (e) => {
  const r = e.reason;
  report('error', 'unhandledrejection: ' + (r && r.stack ? r.stack : String(r)));
});

// 渲染层卡顿：长任务超过 300ms 记一条
try {
  const po = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      if (entry.duration > 300) report('warn', '长任务 ' + Math.round(entry.duration) + 'ms', { name: entry.name });
    }
  });
  po.observe({ entryTypes: ['longtask'] });
} catch {
  /* 不支持 longtask 就跳过 */
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>
);
