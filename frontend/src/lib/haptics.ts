// A short haptic tick for touch gestures (pager swipes). Android browsers
// support the Vibration API; iOS Safari doesn't, but since iOS 18 toggling a
// switch-style checkbox plays the system haptic, so a hidden one is clicked
// instead. Must run inside a user gesture (e.g. a touchend handler).

let iosSwitch: HTMLLabelElement | null = null;

export function haptic(): void {
  if (typeof navigator.vibrate === "function") {
    navigator.vibrate(10);
    return;
  }
  if (!iosSwitch) {
    iosSwitch = document.createElement("label");
    iosSwitch.dataset.haptic = "";
    iosSwitch.setAttribute("aria-hidden", "true");
    iosSwitch.style.cssText =
      "position:fixed;left:-100px;top:0;width:1px;height:1px;overflow:hidden;opacity:0;pointer-events:none";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.setAttribute("switch", "");
    input.tabIndex = -1;
    iosSwitch.appendChild(input);
    document.body.appendChild(iosSwitch);
  }
  iosSwitch.click();
}

/** Whether a click comes from haptic() (click guards must let it through). */
export function isHapticClick(e: Event): boolean {
  return e.target instanceof Element && e.target.closest("[data-haptic]") !== null;
}
