import { useEffect, useLayoutEffect, useRef } from "react";

export function useAnimationFrameLoop(onFrame: (time: DOMHighResTimeStamp) => void): void {
    const onFrameRef = useRef(onFrame);

    // A layout effect updates the ref during the commit, so the next frame already sees the
    // closure over the committed state instead of the one from the render before it.
    useLayoutEffect(() => {
        onFrameRef.current = onFrame;
    });

    useEffect(() => {
        let frameId: number;
        const loop = (time: DOMHighResTimeStamp) => {
            onFrameRef.current(time);
            frameId = requestAnimationFrame(loop);
        };
        frameId = requestAnimationFrame(loop);
        return () => cancelAnimationFrame(frameId);
    }, []);
}
