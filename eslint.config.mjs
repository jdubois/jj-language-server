import tseslint from 'typescript-eslint';

export default tseslint.config(
    {
        ignores: ['lib/', 'node_modules/', 'test-fixtures/', 'benchmarks/'],
    },
    ...tseslint.configs.recommended,
    {
        rules: {
            '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
            '@typescript-eslint/no-explicit-any': 'off',
        },
    },
);
