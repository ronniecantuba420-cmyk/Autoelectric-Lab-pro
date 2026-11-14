import { InjectedFault } from '../../types/ecu';
import { CircuitNetwork } from '../electrical/CircuitNetwork';

/**
 * FaultManager: Applies physical topological faults directly into the MNA electrical circuit network.
 * Supports multiple simultaneous faults without overwriting.
 */
export class FaultManager {
  /**
   * Returns physical series contact/break resistance (Ohms) introduced at a pin terminal
   * by OPEN_CIRCUIT or HIGH_RESISTANCE_* faults.
   */
  public static getSeriesFaultOhms(faults: InjectedFault[], pinId: string): number {
    const normPinId = pinId.toLowerCase();
    let extraOhms = 0;

    for (const fault of faults) {
      if (fault.pinId.toLowerCase() !== normPinId) continue;
      switch (fault.faultType) {
        case 'OPEN_CIRCUIT':
          return 1e9;
        case 'HIGH_RESISTANCE_50R':
          extraOhms += 50.0;
          break;
        case 'HIGH_RESISTANCE_250R':
          extraOhms += 250.0;
          break;
        case 'HIGH_RESISTANCE_1K':
          extraOhms += 1000.0;
          break;
        default:
          break;
      }
    }

    return extraOhms;
  }

  /**
   * Applies topological shunt faults (SHORT_TO_GND / SHORT_TO_VBAT) directly to the MNA network.
   * Series faults (OPEN_CIRCUIT / HIGH_RESISTANCE_*) are inserted in-series along pin/wire branches
   * during network stamping via `getSeriesFaultOhms`.
   */
  public static applyFaults(network: CircuitNetwork, faults: InjectedFault[]): void {
    for (const fault of faults) {
      const pinNode = fault.pinId.toLowerCase();

      switch (fault.faultType) {
        case 'SHORT_TO_GND':
          // Low-impedance 0.01Ω direct path to Ground (Node 0)
          network.addResistor(`fault-short-gnd-${fault.pinId}`, pinNode, 'chassis-gnd', 0.01);
          break;

        case 'SHORT_TO_VBAT':
          // Low-impedance 0.01Ω direct path to Battery Positive (+12V Rail)
          network.addResistor(`fault-short-vbat-${fault.pinId}`, pinNode, 'bench-vbat', 0.01);
          break;

        case 'OPEN_CIRCUIT':
          // Maintain tiny Gmin bleed (10^9 Ω) to prevent singular floating pin nodes
          network.addResistor(`fault-open-bleed-${fault.pinId}`, pinNode, 'chassis-gnd', 1e9);
          break;

        default:
          break;
      }
    }
  }
}
