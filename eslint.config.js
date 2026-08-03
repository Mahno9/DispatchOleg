import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  // server/static/minigames is a copy of each minigame's dist — generated, like dist itself.
  { ignores: ['**/dist/**', '**/node_modules/**', 'data/**', 'server/static/minigames/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
  // build/dev scripts run in Node
  {
    files: ['**/*.mjs'],
    languageOptions: { globals: { process: 'readonly', console: 'readonly' } },
  },
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
);
