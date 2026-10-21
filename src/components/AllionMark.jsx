import { useId } from 'react';

// The Allion mark in its brand colours (blue bar, orange bar, cyan dot).
// `tone="dark"` lifts the blue so it reads on dark backgrounds; `light` keeps
// the logo's deeper navy for light backgrounds.
const BLUES = {
  dark: ['#1b63b0', '#3d8bfd'],
  light: ['#0f4a80', '#1f6fc0'],
};

export default function AllionMark({ className, tone = 'dark' }) {
  const gradientId = useId();
  const [from, to] = BLUES[tone] || BLUES.dark;
  return (
    <svg aria-hidden="true" className={className} viewBox="0 0 60 54">
      <defs>
        <linearGradient id={gradientId} x1="0" y1="1" x2="0.6" y2="0">
          <stop offset="0" stopColor={from} />
          <stop offset="1" stopColor={to} />
        </linearGradient>
      </defs>
      <path d="M9 46 30 8" stroke={`url(#${gradientId})`} strokeWidth="12" strokeLinecap="round" />
      <path d="M29 46 39 28" stroke="#f8a627" strokeWidth="12" strokeLinecap="round" />
      <circle cx="51" cy="45" r="6.5" fill="#1fb0ea" />
    </svg>
  );
}
