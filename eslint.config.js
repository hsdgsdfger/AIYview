import js from '@eslint/js';
import globals from 'globals';

export default [
  {
    ignores: ['dist/**', 'release/**', 'node_modules/**', 'tests/fixtures/**', '.native/**'],
  },
  js.configs.recommended,
  {
    files: ['src/main/**/*.cjs', 'src/core/**/*.cjs'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: { ...globals.node },
    },
  },
  {
    files: ['**/*.mjs', 'scripts/**/*.mjs', 'vite.config.js', 'eslint.config.js', 'tailwind.config.js', 'postcss.config.js'],
    languageOptions: {
      sourceType: 'module',
      globals: { ...globals.node },
    },
  },
  {
    files: ['src/renderer/**/*.{js,jsx}'],
    languageOptions: {
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: { ...globals.browser },
    },
    rules: {
      // espree 能解析 JSX，但核心规则不知道 <Row /> 用到了 Row。
      // 不为此引 eslint-plugin-react（依赖白名单），改为只对 JSX 文件放宽首字母大写变量。
      'no-unused-vars': ['error', { varsIgnorePattern: '^[A-Z]' }],
    },
  },
];
