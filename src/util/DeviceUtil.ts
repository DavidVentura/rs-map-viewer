export const checkIphone = () => {
    const u = navigator.userAgent;
    return !!u.match(/iPhone/i);
};
export const checkAndroid = () => {
    const u = navigator.userAgent;
    return !!u.match(/Android/i);
};
export const checkIpad = () => {
    const u = navigator.userAgent;
    return !!u.match(/iPad/i);
};
export const checkMobile = () => {
    const u = navigator.userAgent;
    return !!u.match(/Android/i) || !!u.match(/iPhone/i);
};

export const isWallpaperEngine = !!window.wallpaperRegisterAudioListener;

export const isTouchDevice = !!(
    navigator.maxTouchPoints || "ontouchstart" in document.documentElement
);

export const isWebGL2Supported = !!document.createElement("canvas").getContext("webgl2");

export const isWebGPUSupported = "gpu" in navigator;

export const pixelRatio = window.devicePixelRatio || 1;
