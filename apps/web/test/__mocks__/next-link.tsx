import type { AnchorHTMLAttributes, ReactNode } from 'react';

export default function Link({
  href, children, ...rest
}: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; children?: ReactNode }) {
  return <a href={href} {...rest}>{children}</a>;
}
