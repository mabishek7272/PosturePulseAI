import { requireNativeView } from "expo";
import * as React from "react";

import type { ARJigViewProps, ARJigViewRef } from "./ARJig.types";

// View-level AsyncFunctions declared in ARJigModule.swift land directly on this
// ref, so it is forwarded straight through rather than wrapped.
const NativeView: React.ComponentType<
  ARJigViewProps & { ref?: React.Ref<ARJigViewRef> }
> = requireNativeView("ARJig");

export default React.forwardRef<ARJigViewRef, ARJigViewProps>(function ARJigView(props, ref) {
  return <NativeView {...props} ref={ref} />;
});
