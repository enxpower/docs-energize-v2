import { calculatePowerBalance } from '../physics/power-balance.js';
import { stepIslandFrequency } from '../physics/frequency.js';
import { dispatchIsland } from '../controls/ems.js';
import { commandBessFastResponse } from '../controls/bess-fast-controller.js';
import { evaluateGeneratorCommitment, applyGeneratorCommitmentAction } from '../controls/generator-commitment.js';
import { assessReserve } from '../reliability/reserve-engine.js';
import { HoldCurrentLoadForecast } from '../forecast/load-forecast.js';
import { assessForecastQuality } from '../forecast/forecast-quality.js';
import { deriveSystemState } from './state-machine.js';

export class SimulationEngine {
  constructor({
    dtSeconds,
    nominalHz,
    systemBaseMW,
    load,
    dieselFleet,
    bess,
    loadForecast = new HoldCurrentLoadForecast(),
    emsIntervalSeconds = 20,
    commitmentEnabled = true,
    commitmentIntervalSeconds = 60,
    commitmentLookAheadSeconds = 300,
    commitmentAllowStop = false,
    minimumOnlineUnits = 1,
    commitmentReserveMarginMW = 0,
    commitmentFirmSupportDurationMinutes = 15,
    forecastStaleFallbackMarginMW = 0.5,
    forecastLowQualityMarginMW = 0.25,
    forecastMissingFallbackMarginMW = 1.0,
  }) {
    this.dtSeconds = dtSeconds;
    this.nominalHz = nominalHz;
    this.systemBaseMW = systemBaseMW;
    this.load = load;
    this.dieselFleet = dieselFleet;
    this.bess = bess;
    this.loadForecast = loadForecast;
    this.emsIntervalSeconds = emsIntervalSeconds;
    this.nextEmsDispatchSeconds = 0;
    this.lastEmsResult = null;
    this.commitmentEnabled = commitmentEnabled;
    this.commitmentIntervalSeconds = commitmentIntervalSeconds;
    this.commitmentLookAheadSeconds = commitmentLookAheadSeconds;
    this.commitmentAllowStop = commitmentAllowStop;
    this.minimumOnlineUnits = minimumOnlineUnits;
    this.commitmentReserveMarginMW = commitmentReserveMarginMW;
    this.commitmentFirmSupportDurationMinutes = commitmentFirmSupportDurationMinutes;
    this.forecastStaleFallbackMarginMW = forecastStaleFallbackMarginMW;
    this.forecastLowQualityMarginMW = forecastLowQualityMarginMW;
    this.forecastMissingFallbackMarginMW = forecastMissingFallbackMarginMW;
    this.nextCommitmentEvaluationSeconds = 0;
    this.lastCommitmentDecision = null;
    this.lastLoadForecast = null;
    this.lastForecastQuality = null;
    this.timeSeconds = 0;
    this.frequencyHz = nominalHz;
    this.rocofHzPerS = 0;
    this.running = false;
    this.faulted = false;
    this.state = 'OFF';
    this.history = [];
    this.events = [];
  }

  start() { this.running = true; }
  stop() { this.running = false; }

  runEmsIfDue(loadMW) {
    if (this.timeSeconds + 1e-9 < this.nextEmsDispatchSeconds) return this.lastEmsResult;
    this.lastEmsResult = dispatchIsland({ loadMW, dieselFleet: this.dieselFleet, bess: this.bess });
    this.nextEmsDispatchSeconds = this.timeSeconds + this.emsIntervalSeconds;
    return this.lastEmsResult;
  }

  runCommitmentIfDue(loadMW) {
    if (!this.commitmentEnabled) return this.lastCommitmentDecision;
    if (this.timeSeconds + 1e-9 < this.nextCommitmentEvaluationSeconds) return this.lastCommitmentDecision;

    this.lastLoadForecast = this.loadForecast?.getCommitmentForecast?.({
      currentTimeSeconds: this.timeSeconds,
      lookAheadSeconds: this.commitmentLookAheadSeconds,
      currentLoadMW: loadMW,
    }) ?? null;

    const sourceSwitchEvent = this.lastLoadForecast?.switchEvent;
    if (sourceSwitchEvent) this.events.push({ ...sourceSwitchEvent });

    this.lastForecastQuality = assessForecastQuality({
      forecast: this.lastLoadForecast,
      currentTimeSeconds: this.timeSeconds,
      currentLoadMW: loadMW,
      staleFallbackMarginMW: this.forecastStaleFallbackMarginMW,
      lowQualityMarginMW: this.forecastLowQualityMarginMW,
      missingFallbackMarginMW: this.forecastMissingFallbackMarginMW,
    });

    const allowStopByQuality = this.commitmentAllowStop && this.lastForecastQuality.allowAutomaticStop;
    const forecastLoadMW = this.lastLoadForecast?.forecastPeakLoadMW ?? loadMW;
    const forecastHorizonSeconds = this.lastLoadForecast?.forecastHorizonSeconds ?? 0;
    const forecastRiskLevel = this.lastLoadForecast?.forecastRiskLevel ?? 'HIGH';
    const forecastErrorMW = this.lastLoadForecast?.forecastErrorMW ?? this.lastForecastQuality.degradationMarginMW;

    const decision = evaluateGeneratorCommitment({
      loadMW,
      forecastLoadMW,
      forecastPlanningLoadMW: this.lastForecastQuality.effectivePlanningLoadMW,
      forecastHorizonSeconds,
      forecastRiskLevel,
      forecastErrorMW,
      dieselFleet: this.dieselFleet,
      bess: this.bess,
      minimumOnlineUnits: this.minimumOnlineUnits,
      reserveMarginMW: this.commitmentReserveMarginMW,
      firmSupportDurationMinutes: this.commitmentFirmSupportDurationMinutes,
      allowStop: allowStopByQuality,
    });
    const actionResult = applyGeneratorCommitmentAction({ dieselFleet: this.dieselFleet, decision });
    this.lastCommitmentDecision = {
      ...decision,
      actionResult,
      forecast: this.lastLoadForecast,
      forecastQuality: this.lastForecastQuality,
      automaticStopBlockedByForecastQuality: this.commitmentAllowStop && !allowStopByQuality,
    };
    this.nextCommitmentEvaluationSeconds = this.timeSeconds + this.commitmentIntervalSeconds;

    if (actionResult?.accepted) {
      this.events.push({
        timeSeconds: this.timeSeconds,
        type: `DG_${actionResult.type}_REQUEST`,
        equipmentId: actionResult.equipmentId,
        reason: actionResult.reason,
        predictive: Boolean(actionResult.predictive),
        uncertaintyDriven: Boolean(actionResult.uncertaintyDriven),
        forecastPeakLoadMW: forecastLoadMW,
        forecastPlanningLoadMW: this.lastForecastQuality.effectivePlanningLoadMW,
        forecastErrorMW,
        forecastRiskLevel,
        forecastStatus: this.lastForecastQuality.status,
        forecastQualityGrade: this.lastForecastQuality.grade,
        forecastSource: this.lastForecastQuality.source,
        forecastActiveSourceId: this.lastLoadForecast?.activeSourceId ?? null,
        forecastActiveSourceTier: this.lastLoadForecast?.activeSourceTier ?? null,
        forecastSourceSelectionReason: this.lastLoadForecast?.sourceSelectionReason ?? null,
        forecastAgeSeconds: this.lastForecastQuality.ageSeconds,
        forecastHorizonSeconds,
        predictedReadyOnTime: actionResult.predictedReadyOnTime,
      });
      this.nextEmsDispatchSeconds = this.timeSeconds;
    }

    return this.lastCommitmentDecision;
  }

  tripLargestDiesel() {
    const online = this.dieselFleet.filter((dg) => dg.isOnline);
    if (!online.length) return null;
    const target = online.reduce((largest, dg) => (dg.ratedMW > largest.ratedMW ? dg : largest), online[0]);
    const preTripMW = target.outputMW;
    target.trip();
    const event = { timeSeconds: this.timeSeconds, type: 'DG_TRIP', equipmentId: target.id, ratedMW: target.ratedMW, preTripMW };
    this.events.push(event);
    this.nextEmsDispatchSeconds = this.timeSeconds;
    this.nextCommitmentEvaluationSeconds = this.timeSeconds;
    return event;
  }

  tripBess() {
    if (!this.bess.isAvailable) return null;
    const preTripMW = this.bess.trip();
    const event = { timeSeconds: this.timeSeconds, type: 'BESS_TRIP', preTripMW, soc: this.bess.soc };
    this.events.push(event);
    this.nextEmsDispatchSeconds = this.timeSeconds;
    this.nextCommitmentEvaluationSeconds = this.timeSeconds;
    return event;
  }

  step() {
    if (!this.running) throw new Error('Simulation engine is not running');

    const loadStepContextFrequencyHz = this.frequencyHz;
    const loadMW = this.load.step(this.dtSeconds, {
      frequencyHz: loadStepContextFrequencyHz,
      rocofHzPerS: this.rocofHzPerS,
      timeSeconds: this.timeSeconds,
    });
    this.runCommitmentIfDue(loadMW);
    this.runEmsIfDue(loadMW);

    const dieselMW = this.dieselFleet.reduce(
      (sum, dg) => sum + dg.step(this.dtSeconds, { frequencyHz: this.frequencyHz }),
      0,
    );
    const dieselEmsSetpointMW = this.dieselFleet.reduce((sum, dg) => sum + dg.emsSetpointMW, 0);
    const dieselMechanicalMW = this.dieselFleet.reduce((sum, dg) => sum + dg.mechanicalMW, 0);
    const dieselPrimaryResponseMW = this.dieselFleet.reduce(
      (sum, dg) => sum + (dg.governorCommandMW - dg.emsSetpointMW),
      0,
    );

    const preBessResidualMW = dieselMW - loadMW;
    const bessCommandMW = commandBessFastResponse({
      bess: this.bess,
      residualBeforeBessMW: preBessResidualMW,
      frequencyHz: this.frequencyHz,
      nominalHz: this.nominalHz,
      rocofHzPerS: this.rocofHzPerS,
    });
    const bessMW = this.bess.step(this.dtSeconds);

    const balance = calculatePowerBalance({ loadMW, dieselMW, bessMW });
    const onlineFleet = this.dieselFleet.filter((dg) => dg.isOnline);
    const totalInertiaSeconds = Math.max(
      0.1,
      onlineFleet.reduce((sum, dg) => sum + dg.inertiaSeconds * dg.ratedMW, 0) / Math.max(this.systemBaseMW, 0.1),
    );

    const frequency = stepIslandFrequency(
      { frequencyHz: this.frequencyHz },
      {
        nominalHz: this.nominalHz,
        systemBaseMW: this.systemBaseMW,
        inertiaSeconds: totalInertiaSeconds,
        loadDampingMWPerHz: 0.02 * this.systemBaseMW,
        generationMW: dieselMW + bessMW,
        loadMW,
      },
      this.dtSeconds,
    );

    this.frequencyHz = frequency.frequencyHz;
    this.rocofHzPerS = frequency.rocofHzPerS;
    this.state = deriveSystemState({
      running: this.running,
      faulted: this.faulted,
      frequencyHz: this.frequencyHz,
      nominalHz: this.nominalHz,
      powerResidualMW: balance.residualMW,
    });

    const reserve = assessReserve({ dieselFleet: this.dieselFleet, bess: this.bess });
    this.timeSeconds += this.dtSeconds;
    const requestedSupportMW = Math.max(0, loadMW - dieselMW);
    const sample = {
      timeSeconds: this.timeSeconds,
      state: this.state,
      loadMW,
      loadStepContextFrequencyHz,
      forecastPeakLoadMW: this.lastLoadForecast?.forecastPeakLoadMW ?? loadMW,
      forecastPeakUpperBoundMW: this.lastLoadForecast?.forecastPeakUpperBoundMW ?? loadMW,
      forecastPlanningLoadMW: this.lastForecastQuality?.effectivePlanningLoadMW ?? loadMW,
      forecastErrorMW: this.lastLoadForecast?.forecastErrorMW ?? 0,
      forecastRiskLevel: this.lastLoadForecast?.forecastRiskLevel ?? 'HIGH',
      forecastStatus: this.lastForecastQuality?.status ?? 'MISSING',
      forecastQualityGrade: this.lastForecastQuality?.grade ?? 'UNKNOWN',
      forecastSource: this.lastForecastQuality?.source ?? 'NONE',
      forecastActiveSourceId: this.lastLoadForecast?.activeSourceId ?? null,
      forecastActiveSourceTier: this.lastLoadForecast?.activeSourceTier ?? null,
      forecastSourceSelectionReason: this.lastLoadForecast?.sourceSelectionReason ?? null,
      forecastSourceSwitchCount: this.lastLoadForecast?.sourceSwitchCount ?? 0,
      forecastAgeSeconds: this.lastForecastQuality?.ageSeconds ?? Infinity,
      forecastValidUntilSeconds: this.lastForecastQuality?.validUntilSeconds ?? null,
      forecastAutomaticStopAllowed: this.lastForecastQuality?.allowAutomaticStop ?? false,
      forecastHorizonSeconds: this.lastLoadForecast?.forecastHorizonSeconds ?? 0,
      dieselMW,
      dieselEmsSetpointMW,
      dieselMechanicalMW,
      dieselPrimaryResponseMW,
      dieselStates: this.dieselFleet.map((dg) => ({ id: dg.id, state: dg.state, outputMW: dg.outputMW })),
      bessCommandMW,
      bessMW,
      bessSoc: this.bess.soc,
      bessAvailable: this.bess.isAvailable,
      bessAvailableDischargeMW: this.bess.availableDischargeMW(),
      bessUsableEnergyMWh: this.bess.usableDischargeEnergyMWh(),
      bessSupportDurationMinutes: this.bess.dischargeDurationMinutes(requestedSupportMW),
      residualMW: balance.residualMW,
      frequencyHz: this.frequencyHz,
      rocofHzPerS: this.rocofHzPerS,
      onlineDieselCount: onlineFleet.length,
      startingDieselCount: this.dieselFleet.filter((dg) => dg.isStarting).length,
      reserveFast10MW: reserve.fast10MW,
      reserve60MW: reserve.reserve60MW,
      reserve600MW: reserve.reserve600MW,
      largestOnlineContingencyMW: reserve.largestOnlineContingencyMW,
      n1Status: reserve.n1Status,
      n1CoverageRatio: reserve.n1CoverageRatio,
      commitmentRequiredForecastMW: this.lastCommitmentDecision?.requiredForecastMW ?? null,
      commitmentForecastShortfallMW: this.lastCommitmentDecision?.forecastCapacityShortfallMW ?? null,
      commitmentUncertaintyExposureMW: this.lastCommitmentDecision?.uncertaintyExposureMW ?? null,
      commitmentStopBlockedByForecastQuality: this.lastCommitmentDecision?.automaticStopBlockedByForecastQuality ?? false,
      emsNextDispatchSeconds: this.nextEmsDispatchSeconds,
      commitmentNextEvaluationSeconds: this.nextCommitmentEvaluationSeconds,
    };
    this.history.push(sample);
    return sample;
  }
}
