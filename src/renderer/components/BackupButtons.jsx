/** 数据维护四个按钮：侧车导出 / 侧车恢复 / 备份数据库 / 备份文件夹 */
export default function BackupButtons({ libraryId, say, actions }) {
  return (
    <>
      <button
        className="btn"
        title="把心数/废标/分级/标签写成每张图旁边的 .aiyview.json（不动原图）"
        onClick={async () => {
          const r = await window.aiyview.image['export-sidecar']({ libraryId });
          say(r && r.ok ? `侧车已写出 ${r.data.written} 份${r.data.failed ? `，失败 ${r.data.failed}` : ''}` : (r && r.error) || '导出失败');
        }}
      >导出全库标记（侧车）</button>
      <button
        className="btn ghost"
        title="读回每张图旁边的 .aiyview.json，恢复心数/废标/分级"
        onClick={async () => {
          if (!window.confirm('用侧车文件覆盖当前的 心数/废标/分级？\n（只覆盖侧车里写了的字段）')) return;
          const r = await window.aiyview.image['import-sidecar']({ libraryId });
          if (r && r.ok) {
            say(`已恢复 ${r.data.restored} 张（无侧车 ${r.data.missing}）`);
            actions.refresh();
          } else say((r && r.error) || '恢复失败');
        }}
      >从侧车恢复标记</button>
      <button
        className="btn ghost"
        title="把当前数据库快照一份到 backups 目录（带时间戳，不覆盖旧备份）"
        onClick={async () => {
          const r = await window.aiyview.app.backup();
          say(r && r.ok ? `已备份：${r.data.path}` : (r && r.error) || '备份失败');
        }}
      >备份数据库</button>
      <button
        className="btn ghost"
        title="打开备份所在文件夹"
        onClick={() => window.aiyview.app['backup-open']()}
      >备份文件夹</button>
    </>
  );
}
