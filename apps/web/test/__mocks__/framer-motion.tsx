import type { ReactNode } from 'react';

// Stub framer-motion to plain DOM wrappers. Animation behaviour is not
// interesting to unit tests, but stripping it avoids `Cannot find module`
// when a component under test imports from framer-motion at the top.
const passthrough = (tag: string) =>
  function Motion({ children, ...props }: { children?: ReactNode; [k: string]: any }) {
    const Tag = tag as any;
    // Drop framer-motion-specific props that React will warn about.
    const {
      initial, animate, exit, transition, variants, whileHover, whileTap,
      whileFocus, whileDrag, whileInView, layout, layoutId, ...rest
    } = props;
    return <Tag {...rest}>{children}</Tag>;
  };

export const motion = new Proxy({}, { get: (_, prop: string) => passthrough(prop) }) as any;
export const AnimatePresence = ({ children }: { children?: ReactNode }) => <>{children}</>;
export const useAnimation = () => ({ start: () => {}, stop: () => {} });
export const useMotionValue = (v: any) => ({ get: () => v, set: () => {}, on: () => () => {} });
export const useTransform = () => ({ get: () => 0 });
