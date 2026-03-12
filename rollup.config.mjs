import typescript from '@rollup/plugin-typescript';
import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import terser from '@rollup/plugin-terser';

/** @type {import('rollup').RollupOptions} */
const config = {
    input: 'src/cli.ts',
    output: {
        file: 'lib/cli.mjs',
        format: 'es',
        sourcemap: true,
        banner: '#!/usr/bin/env node',
        inlineDynamicImports: true,
    },
    external: [
        /^node:/,
    ],
    plugins: [
        typescript({ tsconfig: './tsconfig.json' }),
        resolve({ preferBuiltins: true }),
        commonjs(),
        terser(),
    ],
};

export default config;
