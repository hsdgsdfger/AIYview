'use strict';

/**
 * 虚拟收藏夹 IPC：list / create / rename / remove / add / remove-items。
 * 纯关系表，磁盘上不多出任何文件。
 */

const { handle } = require('../ipc.cjs');
const { getDb } = require('../db/database.cjs');
const repo = require('../../core/db/collectionRepository.cjs');

function registerCollectionIpc(broadcast) {
  handle('collection:list', ({ libraryId } = {}) => repo.listCollections(getDb(), libraryId));

  handle('collection:create', ({ libraryId, name } = {}) => {
    const created = repo.createCollection(getDb(), libraryId, name);
    if (typeof broadcast === 'function') broadcast('collections-updated', { libraryId });
    return created;
  });

  handle('collection:rename', ({ id, name } = {}) => repo.renameCollection(getDb(), id, name));

  handle('collection:remove', ({ id, libraryId } = {}) => {
    const removed = repo.removeCollection(getDb(), id);
    if (typeof broadcast === 'function') broadcast('collections-updated', { libraryId });
    return removed;
  });

  handle('collection:add', ({ collectionId, ids, libraryId } = {}) => {
    const added = repo.addItems(getDb(), collectionId, ids || []);
    if (typeof broadcast === 'function') broadcast('collections-updated', { libraryId });
    return added;
  });

  handle('collection:remove-items', ({ collectionId, ids, libraryId } = {}) => {
    const removed = repo.removeItems(getDb(), collectionId, ids || []);
    if (typeof broadcast === 'function') broadcast('collections-updated', { libraryId });
    return removed;
  });
}

module.exports = { registerCollectionIpc };
