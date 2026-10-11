import { Avatar, Style } from '@dicebear/core';
import shapes from '@dicebear/styles/shapes.json';

const style = new Style(shapes);

/** Local generation only. Seeds contain stable IDs, never names or email addresses. */
export function avatarDataUri(identity: string): string {
  const svg = new Avatar(style, {
    seed: `jelajah:${identity}`,
    backgroundColor: ['e2f0e7', 'edcbb6', 'e5eafa'],
    shape1Color: ['116b58', '448575', '436b83'],
    shape2Color: ['9fdac0', 'e4ac85', 'f6f5f1'],
    shape3Color: ['182b25', '116b58'],
  }).toString();
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
