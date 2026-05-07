import { useEffect, useRef } from 'react';

/**
 * Horizontal drag-to-scroll on a wide table/container. Hovering shows a
 * grab cursor; mousedown + drag scrolls horizontally; releasing snaps back
 * to grab. Click handlers (checkboxes, buttons) inside still work — we only
 * swallow the click if the user actually dragged > THRESHOLD pixels.
 */
const DRAG_THRESHOLD_PX = 5;

export function useDragScroll<T extends HTMLElement = HTMLDivElement>() {
  const ref = useRef<T | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    let isDown = false;
    let startX = 0;
    let startScrollLeft = 0;
    let hasMoved = false;

    el.style.cursor = 'grab';
    el.style.userSelect = 'none';

    const onPointerDown = (e: PointerEvent) => {
      // Don't hijack drag from interactive children — buttons, checkboxes,
      // dropdown triggers should still receive the click cleanly.
      const target = e.target as HTMLElement;
      if (target.closest('button, input, select, [role="checkbox"], [role="combobox"], [data-no-drag]')) {
        return;
      }
      isDown = true;
      hasMoved = false;
      startX = e.pageX;
      startScrollLeft = el.scrollLeft;
      el.style.cursor = 'grabbing';
    };

    const onPointerMove = (e: PointerEvent) => {
      if (!isDown) return;
      const dx = e.pageX - startX;
      if (Math.abs(dx) > DRAG_THRESHOLD_PX) hasMoved = true;
      el.scrollLeft = startScrollLeft - dx;
    };

    const onPointerUp = () => {
      if (!isDown) return;
      isDown = false;
      el.style.cursor = 'grab';
    };

    // Swallow the click that follows a real drag so checkboxes don't toggle
    // when the user was just panning.
    const onClickCapture = (e: MouseEvent) => {
      if (hasMoved) {
        e.stopPropagation();
        e.preventDefault();
        hasMoved = false;
      }
    };

    el.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    el.addEventListener('click', onClickCapture, true);

    return () => {
      el.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      el.removeEventListener('click', onClickCapture, true);
    };
  }, []);

  return ref;
}
