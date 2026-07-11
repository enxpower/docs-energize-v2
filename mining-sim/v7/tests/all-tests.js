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
import {
  testStagedUflsResponse,
  testUflsDelayReset,
  testEensCappedByCurrentDemand,
} from './ufls-test.js';
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
  testMotorReceivesSimulationFrequency,
} from './motor-start-test.js';
import {
  testMotorSchedulerPriorityAndDeadline,
  testMotorSchedulerReserveDelayAndRetry,
  testMotorSchedulerExpiry,
} from './motor-start-scheduler-test.js';
import {
  testIntegratedMotorStartsAreStaggered,
  testIntegratedMotorStartFailureIsTraceable,
  testMotorQueueStateIsExposedInSamples,
} from './motor-scheduler-integration-test.js';
import { testMinimumMiningAcceptanceChain } from './mining-acceptance-test.js';

export const EXTENDED_TESTS = Object.freeze([
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
  testEensCappedByCurrentDemand,
  testStagedLoadRestorationPriority,
  testColdLoadPickupDecay,
  testRestorationRollbackAndLockout,
  testMotorStartModePickupHierarchy,
  testMotorStartPermissiveAndReserveGate,
  testMotorLowFrequencyAbort,
  testMotorDynamicLoadIntegration,
  testMotorReceivesSimulationFrequency,
  testMotorSchedulerPriorityAndDeadline,
  testMotorSchedulerReserveDelayAndRetry,
  testMotorSchedulerExpiry,
  testIntegratedMotorStartsAreStaggered,
  testIntegratedMotorStartFailureIsTraceable,
  testMotorQueueStateIsExposedInSamples,
  testMinimumMiningAcceptanceChain,
]);

export function runFullRegressionSuite() {
  const results = [...runAllTests()];
  for (const test of EXTENDED_TESTS) {
    try {
      results.push(test());
    } catch (error) {
      results.push({
        name: test.name || 'anonymous test',
        status: 'FAIL',
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return results;
}
