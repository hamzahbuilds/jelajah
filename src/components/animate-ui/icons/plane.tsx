'use client';

import * as React from 'react';
import { motion, type Variants } from 'motion/react';

import {
  getVariants,
  useAnimateIconContext,
  IconWrapper,
  type IconProps,
} from '@animate-ui/react/icons';

type PlaneProps = IconProps<keyof typeof animations>;

// Lucide's plane (not in Animate UI's registry; same drawing as our sprite).
// It flies a little: a hop toward its nose, up-right (2.5 units on the 24 grid),
// with a slight nose-up tilt, then settles back (icons.md: small amplitudes, one gesture).
const animations = {
  default: {
    path: {
      initial: { x: 0, y: 0, rotate: 0 },
      animate: {
        x: [0, 2.5, 0],
        y: [0, -2.5, 0],
        rotate: [0, -8, 0],
        transition: { duration: 0.8, ease: 'easeInOut' },
      },
    },
  } satisfies Record<string, Variants>,
} as const;

function IconComponent({ size, ...props }: PlaneProps) {
  const { controls } = useAnimateIconContext();
  const variants = getVariants(animations);

  return (
    <motion.svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      initial="initial"
      animate={controls}
      {...props}
    >
      <motion.path
        d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z"
        className="jl-icon-pivot-center"
        variants={variants.path}
        initial="initial"
        animate={controls}
      />
    </motion.svg>
  );
}

function Plane(props: PlaneProps) {
  return <IconWrapper icon={IconComponent} {...props} />;
}

export {
  animations,
  Plane,
  Plane as PlaneIcon,
  type PlaneProps,
  type PlaneProps as PlaneIconProps,
};
