// eslint.config.js
// 边界规则的强制手段（四条宪法的一/三落地）。
// 目标：把"架构约定"变成"机器可判定的检查"，而非口头要求。
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['node_modules/**', 'dist/**', 'web/**', '**/*.d.ts'],
  },
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },

  // 宪法一：依赖只能单向向内（kernel 不得依赖 modules/scenarios）
  {
    files: ['kernel/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/modules/**', '**/scenarios/**', '@modules/*', '@scenarios/*'],
              message:
                '宪法一：kernel 不得依赖 modules/scenarios。内核必须对场景无知。',
            },
          ],
        },
      ],
    },
  },

  // 宪法三：模块间只发/订事件，不直接调用
  {
    files: ['modules/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/scenarios/**', '@scenarios/*'],
              message: '宪法一/三：模块不得依赖场景产品。',
            },
            {
              group: ['**/modules/*/internal/**'],
              message:
                '宪法三：禁止跨模块 import 其他模块的 internal/。跨模块协作走事件总线。',
            },
          ],
        },
      ],
    },
  }
);
