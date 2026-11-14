'use strict';

const { handle } = require('../ipc.cjs');
const { getDb } = require('../db/database.cjs');
const imgs = require('../../core/db/imageRepository.cjs');
const prompts = require('../../core/db/promptRepository.cjs');
const { readImagePrompt } = require('./prompts.cjs');

/**
 * 提示词库 IPC：save = 先懒读元数据，再存进软件自己的库（不写原图目录）。
 */
function registerPromptLibraryIpc() {
  handle('prompt:save', async ({ imageId, title, note } = {}) => {
    const db = getDb();
    const image = imgs.getImage(db, imageId);
    if (!image) throw Object.assign(new Error('图片不存在'), { code: 'NOT_FOUND' });

    let metaRow = null;
    try {
      metaRow = await readImagePrompt({ id: imageId });
    } catch { /* 无元数据也允许保存空壳 */ }

    return prompts.saveFromImage(
      db,
      imageId,
      {
        positive: (metaRow && metaRow.positive) || '',
        negative: (metaRow && metaRow.negative) || '',
        params: metaRow
          ? {
              Model: metaRow.model,
              Sampler: metaRow.sampler,
              Steps: metaRow.steps,
              'CFG scale': metaRow.cfg,
              Seed: metaRow.seed,
            }
          : {},
      },
      { title, note }
    );
  });

  handle('prompt:save-manual', (payload) => prompts.saveManual(getDb(), payload || {}));
  handle('prompt:list', (q) => prompts.listPage(getDb(), q || {}));
  handle('prompt:get', ({ id }) => prompts.get(getDb(), id));
  handle('prompt:update', ({ id, ...patch }) => prompts.update(getDb(), id, patch));
  handle('prompt:remove', ({ id }) => prompts.remove(getDb(), id));
}

module.exports = { registerPromptLibraryIpc };
