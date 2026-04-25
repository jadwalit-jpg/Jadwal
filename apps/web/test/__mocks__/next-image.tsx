import type { ImgHTMLAttributes } from 'react';

// Next.js <Image> drops many props the <img> tag doesn't know about (fill,
// sizes, placeholder, quality, priority, unoptimized, loader, etc.).
// We strip them so jsdom doesn't warn about unknown DOM attrs, then render
// a plain <img>.
export default function NextImage({
  src, alt, width, height, className, loading, style,
}: ImgHTMLAttributes<HTMLImageElement> & { src: string; alt: string; [k: string]: any }) {
  return (
    <img
      src={typeof src === 'string' ? src : ''}
      alt={alt ?? ''}
      width={width}
      height={height}
      className={className}
      loading={loading}
      style={style}
    />
  );
}
