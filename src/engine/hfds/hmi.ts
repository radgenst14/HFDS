/**
 * HumanMachineInterface (doc 12). The engine only produces HMI *state*; src/client/ui
 * renders it.
 *
 * updateDisplay() (R46) maps the HFDS mode to the light bar (doc 13 §6 table; R33, R34)
 * and keeps the IR6 indicator, IR16 "Update needed" and IR22 FCS mode current.
 * Rejections (R16, R49) and control transfers (R40) are shown for a fixed time (A-44).
 */
import {
  CONTROL_TRANSFER_BANNER_S,
  LIGHT_BAR_ERROR_FLASH_S,
  REJECTION_DISPLAY_S,
} from '../../shared/constants';
import {
  FcsMode,
  HfdsMode,
  LightBarState,
  OnStarStatus,
  SeatVibration,
  type DisplayState,
  type HmiState,
  type Warning,
} from '../../shared/domain';

/** Doc 13 §6 light bar mapping (R33, R34, R39.1, R29.1, R30.1, UC19). */
export function lightBarFor(mode: HfdsMode): LightBarState {
  switch (mode) {
    case HfdsMode.HANDS_FREE:
      return LightBarState.SolidGreen;
    case HfdsMode.DRIVER_STEERING:
      return LightBarState.PulsingBlue;
    case HfdsMode.ALERT_FIRST:
      return LightBarState.FlashingGreen;
    case HfdsMode.ALERT_SECOND:
    case HfdsMode.ALERT_FINAL:
    case HfdsMode.TAKEOVER_REQUESTED:
    case HfdsMode.MINIMAL_RISK_MANEUVER:
      return LightBarState.FlashingRed;
    default:
      return LightBarState.Off;
  }
}

export function initialHmiState(): HmiState {
  return {
    displayedState: HfdsMode.UNAVAILABLE,
    displayedMessage: '',
    activeWarnings: [],
    lightBarStatus: LightBarState.Off,
    availableIndicator: false,
    lightBarError: false,
    seatVibration: SeatVibration.off,
    audibleAlert: false,
    hazardLights: false,
    onStar: OnStarStatus.idle,
    doorsUnlocked: false,
    fcsMode: FcsMode.Default,
    updateNeeded: false,
  };
}

interface Timed {
  text: string;
  until: number;
}

export class HumanMachineInterface {
  displayedState: DisplayState = HfdsMode.UNAVAILABLE;
  displayedMessage = '';
  activeWarnings: Warning[] = [];
  lightBarStatus: LightBarState = LightBarState.Off;

  private readonly config: { hasHUD: boolean; hasLightBar: boolean };
  private state: HmiState = initialHmiState();
  private rejection: { dashboard: Timed; hud: Timed | null; warning: Timed } | null = null;
  private lightBarErrorUntil = -Infinity;
  private banner: Timed | null = null;

  constructor(config: { hasHUD: boolean; hasLightBar: boolean }) {
    this.config = config;
  }

  /**
   * R16 (press while unavailable) and R49 (rejected engagement) share one path
   * (ISSUE-29): dashboard error (R16.1), HUD line if fitted (R16.2), light-bar error flash
   * if fitted (R16.3), and an activation warning naming the failed checks (R49).
   */
  showRejection(t: number, dashboardText: string, warningText: string): void {
    const until = t + REJECTION_DISPLAY_S;
    this.rejection = {
      dashboard: { text: dashboardText, until },
      hud: this.config.hasHUD ? { text: dashboardText, until } : null,
      warning: { text: warningText, until },
    };
    if (this.config.hasLightBar) this.lightBarErrorUntil = t + LIGHT_BAR_ERROR_FLASH_S;
  }

  clearRejection(): void {
    this.rejection = null;
    this.lightBarErrorUntil = -Infinity;
  }

  /** R40: announce a transfer of control. */
  showControlTransfer(t: number, text: string): void {
    this.banner = { text, until: t + CONTROL_TRANSFER_BANNER_S };
  }

  displayWarning(w: Warning): void {
    if (!this.activeWarnings.some((x) => x.id === w.id)) this.activeWarnings.push(w);
  }

  removeWarning(w: Warning): void {
    this.activeWarnings = this.activeWarnings.filter((x) => x.id !== w.id);
  }

  /** R46: current system state and active warnings, plus the indicator channels. */
  updateDisplay(
    t: number,
    s: { mode: HfdsMode; available: boolean; updateNeeded: boolean; fcsMode: FcsMode },
  ): void {
    const live = (x: Timed | null | undefined): string | undefined =>
      x && t < x.until - 1e-9 ? x.text : undefined;
    if (this.rejection && t >= this.rejection.dashboard.until - 1e-9) this.rejection = null;

    this.displayedState = s.mode;
    this.lightBarStatus = lightBarFor(s.mode);
    const warningText = live(this.rejection?.warning);
    this.displayedMessage = warningText ?? '';

    const next: HmiState = {
      ...initialHmiState(),
      displayedState: this.displayedState,
      displayedMessage: this.displayedMessage,
      activeWarnings: this.activeWarnings.map((w) => ({ ...w, reqs: [...w.reqs] })),
      lightBarStatus: this.lightBarStatus,
      availableIndicator: s.available,
      lightBarError: t < this.lightBarErrorUntil - 1e-9,
      fcsMode: s.fcsMode,
      updateNeeded: s.updateNeeded,
    };
    const dashboard = live(this.rejection?.dashboard);
    if (dashboard) next.dashboardError = dashboard;
    const hud = live(this.rejection?.hud);
    if (hud) next.hudMessage = hud;
    if (warningText) next.activationWarning = warningText;
    const banner = live(this.banner);
    if (banner) next.controlTransferBanner = banner;
    this.state = next;
  }

  get current(): HmiState {
    return this.state;
  }
}
