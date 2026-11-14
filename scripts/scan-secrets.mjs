import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.argv[2] || process.cwd();
const PATTERNS = [
  ['私钥', /BEGIN (RSA |EC |OPENSSH |PGP )?PRIVATE KEY/],
  ['AWS key', /AKIA[0-9A-Z]{16}/],
  ['GitHub token', /gh[pousr]_[A-Za-z0-9]{20,}/],
  ['OpenAI/云 key', /\b(sk|pk)-[A-Za-z0-9]{20,}/],
  ['疑似赋值型密钥', /(api[_-]?key|secret|token|passwd|password|access[_-]?key)\s*[:=]\s*['"][^'"\s]{12,}['"]/i],
  ['绝对用户路径', /[A-Za-z]:\\Users\\[^\\'"\s]+/],
  ['项目绝对路径', /D:\\\\?Apps|D:\\Apps|workbubby_Data/],
  ['mac/linux 家目录', /\/Users\/[A-Za-z0-9._-]+/],
  ['邮箱', /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/],
  ['内网地址', /(?:10\.\d{1,3}|192\.168|172\.(?:1[6-9]|2\d|3[01]))\.\d{1,3}\.\d{1,3}/],
  ['云厂商 AK/SK 字面量', /(LTAI[0-9A-Za-z]{12,}|AKID[A-Za-z0-9]{16,})/],
];
const SKIP_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.ico', '.woff', '.woff2', '.ttf', '.onnx', '.sqlite', '.node', '.dll', '.exe', '.zip']);

const tracked = execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' })
  .split('\n')
  .filter(Boolean)
  .filter((f) => !SKIP_EXT.has(path.extname(f).toLowerCase()));

const hits = [];
for (const rel of tracked) {
  const abs = path.join(ROOT, rel);
  let text;
  try {
    const st = fs.statSync(abs);
    if (st.size > 2 * 1024 * 1024) continue;
    text = fs.readFileSync(abs, 'utf8');
  } catch {
    continue;
  }
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    for (const [name, re] of PATTERNS) {
      if (re.test(lines[i])) {
        hits.push({ file: rel, line: i + 1, kind: name, text: lines[i].trim().slice(0, 140) });
        break;
      }
    }
  }
}
console.log(`tracked text files: ${tracked.length}, suspicious lines: ${hits.length}`);
for (const h of hits) console.log(`${h.file}:${h.line} [${h.kind}] ${h.text}`);
