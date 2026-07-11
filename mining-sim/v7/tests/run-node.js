import { runAllTests } from './test-runner.js';
import { testBessEnergyDurationDepletion } from './bess-duration-test.js';
import { testMultiTimescaleControl } from './multi-timescale-control-test.js';
import {
  testGeneratorStateMachine,
  testReserveN1Classification,
  testCommitmentStartDecision,
  testDurationAwareBessReserve,
} from './generator-commitment-test.js';
import {
  testPredictiveCommitmentStartsOnTime,
  testPredictiveCommitmentFlagsLateReadiness,
} from './predictive-commitment-test.js';
import {
  testUncertaintyDrivesPreStart,
  testUncertaintyBlocksUnsafeStop,
} from './forecast-uncertainty-test.js';
import {
  testFreshForecastAllowsNormalPolicy,
  testStaleForecastBlocksAutomaticStop,
  testLowQualityForecastAddsConservativeMargin,
} from './forecast-quality-test.js';
import {
  testPrimaryFailsOverToSecondary,
  testPrimaryRecoveryUsesHysteresis,
  testEmergencyForecastFallback,
} from './forecast-failover-test.js';
import { testStagedUflsResponse, testUflsDelayReset } from './ufls-test.js';
import {
  testStagedLoadRestorationPriority,
  testColdLoadPickupDecay,
  testRestorationRollbackAndLockout,
} from './load-restoration-test.js';
import {
  testMotorStartModePickupHierarchy,
  testMotorStartPermissiveAndReserveGate,
  testMotorLowFrequencyAbort,
  testMotorDynamicLoadIntegration,
} from './motor-start-test.js';

const tests = [
  ...runAllTests().map((result) => () => result),
  testBessEnergyDurationDepletion,
  testMultiTimescaleControl,
  testGeneratorStateMachine,
  testReserveN1Classification,
  testCommitmentStartDecision,
  testDurationAwareBessReserve,
  testPredictiveCommitmentStartsOnTime,
  testPredictiveCommitmentFlagsLateReadiness,
  testUncertaintyDrivesPreStart,
  testUncertaintyBlocksUnsafeStop,
  testFreshForecastAllowsNormalPolicy,
  testStaleForecastBlocksAutomaticStop,
  testLowQualityForecastAddsConservativeMargin,
  testPrimaryFailsOverToSecondary,
  testPrimaryRecoveryUsesHysteresis,
  testEmergencyForecastFallback,
  testStagedUflsResponse,
  testUflsDelayReset,
  testStagedLoadRestorationPriority,
  testColdLoadPickupDecay,
  testRestorationRollbackAndLockout,
  testMotorStartModePickupHierarchy,
  testMotorStartPermissiveAndReserveGate,
  testMotorLowFrequencyAbort,
  testMotorDynamicLoadIntegration,
];

const results = [];
for (const test of tests) {
  try {
    const result = test();
    results.push(result);
    console.log(`PASS — ${result.name}`);
  } catch (error) {
    const name = test.name || 'anonymous test';
    results.push({ name, status: 'FAIL', error: error.message });
    console.error(`FAIL — ${name}: ${error.message}`);
  }
}

const passed = results.filter((result) => result.status === 'PASS').length;
const failed = results.length - passed;
console.log(`\n${passed}/${results.length} tests passed`);

if (failed > 0) process.exit(1);
