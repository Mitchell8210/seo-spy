import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', 'coverage/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  { files: ['**/*.cjs'], languageOptions: { globals: { module: 'readonly' } } },
  { files: ['**/*.ts'], rules: { '@typescript-eslint/no-explicit-any': 'error' } },
);
