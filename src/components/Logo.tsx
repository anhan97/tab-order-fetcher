/**
 * The app mark: four bars climbing left to right on a rounded tile.
 *
 * Inline SVG rather than an <img src="/logo.svg"> so it costs no request and
 * inherits crispness at any size. public/logo.svg holds the same geometry for
 * anything outside React; scripts/make-logo.cjs rasterises it for favicons.
 *
 * The gradient needs a document-unique id — two <Logo/>s on one page sharing
 * an id would make the second render the first one's fill.
 */
import { useId } from 'react';

interface LogoProps {
  /** Rendered size in px. 16 stays legible; the bars are the only detail. */
  size?: number;
  className?: string;
}

export const Logo = ({ size = 32, className }: LogoProps) => {
  const gradientId = useId();

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      className={className}
      role="img"
      aria-label="Order Manager"
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#14b8a6" />
          <stop offset="1" stopColor="#059669" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="7.25" fill={`url(#${gradientId})`} />
      <g fill="#fff">
        <rect x="7" y="19" width="3.5" height="6" rx="1.75" />
        <rect x="12" y="16" width="3.5" height="9" rx="1.75" />
        <rect x="17" y="12.5" width="3.5" height="12.5" rx="1.75" />
        <rect x="22" y="7" width="3.5" height="18" rx="1.75" />
      </g>
    </svg>
  );
};
