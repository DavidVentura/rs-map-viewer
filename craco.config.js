const { when, whenDev, addBeforeLoader, loaderByName } = require("@craco/craco");

const ThreadsPlugin = require("threads-plugin");
const JsonMinimizerPlugin = require("json-minimizer-webpack-plugin");
const ForkTsCheckerWebpackPlugin = require("fork-ts-checker-webpack-plugin");

// The pack server (src/server/main.ts) runs beside the dev server under npm start, which sets
// its port; the browser reaches it as /packs on the page's own origin.
function packServerTarget() {
    const port = process.env.PACK_SERVER_PORT;
    if (!port) {
        throw new Error("PACK_SERVER_PORT is not set: run the dev server through npm start");
    }
    return `http://127.0.0.1:${port}`;
}

module.exports = {
    webpack: {
        configure: (webpackConfig, { env }) => {
            const glslLoader = {
                test: /\.(glsl|vs|fs)$/,
                loader: "ts-shader-loader",
            };

            // Kind of a hack to get the glsl loader to work
            // https://github.com/dilanx/craco/issues/486
            for (const rule of webpackConfig.module.rules) {
                if (rule.oneOf) {
                    rule.oneOf.unshift(glslLoader);
                    break;
                }
            }

            webpackConfig.module.rules.push({
                resourceQuery: /source/,
                type: "asset/source",
            });

            // addBeforeLoader(webpackConfig, loaderByName('file-loader'), glslLoader);

            webpackConfig.resolve.fallback = {
                fs: false,
            };

            webpackConfig.optimization.minimizer.push(new JsonMinimizerPlugin());

            const typeCheckerIndex = webpackConfig.plugins.findIndex(
                (plugin) => plugin instanceof ForkTsCheckerWebpackPlugin,
            );
            if (typeCheckerIndex === -1) {
                throw new Error(
                    "CRA's ForkTsCheckerWebpackPlugin is missing from the webpack config",
                );
            }
            if (env === "development") {
                // The dev server doesn't type-check: CRA's in-process checker re-checks the whole
                // project on every save and competes with the game for CPU. Type checking runs as
                // `npx tsc --noEmit -p .` instead.
                webpackConfig.plugins.splice(typeCheckerIndex, 1);
            } else {
                // CRA's type checker takes its file list from tsconfig's include and registers every
                // file as a webpack watch dependency, so editing a test would rebuild the app. Tests
                // stay type-checked by tsc against the root tsconfig.
                webpackConfig.plugins[typeCheckerIndex].options.typescript.configOverwrite.exclude =
                    [
                        "**/*.test.ts",
                        "**/*.test.tsx",
                        "src/setupTests.ts",
                        "src/mapviewer/game/testLoaders.ts",
                    ];
            }

            return webpackConfig;
        },
        plugins: [new ThreadsPlugin()],
    },
    // A function, so the pack server's port is only required when the dev server starts, not when
    // craco builds or tests.
    devServer: (devServerConfig) => ({
        ...devServerConfig,
        headers: {
            "Cross-Origin-Opener-Policy": "same-origin",
            "Cross-Origin-Embedder-Policy": "require-corp",
        },
        client: {
            ...devServerConfig.client,
            overlay: {
                errors: true,
                warnings: false,
                runtimeErrors: (error) => {
                    if (error instanceof DOMException && error.name === "AbortError") {
                        return false;
                    }
                    return true;
                },
            },
        },
        proxy: {
            "/packs": { target: packServerTarget() },
        },
    }),
};
