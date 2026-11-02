// Shared ESLint flat config for all Track workspaces.
// Usage in a workspace's eslint.config.js:
//   import { base, react } from '@track/config/eslint';
//   export default [...base, ...react];
import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/** Rules for every TypeScript workspace. */
export const base = tseslint.config(
  { ignores: ['dist/**', '.expo/**', '.turbo/**', 'node_modules/**', 'ios/**', 'android/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': 'error',
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },
  prettier,
);

/** Additional rules for React workspaces (web and mobile). */
export const react = [reactHooks.configs.flat.recommended];

/** Globals for Node.js scripts and tools. */
export const node = [{ languageOptions: { globals: globals.node } }];

/** Globals for browser code. */
export const browser = [{ languageOptions: { globals: globals.browser } }];
