import { mat4 } from "gl-matrix";

import { screenToGroundPoint, worldToScreen } from "./groundPoint";

function buildViewProjMatrix(): mat4 {
    const proj = mat4.create();
    mat4.perspective(proj, Math.PI / 3, 800 / 600, 0.1, 1000);
    const view = mat4.create();
    mat4.lookAt(view, [0, 10, 20], [0, 0, 0], [0, 1, 0]);
    const viewProj = mat4.create();
    mat4.multiply(viewProj, proj, view);
    return viewProj;
}

describe("worldToScreen", () => {
    const viewProjMatrix = buildViewProjMatrix();
    const width = 800;
    const height = 600;

    it("round-trips through screenToGroundPoint", () => {
        const worldX = 256;
        const worldY = 128;
        const groundHeight = -640;

        const screen = worldToScreen(viewProjMatrix, worldX, worldY, groundHeight, width, height);
        expect(screen).toBeDefined();

        const ground = screenToGroundPoint(
            viewProjMatrix,
            screen!.x,
            screen!.y,
            width,
            height,
            groundHeight,
        );
        expect(ground).toBeDefined();
        expect(ground!.x).toBeCloseTo(worldX, 1);
        expect(ground!.y).toBeCloseTo(worldY, 1);
    });

    it("is the inverse of screenToGroundPoint for an arbitrary screen point", () => {
        const screenX = 500;
        const screenY = 200;
        const groundHeight = 0;

        const ground = screenToGroundPoint(
            viewProjMatrix,
            screenX,
            screenY,
            width,
            height,
            groundHeight,
        );
        expect(ground).toBeDefined();

        const screen = worldToScreen(
            viewProjMatrix,
            ground!.x,
            ground!.y,
            groundHeight,
            width,
            height,
        );
        expect(screen).toBeDefined();
        expect(screen!.x).toBeCloseTo(screenX, 1);
        expect(screen!.y).toBeCloseTo(screenY, 1);
    });

    it("returns undefined for a point behind the camera", () => {
        const behind = worldToScreen(viewProjMatrix, 0, 100000, 0, width, height);
        expect(behind).toBeUndefined();
    });
});
