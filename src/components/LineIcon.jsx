// Small outline icons (24px grid, currentColor) for License Utilizations.
const PATHS = {
  layers: ['M12 3 3 8l9 5 9-5-9-5Z', 'm3 13 9 5 9-5', 'm3 17.5 9 5 9-5'],
  users: ['M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z', 'M2 21a7 7 0 0 1 14 0', 'M16 3.5a4 4 0 0 1 0 7.5', 'M18 14a6 6 0 0 1 4 6.5'],
  box: ['m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Z', 'm4 7.5 8 4.5 8-4.5', 'M12 12v9'],
  coins: ['M9 8c3.9 0 7-1.3 7-3s-3.1-3-7-3-7 1.3-7 3 3.1 3 7 3Z', 'M2 5v5c0 1.7 3.1 3 7 3s7-1.3 7-3V5', 'M2 10v5c0 1.7 3.1 3 7 3', 'M15 13c3.9 0 7-1.3 7-3', 'M22 10v8c0 1.7-3.1 3-7 3s-7-1.3-7-3'],
  search: ['M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14Z', 'm20 20-4-4'],
  calendar: ['M4 6h16v14H4z', 'M4 10h16', 'M8 3v4', 'M16 3v4'],
  monitor: ['M3 4h18v12H3z', 'M8 20h8', 'M12 16v4'],
  cloud: ['M7 18a5 5 0 0 1-.5-10A6 6 0 0 1 18 9a4.5 4.5 0 0 1-.5 9H7Z'],
};

export default function LineIcon({ name, size = 18, className = '' }) {
  return (
    <svg
      aria-hidden="true"
      className={`line-icon ${className}`}
      fill="none"
      height={size}
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.7"
      viewBox="0 0 24 24"
      width={size}
    >
      {(PATHS[name] || []).map((d) => <path d={d} key={d} />)}
    </svg>
  );
}
