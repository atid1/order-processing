module.exports = {
  root: true,
  env: {
    node: true,
    es2020: true,
  },
  extends: ['eslint:recommended'],
  parserOptions: {
    ecmaVersion: 2020,
    sourceType: 'module',
  },
  ignorePatterns: ['dist', 'node_modules'],
  rules: {
    'no-console': 'off'
  },
};
