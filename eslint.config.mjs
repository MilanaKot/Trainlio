import nextCoreWebVitals from 'eslint-config-next/core-web-vitals'
import nextTypescript from 'eslint-config-next/typescript'
import prettier from 'eslint-config-prettier'

/**
 * Trainlio — Sports Training Booking Platform
 *
 * Beyond the Next.js defaults, this config enforces three architectural rules
 * that are easy to break by accident and expensive to discover later.
 */
const config = [
  ...nextCoreWebVitals,
  ...nextTypescript,
  prettier,
  {
    ignores: ['.next/**', 'node_modules/**', 'src/types/database.generated.ts'],
  },
  {
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  {
    // RULE 1 — the service-role client never reaches the browser.
    //
    // It bypasses row level security entirely (PERMISSIONS). A single import
    // from a Client Component would ship a key that can read every family's
    // data. The module itself also imports 'server-only', so this rule is the
    // fast, legible failure rather than the only line of defence.
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/lib/supabase/admin.ts', 'src/server/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/lib/supabase/admin', '@/lib/supabase/admin'],
              message:
                'The service-role client bypasses RLS. Import it only from src/server/**, never from a component or a shared lib module.',
            },
          ],
        },
      ],
    },
  },
  {
    // RULE 2 — no raw environment access outside the validated env module.
    //
    // Scattered process.env reads are how a missing secret becomes a runtime
    // 500 in production instead of a failed build.
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/lib/env.ts'],
    rules: {
      'no-restricted-properties': [
        'error',
        {
          object: 'process',
          property: 'env',
          message: 'Import the validated config from @/lib/env instead of reading process.env.',
        },
      ],
    },
  },
  {
    // RULE 3 — no device-local date formatting.
    //
    // Every date shown to any user is in the workspace timezone, never the
    // browser's (approved finding 2). A guardian travelling abroad must see the
    // same training time as the coach.
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/lib/time/**'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector:
            'CallExpression[callee.property.name=/^(toLocaleDateString|toLocaleTimeString|toLocaleString)$/]',
          message:
            'Locale formatting uses the device timezone. Use the helpers in @/lib/time, which format in the workspace timezone.',
        },
        {
          selector: "NewExpression[callee.name='Intl.DateTimeFormat']",
          message: 'Use @/lib/time so the workspace timezone is applied explicitly.',
        },
      ],
    },
  },
  {
    files: ['tests/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-properties': 'off',
      'no-restricted-syntax': 'off',
    },
  },
]

export default config
