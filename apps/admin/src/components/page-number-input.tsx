'use client';

import type { InputHTMLAttributes } from 'react';

import { typedDigits } from '@safra/contracts';

/**
 * The pager's page box, as a field that reads «١٢» as 12.
 *
 * It was `type="number"`, and Chromium DROPS Arabic-Indic digits from a number field: an operator
 * typing «٤» on an Arabic keyboard submitted an empty box and landed on page one (go-live audit,
 * 2026-10-06). A text field with the numeric pad, normalised as it is typed, like every other
 * numeric control in the console. Its own client file because `TablePagination` renders on the
 * server; the save endpoint normalises too, for a submit without JavaScript.
 */
export function PageNumberInput(
  props: Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'onChange'>,
) {
  return (
    <input
      {...props}
      type="text"
      inputMode="numeric"
      autoComplete="off"
      onChange={(event) => typedDigits(event.currentTarget)}
    />
  );
}
