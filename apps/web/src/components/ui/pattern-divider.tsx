export function PatternDivider() {
  return (
    <div
      aria-hidden="true"
      className="flex h-8 items-center justify-center opacity-30 my-3"
    >
      <svg
        width="180"
        height="16"
        viewBox="0 0 180 16"
        fill="none"
        className="text-jadwal-text-faint"
      >
        <path d="M0 8h70M110 8h70" stroke="currentColor" strokeWidth="1" />
        <g
          transform="translate(90 8)"
          className="text-jadwal-accent"
          stroke="currentColor"
          strokeWidth="1.2"
          fill="none"
        >
          <path d="M-8 0l8-8 8 8-8 8z" />
          <circle r="2" fill="currentColor" />
        </g>
      </svg>
    </div>
  );
}
