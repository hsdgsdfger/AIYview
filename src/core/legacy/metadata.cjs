'use strict';
/**
 * 全格式图像元数据解析器 —— 门面
 * ---------------------------------------------------------------------------
 * 原单文件 568 行超限，拆为 metadataImage.cjs（容器解析）+
 * metadataPrompts.cjs（提示词/主入口），此处保持原导出形状不变。
 *
 * 导出：
 *   readMetadata(buffer)            -> Promise<Metadata>   （纯内存，供测试）
 *   readMetadataFromFile(filePath)  -> Promise<Metadata>
 *   parseA1111Parameters(text)      -> { positive, negative, settings, params }
 *   extractPromptsFromJson(json)    -> string[]
 */

const prompts = require('./metadataPrompts.cjs');
const image = require('./metadataImage.cjs');

module.exports = {
  readMetadata: prompts.readMetadata,
  readMetadataFromFile: prompts.readMetadataFromFile,
  parseA1111Parameters: prompts.parseA1111Parameters,
  extractPromptsFromJson: prompts.extractPromptsFromJson,
  decodeUserComment: image.decodeUserComment,
  parseTiff: image.parseTiff,
  parsePng: image.parsePng,
  sniffFormat: image.sniffFormat,
};
