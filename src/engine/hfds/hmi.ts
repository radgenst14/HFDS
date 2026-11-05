/**
 * HumanMachineInterface state (doc 12). The engine only produces HMI *state*; rendering
 * is in src/client/ui. M1 shows the HFDS-off state; M2 adds updateDisplay() (R46).
 */
import {
  FcsMode,
  HfdsMode,
  LightBarState,
  OnStarStatus,
  SeatVibration,
  type HmiState,
} from '../../shared/domain';

export function initialHmiState(): HmiState {
  return {
    displayedState: HfdsMode.UNAVAILABLE,
    displayedMessage: '',
    activeWarnings: [],
    lightBarStatus: LightBarState.Off,
    availableIndicator: false,
    seatVibration: SeatVibration.off,
    audibleAlert: false,
    hazardLights: false,
    onStar: OnStarStatus.idle,
    doorsUnlocked: false,
    fcsMode: FcsMode.Default,
    updateNeeded: false,
  };
}
