import js from '@eslint/js';
import globals from 'globals';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import jsxA11y from 'eslint-plugin-jsx-a11y';

export default [
    { ignores: ['dist/**', 'node_modules/**'] },

    {
        files: ['**/*.{js,jsx}'],
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: 'module',
            globals: { ...globals.browser },
            parserOptions: { ecmaFeatures: { jsx: true } }
        },
        settings: { react: { version: 'detect' } },
        plugins: { react, 'react-hooks': reactHooks, 'jsx-a11y': jsxA11y },
        rules: {
            ...js.configs.recommended.rules,
            ...react.configs.flat.recommended.rules,
            ...react.configs.flat['jsx-runtime'].rules,
            ...reactHooks.configs.recommended.rules,
            ...jsxA11y.flatConfigs.recommended.rules,

            // This project imports React explicitly and does not use prop-types.
            'react/prop-types': 'off',

            // The two that have actually bitten here: a stale dependency array
            // silently reading old state, and a control that only a mouse can
            // reach. Both were real bugs in this codebase, so they are errors.
            'react-hooks/exhaustive-deps': 'error',
            'jsx-a11y/no-static-element-interactions': 'error',
            'jsx-a11y/click-events-have-key-events': 'error',

            // The React Compiler rules are worth reading but not worth blocking
            // on: they flag correct patterns this app relies on — measuring
            // layout then setting state in a layout effect, detecting
            // completion from an effect, and calling Date.now() inside an event
            // handler the rule cannot prove is not render. Warnings keep them
            // visible without training anyone to ignore a red build.
            'react-hooks/purity': 'warn',
            'react-hooks/refs': 'warn',
            'react-hooks/set-state-in-effect': 'warn',
            'react-hooks/preserve-manual-memoization': 'warn',

            'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }]
        }
    },

    {
        files: ['**/*.test.js'],
        languageOptions: { globals: { ...globals.node } },
        rules: { 'no-undef': 'off' }
    }
];
