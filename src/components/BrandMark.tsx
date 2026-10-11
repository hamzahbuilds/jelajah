/** The rounded journey path forms a lowercase j; the dot is its destination. */
export default function BrandMark({ size = 32 }: { size?: number }) {
  return <img src="/icon.svg" width={size} height={size} alt="" aria-hidden="true" className="brand-mark" />;
}
