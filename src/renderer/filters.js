/**
 * 列表与计数共用的筛选口径（避免两处漂移）。
 */
export function filtersOf(s) {
  return {
    folder: s.folder || null,
    heartMin: s.heartOnly ? 1 : null,
    untaggedOnly: s.untagged,
    rejectedOnly: s.rejectedOnly,
    ageMax: s.ageMax,
    ageOnly: s.ageOnly,
    nameLike: s.nameLike || '',
    tagId: s.tagFilter ? s.tagFilter.id : null,
    collectionId: s.collectionId ?? null,
  };
}
