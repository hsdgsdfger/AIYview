import { useEffect, useState } from 'react';

const MILESTONES = [
  { id: 'M0', label: '仓库骨架 / SQLite 迁移 / CI', done: true },
  { id: 'M1', label: '图库注册、扫描入库、游标分页', done: false },
  { id: 'M2', label: '查看器、提示词面板、心数、废标', done: false },
  { id: 'M3', label: '分级 l0–l4、遮挡、回收站撤回', done: false },
  { id: 'M4', label: '标签抽取与打标', done: false },
  { id: 'M5', label: '主题与性能达标', done: false },
];

function Row({ label, value }) {
  return (
    <div className="row">
      <span className="row-key">{label}</span>
      <span className="row-value">{value}</span>
    </div>
  );
}

export default function App() {
  const [info, setInfo] = useState(null);
  const [db, setDb] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const api = window.yizi;
    if (!api) {
      setError('preload 未注入：请通过 electron 启动，而不是浏览器直开');
      return;
    }
    api.info().then(setInfo).catch((e) => setError(String(e)));
    api.dbStatus().then(setDb).catch((e) => setError(String(e)));
  }, []);

  return (
    <main className="shell">
      <header className="head">
        <h1>YiziView Next</h1>
        <p className="sub">M0 骨架：空窗口 + 迁移自检，界面与业务逻辑尚未接入</p>
      </header>

      {error ? <p className="error">{error}</p> : null}

      <section className="card">
        <h2>运行环境</h2>
        {info ? (
          <>
            <Row label="Electron" value={info.electron} />
            <Row label="Chromium" value={info.chrome} />
            <Row label="Node" value={info.node} />
            <Row label="平台" value={`${info.platform} / ${info.arch}`} />
            <Row label="模式" value={info.dev ? 'development' : 'production'} />
          </>
        ) : (
          <p className="muted">读取中…</p>
        )}
      </section>

      <section className="card">
        <h2>数据库自检</h2>
        {db ? (
          db.ok ? (
            <>
              <Row label="迁移版本" value={db.current} />
              <Row label="user_version" value={db.userVersion} />
              <Row label="表数量" value={db.tables.length} />
              <Row label="表清单" value={db.tables.join(', ')} />
            </>
          ) : (
            <p className="error">不可用：{db.code} — {db.error}</p>
          )
        ) : (
          <p className="muted">读取中…</p>
        )}
      </section>

      <section className="card">
        <h2>里程碑</h2>
        <ul className="milestones">
          {MILESTONES.map((m) => (
            <li key={m.id} className={m.done ? 'done' : ''}>
              <span className="tag">{m.id}</span>
              {m.label}
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
