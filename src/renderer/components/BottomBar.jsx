import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useStore } from '../store.jsx';
import TagPanel from './TagPanel.jsx';
import ShortcutPanel from './ShortcutPanel.jsx';
import { TrashPanel, PromptsPanel, CachePanel, ScalePanel, RenamePanel } from './BottomPanels.jsx';
import Icon from './Icon.jsx';

/**
 * 底栏：左状态 / 右打标 + 设置。
 * 设置里收：最近删除、标签、提示词库、批量重命名、标签字典、缩略图缓存、界面缩放、快捷键、日志、主题。
 */
export default function BottomBar() {
  const { selection, actions, tagging, status, say, hoverEdit, setHoverEdit } = useStore();
  const [panel, setPanel] = useState(null); // 'trash' | 'prompts' | 'tags' | 'shortcuts' | 'cache' | 'scale' | 'rename'
  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsRef = useRef(null);

  /* 点空白处关设置 */
  useEffect(() => {
    if (!settingsOpen) return undefined;
    const onDown = (e) => {
      if (e.target.closest && e.target.closest('.settings-menu')) return;
      if (settingsRef.current && !settingsRef.current.contains(e.target)) setSettingsOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [settingsOpen]);

  const open = (name) => {
    setSettingsOpen(false);
    setPanel(name);
  };

  /** 导入标签字典：不选文件时用打标模型目录里的 selected_tags.csv */
  const importDictionary = async () => {
    setSettingsOpen(false);
    const r = await window.aiyview.tag['import-dictionary']({});
    if (r && r.ok) {
      say(`标签字典已导入：新增 ${r.data.inserted || 0}，更新 ${r.data.updated || 0}`);
      actions.refresh();
    } else {
      say(`导入标签字典失败：${(r && r.error) || '未知错误'}`);
    }
  };

  /** 导入任意 CSV（带文件对话框） */
  const importCsv = async () => {
    setSettingsOpen(false);
    const r = await window.aiyview.tag['pick-csv']({});
    if (!r || !r.ok) {
      say(`导入失败：${(r && r.error) || '未知错误'}`);
      return;
    }
    if (r.data.canceled) return;
    say(`CSV 已导入：新增 ${r.data.inserted || 0}，更新 ${r.data.updated || 0}`);
    actions.refresh();
  };

  return (
    <>
      {panel === 'tags' && <TagPanel onClose={() => setPanel(null)} />}
      {panel === 'shortcuts' && <ShortcutPanel onClose={() => setPanel(null)} />}
      {panel === 'prompts' && <PromptsPanel onClose={() => setPanel(null)} />}
      {panel === 'cache' && <CachePanel onClose={() => setPanel(null)} />}
      {panel === 'scale' && <ScalePanel onClose={() => setPanel(null)} />}
      {panel === 'rename' && <RenamePanel onClose={() => setPanel(null)} />}
      {panel === 'trash' && <TrashPanel onClose={() => setPanel(null)} />}

      <footer className="statusbar">
        <div className="sb-left">
          <span className="sb-muted">{status || (selection.size > 0 ? `已选 ${selection.size} 张` : '未选择')}</span>
        </div>

        <div className="sb-right">
          {tagging && <span className="sb-muted">打标 {tagging.done}/{tagging.total}</span>}

          <button
            className="sb-toggle"
            onClick={() => (tagging ? actions.stopTagging() : actions.startTagging())}
            title="打标（只处理无元数据的图）"
          ><Icon name="refresh" size={14} className={tagging ? 'spin-icon' : ''} /></button>

          <div className="settings-anchor" ref={settingsRef}>
            <button
              className={settingsOpen ? 'sb-toggle on' : 'sb-toggle'}
              onClick={() => setSettingsOpen((v) => !v)}
              title="设置"
            ><Icon name="gear" size={14} /></button>

            {settingsOpen && createPortal(
              <div className="settings-menu">
                <button onClick={() => open('trash')}>
                  <Icon name="trash" size={14} />
                  <span>最近删除</span>
                  <em>12h 可撤回</em>
                </button>
                <button onClick={() => open('tags')}>
                  <Icon name="tag" size={14} />
                  <span>标签</span>
                  <em>含移除单图标签</em>
                </button>
                <button onClick={() => open('prompts')}>
                  <Icon name="tag" size={14} />
                  <span>提示词库</span>
                  <em>可编辑/删除</em>
                </button>
                <button onClick={() => open('rename')}>
                  <Icon name="sort" size={14} />
                  <span>批量重命名</span>
                  <em>{selection.size > 0 ? `已选 ${selection.size} 张` : '先选图'}</em>
                </button>
                <div className="settings-sep" />
                <button onClick={importDictionary}>
                  <Icon name="tag" size={14} />
                  <span>导入标签字典</span>
                  <em>模型目录 CSV</em>
                </button>
                <button onClick={importCsv}>
                  <Icon name="folder-plus" size={14} />
                  <span>导入标签 CSV</span>
                  <em>自选文件</em>
                </button>
                <button onClick={() => open('cache')}>
                  <Icon name="refresh" size={14} />
                  <span>缩略图缓存</span>
                  <em>查看/清理</em>
                </button>
                <button onClick={() => open('scale')}>
                  <Icon name="panel-expand" size={14} />
                  <span>界面缩放</span>
                </button>
                <button
                  onClick={() => {
                    setHoverEdit(!hoverEdit);
                    setSettingsOpen(false);
                  }}
                  title="鼠标停在缩略图上就能标记/分级，和选中一样"
                >
                  <Icon name="search" size={14} />
                  <span>悬停即编辑</span>
                  <em>{hoverEdit ? '开' : '关'}</em>
                </button>
                <div className="settings-sep" />
                <button onClick={() => open('shortcuts')}>
                  <Icon name="sort" size={14} />
                  <span>快捷键</span>
                  <em>打分/评级/标废/删除</em>
                </button>
                <button
                  onClick={async () => {
                    const r = await window.aiyview.app['log-open']();
                    if (!r || !r.ok) window.aiyview.app['log-path']();
                    setSettingsOpen(false);
                  }}
                >
                  <Icon name="search" size={14} />
                  <span>日志</span>
                  <em>排障</em>
                </button>
                <button
                  onClick={() => {
                    const el = document.documentElement;
                    const light = el.getAttribute('data-theme') === 'light';
                    el.setAttribute('data-theme', light ? 'dark' : 'light');
                    window.aiyview.settings.set({ key: 'theme', value: light ? 'dark' : 'light' });
                    setSettingsOpen(false);
                  }}
                >
                  <Icon name="gear" size={14} />
                  <span>亮/暗主题</span>
                </button>
              </div>,
              document.body
            )}
          </div>
        </div>
      </footer>
    </>
  );
}
