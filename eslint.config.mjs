import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

export default tseslint.config(
  { ignores: ['**/dist', '**/.next', '**/coverage', '**/node_modules', '**/*.d.ts'] },
  js.configs.recommended,
  {
    files: ['**/*.{ts,tsx,mts,cts}'],
    extends: [...tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      globals: { ...globals.node },
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Allow intentionally unused parameters/variables prefixed with `_`.
      // This is the standard TypeScript convention for satisfying interface
      // contracts where a parameter is structurally required but unused.
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
    },
  },
  {
    // Relax unsafe-type rules in test files: Jest/Vitest globals (describe/it/expect)
    // and test framework objects are unresolvable at the ESLint level without full
    // type augmentation, producing false-positive no-unsafe-* and unbound-method errors.
    files: [
      '**/*.spec.ts',
      '**/*.spec.tsx',
      '**/*.test.ts',
      '**/*.test.tsx',
      '**/*.e2e-spec.ts',
      '**/test/**/*.ts',
    ],
    languageOptions: {
      globals: { ...globals.node, ...globals.jest },
    },
    rules: {
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      // vi.fn() mock objects accessed as method references produce false-positive
      // unbound-method warnings because TypeScript sees them as class methods.
      '@typescript-eslint/unbound-method': 'off',
    },
  },
  prettier,
);
