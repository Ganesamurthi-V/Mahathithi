import type React from 'react';

// True only while the current press started on the dark backdrop itself.
let pressStartedOnBackdrop = false;

/**
 * Props for a modal's backdrop: close only when the press AND the release both happen on the
 * backdrop. A plain onClick also fires when text is selected inside the dialog and the mouse is
 * released outside it (the click then lands on the common ancestor, the backdrop), which closed
 * forms halfway through filling them in.
 */
export function overlayClose(onClose?: () => void) {
  return {
    onMouseDown: (e: React.MouseEvent) => {
      pressStartedOnBackdrop = e.target === e.currentTarget;
    },
    onClick: (e: React.MouseEvent) => {
      const closing = pressStartedOnBackdrop && e.target === e.currentTarget;
      pressStartedOnBackdrop = false;
      if (closing) onClose?.();
    },
  };
}
