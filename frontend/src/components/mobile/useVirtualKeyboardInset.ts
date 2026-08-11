"use client";

import { useEffect, useState } from "react";

// Returns the number of pixels of the shell hidden behind the on-screen touch
// keyboard. The visualViewport API is used: when the keyboard opens it shows a
// smaller "visual" viewport while window.innerHeight may stay unchanged
// (iOS/Safari), so the difference is the keyboard height. On browsers that
// already resize the layout viewport (Android Chrome) the difference is ~0
// and no extra insetting is needed.
export function useVirtualKeyboardInset(): number {
  const [inset, setInset] = useState(0);

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;

    const update = () => {
      const hidden = Math.max(0, window.innerHeight - vv.height);
      setInset((prev) => (prev !== hidden ? hidden : prev));
    };

    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    update();

    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
    };
  }, []);

  return inset;
}