import type { ARJigViewProps } from "./ARJig.types";

/**
 * Web has no ARKit. Rendering nothing is the honest result: check
 * `ARJigModule.isSupported` and render your own fallback instead of relying on
 * this component to tell you.
 */
export default function ARJigView(_props: ARJigViewProps) {
  return null;
}
