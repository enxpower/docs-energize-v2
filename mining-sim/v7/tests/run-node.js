import { runFullRegressionSuite } from './all-tests.js';

const results = runFullRegressionSuite();
for (const result of results) {
  if (result.status === 'PASS') {
    console.log(`PASS — ${result.name}`);
  } else {
    console.error(`FAIL — ${result.name}: ${result.error ?? 'unknown failure'}`);
  }
}

const passed = results.filter((result) => result.status === 'PASS').length;
const failed = results.length - passed;
console.log(`\n${passed}/${results.length} tests passed`);

if (failed > 0) process.exit(1);
