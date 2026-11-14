'use strict';

/**
 * WD tagger 前后处理（纯逻辑，无模型依赖，可单测）
 *
 * WD-SwinV2-v3 输入：[1, H, W, 3]（NHWC，本仓库 models/illuTag 的 onnx 实测为 NHWC），
 * RGB，float32，取值 0–1；输出：按 selected_tags.csv 行序排列的概率（sigmoid 前 logits）。
 */

const IMG_SIZE = 448;

/** RGB 像素（HWC, 0–255）→ float32 NHWC（0–1） */
function pixelsToTensor(pixels, { width = IMG_SIZE, height = IMG_SIZE } = {}) {
  if (!pixels || pixels.length !== width * height * 3) {
    throw new Error(`像素缓冲尺寸不符：期望 ${width * height * 3}，实际 ${pixels ? pixels.length : 0}`);
  }
  const data = new Float32Array(width * height * 3);
  for (let i = 0; i < data.length; i++) {
    data[i] = pixels[i] / 255;
  }
  return { dims: [1, height, width, 3], data };
}

/** 数值稳定 sigmoid */
function sigmoid(x) {
  if (x >= 0) return 1 / (1 + Math.exp(-x));
  const e = Math.exp(x);
  return e / (1 + e);
}

/**
 * 把输出向量映射成标签概率。
 * @param {Array|Float32Array} logits 模型输出
 * @param {Array<{name:string, category:number}>} labels 按 CSV 行序
 * @returns {{rating:Array, general:Array, character:Array}}
 */
function mapOutputs(logits, labels) {
  if (!labels || logits.length !== labels.length) {
    throw new Error(`输出维度与标签表不符：${logits.length} vs ${labels ? labels.length : 0}`);
  }
  const rating = [];
  const general = [];
  const character = [];
  for (let i = 0; i < labels.length; i++) {
    const p = sigmoid(Number(logits[i]));
    const item = { name: labels[i].name, prob: p };
    const cat = Number(labels[i].category);
    if (cat === 9) rating.push(item);
    else if (cat === 4) character.push(item);
    else general.push(item);
  }
  return { rating, general, character };
}

/**
 * 选出可用标签：
 *   rating 取概率最高的一项（决定 age_level 候选）；
 *   general/character 按 threshold 截断，general 限 topN。
 */
function selectTags({ rating, general, character }, { threshold = 0.35, topN = 24 } = {}) {
  const pick = (arr) => arr
    .filter((t) => t.prob >= threshold)
    .sort((a, b) => b.prob - a.prob)
    .slice(0, topN);

  let topRating = null;
  for (const r of rating) {
    if (!topRating || r.prob > topRating.prob) topRating = r;
  }

  return {
    rating: topRating,
    general: pick(general),
    character: pick(character),
  };
}

/** rating 标签名 → l0–l4 候选（需求 3.1：s=q 的映射按 Danbooru 口径降档） */
const RATING_TO_LEVEL = {
  general: 0, // sfw
  sensitive: 1, // q
  questionable: 2, // e（未到露骨词则由词表细判，这里保守给 l2）
  explicit: 3, // e
};

function ratingToLevel(ratingName) {
  if (!ratingName) return null;
  return RATING_TO_LEVEL[String(ratingName).toLowerCase()] ?? null;
}

module.exports = {
  IMG_SIZE,
  pixelsToTensor,
  sigmoid,
  mapOutputs,
  selectTags,
  ratingToLevel,
  RATING_TO_LEVEL,
};
