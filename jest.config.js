module.exports = {
  bail: false,
  verbose: true,
  testMatch: [
    '**/__tests__/**/*.test.js'
  ],
  moduleFileExtensions: [
    'js',
    'json'
  ],
  coverageDirectory: '<rootDir>/.coverage',
  collectCoverageFrom: [
    'lib/**/*.js',
    '!**/node_modules/**'
  ],
  watchman: false,
  setupTestFrameworkScriptFile: 'jest-extended',
  testEnvironment: 'node'
}
